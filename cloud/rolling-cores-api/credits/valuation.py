import hashlib
import re
from datetime import datetime
from typing import Any

from .domain import (
    TIERS,
    CreditError,
    bounded_text,
    canonical_json,
    price_sats_for_fraction,
    validate_sha256,
)


VALUATION_SCHEMA = "rappter-valuation-schedule/1"
SCHEDULE_ID = re.compile(r"^rvs_[0-9a-f]{32}$")
SCHEDULE_KEYS = {
    "schema",
    "issuer",
    "schedule_id",
    "schedule_hash",
    "schedule_index",
    "set_id",
    "issued_at",
    "previous_schedule_hash",
    "tiers",
    "signature",
}
FRACTION_KEYS = {"numerator", "denominator", "price_sats"}


class ValuationScheduleNotFound(CreditError):
    code = "valuation_schedule_not_found"
    status_code = 404


class ValuationScheduleChanged(CreditError):
    code = "valuation_schedule_changed"
    status_code = 409


def _normalize_tiers(value: Any) -> dict[str, dict[str, int]]:
    if not isinstance(value, dict) or set(value) != set(TIERS):
        raise CreditError(f"tiers must contain exactly: {', '.join(TIERS)}.")
    result = {}
    previous_price = 0
    for tier in TIERS:
        fraction = value[tier]
        if not isinstance(fraction, dict) or set(fraction) not in (
            {"numerator", "denominator"},
            FRACTION_KEYS,
        ):
            raise CreditError(f"Tier {tier} must define numerator and denominator.")
        numerator = fraction.get("numerator")
        denominator = fraction.get("denominator")
        computed_price = price_sats_for_fraction(numerator, denominator)
        if "price_sats" in fraction and fraction["price_sats"] != computed_price:
            raise CreditError(f"Tier {tier} price_sats does not match its BTC fraction.")
        if computed_price <= previous_price:
            raise CreditError("Tier BTC fractions must increase from common through secret.")
        result[tier] = {
            "numerator": numerator,
            "denominator": denominator,
            "price_sats": computed_price,
        }
        previous_price = computed_price
    return result


def build_unsigned_schedule(
    *,
    issuer: str,
    schedule_index: int,
    set_id: Any,
    tiers: Any,
    issued_at: str,
    previous_schedule_hash: str | None,
) -> dict[str, Any]:
    normalized_set_id = bounded_text(set_id, "set_id", 128)
    normalized_tiers = _normalize_tiers(tiers)
    base = {
        "schema": VALUATION_SCHEMA,
        "issuer": bounded_text(issuer, "issuer", 128),
        "schedule_index": schedule_index,
        "set_id": normalized_set_id,
        "issued_at": issued_at,
        "previous_schedule_hash": previous_schedule_hash,
        "tiers": normalized_tiers,
    }
    schedule_hash = hashlib.sha256(canonical_json(base)).hexdigest()
    return {
        **base,
        "schedule_id": f"rvs_{schedule_hash[:32]}",
        "schedule_hash": schedule_hash,
    }


def validate_signed_schedule(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != SCHEDULE_KEYS:
        raise CreditError("Signed valuation schedule has an invalid shape.")
    if value.get("schema") != VALUATION_SCHEMA:
        raise CreditError("Valuation schedule schema is invalid.")
    issuer = bounded_text(value.get("issuer"), "issuer", 128)
    set_id = bounded_text(value.get("set_id"), "set_id", 128)
    if (
        isinstance(value.get("schedule_index"), bool)
        or not isinstance(value.get("schedule_index"), int)
        or value["schedule_index"] < 1
    ):
        raise CreditError("schedule_index is invalid.")
    issued_at = bounded_text(value.get("issued_at"), "issued_at", 64)
    try:
        issued_datetime = datetime.fromisoformat(issued_at)
    except ValueError as error:
        raise CreditError("issued_at is invalid.") from error
    if issued_datetime.tzinfo is None:
        raise CreditError("issued_at must include a timezone.")
    previous_hash = value.get("previous_schedule_hash")
    if previous_hash is not None:
        previous_hash = validate_sha256(previous_hash, "previous_schedule_hash")
    tiers = _normalize_tiers(value.get("tiers"))
    schedule_hash = validate_sha256(value.get("schedule_hash"), "schedule_hash")
    schedule_id = bounded_text(value.get("schedule_id"), "schedule_id", 36)
    if not SCHEDULE_ID.fullmatch(schedule_id):
        raise CreditError("schedule_id is invalid.")
    base = {
        "schema": VALUATION_SCHEMA,
        "issuer": issuer,
        "schedule_index": value["schedule_index"],
        "set_id": set_id,
        "issued_at": issued_at,
        "previous_schedule_hash": previous_hash,
        "tiers": tiers,
    }
    expected_hash = hashlib.sha256(canonical_json(base)).hexdigest()
    if schedule_hash != expected_hash or schedule_id != f"rvs_{expected_hash[:32]}":
        raise CreditError("Valuation schedule hash is invalid.")
    signature = value.get("signature")
    if not isinstance(signature, dict):
        raise CreditError("Valuation schedule signature is invalid.")
    return value


def schedule_signature_payload(record: dict[str, Any]) -> dict[str, Any]:
    validate_signed_schedule(record)
    return {key: value for key, value in record.items() if key != "signature"}
