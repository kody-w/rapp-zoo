"""Dormant public-frame provenance for the Rapter Coin Trail."""

from __future__ import annotations

import re
from typing import Callable, Optional

import holo_protocol
import rapp_protocol


COIN_SCHEMA = "rapp-rapter-coin/1"
COIN_DOMAIN = "rapp/1:rapter-coin"
COIN_VISIBILITY = "public-dogg"
MAX_UINT53 = 2**53 - 1

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_COIN_ID = re.compile(r"^rcoin:[0-9a-f]{64}$")
_LABEL = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_UTC = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}"
    r"T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$"
)


class CoinError(ValueError):
    """A Rapter Coin record is unsafe or non-conformant."""


def _exact(value, keys: set[str], label: str) -> dict:
    if not isinstance(value, dict) or set(value) != keys:
        raise CoinError(f"{label} has unknown or missing members")
    return value


def _hex(value, label: str) -> str:
    if not isinstance(value, str) or not _HEX64.fullmatch(value):
        raise CoinError(f"{label} must be 64 lowercase hexadecimal characters")
    return value


def _uint(value, label: str) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or not 0 <= value <= MAX_UINT53
    ):
        raise CoinError(f"{label} must be an integer in [0, {MAX_UINT53}]")
    return value


def _label(value, label: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) > 100
        or not _LABEL.fullmatch(value)
    ):
        raise CoinError(f"{label} must be a lowercase label")
    return value


def _utc(value, label: str) -> str:
    if (
        not isinstance(value, str)
        or not _UTC.fullmatch(value)
        or not rapp_protocol.utc_valid(value)
    ):
        raise CoinError(f"{label} must be ASCII fixed-form calendar-valid UTC")
    return value


def coin_id_for(*, organism_rappid: str, core_frame_hash: str) -> str:
    if not rapp_protocol.rappid_valid(organism_rappid):
        raise CoinError("organism_rappid is not a valid RAPPID")
    _hex(core_frame_hash, "core_frame_hash")
    return "rcoin:" + rapp_protocol.H(
        COIN_DOMAIN,
        {
            "core_frame_hash": core_frame_hash,
            "organism_rappid": organism_rappid,
        },
    )


def build_coin_record(
    *,
    organism_rappid: str,
    publisher_rappid: str,
    publisher_authorization_hash: str,
    dogg_publication_hash: str,
    core_frame_hash: str,
    core_seq: int,
    source_frame_hash: str,
    rights_profile_id: str,
    rights_profile_hash: str,
    created_utc: str,
    previous: Optional[dict] = None,
) -> dict:
    record = {
        "schema": COIN_SCHEMA,
        "coin_id": coin_id_for(
            organism_rappid=organism_rappid,
            core_frame_hash=core_frame_hash,
        ),
        "organism_rappid": organism_rappid,
        "publisher_rappid": publisher_rappid,
        "publisher_authorization_hash": publisher_authorization_hash,
        "dogg_publication_hash": dogg_publication_hash,
        "core_frame_hash": core_frame_hash,
        "core_seq": core_seq,
        "coin_seq": previous["coin_seq"] + 1 if previous else 0,
        "source_frame_hash": source_frame_hash,
        "previous_coin_id": previous["coin_id"] if previous else None,
        "rights_profile_id": rights_profile_id,
        "rights_profile_hash": rights_profile_hash,
        "visibility": COIN_VISIBILITY,
        "economics": {
            "status": "dormant",
            "cash_value": None,
            "purchasable": False,
            "redeemable": False,
            "transferable": False,
            "yield_bearing": False,
        },
        "created_utc": created_utc,
    }
    return validate_coin_record(record, previous=previous)


def validate_coin_record(
    value: dict,
    *,
    previous: Optional[dict] = None,
) -> dict:
    record, core_sequence, coin_sequence = _validate_coin_record_shape(value)
    previous_coin_id = record["previous_coin_id"]
    if coin_sequence == 0:
        if previous is not None or previous_coin_id is not None:
            raise CoinError("genesis Coin must not name a predecessor")
    else:
        if previous is None:
            raise CoinError("non-genesis Coin requires its resolved predecessor")
        prior, prior_core_sequence, prior_coin_sequence = (
            _validate_coin_record_shape(previous)
        )
        if record["organism_rappid"] != prior["organism_rappid"]:
            raise CoinError("Coin Trail cannot change organism")
        if coin_sequence != prior_coin_sequence + 1:
            raise CoinError("Coin Trail sequence must advance by one")
        if core_sequence <= prior_core_sequence:
            raise CoinError("published core sequence must strictly advance")
        if previous_coin_id != prior["coin_id"]:
            raise CoinError("Coin Trail predecessor does not match")
        if record["created_utc"] < prior["created_utc"]:
            raise CoinError("Coin Trail publication time cannot move backward")
    return record


def _validate_coin_record_shape(value: dict) -> tuple[dict, int, int]:
    record = _exact(
        value,
        {
            "schema",
            "coin_id",
            "organism_rappid",
            "publisher_rappid",
            "publisher_authorization_hash",
            "dogg_publication_hash",
            "core_frame_hash",
            "core_seq",
            "coin_seq",
            "source_frame_hash",
            "previous_coin_id",
            "rights_profile_id",
            "rights_profile_hash",
            "visibility",
            "economics",
            "created_utc",
        },
        "coin record",
    )
    if record["schema"] != COIN_SCHEMA:
        raise CoinError("unsupported coin schema")
    if not rapp_protocol.rappid_valid(record["organism_rappid"]):
        raise CoinError("organism_rappid is not a valid RAPPID")
    if not rapp_protocol.rappid_valid(record["publisher_rappid"]):
        raise CoinError("publisher_rappid is not a valid keyed RAPPID")
    _hex(
        record["publisher_authorization_hash"],
        "publisher_authorization_hash",
    )
    _hex(record["dogg_publication_hash"], "dogg_publication_hash")
    _hex(record["core_frame_hash"], "core_frame_hash")
    core_sequence = _uint(record["core_seq"], "core_seq")
    coin_sequence = _uint(record["coin_seq"], "coin_seq")
    _hex(record["source_frame_hash"], "source_frame_hash")
    _label(record["rights_profile_id"], "rights_profile_id")
    _hex(record["rights_profile_hash"], "rights_profile_hash")
    if record["visibility"] != COIN_VISIBILITY:
        raise CoinError("only intentionally public DOGG-safe frames qualify")
    _utc(record["created_utc"], "created_utc")

    expected_coin_id = coin_id_for(
        organism_rappid=record["organism_rappid"],
        core_frame_hash=record["core_frame_hash"],
    )
    if record["coin_id"] != expected_coin_id:
        raise CoinError("coin_id does not match the public Rolling Core frame")

    previous_coin_id = record["previous_coin_id"]
    if previous_coin_id is not None and (
        not isinstance(previous_coin_id, str)
        or not _COIN_ID.fullmatch(previous_coin_id)
    ):
        raise CoinError("previous_coin_id is invalid")
    if coin_sequence > 0 and previous_coin_id is None:
        raise CoinError("non-genesis Coin must name its predecessor")

    economics = _exact(
        record["economics"],
        {
            "status",
            "cash_value",
            "purchasable",
            "redeemable",
            "transferable",
            "yield_bearing",
        },
        "coin economics",
    )
    if economics != {
        "status": "dormant",
        "cash_value": None,
        "purchasable": False,
        "redeemable": False,
        "transferable": False,
        "yield_bearing": False,
    }:
        raise CoinError("Rapter Coin economics are dormant and non-financial")

    rapp_protocol.canonical(record)
    return record, core_sequence, coin_sequence


def validate_coin_candidate(
    frame: dict,
    *,
    organism_rappid: str,
    authoritative_body_history_resolver: Callable[[str], list[dict]],
    signature_verifier: Callable[[dict, str], tuple[bool, str]],
    publisher_authorization_verifier: Callable[
        [dict, str, str],
        tuple[bool, str],
    ],
    source_frame_resolver: Callable[[str], Optional[dict]],
    publication_evidence_verifier: Callable[
        [dict, dict, dict],
        tuple[bool, str],
    ],
) -> dict:
    """Preflight one candidate; only append_coin_frame establishes publication."""
    body_history = resolve_body_history(
        authoritative_body_history_resolver,
        organism_rappid,
    )
    return _validate_coin_candidate_against_history(
        frame,
        organism_rappid=organism_rappid,
        body_history=body_history,
        signature_verifier=signature_verifier,
        publisher_authorization_verifier=publisher_authorization_verifier,
        source_frame_resolver=source_frame_resolver,
        publication_evidence_verifier=publication_evidence_verifier,
    )


def append_coin_frame(
    frame: dict,
    *,
    organism_rappid: str,
    authoritative_body_history_resolver: Callable[[str], list[dict]],
    atomic_compare_and_append: Callable[
        [str, Optional[str], dict],
        bool,
    ],
    signature_verifier: Callable[[dict, str], tuple[bool, str]],
    publisher_authorization_verifier: Callable[
        [dict, str, str],
        tuple[bool, str],
    ],
    source_frame_resolver: Callable[[str], Optional[dict]],
    publication_evidence_verifier: Callable[
        [dict, dict, dict],
        tuple[bool, str],
    ],
) -> dict:
    """Validate and atomically append one official Coin publication."""
    body_history = resolve_body_history(
        authoritative_body_history_resolver,
        organism_rappid,
    )
    validated = _validate_coin_candidate_against_history(
        frame,
        organism_rappid=organism_rappid,
        body_history=body_history,
        signature_verifier=signature_verifier,
        publisher_authorization_verifier=publisher_authorization_verifier,
        source_frame_resolver=source_frame_resolver,
        publication_evidence_verifier=publication_evidence_verifier,
    )
    expected_head_hash = (
        body_history[-1]["frame_hash"] if body_history else None
    )
    try:
        appended = atomic_compare_and_append(
            organism_rappid,
            expected_head_hash,
            validated,
        )
    except Exception as exc:
        raise CoinError(f"atomic Coin append failed: {exc}") from exc
    if appended is not True:
        raise CoinError("atomic Coin append lost the authoritative head race")
    return validated


def resolve_body_history(
    resolver: Callable[[str], list[dict]],
    organism_rappid: str,
) -> list[dict]:
    try:
        body_history = resolver(organism_rappid)
    except Exception as exc:
        raise CoinError(f"authoritative body resolver failed: {exc}") from exc
    if not isinstance(body_history, list):
        raise CoinError("authoritative body resolver must return a frame list")
    return body_history


def _validate_coin_candidate_against_history(
    frame: dict,
    *,
    organism_rappid: str,
    body_history: list[dict],
    signature_verifier: Callable[[dict, str], tuple[bool, str]],
    publisher_authorization_verifier: Callable[
        [dict, str, str],
        tuple[bool, str],
    ],
    source_frame_resolver: Callable[[str], Optional[dict]],
    publication_evidence_verifier: Callable[
        [dict, dict, dict],
        tuple[bool, str],
    ],
) -> dict:
    def verify_bound_signature(
        unsigned_frame: dict,
        signature: str,
    ) -> tuple[bool, str]:
        payload = unsigned_frame.get("payload")
        if (
            isinstance(payload, dict)
            and payload.get("schema") == COIN_SCHEMA
        ):
            publisher = payload.get("publisher_rappid")
            if not rapp_protocol.rappid_valid(publisher):
                return False, "Rapter Coin publisher_rappid is invalid"
            try:
                protected, _, _ = rapp_protocol.parse_detached_jws(signature)
            except rapp_protocol.ProtocolError as exc:
                return False, str(exc)
            if protected["kid"] != publisher:
                return False, "Rapter Coin signer must equal publisher_rappid"
        return signature_verifier(unsigned_frame, signature)

    head = body_history[-1] if body_history else None
    previous_coin = coin_head_from_body_history(
        body_history,
        head=head,
        organism_rappid=organism_rappid,
        signature_verifier=verify_bound_signature,
        publisher_authorization_verifier=publisher_authorization_verifier,
        source_frame_resolver=source_frame_resolver,
        publication_evidence_verifier=publication_evidence_verifier,
    )

    ok, step, why = rapp_protocol.verify_frame(
        frame,
        head=head,
        stream_id_of_record=organism_rappid,
        signature_verifier=verify_bound_signature,
    )
    if not ok:
        raise CoinError(f"RAPP frame refused at {step}: {why}")
    if frame["kind"] != "body.pulse":
        raise CoinError("Rapter Coin publications must use registered body.pulse")
    if frame["sig"] is None:
        raise CoinError("official Rapter Coin publications must be signed")
    coin = frame["payload"]
    if previous_coin is None and coin.get("coin_seq") != 0:
        raise CoinError("Coin history must begin with coin_seq 0")
    validate_coin_record(coin, previous=previous_coin)
    if coin["organism_rappid"] != organism_rappid:
        raise CoinError("Coin organism does not match its RAPP stream")
    if frame["utc"] != coin["created_utc"]:
        raise CoinError("Coin publication time must equal its RAPP frame time")
    authorize_publisher(
        coin,
        frame["sig"],
        publisher_authorization_verifier,
    )
    try:
        source_frame = source_frame_resolver(coin["source_frame_hash"])
    except Exception as exc:
        raise CoinError(f"source frame resolver failed: {exc}") from exc
    if source_frame is None:
        raise CoinError("current Coin source is absent from authoritative history")
    core_frame = next(
        (
            candidate
            for candidate in body_history
            if candidate.get("frame_hash") == coin["core_frame_hash"]
        ),
        None,
    )
    if core_frame is None:
        raise CoinError("current Coin core is absent from authoritative history")
    validate_publication_evidence(
        coin,
        core_frame=core_frame,
        source_frame=source_frame,
        body_history=body_history,
        publication_evidence_verifier=publication_evidence_verifier,
    )
    return frame


def coin_head_from_body_history(
    body_history: list[dict],
    *,
    head: Optional[dict],
    organism_rappid: str,
    signature_verifier: Callable[[dict, str], tuple[bool, str]],
    publisher_authorization_verifier: Callable[
        [dict, str, str],
        tuple[bool, str],
    ],
    source_frame_resolver: Callable[[str], Optional[dict]],
    publication_evidence_verifier: Callable[
        [dict, dict, dict],
        tuple[bool, str],
    ],
) -> Optional[dict]:
    if not isinstance(body_history, list):
        raise CoinError("body_history must be a verified frame list")
    if head is None:
        if body_history:
            raise CoinError("genesis body history must be empty")
        return None
    if (
        not isinstance(head, dict)
        or not body_history
        or not isinstance(body_history[-1], dict)
        or body_history[-1].get("frame_hash") != head.get("frame_hash")
    ):
        raise CoinError("body_history must end at the supplied RAPP head")
    try:
        exact_head = (
            rapp_protocol.canonical(body_history[-1])
            == rapp_protocol.canonical(head)
        )
    except rapp_protocol.ProtocolError as exc:
        raise CoinError(f"supplied body head is not canonical: {exc}") from exc
    if not exact_head:
        raise CoinError("body_history must contain the exact supplied RAPP head")

    prior_frame = None
    prior_coin = None
    accepted_frames = []
    for candidate in body_history:
        ok, step, why = rapp_protocol.verify_frame(
            candidate,
            head=prior_frame,
            stream_id_of_record=organism_rappid,
            signature_verifier=signature_verifier,
        )
        if not ok:
            raise CoinError(f"body history refused at {step}: {why}")
        payload = candidate["payload"]
        if payload.get("schema") == COIN_SCHEMA:
            if candidate["kind"] != "body.pulse" or candidate["sig"] is None:
                raise CoinError("official Coin history contains an unsigned event")
            if prior_coin is None and payload.get("coin_seq") != 0:
                raise CoinError("accepted Coin history does not begin at coin_seq 0")
            validate_coin_record(payload, previous=prior_coin)
            if payload["organism_rappid"] != organism_rappid:
                raise CoinError("Coin history changes organism")
            if candidate["utc"] != payload["created_utc"]:
                raise CoinError("Coin history publication time is inconsistent")
            authorize_publisher(
                payload,
                candidate["sig"],
                publisher_authorization_verifier,
            )
            historical_core = next(
                (
                    accepted
                    for accepted in accepted_frames
                    if accepted.get("frame_hash") == payload["core_frame_hash"]
                ),
                None,
            )
            try:
                historical_source = source_frame_resolver(
                    payload["source_frame_hash"]
                )
            except Exception as exc:
                raise CoinError(
                    f"source frame resolver failed: {exc}"
                ) from exc
            if historical_core is None or historical_source is None:
                raise CoinError(
                    "historical Coin is missing accepted core or source evidence"
                )
            validate_publication_evidence(
                payload,
                core_frame=historical_core,
                source_frame=historical_source,
                body_history=accepted_frames,
                publication_evidence_verifier=publication_evidence_verifier,
            )
            prior_coin = payload
        accepted_frames.append(candidate)
        prior_frame = candidate
    return prior_coin


def authorize_publisher(
    coin: dict,
    signature: str,
    publisher_authorization_verifier: Callable[
        [dict, str, str],
        tuple[bool, str],
    ],
) -> None:
    try:
        protected, _, _ = rapp_protocol.parse_detached_jws(signature)
    except rapp_protocol.ProtocolError as exc:
        raise CoinError(f"Coin publication signature is invalid: {exc}") from exc
    publisher = protected["kid"]
    if publisher != coin["publisher_rappid"]:
        raise CoinError("Rapter Coin signer must equal publisher_rappid")
    try:
        authorized, why = publisher_authorization_verifier(
            coin,
            publisher,
            coin["created_utc"],
        )
    except Exception as exc:
        raise CoinError(f"publisher authorization verifier failed: {exc}") from exc
    if not authorized:
        raise CoinError(f"Rapter Coin publisher is not authorized: {why}")


def validate_publication_evidence(
    coin: dict,
    *,
    core_frame: dict,
    source_frame: dict,
    body_history: list[dict],
    publication_evidence_verifier: Callable[
        [dict, dict, dict],
        tuple[bool, str],
    ],
) -> None:
    if not isinstance(core_frame, dict) or not isinstance(source_frame, dict):
        raise CoinError("Coin publication requires core and source RAPP frames")
    accepted_core = next(
        (
            candidate
            for candidate in body_history
            if candidate.get("frame_hash") == coin["core_frame_hash"]
        ),
        None,
    )
    if accepted_core is None:
        raise CoinError("referenced Rolling Core is absent from accepted body history")
    try:
        same_core = (
            rapp_protocol.canonical(core_frame)
            == rapp_protocol.canonical(accepted_core)
        )
    except rapp_protocol.ProtocolError as exc:
        raise CoinError(f"referenced Rolling Core is not canonical: {exc}") from exc
    if not same_core:
        raise CoinError("supplied Rolling Core differs from accepted body history")
    if (
        core_frame.get("kind") != "body.pulse"
        or core_frame.get("stream_id") != coin["organism_rappid"]
        or core_frame.get("frame_hash") != coin["core_frame_hash"]
        or core_frame.get("utc", "") > coin["created_utc"]
    ):
        raise CoinError("Coin does not match the referenced Rolling Core frame")
    record = core_frame.get("payload")
    try:
        holo_protocol.validate_record(
            record,
            subject_rappid=coin["organism_rappid"],
        )
    except (holo_protocol.HoloProtocolError, TypeError) as exc:
        raise CoinError(f"referenced Rolling Core is invalid: {exc}") from exc
    if record["holo_seq"] != coin["core_seq"]:
        raise CoinError("Coin core_seq does not match the Rolling Core record")
    source = record["source"]
    if (
        source_frame.get("kind") != "memory.chat-turn"
        or source_frame.get("stream_id") != source["stream_id"]
        or source_frame.get("seq") != source["seq"]
        or source_frame.get("frame_hash") != source["frame_hash"]
        or source_frame.get("frame_hash") != coin["source_frame_hash"]
        or source_frame.get("utc", "") > coin["created_utc"]
    ):
        raise CoinError("Coin does not match the referenced public source frame")
    source_payload = source_frame.get("payload")
    source_outputs = (
        source_payload.get("outputs")
        if isinstance(source_payload, dict)
        else None
    )
    source_holo = (
        source_outputs.get("holo")
        if isinstance(source_outputs, dict)
        else None
    )
    if not isinstance(source_holo, dict):
        raise CoinError("public source frame has no authored Holo output")
    try:
        authored_matches = (
            rapp_protocol.canonical(source_holo)
            == rapp_protocol.canonical(record["authored"])
        )
    except rapp_protocol.ProtocolError as exc:
        raise CoinError(f"public source evidence is not canonical: {exc}") from exc
    if not authored_matches:
        raise CoinError("public source Holo differs from the Rolling Core record")
    try:
        evidence_ok, evidence_why = publication_evidence_verifier(
            coin,
            core_frame,
            source_frame,
        )
    except Exception as exc:
        raise CoinError(f"publication evidence verifier failed: {exc}") from exc
    if not evidence_ok:
        raise CoinError(f"public DOGG evidence refused: {evidence_why}")


__all__ = [
    "COIN_DOMAIN",
    "COIN_SCHEMA",
    "COIN_VISIBILITY",
    "CoinError",
    "append_coin_frame",
    "build_coin_record",
    "coin_head_from_body_history",
    "coin_id_for",
    "resolve_body_history",
    "validate_coin_candidate",
    "validate_coin_record",
    "validate_publication_evidence",
]
