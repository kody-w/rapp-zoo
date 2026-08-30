"""RAPP/1-native Rapter Credit validation and birth valuation."""

from __future__ import annotations

import re
from typing import Callable, Optional

import rapp_protocol


CREDIT_SCHEMA = "rapp-rapter-credit/1"
TRANSFER_SCHEMA = "rapp-rapter-credit-transfer/1"
BIRTH_SCHEMA = "rapp-rapter-birth/1"
SATOSHIS_PER_BITCOIN = 100_000_000
MAX_UINT53 = 2**53 - 1

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_CREDIT_ID = re.compile(r"^rcredit:[0-9a-f]{64}$")
_LABEL = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class CreditError(ValueError):
    """A Rapter Credit value is not safe or conformant."""


def _exact(value, keys: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise CreditError(f"{label} has unknown or missing members")
    return value


def _uint(value, label: str, *, minimum: int = 0, maximum: int = MAX_UINT53):
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or not minimum <= value <= maximum
    ):
        raise CreditError(f"{label} must be an integer in [{minimum}, {maximum}]")
    return value


def _hex(value, label: str):
    if not isinstance(value, str) or not _HEX64.fullmatch(value):
        raise CreditError(f"{label} must be 64 lowercase hexadecimal characters")
    return value


def _label(value, label: str, *, maximum: int = 100):
    if (
        not isinstance(value, str)
        or len(value) > maximum
        or not _LABEL.fullmatch(value)
    ):
        raise CreditError(f"{label} must be a lowercase label")
    return value


def _utc(value, label: str):
    if not rapp_protocol.utc_valid(value):
        raise CreditError(f"{label} must be fixed-form UTC")
    return value


def round_div(numerator: int, denominator: int) -> int:
    if not isinstance(numerator, int) or not isinstance(denominator, int):
        raise CreditError("round_div requires integers")
    if denominator <= 0:
        raise CreditError("round_div denominator must be positive")
    sign = -1 if numerator < 0 else 1
    absolute = abs(numerator)
    quotient, remainder = divmod(absolute, denominator)
    if remainder * 2 >= denominator:
        quotient += 1
    return sign * quotient


def birth_valuation(
    *,
    numerator: int,
    denominator: int,
    btc_usd_micros: int,
) -> tuple[int, int]:
    _uint(numerator, "btc fraction numerator", minimum=1)
    _uint(denominator, "btc fraction denominator", minimum=1)
    _uint(btc_usd_micros, "BTC/USD micros", minimum=1)
    price_sats = (
        SATOSHIS_PER_BITCOIN * numerator + denominator - 1
    ) // denominator
    if not 1 <= price_sats <= SATOSHIS_PER_BITCOIN:
        raise CreditError("birth price must be between one satoshi and one BTC")
    birth_usd_micros = round_div(
        price_sats * btc_usd_micros,
        SATOSHIS_PER_BITCOIN,
    )
    return price_sats, birth_usd_micros


def validate_credit_record(value: dict) -> dict:
    record = _exact(value, {
        "schema",
        "credit_id",
        "series",
        "issuance_index",
        "series_cap",
        "organism_rappid",
        "genesis_core_id",
        "core_manifest_hash",
        "birth",
        "settlement",
        "issuer_rappid",
        "issued_utc",
    }, "credit record")
    if record["schema"] != CREDIT_SCHEMA:
        raise CreditError("unsupported credit schema")
    if not isinstance(record["credit_id"], str) or not _CREDIT_ID.fullmatch(
        record["credit_id"]
    ):
        raise CreditError("credit_id is invalid")
    _label(record["series"], "series")
    index = _uint(record["issuance_index"], "issuance_index")
    cap = _uint(record["series_cap"], "series_cap", minimum=1)
    if index >= cap:
        raise CreditError("issuance_index must be below series_cap")
    for key in ("organism_rappid", "issuer_rappid"):
        if not rapp_protocol.rappid_valid(record[key]):
            raise CreditError(f"{key} is not a valid RAPPID")
    _hex(record["genesis_core_id"], "genesis_core_id")
    _hex(record["core_manifest_hash"], "core_manifest_hash")
    _utc(record["issued_utc"], "issued_utc")

    birth = _exact(record["birth"], {
        "schema",
        "conception_utc",
        "tier",
        "schedule_id",
        "schedule_hash",
        "btc_fraction",
        "btc_quote",
        "price_sats",
        "birth_value_usd_micros",
    }, "birth")
    if birth["schema"] != BIRTH_SCHEMA:
        raise CreditError("unsupported birth schema")
    _utc(birth["conception_utc"], "birth.conception_utc")
    _label(birth["tier"], "birth.tier")
    _label(birth["schedule_id"], "birth.schedule_id")
    _hex(birth["schedule_hash"], "birth.schedule_hash")
    fraction = _exact(
        birth["btc_fraction"],
        {"numerator", "denominator"},
        "birth.btc_fraction",
    )
    quote = _exact(
        birth["btc_quote"],
        {
            "pair",
            "price_usd_micros",
            "source",
            "observed_utc",
            "response_hash",
        },
        "birth.btc_quote",
    )
    if quote["pair"] != "BTC-USD":
        raise CreditError("birth.btc_quote.pair must be BTC-USD")
    _label(quote["source"], "birth.btc_quote.source")
    _utc(quote["observed_utc"], "birth.btc_quote.observed_utc")
    _hex(quote["response_hash"], "birth.btc_quote.response_hash")
    expected_sats, expected_usd = birth_valuation(
        numerator=_uint(
            fraction["numerator"],
            "birth.btc_fraction.numerator",
            minimum=1,
        ),
        denominator=_uint(
            fraction["denominator"],
            "birth.btc_fraction.denominator",
            minimum=1,
        ),
        btc_usd_micros=_uint(
            quote["price_usd_micros"],
            "birth.btc_quote.price_usd_micros",
            minimum=1,
        ),
    )
    if birth["price_sats"] != expected_sats:
        raise CreditError("birth.price_sats does not match the signed tier fraction")
    if birth["birth_value_usd_micros"] != expected_usd:
        raise CreditError(
            "birth.birth_value_usd_micros does not match the BTC quote"
        )
    if not (
        birth["conception_utc"]
        <= quote["observed_utc"]
        <= record["issued_utc"]
    ):
        raise CreditError("birth quote and issuance chronology is invalid")

    settlement = _exact(record["settlement"], {
        "rail",
        "payment_reference_hash",
        "bitcoin_outpoint",
    }, "settlement")
    if settlement["rail"] not in {
        "bitcoin",
        "app-store",
        "google-play",
        "grant",
    }:
        raise CreditError("settlement rail is unsupported")
    _hex(settlement["payment_reference_hash"], "payment_reference_hash")
    outpoint = settlement["bitcoin_outpoint"]
    if settlement["rail"] == "bitcoin":
        outpoint = _exact(outpoint, {"txid", "vout"}, "bitcoin_outpoint")
        _hex(outpoint["txid"], "bitcoin_outpoint.txid")
        _uint(outpoint["vout"], "bitcoin_outpoint.vout", maximum=2**32 - 1)
    elif outpoint is not None:
        raise CreditError("bitcoin_outpoint must be null for non-Bitcoin rails")
    rapp_protocol.canonical(record)
    return record


def validate_transfer_record(value: dict) -> dict:
    record = _exact(value, {
        "schema",
        "credit_id",
        "previous_transfer_hash",
        "from_owner_rappid",
        "to_owner_rappid",
        "settlement_reference_hash",
        "utc",
    }, "credit transfer")
    if record["schema"] != TRANSFER_SCHEMA:
        raise CreditError("unsupported transfer schema")
    if not isinstance(record["credit_id"], str) or not _CREDIT_ID.fullmatch(
        record["credit_id"]
    ):
        raise CreditError("credit_id is invalid")
    if record["previous_transfer_hash"] is not None:
        _hex(record["previous_transfer_hash"], "previous_transfer_hash")
    for key in ("from_owner_rappid", "to_owner_rappid"):
        if not rapp_protocol.rappid_valid(record[key]):
            raise CreditError(f"{key} is not a valid RAPPID")
    if record["from_owner_rappid"] == record["to_owner_rappid"]:
        raise CreditError("credit transfer must change owner")
    if record["settlement_reference_hash"] is not None:
        _hex(record["settlement_reference_hash"], "settlement_reference_hash")
    _utc(record["utc"], "utc")
    rapp_protocol.canonical(record)
    return record


def validate_credit_frame(
    frame: dict,
    *,
    head: Optional[dict],
    issuer_rappid: str,
    signature_verifier: Callable[[dict, str], tuple[bool, str]],
) -> dict:
    ok, step, why = rapp_protocol.verify_frame(
        frame,
        head=head,
        stream_id_of_record=issuer_rappid,
        signature_verifier=signature_verifier,
    )
    if not ok:
        raise CreditError(f"RAPP frame refused at {step}: {why}")
    if frame["kind"] != "body.pulse":
        raise CreditError("Rapter Credit events must use registered body.pulse")
    if frame["sig"] is None:
        raise CreditError("official Rapter Credit frames must be issuer-signed")
    schema = frame["payload"].get("schema")
    if schema == CREDIT_SCHEMA:
        validate_credit_record(frame["payload"])
        if frame["payload"]["issuer_rappid"] != issuer_rappid:
            raise CreditError("credit issuer does not match ledger stream")
    elif schema == TRANSFER_SCHEMA:
        validate_transfer_record(frame["payload"])
    else:
        raise CreditError("unsupported Rapter Credit event payload")
    return frame


__all__ = [
    "BIRTH_SCHEMA",
    "CREDIT_SCHEMA",
    "CreditError",
    "SATOSHIS_PER_BITCOIN",
    "TRANSFER_SCHEMA",
    "birth_valuation",
    "round_div",
    "validate_credit_frame",
    "validate_credit_record",
    "validate_transfer_record",
]
