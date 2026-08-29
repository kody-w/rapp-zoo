import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Callable, Protocol

import httpx

from .domain import CreditError, bounded_text, validate_sha256


class QuoteUnavailable(CreditError):
    code = "btc_quote_unavailable"
    status_code = 503


class StaleQuote(CreditError):
    code = "btc_quote_stale"
    status_code = 503


@dataclass(frozen=True)
class BtcUsdQuote:
    source: str
    observed_utc: str
    raw_response_hash: str
    btc_usd_micros: int


class BtcUsdQuoteProvider(Protocol):
    def fetch(self) -> BtcUsdQuote:
        ...


def _usd_micros(value: Any) -> int:
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise QuoteUnavailable("BTC/USD provider returned an invalid price.") from error
    if not decimal_value.is_finite() or decimal_value <= 0:
        raise QuoteUnavailable("BTC/USD provider returned an invalid price.")
    micros = int((decimal_value * Decimal(1_000_000)).quantize(
        Decimal("1"),
        rounding=ROUND_HALF_UP,
    ))
    if micros < 1:
        raise QuoteUnavailable("BTC/USD provider returned an invalid price.")
    return micros


class PublicHttpQuoteProvider:
    def __init__(
        self,
        *,
        source: str,
        url: str,
        parser: Callable[[dict[str, Any]], Any],
        fetch_impl: Callable[..., httpx.Response] | None = None,
        now: Callable[[], datetime] | None = None,
    ):
        self.source = source
        self.url = url
        self.parser = parser
        self.fetch_impl = fetch_impl
        self.now = now or (lambda: datetime.now(timezone.utc))

    def fetch(self) -> BtcUsdQuote:
        try:
            if self.fetch_impl is None:
                with httpx.Client(
                    timeout=httpx.Timeout(5.0, connect=2.0),
                    follow_redirects=False,
                ) as client:
                    response = client.get(self.url, headers={"accept": "application/json"})
            else:
                response = self.fetch_impl(
                    self.url,
                    headers={"accept": "application/json"},
                )
            if response.status_code != 200 or len(response.content) > 65_536:
                raise QuoteUnavailable("BTC/USD provider is unavailable.")
            raw = bytes(response.content)
            parsed = response.json()
            price = _usd_micros(self.parser(parsed))
        except QuoteUnavailable:
            raise
        except Exception as error:
            raise QuoteUnavailable("BTC/USD provider is unavailable.") from error
        return BtcUsdQuote(
            source=self.source,
            observed_utc=self.now().isoformat(timespec="seconds"),
            raw_response_hash=hashlib.sha256(raw).hexdigest(),
            btc_usd_micros=price,
        )


class FallbackQuoteProvider:
    def __init__(self, providers: list[BtcUsdQuoteProvider]):
        self.providers = providers

    def fetch(self) -> BtcUsdQuote:
        for provider in self.providers:
            try:
                return provider.fetch()
            except QuoteUnavailable:
                continue
        raise QuoteUnavailable("All configured BTC/USD quote providers are unavailable.")


def configured_quote_provider() -> BtcUsdQuoteProvider:
    return FallbackQuoteProvider([
        PublicHttpQuoteProvider(
            source="coinbase-btc-usd-spot",
            url="https://api.coinbase.com/v2/prices/BTC-USD/spot",
            parser=lambda body: body["data"]["amount"],
        ),
        PublicHttpQuoteProvider(
            source="kraken-xbt-usd-ticker",
            url="https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
            parser=lambda body: next(iter(body["result"].values()))["c"][0],
        ),
    ])


def validate_fresh_quote(
    quote: BtcUsdQuote,
    *,
    now: datetime,
    maximum_age_seconds: int,
) -> BtcUsdQuote:
    try:
        observed = datetime.fromisoformat(quote.observed_utc)
    except ValueError as error:
        raise StaleQuote("BTC/USD quote observation time is invalid.") from error
    if observed.tzinfo is None:
        raise StaleQuote("BTC/USD quote observation time lacks a timezone.")
    age = (now - observed.astimezone(timezone.utc)).total_seconds()
    if age < -5 or age > maximum_age_seconds:
        raise StaleQuote("BTC/USD quote is outside the allowed freshness window.")
    if quote.btc_usd_micros < 1:
        raise QuoteUnavailable("BTC/USD quote value is invalid.")
    try:
        source = bounded_text(quote.source, "BTC/USD quote source", 128)
        raw_response_hash = validate_sha256(
            quote.raw_response_hash,
            "BTC/USD quote evidence hash",
        )
    except CreditError as error:
        raise QuoteUnavailable(str(error)) from error
    return BtcUsdQuote(
        source=source,
        observed_utc=quote.observed_utc,
        raw_response_hash=raw_response_hash,
        btc_usd_micros=quote.btc_usd_micros,
    )
