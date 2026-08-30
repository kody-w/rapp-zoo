import hashlib
import re
from datetime import datetime, timezone
from typing import Any

from .domain import CreditError, canonical_json, validate_sha256
from .signing import RegistrySigner


GENESIS_FAMILY_COUNT = 151
FREE_COMPANION_FAMILY_COUNT = 3
PREMIUM_FAMILY_COUNT = 148
GENESIS_FAMILY_IDS = tuple(
    f"genesis-family-{index:03d}"
    for index in range(1, GENESIS_FAMILY_COUNT + 1)
)
FREE_COMPANION_FAMILY_IDS = GENESIS_FAMILY_IDS[:FREE_COMPANION_FAMILY_COUNT]
PREMIUM_FAMILY_IDS = GENESIS_FAMILY_IDS[FREE_COMPANION_FAMILY_COUNT:]
GENERATION_POLICY_SCHEMA = "rapp-rapter-generation-policy/1"
MUTATION_POLICY_SCHEMA = "rapp-rapter-mutation-policy/1"
_GENERATION_ID = re.compile(r"^generation-[0-9]{4}$")


def family_class(family_id: str) -> str:
    if family_id in FREE_COMPANION_FAMILY_IDS:
        return "free-companion"
    if family_id in PREMIUM_FAMILY_IDS:
        return "premium"
    raise CreditError("Genesis family id is not canonical.")


def companion_family_for_account(account_hash: str) -> str:
    validate_sha256(account_hash, "account_hash")
    index = int(account_hash, 16) % FREE_COMPANION_FAMILY_COUNT
    return FREE_COMPANION_FAMILY_IDS[index]


def _utc(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise CreditError(f"{label} is invalid.")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise CreditError(f"{label} is invalid.") from error
    if parsed.tzinfo is None:
        raise CreditError(f"{label} must include a timezone.")
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def _cap(value: Any, label: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 1
        or value > 9_007_199_254_740_991
    ):
        raise CreditError(f"{label} must be a positive uint53.")
    return value


def _policy_hash(value: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def build_generation_policy(
    *,
    issuer: str,
    generation_id: str,
    eligible_after_utc: str,
    family_caps: dict[str, dict[str, int]],
    previous_policy_hash: str | None,
    created_utc: str,
    signer: RegistrySigner,
) -> dict[str, Any]:
    if not _GENERATION_ID.fullmatch(generation_id):
        raise CreditError("generation_id is invalid.")
    if set(family_caps) != set(PREMIUM_FAMILY_IDS):
        raise CreditError("Generation policy must cap all 148 premium families exactly once.")
    normalized_caps = {}
    for family_id in PREMIUM_FAMILY_IDS:
        value = family_caps[family_id]
        if not isinstance(value, dict) or set(value) != {
            "birth_cap",
            "exclusive_rental_cap",
        }:
            raise CreditError("Premium family caps have an invalid shape.")
        normalized_caps[family_id] = {
            "birth_cap": _cap(value["birth_cap"], "birth_cap"),
            "exclusive_rental_cap": _cap(
                value["exclusive_rental_cap"],
                "exclusive_rental_cap",
            ),
        }
    if previous_policy_hash is not None:
        previous_policy_hash = validate_sha256(
            previous_policy_hash,
            "previous_policy_hash",
        )
    base = {
        "schema": GENERATION_POLICY_SCHEMA,
        "kind": "body.pulse",
        "issuer": issuer,
        "generation_id": generation_id,
        "eligible_after_utc": _utc(eligible_after_utc, "eligible_after_utc"),
        "created_utc": _utc(created_utc, "created_utc"),
        "previous_policy_hash": previous_policy_hash,
        "canonical_family_count": GENESIS_FAMILY_COUNT,
        "free_companion_family_ids": list(FREE_COMPANION_FAMILY_IDS),
        "premium_family_caps": normalized_caps,
        "retroactive_rewrite": False,
    }
    policy_hash = _policy_hash(base)
    payload = {
        **base,
        "policy_id": f"generation-policy:{policy_hash}",
        "policy_hash": policy_hash,
    }
    return {**payload, "signature": signer.sign(payload)}


def build_mutation_policy(
    *,
    issuer: str,
    family_id: str,
    generation_id: str,
    eligible_after_utc: str,
    current_core_head: str,
    created_utc: str,
    previous_policy_hash: str | None,
    signer: RegistrySigner,
) -> dict[str, Any]:
    family_class(family_id)
    if not _GENERATION_ID.fullmatch(generation_id):
        raise CreditError("generation_id is invalid.")
    validate_sha256(current_core_head, "current_core_head")
    if previous_policy_hash is not None:
        previous_policy_hash = validate_sha256(
            previous_policy_hash,
            "previous_policy_hash",
        )
    base = {
        "schema": MUTATION_POLICY_SCHEMA,
        "kind": "body.pulse",
        "issuer": issuer,
        "family_id": family_id,
        "generation_id": generation_id,
        "eligible_after_utc": _utc(eligible_after_utc, "eligible_after_utc"),
        "created_utc": _utc(created_utc, "created_utc"),
        "current_core_head": current_core_head,
        "previous_policy_hash": previous_policy_hash,
        "mutation_mode": "next-verified-ai-turn-successor",
        "retroactive_rewrite": False,
    }
    policy_hash = _policy_hash(base)
    payload = {
        **base,
        "policy_id": f"mutation-policy:{policy_hash}",
        "policy_hash": policy_hash,
    }
    return {**payload, "signature": signer.sign(payload)}


def mutation_status(
    policy: dict[str, Any],
    *,
    evaluated_utc: str,
    compute_available: bool,
) -> dict[str, Any]:
    if policy.get("schema") != MUTATION_POLICY_SCHEMA:
        raise CreditError("Mutation policy schema is invalid.")
    eligible = datetime.fromisoformat(_utc(
        policy.get("eligible_after_utc"),
        "eligible_after_utc",
    ))
    evaluated = datetime.fromisoformat(_utc(evaluated_utc, "evaluated_utc"))
    mutation_due = evaluated >= eligible
    return {
        "schema": "rapp-rapter-mutation-status/1",
        "family_id": policy["family_id"],
        "generation_id": policy["generation_id"],
        "current_core_head": policy["current_core_head"],
        "mutation_due": mutation_due,
        "authoring_allowed": mutation_due and compute_available,
        "state": (
            "ready-for-next-verified-turn"
            if mutation_due and compute_available
            else "pending-no-compute"
            if mutation_due
            else "pending-time"
        ),
        "old_bytes_mutated": False,
        "successor_required": True,
    }
