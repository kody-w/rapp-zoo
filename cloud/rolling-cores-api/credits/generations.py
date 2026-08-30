import hashlib
import re
from datetime import datetime, timezone
from typing import Any

from .domain import (
    CreditError,
    bounded_text,
    canonical_json,
    validate_organism_rappid,
    validate_sha256,
)
from .signing import RegistrySigner


ORIGINAL_COUNT = 251
ORIGINAL_IDS = tuple(
    f"first-dimension-{index:03d}"
    for index in range(1, ORIGINAL_COUNT + 1)
)
ORIGINAL_CATALOG_SCHEMA = "rapp-rapter-original-catalog/1"
GENERATION_POLICY_SCHEMA = "rapp-rapter-offspring-generation-policy/1"
MUTATION_POLICY_SCHEMA = "rapp-rapter-offspring-mutation-policy/1"
_GENERATION_ID = re.compile(r"^generation-[0-9]{4}$")
ORIGINAL_CATALOG_KEYS = {
    "schema",
    "kind",
    "issuer",
    "edition",
    "dimension",
    "canonical_original_count",
    "issuer_held_count",
    "transferred_count",
    "discovered_count",
    "undiscovered_count",
    "originals",
    "title_transfer_requirements",
    "offspring_identity_rule",
    "published_utc",
    "catalog_id",
    "catalog_hash",
    "signature",
}
GENERATION_POLICY_KEYS = {
    "schema",
    "kind",
    "issuer",
    "generation_id",
    "eligible_after_utc",
    "created_utc",
    "previous_policy_hash",
    "canonical_original_count",
    "source_original_caps",
    "original_title_supply_affected",
    "offspring_distinct_rappid_required",
    "offspring_distinct_rights_required",
    "retroactive_rewrite",
    "policy_id",
    "policy_hash",
    "signature",
}
MUTATION_POLICY_KEYS = {
    "schema",
    "kind",
    "issuer",
    "organism_rappid",
    "source_original_id",
    "generation_id",
    "eligible_after_utc",
    "created_utc",
    "current_core_head",
    "previous_policy_hash",
    "mutation_mode",
    "original_title_affected",
    "offspring_rights_profile",
    "retroactive_rewrite",
    "policy_id",
    "policy_hash",
    "signature",
}


def validate_original_id(original_id: Any) -> str:
    if not isinstance(original_id, str) or original_id not in ORIGINAL_IDS:
        raise CreditError("First Dimension Original id is not canonical.")
    return original_id


def original_rappid(original_id: Any) -> str:
    original_id = validate_original_id(original_id)
    digest = hashlib.sha256(
        f"rappterbox-first-edition\0{original_id}".encode(),
    ).hexdigest()
    return f"rappid:@rapterbox/{original_id}:{digest}"


def companion_source_original_for_account(account_hash: str) -> str:
    validate_sha256(account_hash, "account_hash")
    return ORIGINAL_IDS[int(account_hash, 16) % ORIGINAL_COUNT]


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


def build_original_catalog(
    *,
    issuer: str,
    published_utc: str,
    signer: RegistrySigner,
) -> dict[str, Any]:
    originals = [
        {
            "original_id": original_id,
            "original_rappid": original_rappid(original_id),
            "edition": "first-edition",
            "dimension": "first-dimension",
            "title_owner": "rappterbox",
            "ownership_state": "issuer-held",
            "transfer_count": 0,
            "discovery_state": "undiscovered",
        }
        for original_id in ORIGINAL_IDS
    ]
    base = {
        "schema": ORIGINAL_CATALOG_SCHEMA,
        "kind": "body.pulse",
        "issuer": bounded_text(issuer, "issuer", 128),
        "edition": "first-edition",
        "dimension": "first-dimension",
        "canonical_original_count": ORIGINAL_COUNT,
        "issuer_held_count": ORIGINAL_COUNT,
        "transferred_count": 0,
        "discovered_count": 0,
        "undiscovered_count": ORIGINAL_COUNT,
        "originals": originals,
        "title_transfer_requirements": [
            "verified-output-rights",
            "verified-commerce-settlement",
        ],
        "offspring_identity_rule": "distinct-rappid-and-rights",
        "published_utc": _utc(published_utc, "published_utc"),
    }
    catalog_hash = _policy_hash(base)
    payload = {
        **base,
        "catalog_id": f"original-catalog:{catalog_hash}",
        "catalog_hash": catalog_hash,
    }
    return {**payload, "signature": signer.sign(payload)}


def validate_original_catalog(
    catalog: Any,
    verifier: RegistrySigner,
) -> dict[str, Any]:
    if (
        not isinstance(catalog, dict)
        or set(catalog) != ORIGINAL_CATALOG_KEYS
        or catalog.get("schema") != ORIGINAL_CATALOG_SCHEMA
        or catalog.get("kind") != "body.pulse"
        or catalog.get("edition") != "first-edition"
        or catalog.get("dimension") != "first-dimension"
        or catalog.get("canonical_original_count") != ORIGINAL_COUNT
        or catalog.get("issuer_held_count") != ORIGINAL_COUNT
        or catalog.get("transferred_count") != 0
        or catalog.get("discovered_count") != 0
        or catalog.get("undiscovered_count") != ORIGINAL_COUNT
        or catalog.get("title_transfer_requirements") != [
            "verified-output-rights",
            "verified-commerce-settlement",
        ]
        or catalog.get("offspring_identity_rule") != "distinct-rappid-and-rights"
    ):
        raise CreditError("Original catalog launch state is invalid.")
    bounded_text(catalog.get("issuer"), "issuer", 128)
    originals = catalog.get("originals")
    if not isinstance(originals, list) or len(originals) != ORIGINAL_COUNT:
        raise CreditError("Original catalog must contain exactly 251 entries.")
    if [record.get("original_id") for record in originals] != list(ORIGINAL_IDS):
        raise CreditError("Original catalog identifiers are invalid.")
    for record in originals:
        if set(record) != {
            "original_id",
            "original_rappid",
            "edition",
            "dimension",
            "title_owner",
            "ownership_state",
            "transfer_count",
            "discovery_state",
        } or record != {
            "original_id": record["original_id"],
            "original_rappid": original_rappid(record["original_id"]),
            "edition": "first-edition",
            "dimension": "first-dimension",
            "title_owner": "rappterbox",
            "ownership_state": "issuer-held",
            "transfer_count": 0,
            "discovery_state": "undiscovered",
        }:
            raise CreditError("Original catalog entry launch state is invalid.")
    _utc(catalog.get("published_utc"), "published_utc")
    hash_payload = {
        key: value
        for key, value in catalog.items()
        if key not in {"catalog_id", "catalog_hash", "signature"}
    }
    expected_hash = _policy_hash(hash_payload)
    if (
        catalog.get("catalog_hash") != expected_hash
        or catalog.get("catalog_id") != f"original-catalog:{expected_hash}"
    ):
        raise CreditError("Original catalog content address is invalid.")
    payload = {key: value for key, value in catalog.items() if key != "signature"}
    if not verifier.verify(payload, catalog.get("signature")):
        raise CreditError("Original catalog signature is invalid.")
    return catalog


def build_generation_policy(
    *,
    issuer: str,
    generation_id: str,
    eligible_after_utc: str,
    offspring_caps: dict[str, dict[str, int]],
    previous_policy_hash: str | None,
    created_utc: str,
    signer: RegistrySigner,
) -> dict[str, Any]:
    if not _GENERATION_ID.fullmatch(generation_id):
        raise CreditError("generation_id is invalid.")
    if set(offspring_caps) != set(ORIGINAL_IDS):
        raise CreditError(
            "Offspring policy must cap all 251 source Originals exactly once.",
        )
    normalized_caps = {}
    for original_id in ORIGINAL_IDS:
        value = offspring_caps[original_id]
        if not isinstance(value, dict) or set(value) != {
            "offspring_birth_cap",
            "exclusive_rental_cap",
        }:
            raise CreditError("Offspring supply caps have an invalid shape.")
        normalized_caps[original_id] = {
            "offspring_birth_cap": _cap(
                value["offspring_birth_cap"],
                "offspring_birth_cap",
            ),
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
        "issuer": bounded_text(issuer, "issuer", 128),
        "generation_id": generation_id,
        "eligible_after_utc": _utc(eligible_after_utc, "eligible_after_utc"),
        "created_utc": _utc(created_utc, "created_utc"),
        "previous_policy_hash": previous_policy_hash,
        "canonical_original_count": ORIGINAL_COUNT,
        "source_original_caps": normalized_caps,
        "original_title_supply_affected": False,
        "offspring_distinct_rappid_required": True,
        "offspring_distinct_rights_required": True,
        "retroactive_rewrite": False,
    }
    policy_hash = _policy_hash(base)
    payload = {
        **base,
        "policy_id": f"offspring-generation-policy:{policy_hash}",
        "policy_hash": policy_hash,
    }
    return {**payload, "signature": signer.sign(payload)}


def build_mutation_policy(
    *,
    issuer: str,
    organism_rappid: str,
    source_original_id: str,
    generation_id: str,
    eligible_after_utc: str,
    current_core_head: str,
    created_utc: str,
    previous_policy_hash: str | None,
    signer: RegistrySigner,
) -> dict[str, Any]:
    validate_organism_rappid(organism_rappid)
    validate_original_id(source_original_id)
    if organism_rappid == original_rappid(source_original_id):
        raise CreditError("Offspring RAPPID must differ from the source Original.")
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
        "issuer": bounded_text(issuer, "issuer", 128),
        "organism_rappid": organism_rappid,
        "source_original_id": source_original_id,
        "generation_id": generation_id,
        "eligible_after_utc": _utc(eligible_after_utc, "eligible_after_utc"),
        "created_utc": _utc(created_utc, "created_utc"),
        "current_core_head": current_core_head,
        "previous_policy_hash": previous_policy_hash,
        "mutation_mode": "next-verified-ai-turn-successor",
        "original_title_affected": False,
        "offspring_rights_profile": "distinct-from-source-original",
        "retroactive_rewrite": False,
    }
    policy_hash = _policy_hash(base)
    payload = {
        **base,
        "policy_id": f"offspring-mutation-policy:{policy_hash}",
        "policy_hash": policy_hash,
    }
    return {**payload, "signature": signer.sign(payload)}


def validate_generation_policy(
    policy: Any,
    verifier: RegistrySigner,
) -> dict[str, Any]:
    if (
        not isinstance(policy, dict)
        or set(policy) != GENERATION_POLICY_KEYS
        or policy.get("schema") != GENERATION_POLICY_SCHEMA
        or policy.get("kind") != "body.pulse"
    ):
        raise CreditError("Offspring generation policy shape is invalid.")
    if not _GENERATION_ID.fullmatch(policy.get("generation_id", "")):
        raise CreditError("generation_id is invalid.")
    bounded_text(policy.get("issuer"), "issuer", 128)
    _utc(policy.get("eligible_after_utc"), "eligible_after_utc")
    _utc(policy.get("created_utc"), "created_utc")
    if policy.get("previous_policy_hash") is not None:
        validate_sha256(policy["previous_policy_hash"], "previous_policy_hash")
    if policy.get("canonical_original_count") != ORIGINAL_COUNT:
        raise CreditError("Offspring policy Original count is invalid.")
    caps = policy.get("source_original_caps")
    if not isinstance(caps, dict) or set(caps) != set(ORIGINAL_IDS):
        raise CreditError("Offspring source Original caps are invalid.")
    for value in caps.values():
        if not isinstance(value, dict) or set(value) != {
            "offspring_birth_cap",
            "exclusive_rental_cap",
        }:
            raise CreditError("Offspring supply cap shape is invalid.")
        _cap(value["offspring_birth_cap"], "offspring_birth_cap")
        _cap(value["exclusive_rental_cap"], "exclusive_rental_cap")
    if (
        policy.get("original_title_supply_affected") is not False
        or policy.get("offspring_distinct_rappid_required") is not True
        or policy.get("offspring_distinct_rights_required") is not True
        or policy.get("retroactive_rewrite") is not False
    ):
        raise CreditError("Offspring policy violates Original supply boundaries.")
    hash_payload = {
        key: value
        for key, value in policy.items()
        if key not in {"policy_id", "policy_hash", "signature"}
    }
    expected_hash = _policy_hash(hash_payload)
    if (
        policy.get("policy_hash") != expected_hash
        or policy.get("policy_id")
        != f"offspring-generation-policy:{expected_hash}"
    ):
        raise CreditError("Offspring generation policy content address is invalid.")
    payload = {key: value for key, value in policy.items() if key != "signature"}
    if not verifier.verify(payload, policy.get("signature")):
        raise CreditError("Offspring generation policy signature is invalid.")
    return policy


def mutation_status(
    policy: dict[str, Any],
    *,
    evaluated_utc: str,
    compute_available: bool,
    verifier: RegistrySigner,
) -> dict[str, Any]:
    if (
        not isinstance(policy, dict)
        or set(policy) != MUTATION_POLICY_KEYS
        or policy.get("schema") != MUTATION_POLICY_SCHEMA
    ):
        raise CreditError("Offspring mutation policy schema is invalid.")
    payload = {key: value for key, value in policy.items() if key != "signature"}
    if not verifier.verify(payload, policy.get("signature")):
        raise CreditError("Offspring mutation policy signature is invalid.")
    hash_payload = {
        key: value
        for key, value in policy.items()
        if key not in {"policy_id", "policy_hash", "signature"}
    }
    expected_hash = _policy_hash(hash_payload)
    if (
        policy.get("policy_hash") != expected_hash
        or policy.get("policy_id") != f"offspring-mutation-policy:{expected_hash}"
    ):
        raise CreditError("Offspring mutation policy content address is invalid.")
    validate_organism_rappid(policy.get("organism_rappid"))
    bounded_text(policy.get("issuer"), "issuer", 128)
    validate_original_id(policy.get("source_original_id"))
    if policy["organism_rappid"] == original_rappid(policy["source_original_id"]):
        raise CreditError("Offspring RAPPID must differ from the source Original.")
    if not _GENERATION_ID.fullmatch(policy.get("generation_id", "")):
        raise CreditError("generation_id is invalid.")
    _utc(policy.get("eligible_after_utc"), "eligible_after_utc")
    _utc(policy.get("created_utc"), "created_utc")
    validate_sha256(policy.get("current_core_head"), "current_core_head")
    if policy.get("previous_policy_hash") is not None:
        validate_sha256(policy["previous_policy_hash"], "previous_policy_hash")
    if policy.get("mutation_mode") != "next-verified-ai-turn-successor":
        raise CreditError("Offspring mutation policy mode is invalid.")
    if (
        policy.get("original_title_affected") is not False
        or policy.get("offspring_rights_profile") != "distinct-from-source-original"
        or policy.get("retroactive_rewrite") is not False
    ):
        raise CreditError("Offspring mutation cannot alter Original title or history.")
    eligible = datetime.fromisoformat(
        _utc(policy.get("eligible_after_utc"), "eligible_after_utc"),
    )
    evaluated = datetime.fromisoformat(_utc(evaluated_utc, "evaluated_utc"))
    mutation_due = evaluated >= eligible
    return {
        "schema": "rapp-rapter-offspring-mutation-status/1",
        "organism_rappid": policy["organism_rappid"],
        "source_original_id": policy["source_original_id"],
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
        "original_title_affected": False,
        "successor_required": True,
    }
