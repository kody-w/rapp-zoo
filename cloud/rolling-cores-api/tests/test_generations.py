import base64
import hashlib
from datetime import datetime, timedelta, timezone

from credits.domain import canonical_json
from credits.generations import (
    FREE_COMPANION_FAMILY_IDS,
    GENESIS_FAMILY_COUNT,
    GENESIS_FAMILY_IDS,
    PREMIUM_FAMILY_COUNT,
    PREMIUM_FAMILY_IDS,
    build_generation_policy,
    build_mutation_policy,
    companion_family_for_account,
    family_class,
    mutation_status,
)


NOW = datetime(2026, 8, 29, 20, 0, 0, tzinfo=timezone.utc)


class Signer:
    def sign(self, payload):
        digest = hashlib.sha256(canonical_json(payload)).digest()
        return {
            "algorithm": "ES256",
            "key_id": "https://issuer.example/key/v1",
            "value": base64.urlsafe_b64encode(digest + digest).rstrip(b"=").decode(),
        }


def test_genesis_family_supply_split_is_exact_and_neutral():
    assert GENESIS_FAMILY_COUNT == 151
    assert len(GENESIS_FAMILY_IDS) == 151
    assert len(FREE_COMPANION_FAMILY_IDS) == 3
    assert len(PREMIUM_FAMILY_IDS) == PREMIUM_FAMILY_COUNT == 148
    assert all(family_class(value) == "free-companion" for value in FREE_COMPANION_FAMILY_IDS)
    assert all(family_class(value) == "premium" for value in PREMIUM_FAMILY_IDS)
    assert len(set(GENESIS_FAMILY_IDS)) == 151


def test_free_companion_family_assignment_is_deterministic_and_one_of_three():
    account_hash = "a" * 64
    first = companion_family_for_account(account_hash)
    assert first in FREE_COMPANION_FAMILY_IDS
    assert companion_family_for_account(account_hash) == first


def test_generation_policy_signs_all_premium_family_caps():
    caps = {
        family_id: {
            "birth_cap": 100,
            "exclusive_rental_cap": 10,
        }
        for family_id in PREMIUM_FAMILY_IDS
    }
    policy = build_generation_policy(
        issuer="rappterbox",
        generation_id="generation-0001",
        eligible_after_utc=(NOW + timedelta(days=1)).isoformat(timespec="seconds"),
        family_caps=caps,
        previous_policy_hash=None,
        created_utc=NOW.isoformat(timespec="seconds"),
        signer=Signer(),
    )
    assert policy["canonical_family_count"] == 151
    assert len(policy["premium_family_caps"]) == 148
    assert policy["free_companion_family_ids"] == list(FREE_COMPANION_FAMILY_IDS)
    assert policy["retroactive_rewrite"] is False
    assert policy["signature"]["algorithm"] == "ES256"


def test_mutation_due_never_rewrites_old_bytes_and_waits_for_compute():
    policy = build_mutation_policy(
        issuer="rappterbox",
        family_id=PREMIUM_FAMILY_IDS[0],
        generation_id="generation-0002",
        eligible_after_utc=NOW.isoformat(timespec="seconds"),
        current_core_head="b" * 64,
        created_utc=(NOW - timedelta(minutes=1)).isoformat(timespec="seconds"),
        previous_policy_hash="c" * 64,
        signer=Signer(),
    )
    pending = mutation_status(
        policy,
        evaluated_utc=(NOW + timedelta(seconds=1)).isoformat(timespec="seconds"),
        compute_available=False,
    )
    assert pending["mutation_due"] is True
    assert pending["authoring_allowed"] is False
    assert pending["state"] == "pending-no-compute"
    assert pending["old_bytes_mutated"] is False
    assert pending["current_core_head"] == "b" * 64

    ready = mutation_status(
        policy,
        evaluated_utc=(NOW + timedelta(seconds=1)).isoformat(timespec="seconds"),
        compute_available=True,
    )
    assert ready["state"] == "ready-for-next-verified-turn"
    assert ready["successor_required"] is True


def test_crossing_utc_only_marks_mutation_due():
    policy = build_mutation_policy(
        issuer="rappterbox",
        family_id=FREE_COMPANION_FAMILY_IDS[0],
        generation_id="generation-0002",
        eligible_after_utc=(NOW + timedelta(days=1)).isoformat(timespec="seconds"),
        current_core_head="d" * 64,
        created_utc=NOW.isoformat(timespec="seconds"),
        previous_policy_hash=None,
        signer=Signer(),
    )
    before = mutation_status(
        policy,
        evaluated_utc=NOW.isoformat(timespec="seconds"),
        compute_available=True,
    )
    after = mutation_status(
        policy,
        evaluated_utc=(NOW + timedelta(days=1)).isoformat(timespec="seconds"),
        compute_available=True,
    )
    assert before["mutation_due"] is False
    assert after["mutation_due"] is True
    assert before["current_core_head"] == after["current_core_head"]
    assert before["old_bytes_mutated"] is False
    assert after["old_bytes_mutated"] is False
