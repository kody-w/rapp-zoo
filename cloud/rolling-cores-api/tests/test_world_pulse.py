import base64
import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from credits.domain import CreditError, canonical_json
from credits.world_pulse import (
    InMemoryWorldPulseLedger,
    VerifiedGrowthAttestation,
    WorldPulseService,
    build_world_pulse_checkpoint,
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


class Verifier:
    configured = True

    def __init__(self, attestation):
        self.attestation = attestation

    def verify(self, payload, headers):
        assert payload == b"opaque-private-attestation"
        assert headers == {"x-attestation": "verified"}
        return self.attestation


def attestation(
    event_id,
    account,
    *,
    points=2,
    category="care",
    entitlement_class="verified-account",
    verified=True,
    anti_sybil=True,
    second=0,
):
    return VerifiedGrowthAttestation(
        attestation_id=event_id,
        account_reference=account,
        entitlement_class=entitlement_class,
        category=category,
        points=points,
        observed_utc=(NOW + timedelta(seconds=second)).isoformat(timespec="seconds"),
        source="local-growth-attester",
        evidence_hash=hashlib.sha256(event_id.encode()).hexdigest(),
        account_verified=verified,
        anti_sybil_passed=anti_sybil,
    )


def record(ledger, value):
    ledger.verifier = Verifier(value)
    return ledger.record(
        b"opaque-private-attestation",
        {"x-attestation": "verified"},
    )


def test_every_verified_account_class_can_contribute_without_purchasing_points():
    ledger = InMemoryWorldPulseLedger(verifier=Verifier(attestation("e0", "a0")))
    for index, entitlement_class in enumerate((
        "verified-account",
        "free-companion",
        "premium-owner",
        "premium-lessee",
    )):
        event, created = record(ledger, attestation(
            f"event-{index}",
            f"account-{index}",
            entitlement_class=entitlement_class,
            category=(
                "accessible-equivalent"
                if entitlement_class == "free-companion"
                else "care"
            ),
            second=index,
        ))
        assert created is True
        assert event["purchasable"] is False
        assert event["transferable"] is False
        assert event["redeemable"] is False
        assert set(event).isdisjoint({"raw_health", "email", "receipt"})


def test_attestation_ids_are_idempotent_and_anti_sybil_is_required():
    value = attestation("event-1", "account-1")
    ledger = InMemoryWorldPulseLedger(verifier=Verifier(value))
    first, created = record(ledger, value)
    repeated, repeated_created = record(ledger, value)
    assert created is True
    assert repeated_created is False
    assert repeated == first

    with pytest.raises(CreditError, match="anti-Sybil"):
        record(ledger, attestation(
            "event-2",
            "account-2",
            verified=False,
        ))
    with pytest.raises(CreditError, match="anti-Sybil"):
        record(ledger, attestation(
            "event-3",
            "account-3",
            anti_sybil=False,
        ))


def test_per_account_daily_event_and_point_caps_are_enforced():
    ledger = InMemoryWorldPulseLedger(
        verifier=Verifier(attestation("event-0", "account-1")),
        points_per_event_cap=3,
        events_per_account_daily_cap=2,
        points_per_account_daily_cap=5,
    )
    record(ledger, attestation("event-1", "account-1", points=3))
    record(ledger, attestation("event-2", "account-1", points=2, category="curiosity"))
    with pytest.raises(CreditError, match="daily event cap"):
        record(ledger, attestation("event-3", "account-1", points=1))

    second = InMemoryWorldPulseLedger(
        verifier=Verifier(attestation("event-0", "account-1")),
        points_per_event_cap=3,
        events_per_account_daily_cap=10,
        points_per_account_daily_cap=4,
    )
    record(second, attestation("event-4", "account-1", points=3))
    with pytest.raises(CreditError, match="daily point cap"):
        record(second, attestation("event-5", "account-1", points=2))


def test_world_pulse_checkpoint_is_privacy_safe_signed_and_deterministic():
    ledger = InMemoryWorldPulseLedger(verifier=Verifier(attestation("e0", "a0")))
    event1, _ = record(ledger, attestation(
        "event-1",
        "account-1",
        points=2,
        entitlement_class="free-companion",
    ))
    event2, _ = record(ledger, attestation(
        "event-2",
        "account-2",
        points=3,
        category="accessible-equivalent",
        second=1,
    ))
    pulse = WorldPulseService(
        issuer="rappterbox",
        ledger=ledger,
        signer=Signer(),
        milestones=[
            {
                "milestone_id": "shared-story-001",
                "threshold_points": 5,
                "event_kind": "shared-story",
            },
            {
                "milestone_id": "shared-region-001",
                "threshold_points": 10,
                "event_kind": "shared-region",
            },
        ],
    )
    checkpoint = pulse.checkpoint(
        window_start_utc=NOW.isoformat(timespec="seconds"),
        window_end_utc=(NOW + timedelta(minutes=1)).isoformat(timespec="seconds"),
        previous_aggregate_hash="a" * 64,
    )
    assert pulse.status()["free_companion_accounts_eligible"] is True
    assert checkpoint["kind"] == "swarm.telemetry"
    assert checkpoint["participant_count"] == 2
    assert checkpoint["event_count"] == 2
    assert checkpoint["point_total"] == 5
    assert checkpoint["previous_aggregate_hash"] == "a" * 64
    assert len(checkpoint["evidence_merkle_root"]) == 64
    assert checkpoint["unlocked_events"] == [{
        "milestone_id": "shared-story-001",
        "event_kind": "shared-story",
        "threshold_points": 5,
    }]
    assert checkpoint["monetary_value"] is False
    assert checkpoint["purchasable_points"] is False
    assert checkpoint["investment_value"] is False
    serialized = canonical_json(checkpoint)
    assert b"account-1" not in serialized
    assert b"opaque-private-attestation" not in serialized
    assert event1["event_hash"] != event2["event_hash"]


def test_merkle_root_changes_when_verified_evidence_changes():
    ledger = InMemoryWorldPulseLedger(verifier=Verifier(attestation("e0", "a0")))
    record(ledger, attestation("event-1", "account-1", points=2))
    first = build_world_pulse_checkpoint(
        issuer="rappterbox",
        window_start_utc=NOW.isoformat(timespec="seconds"),
        window_end_utc=(NOW + timedelta(minutes=1)).isoformat(timespec="seconds"),
        events=ledger.window(
            NOW.isoformat(timespec="seconds"),
            (NOW + timedelta(minutes=1)).isoformat(timespec="seconds"),
        ),
        previous_aggregate_hash=None,
        milestones=[],
        signer=Signer(),
    )
    record(ledger, attestation("event-2", "account-2", points=1, second=1))
    second = build_world_pulse_checkpoint(
        issuer="rappterbox",
        window_start_utc=NOW.isoformat(timespec="seconds"),
        window_end_utc=(NOW + timedelta(minutes=1)).isoformat(timespec="seconds"),
        events=ledger.window(
            NOW.isoformat(timespec="seconds"),
            (NOW + timedelta(minutes=1)).isoformat(timespec="seconds"),
        ),
        previous_aggregate_hash=first["aggregate_hash"],
        milestones=[],
        signer=Signer(),
    )
    assert first["evidence_merkle_root"] != second["evidence_merkle_root"]
    assert second["previous_aggregate_hash"] == first["aggregate_hash"]
