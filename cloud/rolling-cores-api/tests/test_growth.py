import base64
import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from credits.domain import CreditError, canonical_json
from credits.growth import (
    InMemoryGrowthPointLedger,
    build_evolution_event,
    build_growth_receipt,
    build_stage_policy,
    default_growth_policy,
    stage_status,
)
from credits.quotes import BtcUsdQuote


NOW = datetime(2026, 8, 29, 20, 0, 0, tzinfo=timezone.utc)
SUBJECT = "rappid:@owner/rapter:" + "a" * 64


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


def receipt(index, points=2, category="care"):
    return build_growth_receipt(
        organism_rappid=SUBJECT,
        category=category,
        points=points,
        observed_utc=(NOW + timedelta(seconds=index)).isoformat(timespec="seconds"),
        attester="local-device-attester",
        source="opt-in-accessible-action",
        evidence_hash=f"{index + 1:064x}",
        signer=Signer(),
    )


def stage_policy(required_points=4, eligible_after=NOW):
    return build_stage_policy(
        issuer="rappterbox",
        organism_rappid=SUBJECT,
        stage_id="stage-2",
        generation_id="generation-0002",
        required_points=required_points,
        eligible_after_utc=eligible_after.isoformat(timespec="seconds"),
        current_core_head="b" * 64,
        btc_fraction={"numerator": 1, "denominator": 500_000},
        created_utc=(NOW - timedelta(minutes=1)).isoformat(timespec="seconds"),
        signer=Signer(),
    )


def test_growth_points_are_positive_local_game_points_only():
    value = receipt(0)
    assert value["kind"] == "memory.save"
    assert value["points"] == 2
    assert value["transferable"] is False
    assert value["purchasable"] is False
    assert value["redeemable"] is False
    assert set(value).isdisjoint({"heart_rate", "diagnosis", "raw_event", "payment"})
    with pytest.raises(CreditError):
        receipt(1, points=0)
    with pytest.raises(CreditError):
        receipt(1, points=-1)


def test_growth_ledger_is_idempotent_and_enforces_daily_caps():
    policy = default_growth_policy()
    policy["daily_total_cap"] = 4
    ledger = InMemoryGrowthPointLedger(policy=policy, verifier=Signer())
    first = receipt(0, points=2)
    second = receipt(1, points=2, category="accessible-equivalent")
    assert ledger.record(first)[1] is True
    assert ledger.record(first)[1] is False
    assert ledger.record(second)[1] is True
    assert ledger.total(SUBJECT) == 4
    with pytest.raises(CreditError, match="daily cap"):
        ledger.record(receipt(2, points=1, category="curiosity"))


def test_stage_requires_signed_threshold_time_and_current_head():
    policy = stage_policy()
    before = stage_status(
        policy,
        current_core_head="b" * 64,
        point_total=4,
        evaluated_utc=(NOW - timedelta(seconds=1)).isoformat(timespec="seconds"),
        compute_available=True,
        verifier=Signer(),
    )
    assert before["mutation_due"] is False
    wrong_head = stage_status(
        policy,
        current_core_head="c" * 64,
        point_total=4,
        evaluated_utc=NOW.isoformat(timespec="seconds"),
        compute_available=True,
        verifier=Signer(),
    )
    assert wrong_head["current_head_matches"] is False
    due_offline = stage_status(
        policy,
        current_core_head="b" * 64,
        point_total=4,
        evaluated_utc=NOW.isoformat(timespec="seconds"),
        compute_available=False,
        verifier=Signer(),
    )
    assert due_offline["mutation_due"] is True
    assert due_offline["state"] == "pending-no-compute"
    assert due_offline["old_bytes_mutated"] is False


def test_accepted_transition_burns_immutable_btc_reference_not_payment():
    policy = stage_policy()
    receipts = [receipt(0), receipt(1, category="accessible-equivalent")]
    event = build_evolution_event(
        policy=policy,
        receipts=receipts,
        successor_core_head="c" * 64,
        quote=BtcUsdQuote(
            source="test-btc-usd",
            observed_utc=NOW.isoformat(timespec="seconds"),
            raw_response_hash="d" * 64,
            btc_usd_micros=60_000_000_000,
        ),
        accepted_utc=NOW.isoformat(timespec="seconds"),
        signer=Signer(),
        verifier=Signer(),
    )
    assert event["kind"] == "body.pulse"
    assert event["generation_id"] == "generation-0002"
    assert event["previous_core_head"] == "b" * 64
    assert event["successor_core_head"] == "c" * 64
    assert event["btc_reference"]["price_sats"] == 200
    assert event["btc_reference"]["fiat_reference_usd_micros"] == 120_000
    assert event["btc_reference"]["purpose"] == "reference-provenance-only"
    assert event["btc_reference"]["payment"] is False
    assert event["btc_reference"]["yield"] is False
    assert event["btc_reference"]["redeemable"] is False
    assert event["old_bytes_mutated"] is False
    with pytest.raises(CreditError, match="replay"):
        build_evolution_event(
            policy=policy,
            receipts=[receipts[0], receipts[0]],
            successor_core_head="d" * 64,
            quote=BtcUsdQuote(
                source="test-btc-usd",
                observed_utc=NOW.isoformat(timespec="seconds"),
                raw_response_hash="e" * 64,
                btc_usd_micros=60_000_000_000,
            ),
            accepted_utc=NOW.isoformat(timespec="seconds"),
            signer=Signer(),
            verifier=Signer(),
        )


def test_accessibility_alternative_has_equal_point_bounds():
    policy = default_growth_policy()
    assert "accessible-equivalent" in policy["accessibility_alternatives"]["care"]
    assert (
        policy["category_daily_caps"]["accessible-equivalent"]
        == policy["category_daily_caps"]["care"]
    )
