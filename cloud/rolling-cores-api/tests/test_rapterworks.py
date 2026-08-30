import base64
import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from credits.domain import CreditError, canonical_json
from credits.rapterworks import (
    SPECIES_COUNT,
    SPECIES_IDS,
    InMemoryOwnerInstanceRegistry,
    InMemoryRapterWorksLedger,
    InMemoryTipLedger,
    VerifiedCommissionPayment,
    VerifiedShopifySale,
    VerifiedTipPayment,
    bounded_quality_evidence,
    build_tip_split_policy,
    source_species,
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

    def verify(self, payload, signature):
        return signature["value"] == self.sign(payload)["value"]


class CreditIssuer:
    def __init__(self):
        self.calls = 0

    def issue(self, sale, instance):
        self.calls += 1
        return {
            "credit_id": "rcredit:" + hashlib.sha256(
                f"{sale.sale_id}\0{instance['instance_rappid']}".encode(),
            ).hexdigest(),
            "transferable": True,
        }


class DoggVerifier:
    configured = True

    def __init__(self, accepted=True):
        self.accepted = accepted

    def verify(self, dogg_id, conformance_hash):
        return (
            self.accepted
            and dogg_id == "public-dogg-1"
            and conformance_hash == "d" * 64
        )


class CommissionAdapter:
    configured = True

    def __init__(self):
        self.offers = 0
        self.payments = 0

    def create_draft_order(self, *, job_id, amount_minor, currency):
        self.offers += 1
        return (
            f"draft-{job_id}-{amount_minor}-{currency}",
            f"https://shop.example.test/pay/{job_id}",
        )

    def verify_payment(self, proof):
        assert proof == "verified-payment"
        self.payments += 1
        return VerifiedCommissionPayment(
            payment_reference="commission-payment-1",
            amount_minor=500,
            currency="USD",
        )


class TipVerifier:
    configured = True

    def __init__(self, amount_minor, payment_reference=None):
        self.amount_minor = amount_minor
        self.payment_reference = payment_reference
        self.calls = 0

    def verify_tip(self, proof, job_id):
        assert proof == "verified-tip"
        self.calls += 1
        return VerifiedTipPayment(
            payment_reference=(
                self.payment_reference
                or f"tip-payment-{job_id}-{self.amount_minor}"
            ),
            amount_minor=self.amount_minor,
            currency="USD",
        )


def transition(ledger, job_id, action, fields=None):
    return ledger.transition(
        job_id=job_id,
        operation_id=f"{action}-{len(ledger.events[job_id])}",
        action=action,
        fields=fields,
    )[0][0]


def test_first_dimension_catalog_has_251_immutable_rapterbox_species():
    assert SPECIES_COUNT == 251
    assert len(SPECIES_IDS) == 251
    assert len(set(SPECIES_IDS)) == 251
    species = source_species(SPECIES_IDS[0])
    assert species["edition"] == "first-edition"
    assert species["dimension"] == "first-dimension"
    assert species["title_owner"] == "rappterbox"
    assert species["mutable"] is False


def test_verified_shopify_sale_hatches_one_unique_idempotent_player_instance():
    registry = InMemoryOwnerInstanceRegistry()
    issuer = CreditIssuer()
    sale = VerifiedShopifySale(
        sale_id="shopify-order-1",
        account_reference="account-1",
        product_id="premium-rapter",
        purchased_utc=NOW.isoformat(timespec="seconds"),
    )
    source_before = source_species(SPECIES_IDS[10])
    first, created = registry.hatch(
        sale=sale,
        species_id=SPECIES_IDS[10],
        issue_credit=issuer,
        build_capsule=lambda instance: {
            "capsule_id": "capsule:" + hashlib.sha256(
                instance["instance_rappid"].encode(),
            ).hexdigest(),
        },
    )
    repeated, repeated_created = registry.hatch(
        sale=sale,
        species_id=SPECIES_IDS[10],
        issue_credit=issuer,
        build_capsule=lambda _instance: pytest.fail("duplicate sale rebuilt capsule"),
    )
    assert created is True
    assert repeated_created is False
    assert repeated == first
    assert issuer.calls == 1
    assert first["instance_rappid"] != source_before["source_rappid"]
    assert first["dimension_branch"].startswith("dimension:")
    assert first["credit"]["transferable"] is True
    assert first["source_species_mutated"] is False
    assert source_species(SPECIES_IDS[10]) == source_before


def test_public_dogg_conformance_is_required_but_private_mutation_remains_free():
    rejected = InMemoryRapterWorksLedger(
        issuer="rappterbox",
        signer=Signer(),
        dogg_verifier=DoggVerifier(False),
        commission_adapter=CommissionAdapter(),
        now=lambda: NOW,
    )
    request, _ = rejected.request_job(
        operation_id="request-1",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
    )
    with pytest.raises(CreditError, match="DOGG conformance"):
        transition(rejected, request["job_id"], "accept", {
            "dogg_id": "public-dogg-1",
            "conformance_hash": "d" * 64,
        })
    assert rejected.state(request["job_id"])["private_mutation_allowed"] is True


def test_job_delivers_full_and_free_before_optional_commission():
    commission = CommissionAdapter()
    ledger = InMemoryRapterWorksLedger(
        issuer="rappterbox",
        signer=Signer(),
        dogg_verifier=DoggVerifier(),
        commission_adapter=commission,
        now=lambda: NOW,
    )
    requested, created = ledger.request_job(
        operation_id="request-1",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
    )
    repeated, repeated_created = ledger.request_job(
        operation_id="request-1",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
    )
    assert created is True
    assert repeated_created is False
    assert repeated == requested
    job_id = requested["job_id"]
    with pytest.raises(CreditError):
        transition(ledger, job_id, "offer_commission", {
            "amount_minor": 500,
            "currency": "USD",
        })
    accepted, accepted_created = ledger.transition(
        job_id=job_id,
        operation_id="accept-idempotent",
        action="accept",
        fields={
            "dogg_id": "public-dogg-1",
            "conformance_hash": "d" * 64,
        },
    )
    accepted_again, accepted_again_created = ledger.transition(
        job_id=job_id,
        operation_id="accept-idempotent",
        action="accept",
        fields={
            "dogg_id": "public-dogg-1",
            "conformance_hash": "d" * 64,
        },
    )
    assert accepted_created is True
    assert accepted_again_created is False
    assert accepted_again == accepted
    transition(ledger, job_id, "start")
    transition(ledger, job_id, "submit_proof", {"proof_hash": "e" * 64})
    transition(ledger, job_id, "approve")
    delivered = transition(
        ledger,
        job_id,
        "deliver",
        {"artifact_hash": "f" * 64},
    )
    assert delivered["artifact_access"] == "full-and-free"
    assert delivered["payment_required"] is False
    assert delivered["debt_created"] is False
    offered = transition(ledger, job_id, "offer_commission", {
        "amount_minor": 500,
        "currency": "USD",
    })
    assert offered["optional"] is True
    assert offered["artifact_access_gated"] is False
    assert offered["payment_url"].startswith("https://shop.example.test/pay/")
    paid = transition(
        ledger,
        job_id,
        "mark_paid",
        {"payment_proof": "verified-payment"},
    )
    assert paid["artifact_access_gated"] is False
    assert commission.offers == 1
    assert commission.payments == 1


def test_low_rating_creates_immutable_regression_then_correction_and_redelivery():
    ledger = InMemoryRapterWorksLedger(
        issuer="rappterbox",
        signer=Signer(),
        dogg_verifier=DoggVerifier(),
        commission_adapter=CommissionAdapter(),
        now=lambda: NOW,
    )
    requested, _ = ledger.request_job(
        operation_id="request-low",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
    )
    job_id = requested["job_id"]
    transition(ledger, job_id, "accept", {
        "dogg_id": "public-dogg-1",
        "conformance_hash": "d" * 64,
    })
    transition(ledger, job_id, "start")
    transition(ledger, job_id, "submit_proof", {"proof_hash": "e" * 64})
    transition(ledger, job_id, "request_revision", {
        "revision_evidence_hash": "4" * 64,
    })
    transition(ledger, job_id, "resume")
    transition(ledger, job_id, "submit_proof", {"proof_hash": "5" * 64})
    transition(ledger, job_id, "approve")
    transition(ledger, job_id, "deliver", {"artifact_hash": "f" * 64})
    transition(ledger, job_id, "rate", {
        "rating": 2,
        "rating_evidence_hash": "1" * 64,
    })
    regression, created = ledger.resolve_rating(
        job_id=job_id,
        operation_id="resolve-low",
    )
    assert created is True
    assert regression[0]["state"] == "regression_open"
    fixture = next(iter(ledger.regression_fixtures.values()))
    assert fixture["immutable"] is True
    assert fixture["rating"] == 2
    transition(ledger, job_id, "correct")
    redelivered = transition(
        ledger,
        job_id,
        "redeliver",
        {"artifact_hash": "2" * 64},
    )
    assert redelivered["state"] == "redelivered"
    assert redelivered["artifact_access"] == "full-and-free"
    transition(ledger, job_id, "rate", {
        "rating": 5,
        "rating_evidence_hash": "3" * 64,
    })
    closed, _ = ledger.resolve_rating(
        job_id=job_id,
        operation_id="resolve-high",
    )
    assert closed[0]["state"] == "closed"


@pytest.mark.parametrize(
    ("action", "state"),
    [
        ("decline_commission", "declined"),
        ("ignore_commission", "ignored"),
    ],
)
def test_optional_commission_can_be_declined_or_ignored(action, state):
    ledger = InMemoryRapterWorksLedger(
        issuer="rappterbox",
        signer=Signer(),
        dogg_verifier=DoggVerifier(),
        commission_adapter=CommissionAdapter(),
        now=lambda: NOW,
    )
    requested, _ = ledger.request_job(
        operation_id=f"request-{state}",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
    )
    job_id = requested["job_id"]
    transition(ledger, job_id, "accept", {
        "dogg_id": "public-dogg-1",
        "conformance_hash": "d" * 64,
    })
    transition(ledger, job_id, "start")
    transition(ledger, job_id, "submit_proof", {"proof_hash": "e" * 64})
    transition(ledger, job_id, "approve")
    transition(ledger, job_id, "deliver", {"artifact_hash": "f" * 64})
    transition(ledger, job_id, "offer_commission", {
        "amount_minor": 500,
        "currency": "USD",
    })
    result = transition(ledger, job_id, action)
    assert result["state"] == state
    assert result["artifact_access_gated"] is False


def test_refused_job_can_close_without_artifact_or_debt():
    ledger = InMemoryRapterWorksLedger(
        issuer="rappterbox",
        signer=Signer(),
        dogg_verifier=DoggVerifier(),
        commission_adapter=CommissionAdapter(),
        now=lambda: NOW,
    )
    requested, _ = ledger.request_job(
        operation_id="request-refused",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
    )
    refused = transition(ledger, requested["job_id"], "refuse")
    assert refused["state"] == "refused"
    closed = transition(ledger, requested["job_id"], "close")
    assert closed["state"] == "closed"
    assert ledger.state(requested["job_id"])["debt_created"] is False


def delivered_job(operation_id="tip-job", account_reference="account-1"):
    ledger = InMemoryRapterWorksLedger(
        issuer="rappterbox",
        signer=Signer(),
        dogg_verifier=DoggVerifier(),
        commission_adapter=CommissionAdapter(),
        now=lambda: NOW,
    )
    requested, _ = ledger.request_job(
        operation_id=operation_id,
        account_reference=account_reference,
        category="artifact-build",
        request_evidence_hash="a" * 64,
    )
    job_id = requested["job_id"]
    transition(ledger, job_id, "accept", {
        "dogg_id": "public-dogg-1",
        "conformance_hash": "d" * 64,
    })
    transition(ledger, job_id, "start")
    transition(ledger, job_id, "submit_proof", {"proof_hash": "e" * 64})
    transition(ledger, job_id, "approve")
    transition(ledger, job_id, "deliver", {"artifact_hash": "f" * 64})
    return ledger.state(job_id)


def tip_policy():
    return build_tip_split_policy(
        issuer="rappterbox",
        operator_reference_hash="1" * 64,
        dealer_reference_hash="2" * 64,
        compute_reserve_reference_hash="3" * 64,
        species_rnd_reference_hash="4" * 64,
        premium_review_reference_hash="8" * 64,
        evolution_service_reference_hash="9" * 64,
        owner_basis_points=2000,
        operator_basis_points=2000,
        dealer_basis_points=1000,
        compute_reserve_basis_points=1500,
        species_rnd_basis_points=1000,
        premium_review_basis_points=1000,
        evolution_sponsorship_basis_points=1500,
        quality_tip_ratio_cap_basis_points=2000,
        mutation_frame_cost_minor=100,
        compute_unit_cost_minor=50,
        iteration_unit_cost_minor=25,
        premium_review_cost_minor=200,
        selected_lens_weight_micros_per_minor=10,
        market_alpha_micros_per_minor=5,
        created_utc=NOW.isoformat(timespec="seconds"),
        signer=Signer(),
    )


def test_tip_is_post_delivery_optional_idempotent_and_never_gates_artifact():
    job = delivered_job()
    verifier = TipVerifier(1_000_000)
    tips = InMemoryTipLedger(
        issuer="rappterbox",
        signer=Signer(),
        payment_verifier=verifier,
        split_policy=tip_policy(),
        now=lambda: NOW,
    )
    event, created = tips.record(
        job=job,
        operation_id="tip-1",
        account_reference="account-1",
        tipped=True,
        currency="USD",
        suggested_tip_minor=1_000,
        reference_cost_minor=1_000,
        payment_proof="verified-tip",
        cohort_id="artifact-build-2026-08",
        evolution_target="owner-instance",
        evolution_target_reference_hash="5" * 64,
        selected_lens="motion",
    )
    repeated, repeated_created = tips.record(
        job=job,
        operation_id="tip-1",
        account_reference="account-1",
        tipped=True,
        currency="USD",
        suggested_tip_minor=1_000,
        reference_cost_minor=1_000,
        payment_proof="verified-tip",
        cohort_id="artifact-build-2026-08",
        evolution_target="owner-instance",
        evolution_target_reference_hash="5" * 64,
        selected_lens="motion",
    )
    assert created is True
    assert repeated_created is False
    assert repeated == event
    assert verifier.calls == 1
    assert event["tipped"] is True
    assert event["amount_minor"] == 1_000_000
    assert event["suggested_tip_ratio_basis_points"] == 2000
    assert event["quality_tip_signal_ppm"] == 1_000_000
    assert event["owner_amount_minor"] == 200_000
    assert event["operator_amount_minor"] == 200_000
    assert event["dealer_amount_minor"] == 100_000
    assert event["compute_reserve_amount_minor"] == 150_000
    assert event["species_rnd_amount_minor"] == 100_000
    assert event["premium_review_amount_minor"] == 100_000
    assert event["evolution_sponsorship_amount_minor"] == 150_000
    assert event["raw_economic_view"]["amount_minor"] == 1_000_000
    assert event["raw_economic_view"]["market_evaluation_influence"] is True
    assert event["selected_lens_weight_micros"] == 1_500_000
    assert event["market_alpha_signal_micros"] == 5_000_000
    assert event["purchased_mutation_frames"] == 1500
    assert event["purchased_compute_units"] == 3000
    assert event["purchased_iteration_units"] == 6000
    assert event["purchased_premium_review_units"] == 500
    assert event["species_candidate_sponsorship_minor"] == 100_000
    assert event["species_candidate_mutation_frames"] == 1000
    assert event["raw_economic_view"]["canonical_mutation_guaranteed"] is False
    assert event["raw_economic_view"]["canon_acceptance_authority"] == "rappterbox"
    assert event["normalized_quality_view"] == {
        "tip_ratio_basis_points": 2000,
        "tip_signal_ppm": 1_000_000,
        "ratio_cap_basis_points": 2000,
        "raw_amount_used_directly": False,
        "rating_override_allowed": False,
    }
    assert "payment_proof" not in event
    assert Signer().verify(
        {key: value for key, value in event.items() if key != "signature"},
        event["signature"],
    )
    assert event["rating_included"] is False
    assert event["rating_incentivized"] is False
    assert event["artifact_access_gated"] is False
    assert event["debt_created"] is False


def test_zero_tip_is_valid_and_does_not_call_payment_or_create_debt():
    job = delivered_job()
    verifier = TipVerifier(100, "shared-tip-payment")
    tips = InMemoryTipLedger(
        issuer="rappterbox",
        signer=Signer(),
        payment_verifier=verifier,
        split_policy=tip_policy(),
        now=lambda: NOW,
    )
    event, _ = tips.record(
        job=job,
        operation_id="tip-zero",
        account_reference="account-1",
        tipped=False,
        currency="USD",
        suggested_tip_minor=0,
        reference_cost_minor=1_000,
        payment_proof=None,
        cohort_id="artifact-build-2026-08",
        evolution_target="none",
        evolution_target_reference_hash=None,
        selected_lens=None,
    )
    assert event["tipped"] is False
    assert event["amount_minor"] == 0
    assert event["payment_reference_hash"] is None
    assert event["debt_created"] is False
    assert event["evolution_target"] == "none"
    assert event["purchased_mutation_frames"] == 0
    assert event["market_alpha_signal_micros"] == 0
    assert event["raw_economic_view"]["demand_market_alpha_influence"] is False
    assert verifier.calls == 0


def test_tip_requires_delivery_and_rejects_reused_payment_or_tampered_policy():
    ledger = InMemoryRapterWorksLedger(
        issuer="rappterbox",
        signer=Signer(),
        dogg_verifier=DoggVerifier(),
        commission_adapter=CommissionAdapter(),
        now=lambda: NOW,
    )
    requested, _ = ledger.request_job(
        operation_id="undelivered-tip-job",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
    )
    verifier = TipVerifier(100, "shared-tip-payment")
    tips = InMemoryTipLedger(
        issuer="rappterbox",
        signer=Signer(),
        payment_verifier=verifier,
        split_policy=tip_policy(),
        now=lambda: NOW,
    )
    with pytest.raises(CreditError, match="delivery"):
        tips.record(
            job=ledger.state(requested["job_id"]),
            operation_id="early-tip",
            account_reference="account-1",
            tipped=True,
            currency="USD",
            suggested_tip_minor=100,
            reference_cost_minor=1_000,
            payment_proof="verified-tip",
            cohort_id="artifact-build-2026-08",
            evolution_target="owner-instance",
            evolution_target_reference_hash="5" * 64,
            selected_lens="motion",
        )
    delivered = delivered_job()
    tips.record(
        job=delivered,
        operation_id="payment-first",
        account_reference="account-1",
        tipped=True,
        currency="USD",
        suggested_tip_minor=100,
        reference_cost_minor=1_000,
        payment_proof="verified-tip",
        cohort_id="artifact-build-2026-08",
        evolution_target="owner-instance",
        evolution_target_reference_hash="5" * 64,
        selected_lens="motion",
    )
    with pytest.raises(CreditError, match="already has"):
        tips.record(
            job=delivered,
            operation_id="payment-replay",
            account_reference="account-1",
            tipped=True,
            currency="USD",
            suggested_tip_minor=100,
            reference_cost_minor=1_000,
            payment_proof="verified-tip",
            cohort_id="artifact-build-2026-08",
            evolution_target="owner-instance",
            evolution_target_reference_hash="5" * 64,
            selected_lens="motion",
        )
    second_job = delivered_job("second-tip-job", "account-2")
    with pytest.raises(CreditError, match="already been recorded"):
        tips.record(
            job=second_job,
            operation_id="payment-replay-other-job",
            account_reference="account-2",
            tipped=True,
            currency="USD",
            suggested_tip_minor=100,
            reference_cost_minor=1_000,
            payment_proof="verified-tip",
            cohort_id="artifact-build-2026-08",
            evolution_target="owner-instance",
            evolution_target_reference_hash="5" * 64,
            selected_lens="motion",
        )
    tampered = dict(tip_policy())
    tampered["operator_basis_points"] = 6000
    with pytest.raises(CreditError, match="total 10000"):
        InMemoryTipLedger(
            issuer="rappterbox",
            signer=Signer(),
            payment_verifier=verifier,
            split_policy=tampered,
            now=lambda: NOW,
        )


def test_raw_economics_preserve_whale_patronage_while_quality_stays_bounded():
    whale_amount = 9_000_000_000_000_000_000
    current_time = [NOW]
    job = delivered_job()
    tips = InMemoryTipLedger(
        issuer="rappterbox",
        signer=Signer(),
        payment_verifier=TipVerifier(whale_amount),
        split_policy=tip_policy(),
        now=lambda: current_time[0],
    )
    whale, _ = tips.record(
        job=job,
        operation_id="tip-whale",
        account_reference="account-1",
        tipped=True,
        currency="USD",
        suggested_tip_minor=50_000,
        reference_cost_minor=1_000,
        payment_proof="verified-tip",
        cohort_id="artifact-build-2026-08",
        evolution_target="owner-instance",
        evolution_target_reference_hash="5" * 64,
        selected_lens="motion",
    )
    assert whale["amount_minor"] == whale_amount
    assert sum(
        whale[field]
        for field in (
            "owner_amount_minor",
            "operator_amount_minor",
            "dealer_amount_minor",
            "compute_reserve_amount_minor",
            "species_rnd_amount_minor",
            "premium_review_amount_minor",
            "evolution_sponsorship_amount_minor",
        )
    ) == whale_amount
    assert whale["raw_economic_view"]["amount_minor"] == whale_amount
    assert whale["normalized_quality_view"]["tip_signal_ppm"] == 1_000_000
    tips.payment_verifier = TipVerifier(100)
    small_job = delivered_job("tip-job-small", "account-2")
    small, _ = tips.record(
        job=small_job,
        operation_id="tip-small",
        account_reference="account-2",
        tipped=True,
        currency="USD",
        suggested_tip_minor=100,
        reference_cost_minor=1_000,
        payment_proof="verified-tip",
        cohort_id="artifact-build-2026-08",
        evolution_target="owner-instance",
        evolution_target_reference_hash="5" * 64,
        selected_lens="motion",
    )
    no_tip_job = delivered_job("tip-job-none", "account-3")
    tips.record(
        job=no_tip_job,
        operation_id="tip-none",
        account_reference="account-3",
        tipped=False,
        currency="USD",
        suggested_tip_minor=0,
        reference_cost_minor=1_000,
        payment_proof=None,
        cohort_id="artifact-build-2026-08",
        evolution_target="none",
        evolution_target_reference_hash=None,
        selected_lens=None,
    )
    current_time[0] = NOW + timedelta(days=1)
    tips.payment_verifier = TipVerifier(500)
    repeat_job = delivered_job("tip-job-repeat", "account-1")
    repeat, _ = tips.record(
        job=repeat_job,
        operation_id="tip-repeat",
        account_reference="account-1",
        tipped=True,
        currency="USD",
        suggested_tip_minor=500,
        reference_cost_minor=1_000,
        payment_proof="verified-tip",
        cohort_id="artifact-build-2026-08",
        evolution_target="species-candidate",
        evolution_target_reference_hash="6" * 64,
        selected_lens="memory",
    )
    assert repeat["species_candidate_sponsorship_minor"] == 125
    assert repeat["species_candidate_mutation_frames"] == 1
    assert repeat["raw_economic_view"]["canon_acceptance_authority"] == "rappterbox"
    assert repeat["raw_economic_view"]["canonical_mutation_guaranteed"] is False
    tips.payment_verifier = TipVerifier(999)
    other_job = delivered_job("tip-job-other", "account-4")
    tips.record(
        job=other_job,
        operation_id="other-cohort-tip",
        account_reference="account-4",
        tipped=True,
        currency="USD",
        suggested_tip_minor=999,
        reference_cost_minor=1_000,
        payment_proof="verified-tip",
        cohort_id="different-cohort",
        evolution_target="owner-instance",
        evolution_target_reference_hash="7" * 64,
        selected_lens="utility",
    )
    cohort = tips.cohort(
        cohort_id="artifact-build-2026-08",
        currency="USD",
        completed_job_count=4,
        window_start_utc=NOW.isoformat(timespec="seconds"),
        window_end_utc=(NOW + timedelta(days=2)).isoformat(timespec="seconds"),
    )
    lifetime_volume = whale_amount + 600
    largest_payer_volume = whale_amount + 500
    assert cohort["lifetime_tip_volume_minor"] == lifetime_volume
    assert cohort["largest_tip_minor"] == whale_amount
    assert cohort["median_tip_minor"] == 500
    assert cohort["unique_payer_count"] == 2
    assert cohort["repeat_tipper_count"] == 1
    assert cohort["largest_payer_volume_minor"] == largest_payer_volume
    assert cohort["largest_payer_share_ppm"] == (
        largest_payer_volume * 1_000_000 + lifetime_volume // 2
    ) // lifetime_volume
    assert cohort["payer_concentration_hhi_ppm"] == (
        (largest_payer_volume**2 + 100**2) * 1_000_000
        + lifetime_volume**2 // 2
    ) // (lifetime_volume**2)
    assert cohort["tip_velocity_minor_per_day"] == (lifetime_volume + 1) // 2
    assert cohort["tip_rate_ppm"] == 750_000
    assert cohort["raw_economic_view"]["demand_market_alpha_influence"] is True
    assert cohort["owner_instance_sponsorship_minor"] == (
        whale["evolution_sponsorship_amount_minor"]
        + small["evolution_sponsorship_amount_minor"]
    )
    assert cohort["species_candidate_target_sponsorship_minor"] == (
        repeat["evolution_sponsorship_amount_minor"]
    )
    assert cohort["species_candidate_pool_minor"] == sum(
        event["species_candidate_sponsorship_minor"]
        for event in (whale, small, repeat)
    )
    assert cohort["selected_lens_weights_micros"] == {
        "motion": (
            whale["selected_lens_weight_micros"]
            + small["selected_lens_weight_micros"]
        ),
        "memory": repeat["selected_lens_weight_micros"],
    }
    assert cohort["canon_acceptance_authority"] == "rappterbox"
    assert cohort["normalized_quality_view"]["raw_volume_used_directly"] is False
    assert Signer().verify(
        {key: value for key, value in cohort.items() if key != "signature"},
        cohort["signature"],
    )
    patronage = tips.patronage(account_reference="account-1", currency="USD")
    assert patronage["lifetime_tip_volume_minor"] == largest_payer_volume
    assert patronage["largest_tip_minor"] == whale_amount
    assert patronage["tip_count"] == 2
    assert patronage["repeat_tip_count"] == 1
    assert patronage["repeat_tipping"] is True
    assert patronage["tip_velocity_minor_per_day"] == largest_payer_volume
    assert patronage["selected_lens_weights_micros"] == {
        "memory": repeat["selected_lens_weight_micros"],
        "motion": whale["selected_lens_weight_micros"],
    }
    assert patronage["canon_acceptance_authority"] == "rappterbox"
    assert [entry["amount_minor"] for entry in patronage["history"]] == [
        whale_amount,
        500,
    ]
    assert [entry["evolution_target"] for entry in patronage["history"]] == [
        "owner-instance",
        "species-candidate",
    ]
    assert Signer().verify(
        {key: value for key, value in patronage.items() if key != "signature"},
        patronage["signature"],
    )
    evidence = bounded_quality_evidence(
        issuer="rappterbox",
        signer=Signer(),
        tip_event=whale,
        cohort=cohort,
        rating=1,
        repeat_count=2,
        completed=True,
        dispute_count=1,
        cost_ratio_ppm=500_000,
        tests_passed=7,
        tests_total=10,
    )
    assert evidence["unweighted_technical_test_score_ppm"] == 700_000
    assert evidence["unweighted_technical_view"]["patronage_inputs_used"] is False
    assert evidence["rating_ppm"] == 200_000
    assert evidence["normalized_tip_component_ppm"] == 1_000_000
    assert evidence["patronage_weighted_view"]["raw_tip_amount_minor"] == whale_amount
    assert evidence["patronage_weighted_view"]["selected_lens"] == "motion"
    assert evidence["patronage_weighted_view"]["market_alpha_signal_micros"] == (
        whale_amount * 5
    )
    assert evidence["raw_tip_amount_used_in_unweighted_technical_score"] is False
    assert evidence["raw_tip_amount_used_in_patronage_weighted_view"] is True
    assert evidence["rating_overridden_by_tip"] is False
    assert evidence["canonical_mutation_guaranteed"] is False
    assert evidence["canon_acceptance_authority"] == "rappterbox"
    assert "unweighted-technical-test-score" in evidence["money_did_not_influence"]
    assert "selected-lens-weight" in evidence["money_influenced_fields"]
    assert Signer().verify(
        {key: value for key, value in evidence.items() if key != "signature"},
        evidence["signature"],
    )
