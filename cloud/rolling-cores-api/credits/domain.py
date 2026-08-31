import hashlib
import json
import math
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


CREDIT_SCHEMA = "rappter-credit-registry-entry/1"
DOWNLOAD_SCHEMA = "rappter-capsule-download/1"
SIGNATURE_KEYS = {"algorithm", "key_id", "value"}
CREDIT_KEYS = {
    "schema",
    "issuer",
    "credit_id",
    "issuance_index",
    "issuance_cap",
    "issued_at",
    "payment_provider",
    "payment_rail",
    "payment_reference_hash",
    "owner_reference_hash",
    "purchase_utc",
    "product_id",
    "set_id",
    "tier",
    "btc_fraction",
    "price_sats",
    "birth_value_usd_micros",
    "valuation_schedule_id",
    "valuation_schedule_hash",
    "btc_quote",
    "conception_utc",
    "organism_rappid",
    "genesis_core_id",
    "core_manifest_hash",
    "bitcoin_outpoint",
    "status",
    "signature",
}
TIERS = ("common", "uncommon", "rare", "holo", "ultra", "secret")
BTC_FRACTION_KEYS = {"numerator", "denominator"}
BTC_QUOTE_KEYS = {
    "source",
    "observed_utc",
    "raw_response_hash",
    "btc_usd_micros",
}
HEX_64 = re.compile(r"^[0-9a-f]{64}$")
CREDIT_ID = re.compile(r"^rcredit:[0-9a-f]{64}$")
OUTPOINT = re.compile(r"^[0-9a-f]{64}:(0|[1-9][0-9]{0,9})$")
PRODUCT_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
ES256_SIGNATURE = re.compile(r"^[A-Za-z0-9_-]{86}$")


class CreditError(Exception):
    code = "credit_error"
    status_code = 400


class CreditConflict(CreditError):
    code = "credit_conflict"
    status_code = 409


class CreditNotFound(CreditError):
    code = "credit_not_found"
    status_code = 404


class IssuanceCapReached(CreditError):
    code = "issuance_cap_reached"
    status_code = 409


class PurchaseVerificationUnavailable(CreditError):
    code = "purchase_verification_unavailable"
    status_code = 503


class PurchaseRejected(CreditError):
    code = "purchase_rejected"
    status_code = 403


class SigningUnavailable(CreditError):
    code = "signing_unavailable"
    status_code = 503


class RegistryUnavailable(CreditError):
    code = "registry_unavailable"
    status_code = 503


def canonical_json(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def bounded_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise CreditError(f"{label} must be a string.")
    normalized = value.strip()
    if not normalized or len(normalized) > maximum or any(ord(char) < 32 for char in normalized):
        raise CreditError(f"{label} is invalid.")
    return normalized


def validate_sha256(value: Any, label: str) -> str:
    normalized = bounded_text(value, label, 64).lower()
    if not HEX_64.fullmatch(normalized):
        raise CreditError(f"{label} must be a lowercase SHA-256 digest.")
    return normalized


def validate_credit_id(value: Any) -> str:
    normalized = bounded_text(value, "credit_id", 72)
    if not CREDIT_ID.fullmatch(normalized):
        raise CreditError("credit_id is invalid.")
    return normalized


def validate_organism_rappid(value: Any) -> str:
    normalized = bounded_text(value, "organism_rappid", 512)
    if not normalized.startswith("rappid:"):
        raise CreditError("organism_rappid must be a RAPPID.")
    return normalized


def validate_outpoint(value: Any) -> str | None:
    if value is None:
        return None
    normalized = bounded_text(value, "bitcoin_outpoint", 76).lower()
    if not OUTPOINT.fullmatch(normalized):
        raise CreditError("bitcoin_outpoint is invalid.")
    if int(normalized.rsplit(":", 1)[1]) > 4_294_967_295:
        raise CreditError("bitcoin_outpoint index is invalid.")
    return normalized


def hash_reference(provider: str, reference: str) -> str:
    material = f"{provider}\0{reference}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def mint_credit_id() -> str:
    digest = hashlib.sha256(
        b"rapp/1:rapter-credit\n" + uuid.uuid4().bytes,
    ).hexdigest()
    return f"rcredit:{digest}"


def price_sats_for_fraction(numerator: int, denominator: int) -> int:
    if (
        isinstance(numerator, bool)
        or isinstance(denominator, bool)
        or not isinstance(numerator, int)
        or not isinstance(denominator, int)
        or numerator < 1
        or denominator < 1
        or numerator > 1_000_000_000_000_000_000
        or denominator > 1_000_000_000_000_000_000
        or numerator > denominator
        or math.gcd(numerator, denominator) != 1
    ):
        raise CreditError("BTC fractions must be positive, reduced, and no greater than one BTC.")
    return (100_000_000 * numerator + denominator - 1) // denominator


def birth_value_usd_micros(price_sats: int, btc_usd_micros: int) -> int:
    if (
        isinstance(price_sats, bool)
        or not isinstance(price_sats, int)
        or price_sats < 1
        or isinstance(btc_usd_micros, bool)
        or not isinstance(btc_usd_micros, int)
        or btc_usd_micros < 1
    ):
        raise CreditError("Birth valuation inputs must be positive integers.")
    return (price_sats * btc_usd_micros + 50_000_000) // 100_000_000


@dataclass(frozen=True)
class Product:
    product_id: str
    credits: int


class ProductCatalog:
    def __init__(self, products: dict[str, Product]):
        self.products = products

    @classmethod
    def from_json(cls, raw: str) -> "ProductCatalog":
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as error:
            raise RuntimeError("CREDIT_PRODUCTS_JSON must be valid JSON.") from error
        if not isinstance(parsed, dict):
            raise RuntimeError("CREDIT_PRODUCTS_JSON must be an object.")
        products = {}
        for product_id, value in parsed.items():
            if not PRODUCT_ID.fullmatch(product_id):
                raise RuntimeError("CREDIT_PRODUCTS_JSON contains an invalid product id.")
            if (
                not isinstance(value, dict)
                or set(value) != {"credits"}
                or value["credits"] != 1
            ):
                raise RuntimeError("Each MVP credit product must contain credits: 1.")
            products[product_id] = Product(product_id=product_id, credits=1)
        return cls(products)

    def get(self, product_id: str) -> Product:
        normalized = bounded_text(product_id, "product_id", 128)
        product = self.products.get(normalized)
        if product is None:
            raise PurchaseRejected("The product is not currently listed.")
        return product

    def public_listing(self) -> list[dict[str, Any]]:
        return [
            {
                "id": product.product_id,
                "object": "rapter_credit_product",
                "credits": product.credits,
            }
            for product in sorted(self.products.values(), key=lambda item: item.product_id)
        ]


@dataclass(frozen=True)
class VerifiedPurchase:
    provider: str
    payment_rail: str
    payment_reference: str
    owner_reference: str
    purchased_utc: str
    product_id: str
    bitcoin_outpoint: str | None = None

    def normalized(self) -> "VerifiedPurchase":
        payment_rail = bounded_text(self.payment_rail, "payment rail", 32).lower()
        if payment_rail not in {"app-store", "play-store", "bitcoin"}:
            raise CreditError("payment rail is invalid.")
        return VerifiedPurchase(
            provider=bounded_text(self.provider, "payment provider", 64).lower(),
            payment_rail=payment_rail,
            payment_reference=bounded_text(
                self.payment_reference,
                "payment reference",
                512,
            ),
            owner_reference=bounded_text(
                self.owner_reference,
                "owner reference",
                512,
            ),
            purchased_utc=_validated_timestamp(self.purchased_utc, "purchased_utc"),
            product_id=bounded_text(self.product_id, "product_id", 128),
            bitcoin_outpoint=validate_outpoint(self.bitcoin_outpoint),
        )


def unsigned_credit_payload(
    *,
    issuer: str,
    credit_id: str,
    issuance_index: int,
    issuance_cap: int,
    issued_at: str,
    purchase: VerifiedPurchase,
    payment_reference_hash: str,
    owner_reference_hash: str,
    product: Product,
    set_id: str,
    tier: str,
    fraction: dict[str, int],
    price_sats: int,
    btc_quote: dict[str, Any],
    birth_value: int,
    valuation_schedule_id: str,
    valuation_schedule_hash: str,
    conception_utc: str,
    organism_rappid: str,
    genesis_core_id: str,
    core_manifest_hash: str,
) -> dict[str, Any]:
    return {
        "schema": CREDIT_SCHEMA,
        "issuer": issuer,
        "credit_id": credit_id,
        "issuance_index": issuance_index,
        "issuance_cap": issuance_cap,
        "issued_at": issued_at,
        "payment_provider": purchase.provider,
        "payment_rail": purchase.payment_rail,
        "payment_reference_hash": payment_reference_hash,
        "owner_reference_hash": owner_reference_hash,
        "purchase_utc": purchase.purchased_utc,
        "product_id": product.product_id,
        "set_id": set_id,
        "tier": tier,
        "btc_fraction": fraction,
        "price_sats": price_sats,
        "birth_value_usd_micros": birth_value,
        "valuation_schedule_id": valuation_schedule_id,
        "valuation_schedule_hash": valuation_schedule_hash,
        "btc_quote": btc_quote,
        "conception_utc": conception_utc,
        "organism_rappid": organism_rappid,
        "genesis_core_id": genesis_core_id,
        "core_manifest_hash": core_manifest_hash,
        "bitcoin_outpoint": purchase.bitcoin_outpoint,
        "status": "active",
    }


def validate_signed_credit(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != CREDIT_KEYS:
        raise CreditError("Signed credit has an invalid shape.")
    if value.get("schema") != CREDIT_SCHEMA or value.get("status") != "active":
        raise CreditError("Signed credit schema or status is invalid.")
    credit_id = validate_credit_id(value.get("credit_id"))
    validate_organism_rappid(value.get("organism_rappid"))
    validate_sha256(value.get("genesis_core_id"), "genesis_core_id")
    validate_sha256(value.get("core_manifest_hash"), "core_manifest_hash")
    payment_reference_hash = validate_sha256(
        value.get("payment_reference_hash"),
        "payment_reference_hash",
    )
    validate_sha256(value.get("owner_reference_hash"), "owner_reference_hash")
    if (
        isinstance(value.get("issuance_index"), bool)
        or not isinstance(value.get("issuance_index"), int)
        or value["issuance_index"] < 1
    ):
        raise CreditError("issuance_index is invalid.")
    if (
        isinstance(value.get("issuance_cap"), bool)
        or not isinstance(value.get("issuance_cap"), int)
        or value["issuance_cap"] < value["issuance_index"]
    ):
        raise CreditError("issuance_cap is invalid.")
    if (
        isinstance(value.get("price_sats"), bool)
        or not isinstance(value.get("price_sats"), int)
        or value["price_sats"] < 1
    ):
        raise CreditError("price_sats is invalid.")
    set_id = bounded_text(value.get("set_id"), "set_id", 128)
    del set_id
    tier = bounded_text(value.get("tier"), "tier", 32)
    if tier not in TIERS:
        raise CreditError("tier is invalid.")
    fraction = value.get("btc_fraction")
    if not isinstance(fraction, dict) or set(fraction) != BTC_FRACTION_KEYS:
        raise CreditError("btc_fraction is invalid.")
    expected_price_sats = price_sats_for_fraction(
        fraction.get("numerator"),
        fraction.get("denominator"),
    )
    if value["price_sats"] != expected_price_sats:
        raise CreditError("price_sats does not match btc_fraction.")
    schedule_id = bounded_text(
        value.get("valuation_schedule_id"),
        "valuation_schedule_id",
        36,
    )
    if not re.fullmatch(r"rvs_[0-9a-f]{32}", schedule_id):
        raise CreditError("valuation_schedule_id is invalid.")
    validate_sha256(value.get("valuation_schedule_hash"), "valuation_schedule_hash")
    btc_quote = value.get("btc_quote")
    if not isinstance(btc_quote, dict) or set(btc_quote) != BTC_QUOTE_KEYS:
        raise CreditError("btc_quote is invalid.")
    bounded_text(btc_quote.get("source"), "btc_quote.source", 128)
    validate_sha256(btc_quote.get("raw_response_hash"), "btc_quote.raw_response_hash")
    btc_usd_micros = btc_quote.get("btc_usd_micros")
    if (
        isinstance(btc_usd_micros, bool)
        or not isinstance(btc_usd_micros, int)
        or btc_usd_micros < 1
    ):
        raise CreditError("btc_quote.btc_usd_micros is invalid.")
    observed_utc = bounded_text(btc_quote.get("observed_utc"), "btc_quote.observed_utc", 64)
    conception_utc = bounded_text(value.get("conception_utc"), "conception_utc", 64)
    for label, timestamp in (
        ("btc_quote.observed_utc", observed_utc),
        ("conception_utc", conception_utc),
    ):
        try:
            parsed_timestamp = datetime.fromisoformat(timestamp)
        except ValueError as error:
            raise CreditError(f"{label} is invalid.") from error
        if parsed_timestamp.tzinfo is None:
            raise CreditError(f"{label} must include a timezone.")
    birth_value = value.get("birth_value_usd_micros")
    if (
        isinstance(birth_value, bool)
        or not isinstance(birth_value, int)
        or birth_value != birth_value_usd_micros(value["price_sats"], btc_usd_micros)
    ):
        raise CreditError("birth_value_usd_micros is invalid.")
    validate_outpoint(value.get("bitcoin_outpoint"))
    bounded_text(value.get("issuer"), "issuer", 128)
    issued_at = bounded_text(value.get("issued_at"), "issued_at", 64)
    try:
        issued_datetime = datetime.fromisoformat(issued_at)
    except ValueError as error:
        raise CreditError("issued_at is invalid.") from error
    if issued_datetime.tzinfo is None:
        raise CreditError("issued_at must include a timezone.")
    bounded_text(value.get("payment_provider"), "payment_provider", 64)
    payment_rail = bounded_text(value.get("payment_rail"), "payment_rail", 32)
    if payment_rail not in {"app-store", "play-store", "bitcoin"}:
        raise CreditError("payment_rail is invalid.")
    _validated_timestamp(value.get("purchase_utc"), "purchase_utc")
    product_id = bounded_text(value.get("product_id"), "product_id", 128)
    if not PRODUCT_ID.fullmatch(product_id):
        raise CreditError("product_id is invalid.")
    signature = value.get("signature")
    if not isinstance(signature, dict) or set(signature) != SIGNATURE_KEYS:
        raise CreditError("Credit signature is invalid.")
    if signature.get("algorithm") != "ES256":
        raise CreditError("Credit signature algorithm is invalid.")
    bounded_text(signature.get("key_id"), "signature.key_id", 2_048)
    signature_value = bounded_text(signature.get("value"), "signature.value", 512)
    if not ES256_SIGNATURE.fullmatch(signature_value):
        raise CreditError("Credit signature value is invalid.")
    return value


def signature_payload(record: dict[str, Any]) -> dict[str, Any]:
    validate_signed_credit(record)
    return {key: value for key, value in record.items() if key != "signature"}


def _validated_timestamp(value: Any, label: str) -> str:
    timestamp = bounded_text(value, label, 64)
    try:
        parsed = datetime.fromisoformat(timestamp)
    except ValueError as error:
        raise CreditError(f"{label} is invalid.") from error
    if parsed.tzinfo is None:
        raise CreditError(f"{label} must include a timezone.")
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")
