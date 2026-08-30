import base64
import hashlib
from datetime import datetime, timedelta, timezone

from credits.domain import canonical_json
from credits.generations import (
    ORIGINAL_COUNT,
    ORIGINAL_IDS,
    build_generation_policy,
    build_mutation_policy,
    build_original_catalog,
    companion_source_original_for_account,
    mutation_status,
    validate_generation_policy,
    validate_original_catalog,
    validate_original_id,
)


NOW = datetime(2026, 8, 29, 20, 0, 0, tzinfo=timezone.utc)
OFFSPRING_RAPPID = (
    "rappid:@companion-aaaaaaaaaaaa/first-dimension-001:"
    + "a" * 64
)


class Signer:
    def sign(self, payload):
        digest = hashlib.sha256(canonical_json(payload)).digest()
        return {
            "algorithm": "ES256",
            "key_id": "https://issuer.example/key/v1",
            "value": base64.urlsafe_b64encode(digest + digest).rstrip(b"=").decode(),
        }

    def verify(self, payload, signature):
        return signature["value"] == self.sign(payload)["value"]


def test_launch_catalog_has_251_issuer_held_undiscovered_originals():
    assert ORIGINAL_COUNT == 251
    assert len(ORIGINAL_IDS) == 251
    assert len(set(ORIGINAL_IDS)) == 251
    catalog = build_original_catalog(
        issuer="rappterbox",
        published_utc=NOW.isoformat(timespec="seconds"),
        signer=Signer(),
    )
    assert catalog["canonical_original_count"] == 251
    assert catalog["issuer_held_count"] == 251
    assert catalog["transferred_count"] == 0
    assert catalog["discovered_count"] == 0
    assert catalog["undiscovered_count"] == 251
    assert all(
        record["title_owner"] == "rappterbox"
        and record["original_rappid"].startswith("rappid:@rapterbox/")
        and record["ownership_state"] == "issuer-held"
        and record["transfer_count"] == 0
        and record["discovery_state"] == "undiscovered"
        for record in catalog["originals"]
    )
    assert catalog["offspring_identity_rule"] == "distinct-rappid-and-rights"
    assert validate_original_catalog(catalog, Signer()) == catalog


def test_companion_source_original_assignment_is_deterministic():
    account_hash = "a" * 64
    first = companion_source_original_for_account(account_hash)
    assert first in ORIGINAL_IDS
    assert companion_source_original_for_account(account_hash) == first
    assert validate_original_id(first) == first


def test_generation_policy_caps_offspring_without_consuming_original_titles():
    caps = {
        original_id: {
            "offspring_birth_cap": 100,
            "exclusive_rental_cap": 10,
        }
        for original_id in ORIGINAL_IDS
    }
    policy = build_generation_policy(
        issuer="rappterbox",
        generation_id="generation-0001",
        eligible_after_utc=(NOW + timedelta(days=1)).isoformat(timespec="seconds"),
        offspring_caps=caps,
        previous_policy_hash=None,
        created_utc=NOW.isoformat(timespec="seconds"),
        signer=Signer(),
    )
    assert policy["canonical_original_count"] == 251
    assert len(policy["source_original_caps"]) == 251
    assert policy["original_title_supply_affected"] is False
    assert policy["offspring_distinct_rappid_required"] is True
    assert policy["offspring_distinct_rights_required"] is True
    assert policy["retroactive_rewrite"] is False
    assert policy["signature"]["algorithm"] == "ES256"
    assert validate_generation_policy(policy, Signer()) == policy


def test_mutation_due_never_rewrites_original_or_old_bytes():
    policy = build_mutation_policy(
        issuer="rappterbox",
        organism_rappid=OFFSPRING_RAPPID,
        source_original_id=ORIGINAL_IDS[0],
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
        verifier=Signer(),
    )
    assert pending["mutation_due"] is True
    assert pending["authoring_allowed"] is False
    assert pending["state"] == "pending-no-compute"
    assert pending["old_bytes_mutated"] is False
    assert pending["original_title_affected"] is False
    assert pending["current_core_head"] == "b" * 64

    ready = mutation_status(
        policy,
        evaluated_utc=(NOW + timedelta(seconds=1)).isoformat(timespec="seconds"),
        compute_available=True,
        verifier=Signer(),
    )
    assert ready["state"] == "ready-for-next-verified-turn"
    assert ready["successor_required"] is True


def test_crossing_utc_only_marks_offspring_mutation_due():
    policy = build_mutation_policy(
        issuer="rappterbox",
        organism_rappid=OFFSPRING_RAPPID,
        source_original_id=ORIGINAL_IDS[1],
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
        verifier=Signer(),
    )
    after = mutation_status(
        policy,
        evaluated_utc=(NOW + timedelta(days=1)).isoformat(timespec="seconds"),
        compute_available=True,
        verifier=Signer(),
    )
    assert before["mutation_due"] is False
    assert after["mutation_due"] is True
    assert before["current_core_head"] == after["current_core_head"]
    assert before["old_bytes_mutated"] is False
    assert after["old_bytes_mutated"] is False
