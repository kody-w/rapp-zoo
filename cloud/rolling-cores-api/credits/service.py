import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from .domain import (
    DOWNLOAD_SCHEMA,
    TIERS,
    CreditError,
    CreditConflict,
    ProductCatalog,
    birth_value_usd_micros,
    bounded_text,
    hash_reference,
    mint_credit_id,
    signature_payload,
    unsigned_credit_payload,
    validate_credit_id,
    validate_organism_rappid,
    validate_sha256,
    validate_signed_credit,
)
from .purchases import PurchaseVerifier
from .quotes import BtcUsdQuoteProvider, validate_fresh_quote
from .repository import CreditRepository
from .signing import RegistrySigner
from .valuation import (
    build_unsigned_schedule,
    schedule_signature_payload,
    validate_signed_schedule,
)


REDEEM_KEYS = {
    "provider",
    "receipt",
    "product_id",
    "set_id",
    "tier",
    "organism_rappid",
    "genesis_core_id",
    "core_manifest_hash",
}
PUBLISH_SCHEDULE_KEYS = {"set_id", "tiers"}
AUTHORIZE_KEYS = {"credit_id", "organism_rappid", "core_manifest_hash"}


def _exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CreditError(f"{label} must be an object.")
    unknown = sorted(set(value) - keys)
    if unknown:
        raise CreditError(f"{label} contains unknown field: {unknown[0]}.")
    return value


def _set_lookup_hash(set_id: str) -> str:
    return hashlib.sha256(set_id.encode("utf-8")).hexdigest()


class CreditService:
    def __init__(
        self,
        *,
        issuer: str,
        issuance_cap: int,
        quote_max_age_seconds: int,
        catalog: ProductCatalog,
        verifier: PurchaseVerifier,
        quote_provider: BtcUsdQuoteProvider,
        signer: RegistrySigner,
        repository: CreditRepository,
        now: Callable[[], datetime] | None = None,
    ):
        self.issuer = bounded_text(issuer, "issuer", 128)
        if (
            isinstance(issuance_cap, bool)
            or not isinstance(issuance_cap, int)
            or issuance_cap < 1
            or issuance_cap > 999_999_999_999
        ):
            raise RuntimeError("CREDIT_ISSUANCE_CAP must be a positive integer.")
        if (
            isinstance(quote_max_age_seconds, bool)
            or not isinstance(quote_max_age_seconds, int)
            or quote_max_age_seconds < 1
            or quote_max_age_seconds > 3_600
        ):
            raise RuntimeError("BTC_QUOTE_MAX_AGE_SECONDS is invalid.")
        self.issuance_cap = issuance_cap
        self.quote_max_age_seconds = quote_max_age_seconds
        self.catalog = catalog
        self.verifier = verifier
        self.quote_provider = quote_provider
        self.signer = signer
        self.repository = repository
        self.now = now or (lambda: datetime.now(timezone.utc))

    def issuer_descriptor(self, key_id: str | None = None) -> dict[str, Any]:
        return {
            "schema": "rappter-credit-issuer/1",
            "issuer": self.issuer,
            "registry_schema": "rappter-credit-registry-entry/1",
            "canonical_credit_payload_schema": "rapp-rapter-credit/1",
            "valuation_schema": "rappter-valuation-schedule/1",
            **self.signer.descriptor(key_id),
        }

    def publish_schedule(self, request: Any) -> dict[str, Any]:
        value = _exact_object(request, PUBLISH_SCHEDULE_KEYS, "valuation schedule request")
        set_id = bounded_text(value.get("set_id"), "set_id", 128)
        tiers = value.get("tiers")
        issued_at = self.now().isoformat(timespec="seconds")

        def build_record(index: int, previous_hash: str | None) -> dict[str, Any]:
            payload = build_unsigned_schedule(
                issuer=self.issuer,
                schedule_index=index,
                set_id=set_id,
                tiers=tiers,
                issued_at=issued_at,
                previous_schedule_hash=previous_hash,
            )
            return {**payload, "signature": self.signer.sign(payload)}

        return self.repository.publish_schedule(
            set_lookup_hash=_set_lookup_hash(set_id),
            build_record=build_record,
        )

    def list_schedules(self, after_value: Any, limit_value: Any) -> dict[str, Any]:
        after, limit = self._pagination(after_value, limit_value)
        records = self.repository.list_schedules(after, limit)
        return {
            "object": "list",
            "data": records,
            "next_after": records[-1]["schedule_index"] if records else after,
        }

    def get_current_schedule(self, set_id_value: Any) -> dict[str, Any]:
        set_id = bounded_text(set_id_value, "set_id", 128)
        return self._official_schedule(set_id)

    def quote(self, set_id_value: Any) -> dict[str, Any]:
        set_id = bounded_text(set_id_value, "set_id", 128)
        schedule = self._official_schedule(set_id)
        quote = validate_fresh_quote(
            self.quote_provider.fetch(),
            now=self.now(),
            maximum_age_seconds=self.quote_max_age_seconds,
        )
        tiers = []
        for tier in TIERS:
            fraction = schedule["tiers"][tier]
            tiers.append({
                "tier": tier,
                "btc_fraction": {
                    "numerator": fraction["numerator"],
                    "denominator": fraction["denominator"],
                },
                "price_sats": fraction["price_sats"],
                "birth_value_usd_micros": birth_value_usd_micros(
                    fraction["price_sats"],
                    quote.btc_usd_micros,
                ),
            })
        return {
            "object": "rapter_birth_valuation_quote",
            "language": "official issuer value",
            "set_id": set_id,
            "schedule_id": schedule["schedule_id"],
            "schedule_hash": schedule["schedule_hash"],
            "products": self.catalog.public_listing(),
            "btc_quote": {
                "source": quote.source,
                "observed_utc": quote.observed_utc,
                "raw_response_hash": quote.raw_response_hash,
                "btc_usd_micros": quote.btc_usd_micros,
            },
            "tiers": tiers,
        }

    def redeem(self, request: Any) -> tuple[dict[str, Any], bool]:
        value = _exact_object(request, REDEEM_KEYS, "redemption request")
        provider = bounded_text(value.get("provider"), "provider", 64).lower()
        receipt = bounded_text(value.get("receipt"), "receipt", 50_000)
        product = self.catalog.get(value.get("product_id"))
        set_id = bounded_text(value.get("set_id"), "set_id", 128)
        tier = bounded_text(value.get("tier"), "tier", 32).lower()
        if tier not in TIERS:
            raise CreditError("tier is invalid.")
        organism_rappid = validate_organism_rappid(value.get("organism_rappid"))
        genesis_core_id = validate_sha256(value.get("genesis_core_id"), "genesis_core_id")
        core_manifest_hash = validate_sha256(
            value.get("core_manifest_hash"),
            "core_manifest_hash",
        )
        purchase = self.verifier.verify(provider, receipt, product.product_id).normalized()
        if purchase.provider != provider or purchase.product_id != product.product_id:
            raise CreditError("Verified purchase does not match the redemption request.")
        payment_reference_hash = hash_reference(
            purchase.provider,
            purchase.payment_reference,
        )
        owner_reference_hash = hash_reference("owner", purchase.owner_reference)
        existing = self.repository.get_by_payment_hash(payment_reference_hash)
        if existing is not None:
            self._assert_same_redemption(
                existing,
                product.product_id,
                set_id,
                tier,
                organism_rappid,
                genesis_core_id,
                core_manifest_hash,
            )
            return existing, False
        credit_id = mint_credit_id()

        conception = self.now()
        conception_utc = conception.isoformat(timespec="seconds")
        schedule = self._official_schedule(set_id)
        fraction = schedule["tiers"][tier]
        quote = validate_fresh_quote(
            self.quote_provider.fetch(),
            now=self.now(),
            maximum_age_seconds=self.quote_max_age_seconds,
        )
        price_sats = fraction["price_sats"]
        birth_value = birth_value_usd_micros(price_sats, quote.btc_usd_micros)
        quote_evidence = {
            "source": quote.source,
            "observed_utc": quote.observed_utc,
            "raw_response_hash": quote.raw_response_hash,
            "btc_usd_micros": quote.btc_usd_micros,
        }
        organism_lookup_hash = hashlib.sha256(organism_rappid.encode("utf-8")).hexdigest()

        def build_record(index: int, cap: int) -> dict[str, Any]:
            payload = unsigned_credit_payload(
                issuer=self.issuer,
                credit_id=credit_id,
                issuance_index=index,
                issuance_cap=cap,
                issued_at=conception_utc,
                purchase=purchase,
                payment_reference_hash=payment_reference_hash,
                owner_reference_hash=owner_reference_hash,
                product=product,
                set_id=set_id,
                tier=tier,
                fraction={
                    "numerator": fraction["numerator"],
                    "denominator": fraction["denominator"],
                },
                price_sats=price_sats,
                btc_quote=quote_evidence,
                birth_value=birth_value,
                valuation_schedule_id=schedule["schedule_id"],
                valuation_schedule_hash=schedule["schedule_hash"],
                conception_utc=conception_utc,
                organism_rappid=organism_rappid,
                genesis_core_id=genesis_core_id,
                core_manifest_hash=core_manifest_hash,
            )
            return {**payload, "signature": self.signer.sign(payload)}

        return self.repository.issue(
            credit_id=credit_id,
            payment_reference_hash=payment_reference_hash,
            organism_lookup_hash=organism_lookup_hash,
            issuance_cap=self.issuance_cap,
            set_lookup_hash=_set_lookup_hash(set_id),
            schedule_id=schedule["schedule_id"],
            build_record=build_record,
        )

    def get_credit(self, credit_id: Any) -> dict[str, Any]:
        return self.repository.get_credit(validate_credit_id(credit_id))

    def get_by_organism(self, organism_rappid: Any) -> dict[str, Any]:
        normalized = validate_organism_rappid(organism_rappid)
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        return self.repository.get_by_organism_hash(digest)

    def list_credits(self, after_value: Any, limit_value: Any) -> dict[str, Any]:
        after, limit = self._pagination(after_value, limit_value)
        records = self.repository.list_credits(after, limit)
        return {
            "object": "list",
            "data": records,
            "next_after": records[-1]["issuance_index"] if records else after,
        }

    def verify(self, record: Any) -> dict[str, Any]:
        validated = validate_signed_credit(record)
        valid = self._credit_is_valid(validated)
        return {
            "valid": valid,
            "credit_id": validated["credit_id"],
            "issuer": validated["issuer"],
        }

    def verify_schedule(self, record: Any) -> dict[str, Any]:
        validated = validate_signed_schedule(record)
        return {
            "valid": (
                validated["issuer"] == self.issuer
                and self.signer.verify(
                    schedule_signature_payload(validated),
                    validated["signature"],
                )
            ),
            "schedule_id": validated["schedule_id"],
            "issuer": validated["issuer"],
            "schema": validated["schema"],
        }

    def authorize_capsule(self, request: Any) -> dict[str, Any]:
        value = _exact_object(request, AUTHORIZE_KEYS, "capsule authorization request")
        credit_id = validate_credit_id(value.get("credit_id"))
        organism_rappid = validate_organism_rappid(value.get("organism_rappid"))
        manifest_hash = validate_sha256(
            value.get("core_manifest_hash"),
            "core_manifest_hash",
        )
        credit = self.repository.get_credit(credit_id)
        if (
            credit["organism_rappid"] != organism_rappid
            or credit["core_manifest_hash"] != manifest_hash
            or credit["status"] != "active"
            or not self._credit_is_valid(credit)
        ):
            raise CreditError("The credit does not authorize this capsule.")
        issued = self.now()
        expires = issued + timedelta(minutes=5)
        payload = {
            "schema": DOWNLOAD_SCHEMA,
            "issuer": self.issuer,
            "authorization_id": "cap_" + hashlib.sha256(
                f"{credit_id}\0{secrets.token_urlsafe(24)}".encode("utf-8"),
            ).hexdigest()[:32],
            "credit_id": credit_id,
            "organism_rappid": organism_rappid,
            "core_manifest_hash": manifest_hash,
            "issued_at": issued.isoformat(timespec="seconds"),
            "expires_at": expires.isoformat(timespec="seconds"),
        }
        return {**payload, "signature": self.signer.sign(payload)}

    def _official_schedule(self, set_id: str) -> dict[str, Any]:
        schedule = validate_signed_schedule(
            self.repository.get_current_schedule(_set_lookup_hash(set_id)),
        )
        if (
            schedule["issuer"] != self.issuer
            or schedule["set_id"] != set_id
            or not self.signer.verify(
                schedule_signature_payload(schedule),
                schedule["signature"],
            )
        ):
            raise CreditError("The current valuation schedule is not an official issuer record.")
        return schedule

    def _credit_is_valid(self, credit: dict[str, Any]) -> bool:
        validated = validate_signed_credit(credit)
        if (
            validated["issuer"] != self.issuer
            or not self.signer.verify(
                signature_payload(validated),
                validated["signature"],
            )
        ):
            return False
        schedule = validate_signed_schedule(
            self.repository.get_schedule(validated["valuation_schedule_id"]),
        )
        fraction = schedule["tiers"][validated["tier"]]
        return bool(
            schedule["issuer"] == self.issuer
            and schedule["schedule_hash"] == validated["valuation_schedule_hash"]
            and schedule["set_id"] == validated["set_id"]
            and fraction["numerator"] == validated["btc_fraction"]["numerator"]
            and fraction["denominator"] == validated["btc_fraction"]["denominator"]
            and fraction["price_sats"] == validated["price_sats"]
            and self.signer.verify(
                schedule_signature_payload(schedule),
                schedule["signature"],
            )
        )

    @staticmethod
    def _pagination(after_value: Any, limit_value: Any) -> tuple[int, int]:
        try:
            after = int(after_value or 0)
            limit = int(limit_value or 50)
        except (TypeError, ValueError) as error:
            raise CreditError("after and limit must be integers.") from error
        if after < 0 or after > 999_999_999_999 or limit < 1 or limit > 100:
            raise CreditError("after must be nonnegative and limit must be from 1 to 100.")
        return after, limit

    @staticmethod
    def _assert_same_redemption(
        existing: dict[str, Any],
        product_id: str,
        set_id: str,
        tier: str,
        organism_rappid: str,
        genesis_core_id: str,
        core_manifest_hash: str,
    ) -> None:
        expected = {
            "product_id": product_id,
            "set_id": set_id,
            "tier": tier,
            "organism_rappid": organism_rappid,
            "genesis_core_id": genesis_core_id,
            "core_manifest_hash": core_manifest_hash,
        }
        if any(existing.get(key) != value for key, value in expected.items()):
            raise CreditConflict("The verified payment is already bound to another credit.")
