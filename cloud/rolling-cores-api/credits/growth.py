import hashlib
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Callable, Protocol

from .domain import (
    CreditError,
    birth_value_usd_micros,
    bounded_text,
    canonical_json,
    validate_organism_rappid,
    validate_sha256,
)
from .generations import FREE_COMPANION_FAMILY_IDS
from .quotes import BtcUsdQuote, validate_fresh_quote
from .signing import RegistrySigner


GROWTH_RECEIPT_SCHEMA = "rapp-rapter-growth-receipt/1"
EVOLUTION_SCHEDULE_SCHEMA = "rapp-rapter-evolution-schedule/1"
STAGE_POLICY_SCHEMA = "rapp-rapter-growth-stage-policy/1"
EVOLUTION_SCHEMA = "rapp-rapter-evolution/1"
TRANSITIONS = ("origin-to-journey", "journey-to-ascendant")
GROWTH_CATEGORIES = (
    "care",
    "curiosity",
    "practice",
    "connection",
    "stewardship",
    "accessible-equivalent",
)
GROWTH_RECEIPT_KEYS = {
    "schema",
    "kind",
    "organism_rappid",
    "category",
    "points",
    "observed_utc",
    "attester",
    "source",
    "evidence_hash",
    "transferable",
    "purchasable",
    "redeemable",
    "record_id",
    "record_hash",
    "signature",
}
STAGE_POLICY_KEYS = {
    "schema",
    "kind",
    "issuer",
    "organism_rappid",
    "stage_id",
    "family_id",
    "generation_id",
    "transition_id",
    "required_points",
    "eligible_after_utc",
    "current_core_head",
    "evolution_schedule_id",
    "evolution_schedule_hash",
    "target_usd_micros",
    "created_utc",
    "retroactive_rewrite",
    "pay_to_evolve",
    "record_id",
    "record_hash",
    "signature",
}


class GrowthReceiptVerifier(Protocol):
    def verify(self, payload: dict[str, Any], signature: dict[str, str]) -> bool:
        ...


def _utc(value: Any, label: str) -> datetime:
    text = bounded_text(value, label, 64)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as error:
        raise CreditError(f"{label} is invalid.") from error
    if parsed.tzinfo is None:
        raise CreditError(f"{label} must include a timezone.")
    return parsed.astimezone(timezone.utc)


def _positive_int(value: Any, label: str, maximum: int) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 1
        or value > maximum
    ):
        raise CreditError(f"{label} must be a positive bounded integer.")
    return value


def _signed_record(
    base: dict[str, Any],
    *,
    id_prefix: str,
    signer: RegistrySigner,
) -> dict[str, Any]:
    record_hash = hashlib.sha256(canonical_json(base)).hexdigest()
    payload = {
        **base,
        "record_id": f"{id_prefix}:{record_hash}",
        "record_hash": record_hash,
    }
    return {**payload, "signature": signer.sign(payload)}


def default_growth_policy() -> dict[str, Any]:
    return {
        "schema": "rapp-rapter-growth-points-policy/1",
        "transferable": False,
        "purchasable": False,
        "redeemable": False,
        "minimum_points_per_event": 1,
        "maximum_points_per_event": 5,
        "daily_total_cap": 40,
        "category_daily_caps": {
            category: 10
            for category in GROWTH_CATEGORIES
        },
        "accessibility_alternatives": {
            category: ["accessible-equivalent"]
            for category in GROWTH_CATEGORIES
            if category != "accessible-equivalent"
        },
        "receipt_frame_kind": "memory.save",
        "aggregate_transition_frame_kind": "body.pulse",
    }


def build_growth_receipt(
    *,
    organism_rappid: str,
    category: str,
    points: int,
    observed_utc: str,
    attester: str,
    source: str,
    evidence_hash: str,
    signer: RegistrySigner,
    policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    policy = policy or default_growth_policy()
    validate_organism_rappid(organism_rappid)
    if category not in GROWTH_CATEGORIES:
        raise CreditError("Growth category is invalid.")
    points = _positive_int(
        points,
        "points",
        policy["maximum_points_per_event"],
    )
    observed = _utc(observed_utc, "observed_utc")
    base = {
        "schema": GROWTH_RECEIPT_SCHEMA,
        "kind": "memory.save",
        "organism_rappid": organism_rappid,
        "category": category,
        "points": points,
        "observed_utc": observed.isoformat(timespec="seconds"),
        "attester": bounded_text(attester, "attester", 256),
        "source": bounded_text(source, "source", 128),
        "evidence_hash": validate_sha256(evidence_hash, "evidence_hash"),
        "transferable": False,
        "purchasable": False,
        "redeemable": False,
    }
    return _signed_record(base, id_prefix="growth-event", signer=signer)


def validate_growth_receipt(
    receipt: Any,
    verifier: GrowthReceiptVerifier,
) -> dict[str, Any]:
    if not isinstance(receipt, dict) or set(receipt) != GROWTH_RECEIPT_KEYS:
        raise CreditError("Growth receipt has an invalid shape.")
    event_id = bounded_text(receipt.get("record_id"), "record_id", 128)
    if receipt.get("schema") != GROWTH_RECEIPT_SCHEMA or receipt.get("kind") != "memory.save":
        raise CreditError("Growth receipt schema or frame kind is invalid.")
    if any(receipt.get(name) is not False for name in (
        "transferable",
        "purchasable",
        "redeemable",
    )):
        raise CreditError("Growth Points cannot be transferred, purchased, or redeemed.")
    category = receipt.get("category")
    if category not in GROWTH_CATEGORIES:
        raise CreditError("Growth category is invalid.")
    validate_organism_rappid(receipt.get("organism_rappid"))
    _positive_int(receipt.get("points"), "points", 9_007_199_254_740_991)
    _utc(receipt.get("observed_utc"), "observed_utc")
    bounded_text(receipt.get("attester"), "attester", 256)
    bounded_text(receipt.get("source"), "source", 128)
    validate_sha256(receipt.get("evidence_hash"), "evidence_hash")
    record_hash = validate_sha256(receipt.get("record_hash"), "record_hash")
    hash_payload = {
        key: value
        for key, value in receipt.items()
        if key not in {"record_id", "record_hash", "signature"}
    }
    expected_hash = hashlib.sha256(canonical_json(hash_payload)).hexdigest()
    if record_hash != expected_hash or event_id != f"growth-event:{expected_hash}":
        raise CreditError("Growth receipt content address is invalid.")
    payload = {
        key: value
        for key, value in receipt.items()
        if key != "signature"
    }
    if not verifier.verify(payload, receipt.get("signature")):
        raise CreditError("Growth receipt signature is invalid.")
    return receipt


class InMemoryGrowthPointLedger:
    def __init__(
        self,
        *,
        policy: dict[str, Any] | None = None,
        verifier: GrowthReceiptVerifier,
    ):
        self.policy = policy or default_growth_policy()
        self.verifier = verifier
        self.receipts: dict[str, dict[str, Any]] = {}
        self.daily_totals: dict[tuple[str, str], int] = defaultdict(int)
        self.category_totals: dict[tuple[str, str, str], int] = defaultdict(int)

    def record(self, receipt: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        receipt = validate_growth_receipt(receipt, self.verifier)
        event_id = bounded_text(receipt.get("record_id"), "record_id", 128)
        if event_id in self.receipts:
            return self.receipts[event_id], False
        category = receipt.get("category")
        points = _positive_int(
            receipt.get("points"),
            "points",
            self.policy["maximum_points_per_event"],
        )
        organism = receipt["organism_rappid"]
        observed = _utc(receipt.get("observed_utc"), "observed_utc")
        day = observed.date().isoformat()
        total_key = (organism, day)
        category_key = (organism, day, category)
        if self.daily_totals[total_key] + points > self.policy["daily_total_cap"]:
            raise CreditError("Growth Point daily cap would be exceeded.")
        if (
            self.category_totals[category_key] + points
            > self.policy["category_daily_caps"][category]
        ):
            raise CreditError("Growth Point category daily cap would be exceeded.")
        self.receipts[event_id] = receipt
        self.daily_totals[total_key] += points
        self.category_totals[category_key] += points
        return receipt, True

    def total(self, organism_rappid: str) -> int:
        organism = validate_organism_rappid(organism_rappid)
        return sum(
            receipt["points"]
            for receipt in self.receipts.values()
            if receipt["organism_rappid"] == organism
        )


def sats_for_usd_target(target_usd_micros: int, btc_usd_micros: int) -> int:
    target = _positive_int(
        target_usd_micros,
        "target_usd_micros",
        9_007_199_254_740_991,
    )
    quote = _positive_int(
        btc_usd_micros,
        "btc_usd_micros",
        9_007_199_254_740_991,
    )
    return (target * 100_000_000 + quote - 1) // quote


def build_companion_evolution_schedule(
    *,
    issuer: str,
    family_id: str,
    generation_id: str,
    origin_to_journey: dict[str, Any],
    journey_to_ascendant: dict[str, Any],
    previous_schedule_hash: str | None,
    created_utc: str,
    signer: RegistrySigner,
) -> dict[str, Any]:
    if family_id not in FREE_COMPANION_FAMILY_IDS:
        raise CreditError("Starter evolution schedules require a free Companion Family.")
    transitions = {
        "origin-to-journey": _transition(
            origin_to_journey,
            "origin-to-journey",
            10_000_000,
            20_000_000,
        ),
        "journey-to-ascendant": _transition(
            journey_to_ascendant,
            "journey-to-ascendant",
            25_000_000,
            45_000_000,
        ),
    }
    if previous_schedule_hash is not None:
        previous_schedule_hash = validate_sha256(
            previous_schedule_hash,
            "previous_schedule_hash",
        )
    base = {
        "schema": EVOLUTION_SCHEDULE_SCHEMA,
        "kind": "body.pulse",
        "issuer": bounded_text(issuer, "issuer", 128),
        "family_id": family_id,
        "generation_id": bounded_text(generation_id, "generation_id", 128),
        "transitions": transitions,
        "previous_schedule_hash": previous_schedule_hash,
        "created_utc": _utc(created_utc, "created_utc").isoformat(timespec="seconds"),
        "retroactive_rewrite": False,
    }
    return _signed_record(base, id_prefix="evolution-schedule", signer=signer)


def _transition(
    value: Any,
    transition_id: str,
    minimum_target: int,
    maximum_target: int,
) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "required_points",
        "eligible_after_utc",
        "target_usd_micros",
    }:
        raise CreditError(f"{transition_id} has an invalid shape.")
    target = _positive_int(
        value["target_usd_micros"],
        f"{transition_id}.target_usd_micros",
        9_007_199_254_740_991,
    )
    if target < minimum_target or target > maximum_target:
        raise CreditError(f"{transition_id} target is outside its initial range.")
    return {
        "required_points": _positive_int(
            value["required_points"],
            f"{transition_id}.required_points",
            9_007_199_254_740_991,
        ),
        "eligible_after_utc": _utc(
            value["eligible_after_utc"],
            f"{transition_id}.eligible_after_utc",
        ).isoformat(timespec="seconds"),
        "target_usd_micros": target,
    }


def validate_evolution_schedule(policy: Any, verifier: GrowthReceiptVerifier) -> dict[str, Any]:
    if not isinstance(policy, dict) or policy.get("schema") != EVOLUTION_SCHEDULE_SCHEMA:
        raise CreditError("Evolution schedule schema is invalid.")
    expected_keys = {
        "schema",
        "kind",
        "issuer",
        "family_id",
        "generation_id",
        "transitions",
        "previous_schedule_hash",
        "created_utc",
        "retroactive_rewrite",
        "record_id",
        "record_hash",
        "signature",
    }
    if set(policy) != expected_keys or policy.get("kind") != "body.pulse":
        raise CreditError("Evolution schedule shape is invalid.")
    if policy.get("family_id") not in FREE_COMPANION_FAMILY_IDS:
        raise CreditError("Evolution schedule Family is not a free Companion Family.")
    if set(policy.get("transitions", {})) != set(TRANSITIONS):
        raise CreditError("Evolution schedule must contain both progressive transitions.")
    _transition(
        policy["transitions"]["origin-to-journey"],
        "origin-to-journey",
        10_000_000,
        20_000_000,
    )
    _transition(
        policy["transitions"]["journey-to-ascendant"],
        "journey-to-ascendant",
        25_000_000,
        45_000_000,
    )
    if policy.get("previous_schedule_hash") is not None:
        validate_sha256(policy["previous_schedule_hash"], "previous_schedule_hash")
    _utc(policy.get("created_utc"), "created_utc")
    if policy.get("retroactive_rewrite") is not False:
        raise CreditError("Evolution schedule cannot rewrite prior records.")
    payload = {
        key: value
        for key, value in policy.items()
        if key != "signature"
    }
    if not verifier.verify(payload, policy.get("signature")):
        raise CreditError("Evolution schedule signature is invalid.")
    hash_payload = {
        key: value
        for key, value in policy.items()
        if key not in {"record_id", "record_hash", "signature"}
    }
    expected_hash = hashlib.sha256(canonical_json(hash_payload)).hexdigest()
    if (
        policy.get("record_hash") != expected_hash
        or policy.get("record_id") != f"evolution-schedule:{expected_hash}"
    ):
        raise CreditError("Evolution schedule content address is invalid.")
    return policy


def build_stage_policy(
    *,
    issuer: str,
    organism_rappid: str,
    stage_id: str,
    transition_id: str,
    current_core_head: str,
    evolution_schedule: dict[str, Any],
    created_utc: str,
    signer: RegistrySigner,
    verifier: GrowthReceiptVerifier,
) -> dict[str, Any]:
    validate_organism_rappid(organism_rappid)
    schedule = validate_evolution_schedule(evolution_schedule, verifier)
    if transition_id not in TRANSITIONS:
        raise CreditError("transition_id is invalid.")
    transition = schedule["transitions"][transition_id]
    base = {
        "schema": STAGE_POLICY_SCHEMA,
        "kind": "body.pulse",
        "issuer": bounded_text(issuer, "issuer", 128),
        "organism_rappid": organism_rappid,
        "stage_id": bounded_text(stage_id, "stage_id", 128),
        "family_id": schedule["family_id"],
        "generation_id": schedule["generation_id"],
        "transition_id": transition_id,
        "required_points": transition["required_points"],
        "eligible_after_utc": transition["eligible_after_utc"],
        "current_core_head": validate_sha256(
            current_core_head,
            "current_core_head",
        ),
        "evolution_schedule_id": schedule["record_id"],
        "evolution_schedule_hash": schedule["record_hash"],
        "target_usd_micros": transition["target_usd_micros"],
        "created_utc": _utc(created_utc, "created_utc").isoformat(timespec="seconds"),
        "retroactive_rewrite": False,
        "pay_to_evolve": False,
    }
    return _signed_record(base, id_prefix="growth-stage-policy", signer=signer)


def stage_status(
    policy: dict[str, Any],
    *,
    current_core_head: str,
    point_total: int,
    evaluated_utc: str,
    compute_available: bool,
    verifier: GrowthReceiptVerifier,
) -> dict[str, Any]:
    validate_stage_policy(policy, verifier)
    if isinstance(point_total, bool) or not isinstance(point_total, int) or point_total < 0:
        raise CreditError("point_total must be a nonnegative integer.")
    head_matches = (
        validate_sha256(current_core_head, "current_core_head")
        == policy["current_core_head"]
    )
    points_met = point_total >= policy["required_points"]
    eligible = _utc(evaluated_utc, "evaluated_utc") >= _utc(
        policy["eligible_after_utc"],
        "eligible_after_utc",
    )
    mutation_due = points_met and eligible and head_matches
    return {
        "schema": "rapp-rapter-growth-stage-status/1",
        "stage_id": policy["stage_id"],
        "generation_id": policy["generation_id"],
        "point_total": point_total,
        "required_points": policy["required_points"],
        "points_met": points_met,
        "eligible_after_reached": eligible,
        "current_head_matches": head_matches,
        "mutation_due": mutation_due,
        "authoring_allowed": mutation_due and compute_available,
        "state": (
            "ready-for-next-verified-turn"
            if mutation_due and compute_available
            else "pending-no-compute"
            if mutation_due
            else "pending"
        ),
        "old_bytes_mutated": False,
    }


def validate_stage_policy(
    policy: Any,
    verifier: GrowthReceiptVerifier,
) -> dict[str, Any]:
    if (
        not isinstance(policy, dict)
        or set(policy) != STAGE_POLICY_KEYS
        or policy.get("schema") != STAGE_POLICY_SCHEMA
    ):
        raise CreditError("Stage policy schema is invalid.")
    if policy.get("kind") != "body.pulse":
        raise CreditError("Stage policy must use body.pulse.")
    validate_organism_rappid(policy.get("organism_rappid"))
    bounded_text(policy.get("stage_id"), "stage_id", 128)
    if policy.get("family_id") not in FREE_COMPANION_FAMILY_IDS:
        raise CreditError("Stage policy Family is not a free Companion Family.")
    bounded_text(policy.get("generation_id"), "generation_id", 128)
    if policy.get("transition_id") not in TRANSITIONS:
        raise CreditError("Stage policy transition is invalid.")
    _positive_int(
        policy.get("required_points"),
        "required_points",
        9_007_199_254_740_991,
    )
    _utc(policy.get("eligible_after_utc"), "eligible_after_utc")
    _utc(policy.get("created_utc"), "created_utc")
    validate_sha256(policy.get("current_core_head"), "current_core_head")
    bounded_text(policy.get("evolution_schedule_id"), "evolution_schedule_id", 128)
    validate_sha256(
        policy.get("evolution_schedule_hash"),
        "evolution_schedule_hash",
    )
    _positive_int(
        policy.get("target_usd_micros"),
        "target_usd_micros",
        9_007_199_254_740_991,
    )
    if policy.get("retroactive_rewrite") is not False or policy.get("pay_to_evolve") is not False:
        raise CreditError("Stage policy cannot rewrite history or require payment.")
    record_hash = validate_sha256(policy.get("record_hash"), "record_hash")
    record_id = bounded_text(policy.get("record_id"), "record_id", 128)
    hash_payload = {
        key: value
        for key, value in policy.items()
        if key not in {"record_id", "record_hash", "signature"}
    }
    expected_hash = hashlib.sha256(canonical_json(hash_payload)).hexdigest()
    if record_hash != expected_hash or record_id != f"growth-stage-policy:{expected_hash}":
        raise CreditError("Stage policy content address is invalid.")
    payload = {
        key: value
        for key, value in policy.items()
        if key != "signature"
    }
    if not verifier.verify(payload, policy.get("signature")):
        raise CreditError("Stage policy signature is invalid.")
    return policy


def build_evolution_event(
    *,
    policy: dict[str, Any],
    receipts: list[dict[str, Any]],
    successor_core_head: str,
    quote: BtcUsdQuote,
    accepted_utc: str,
    signer: RegistrySigner,
    verifier: GrowthReceiptVerifier,
    quote_max_age_seconds: int = 120,
) -> dict[str, Any]:
    verified_receipts = []
    receipt_ids = set()
    for receipt in receipts:
        receipt = validate_growth_receipt(receipt, verifier)
        if receipt["organism_rappid"] != policy["organism_rappid"]:
            raise CreditError("Growth receipt belongs to another organism.")
        if receipt["record_id"] in receipt_ids:
            raise CreditError("Growth receipt replay is not allowed in one transition.")
        receipt_ids.add(receipt["record_id"])
        verified_receipts.append({
            "record_id": receipt["record_id"],
            "category": receipt["category"],
            "points": receipt["points"],
            "observed_utc": receipt["observed_utc"],
            "attester": receipt["attester"],
            "source": receipt["source"],
            "evidence_hash": receipt["evidence_hash"],
        })
    point_total = sum(receipt["points"] for receipt in verified_receipts)
    status = stage_status(
        policy,
        current_core_head=policy["current_core_head"],
        point_total=point_total,
        evaluated_utc=accepted_utc,
        compute_available=True,
        verifier=verifier,
    )
    if not status["authoring_allowed"]:
        raise CreditError("Stage transition requirements are not satisfied.")
    successor = validate_sha256(successor_core_head, "successor_core_head")
    if successor == policy["current_core_head"]:
        raise CreditError("Evolution requires a new verified successor head.")
    verified_quote = validate_fresh_quote(
        quote,
        now=_utc(accepted_utc, "accepted_utc"),
        maximum_age_seconds=quote_max_age_seconds,
    )
    target_usd_micros = policy["target_usd_micros"]
    price_sats = sats_for_usd_target(
        target_usd_micros,
        verified_quote.btc_usd_micros,
    )
    receipt_hash = hashlib.sha256(canonical_json({
        "receipts": sorted(verified_receipts, key=lambda item: item["record_id"]),
    })).hexdigest()
    base = {
        "schema": EVOLUTION_SCHEMA,
        "kind": "body.pulse",
        "issuer": policy["issuer"],
        "organism_rappid": policy["organism_rappid"],
        "stage_id": policy["stage_id"],
        "generation_id": policy["generation_id"],
        "family_id": policy["family_id"],
        "transition_id": policy["transition_id"],
        "stage_policy_id": policy["record_id"],
        "evolution_schedule_id": policy["evolution_schedule_id"],
        "evolution_schedule_hash": policy["evolution_schedule_hash"],
        "previous_core_head": policy["current_core_head"],
        "successor_core_head": successor,
        "accepted_utc": _utc(accepted_utc, "accepted_utc").isoformat(timespec="seconds"),
        "points_total": point_total,
        "required_points": policy["required_points"],
        "growth_receipt_set_hash": receipt_hash,
        "btc_reference": {
            "purpose": "issuer-stage-reference-only",
            "payment": False,
            "yield": False,
            "redeemable": False,
            "target_usd_micros": target_usd_micros,
            "price_sats": price_sats,
            "quote": {
                "source": verified_quote.source,
                "observed_utc": verified_quote.observed_utc,
                "raw_response_hash": verified_quote.raw_response_hash,
                "btc_usd_micros": verified_quote.btc_usd_micros,
            },
            "fiat_reference_usd_micros": birth_value_usd_micros(
                price_sats,
                verified_quote.btc_usd_micros,
            ),
        },
        "birth_valuation_changed": False,
        "old_bytes_mutated": False,
    }
    return _signed_record(base, id_prefix="evolution-event", signer=signer)
