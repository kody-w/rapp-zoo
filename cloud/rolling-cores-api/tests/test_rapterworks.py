import base64
import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from credits.domain import CreditError, canonical_json
from credits.rapterworks import (
    SPECIES_COUNT,
    SPECIES_IDS,
    InMemoryOwnerInstanceRegistry,
    InMemoryEvolutionSponsorshipLedger,
    InMemoryRapterWorksLedger,
    InMemoryTipLedger,
    VerifiedCommissionPayment,
    VerifiedEvolutionSponsorshipPayment,
    VerifiedOutputRightsAcceptance,
    VerifiedShopifySale,
    VerifiedSponsorshipAdjustment,
    VerifiedTipPayment,
    bounded_quality_evidence,
    build_evolution_sponsorship_policy,
    build_tip_policy,
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
            and dogg_id == "rappterbox"
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
            shopify_line_item_reference=f"tip-line-{job_id}-{self.amount_minor}",
            shopify_line_item_kind="tip",
            amount_minor=self.amount_minor,
            currency="USD",
        )


class RightsVerifier:
    configured = True

    def verify(self, proof, account_reference):
        assert proof == "accepted-output-rights"
        return VerifiedOutputRightsAcceptance(
            account_reference=account_reference,
            terms_version="rapterworks-output-rights/1",
            terms_hash="b" * 64,
            accepted_utc=NOW.isoformat(timespec="seconds"),
        )


class MissingRightsVerifier:
    configured = False

    def verify(self, proof, account_reference):
        del proof, account_reference
        raise CreditError("Output-rights acceptance verification is not configured.")


class SponsorshipVerifier:
    configured = True

    def __init__(self):
        self.purchase = VerifiedEvolutionSponsorshipPayment(
            payment_reference="sponsorship-payment-1",
            shopify_line_item_reference="sponsorship-line-1",
            shopify_line_item_kind="evolution-sponsorship",
            account_reference="account-1",
            currency="USD",
            subtotal_minor=1_100,
            tax_minor=88,
            total_minor=1_188,
            evolution_target="owner-instance",
            evolution_target_reference_hash="6" * 64,
            selected_lens="motion",
            mutation_frames=2,
            compute_units=3,
            iteration_units=4,
            premium_review_units=1,
        )

    def verify_purchase(self, proof, job_id):
        assert proof == "verified-sponsorship"
        assert job_id
        return self.purchase

    def verify_refund(self, proof, sponsorship_id):
        assert proof == "verified-refund"
        assert sponsorship_id
        return VerifiedSponsorshipAdjustment(
            reference="sponsorship-refund-1",
            amount_minor=self.purchase.total_minor,
            currency=self.purchase.currency,
        )

    def verify_chargeback(self, proof, sponsorship_id):
        assert proof == "verified-chargeback"
        assert sponsorship_id
        return VerifiedSponsorshipAdjustment(
            reference="sponsorship-chargeback-1",
            amount_minor=self.purchase.total_minor,
            currency=self.purchase.currency,
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
        output_rights_verifier=RightsVerifier(),
        now=lambda: NOW,
    )
    request, _ = rejected.request_job(
        operation_id="request-1",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
        output_rights_acceptance_proof="accepted-output-rights",
    )
    with pytest.raises(CreditError, match="DOGG conformance"):
        transition(rejected, request["job_id"], "accept", {
            "dogg_id": "rappterbox",
            "conformance_hash": "d" * 64,
        })
    assert rejected.state(request["job_id"])["private_mutation_allowed"] is True


def test_launch_jobs_require_verified_output_rights_and_rapterbox_operation():
    blocked = InMemoryRapterWorksLedger(
        issuer="rappterbox",
        signer=Signer(),
        dogg_verifier=DoggVerifier(),
        commission_adapter=CommissionAdapter(),
        output_rights_verifier=MissingRightsVerifier(),
        now=lambda: NOW,
    )
    with pytest.raises(CreditError, match="Output-rights"):
        blocked.request_job(
            operation_id="blocked-rights",
            account_reference="account-1",
            category="artifact-build",
            request_evidence_hash="a" * 64,
            output_rights_acceptance_proof="missing",
        )
    ledger = InMemoryRapterWorksLedger(
        issuer="rappterbox",
        signer=Signer(),
        dogg_verifier=DoggVerifier(),
        commission_adapter=CommissionAdapter(),
        output_rights_verifier=RightsVerifier(),
        now=lambda: NOW,
    )
    requested, _ = ledger.request_job(
        operation_id="launch-controls",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
        output_rights_acceptance_proof="accepted-output-rights",
    )
    with pytest.raises(CreditError, match="Rapterbox-operated only"):
        transition(ledger, requested["job_id"], "accept", {
            "dogg_id": "third-party-dealer",
            "conformance_hash": "d" * 64,
        })
    state = ledger.state(requested["job_id"])
    assert state["merchant_of_record"] == "rappterbox"
    assert state["operator"] == "rappterbox"
    assert state["third_party_payouts_enabled"] is False
    assert state["output_rights_terms_hash"] == "b" * 64


def test_job_delivers_full_and_free_before_optional_commission():
    commission = CommissionAdapter()
    ledger = InMemoryRapterWorksLedger(
        issuer="rappterbox",
        signer=Signer(),
        dogg_verifier=DoggVerifier(),
        commission_adapter=commission,
        output_rights_verifier=RightsVerifier(),
        now=lambda: NOW,
    )
    requested, created = ledger.request_job(
        operation_id="request-1",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
        output_rights_acceptance_proof="accepted-output-rights",
    )
    repeated, repeated_created = ledger.request_job(
        operation_id="request-1",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
        output_rights_acceptance_proof="accepted-output-rights",
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
            "dogg_id": "rappterbox",
            "conformance_hash": "d" * 64,
        },
    )
    accepted_again, accepted_again_created = ledger.transition(
        job_id=job_id,
        operation_id="accept-idempotent",
        action="accept",
        fields={
            "dogg_id": "rappterbox",
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
    assert offered["merchant_of_record"] == "rappterbox"
    assert offered["third_party_payouts_enabled"] is False
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
        output_rights_verifier=RightsVerifier(),
        now=lambda: NOW,
    )
    requested, _ = ledger.request_job(
        operation_id="request-low",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
        output_rights_acceptance_proof="accepted-output-rights",
    )
    job_id = requested["job_id"]
    transition(ledger, job_id, "accept", {
        "dogg_id": "rappterbox",
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
        output_rights_verifier=RightsVerifier(),
        now=lambda: NOW,
    )
    requested, _ = ledger.request_job(
        operation_id=f"request-{state}",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
        output_rights_acceptance_proof="accepted-output-rights",
    )
    job_id = requested["job_id"]
    transition(ledger, job_id, "accept", {
        "dogg_id": "rappterbox",
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
        output_rights_verifier=RightsVerifier(),
        now=lambda: NOW,
    )
    requested, _ = ledger.request_job(
        operation_id="request-refused",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
        output_rights_acceptance_proof="accepted-output-rights",
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
        output_rights_verifier=RightsVerifier(),
        now=lambda: NOW,
    )
    requested, _ = ledger.request_job(
        operation_id=operation_id,
        account_reference=account_reference,
        category="artifact-build",
        request_evidence_hash="a" * 64,
        output_rights_acceptance_proof="accepted-output-rights",
    )
    job_id = requested["job_id"]
    transition(ledger, job_id, "accept", {
        "dogg_id": "rappterbox",
        "conformance_hash": "d" * 64,
    })
    transition(ledger, job_id, "start")
    transition(ledger, job_id, "submit_proof", {"proof_hash": "e" * 64})
    transition(ledger, job_id, "approve")
    transition(ledger, job_id, "deliver", {"artifact_hash": "f" * 64})
    return ledger.state(job_id)


def tip_policy():
    return build_tip_policy(
        issuer="rappterbox",
        rapterbox_reference_hash="1" * 64,
        rapterbox_basis_points=10_000,
        quality_tip_ratio_cap_basis_points=2000,
        market_alpha_micros_per_minor=5,
        created_utc=NOW.isoformat(timespec="seconds"),
        signer=Signer(),
    )


def sponsorship_policy():
    return build_evolution_sponsorship_policy(
        issuer="rappterbox",
        mutation_frame_cost_minor=100,
        compute_unit_cost_minor=100,
        iteration_unit_cost_minor=50,
        premium_review_cost_minor=400,
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
        tip_policy=tip_policy(),
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
    )
    assert created is True
    assert repeated_created is False
    assert repeated == event
    assert verifier.calls == 1
    assert event["tipped"] is True
    assert event["amount_minor"] == 1_000_000
    assert event["suggested_tip_ratio_basis_points"] == 2000
    assert event["quality_tip_signal_ppm"] == 1_000_000
    assert event["rapterbox_amount_minor"] == 1_000_000
    assert event["raw_economic_view"]["amount_minor"] == 1_000_000
    assert event["raw_economic_view"]["market_evaluation_influence"] is True
    assert event["market_alpha_signal_micros"] == 5_000_000
    assert event["shopify_line_item_kind"] == "tip"
    assert event["ledger_id"] == "rapterworks-tips"
    assert event["benefit_free"] is True
    assert event["deliverable_conferred"] is False
    assert event["evolution_sponsorship_included"] is False
    assert event["third_party_payouts_enabled"] is False
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
        tip_policy=tip_policy(),
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
    )
    assert event["tipped"] is False
    assert event["amount_minor"] == 0
    assert event["payment_reference_hash"] is None
    assert event["debt_created"] is False
    assert event["deliverable_conferred"] is False
    assert event["evolution_sponsorship_included"] is False
    assert event["market_alpha_signal_micros"] == 0
    assert event["raw_economic_view"]["demand_market_alpha_influence"] is False
    assert verifier.calls == 0


def test_tip_requires_delivery_and_rejects_reused_payment_or_tampered_policy():
    ledger = InMemoryRapterWorksLedger(
        issuer="rappterbox",
        signer=Signer(),
        dogg_verifier=DoggVerifier(),
        commission_adapter=CommissionAdapter(),
        output_rights_verifier=RightsVerifier(),
        now=lambda: NOW,
    )
    requested, _ = ledger.request_job(
        operation_id="undelivered-tip-job",
        account_reference="account-1",
        category="artifact-build",
        request_evidence_hash="a" * 64,
        output_rights_acceptance_proof="accepted-output-rights",
    )
    verifier = TipVerifier(100, "shared-tip-payment")
    tips = InMemoryTipLedger(
        issuer="rappterbox",
        signer=Signer(),
        payment_verifier=verifier,
        tip_policy=tip_policy(),
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
        )
    tampered = dict(tip_policy())
    tampered["rapterbox_basis_points"] = 9999
    with pytest.raises(CreditError, match="only to Rapterbox"):
        InMemoryTipLedger(
            issuer="rappterbox",
            signer=Signer(),
            payment_verifier=verifier,
            tip_policy=tampered,
            now=lambda: NOW,
        )


def test_evolution_sponsorship_is_separate_deferred_revenue_until_delivery():
    job = delivered_job()
    verifier = SponsorshipVerifier()
    ledger = InMemoryEvolutionSponsorshipLedger(
        issuer="rappterbox",
        signer=Signer(),
        verifier=verifier,
        policy=sponsorship_policy(),
        now=lambda: NOW,
    )
    purchased, created = ledger.purchase(
        job=job,
        operation_id="sponsor-1",
        payment_proof="verified-sponsorship",
    )
    repeated, repeated_created = ledger.purchase(
        job=job,
        operation_id="sponsor-1",
        payment_proof="verified-sponsorship",
    )
    assert created is True
    assert repeated_created is False
    assert repeated == purchased
    assert purchased["shopify_line_item_kind"] == "evolution-sponsorship"
    assert purchased["ledger_id"] == "rapterworks-evolution-sponsorships"
    assert purchased["merchant_of_record"] == "rappterbox"
    assert purchased["operator"] == "rappterbox"
    assert purchased["third_party_payouts_enabled"] is False
    assert purchased["subtotal_minor"] == 1_100
    assert purchased["tax_minor"] == 88
    assert purchased["total_minor"] == 1_188
    assert purchased["recognized_revenue_minor"] == 0
    assert purchased["deferred_revenue_liability_minor"] == 1_100
    assert purchased["tax_state"] == "collected-pending-remittance"
    assert purchased["refund_state"] == "eligible"
    assert purchased["chargeback_state"] == "none"
    assert purchased["selected_lens_weight_micros"] == 11_000
    assert purchased["market_alpha_signal_micros"] == 5_500
    assert purchased["output_rights_terms_hash"] == "b" * 64
    assert purchased["canon_acceptance_authority"] == "rappterbox"
    assert purchased["canonical_mutation_guaranteed"] is False
    sponsorship_id = purchased["sponsorship_id"]
    partial, _ = ledger.deliver(
        sponsorship_id=sponsorship_id,
        operation_id="partial-delivery",
        delivery_evidence_hash="c" * 64,
        mutation_frames=1,
        compute_units=1,
        iteration_units=0,
        premium_review_units=0,
    )
    assert partial["status"] == "partially-delivered-deferred"
    assert partial["recognized_revenue_minor"] == 0
    assert partial["deferred_revenue_liability_minor"] == 1_100
    assert partial["refund_state"] == "post-delivery-policy-review"
    completed, _ = ledger.deliver(
        sponsorship_id=sponsorship_id,
        operation_id="final-delivery",
        delivery_evidence_hash="d" * 64,
        mutation_frames=1,
        compute_units=2,
        iteration_units=4,
        premium_review_units=1,
    )
    assert completed["status"] == "delivered-recognized"
    assert completed["recognized_revenue_minor"] == 1_100
    assert completed["deferred_revenue_liability_minor"] == 0
    assert not any(completed["outstanding_units"].values())
    original_purchase, original_created = ledger.purchase(
        job=job,
        operation_id="sponsor-1",
        payment_proof="verified-sponsorship",
    )
    assert original_created is False
    assert original_purchase["status"] == "paid-deferred"
    assert original_purchase["deferred_revenue_liability_minor"] == 1_100


def test_sponsorship_refund_and_chargeback_are_verified_accounting_states():
    job = delivered_job()
    refund_ledger = InMemoryEvolutionSponsorshipLedger(
        issuer="rappterbox",
        signer=Signer(),
        verifier=SponsorshipVerifier(),
        policy=sponsorship_policy(),
        now=lambda: NOW,
    )
    purchased, _ = refund_ledger.purchase(
        job=job,
        operation_id="refund-purchase",
        payment_proof="verified-sponsorship",
    )
    refunded, _ = refund_ledger.refund(
        sponsorship_id=purchased["sponsorship_id"],
        operation_id="refund-1",
        refund_proof="verified-refund",
    )
    assert refunded["status"] == "refunded"
    assert refunded["refund_state"] == "refunded"
    assert refunded["tax_state"] == "refund-adjustment-pending"
    assert refunded["deferred_revenue_liability_minor"] == 0
    assert not any(refunded["outstanding_units"].values())
    assert refunded["cancelled_units"] == refunded["purchased_units"]

    chargeback_ledger = InMemoryEvolutionSponsorshipLedger(
        issuer="rappterbox",
        signer=Signer(),
        verifier=SponsorshipVerifier(),
        policy=sponsorship_policy(),
        now=lambda: NOW,
    )
    purchased, _ = chargeback_ledger.purchase(
        job=job,
        operation_id="chargeback-purchase",
        payment_proof="verified-sponsorship",
    )
    chargeback_ledger.deliver(
        sponsorship_id=purchased["sponsorship_id"],
        operation_id="chargeback-delivery",
        delivery_evidence_hash="e" * 64,
        mutation_frames=2,
        compute_units=3,
        iteration_units=4,
        premium_review_units=1,
    )
    charged_back, _ = chargeback_ledger.chargeback(
        sponsorship_id=purchased["sponsorship_id"],
        operation_id="chargeback-1",
        chargeback_proof="verified-chargeback",
    )
    assert charged_back["status"] == "charged-back"
    assert charged_back["chargeback_state"] == "charged-back"
    assert charged_back["tax_state"] == "chargeback-adjustment-pending"
    assert charged_back["refund_state"] == "chargeback-closed"
    assert charged_back["recognized_revenue_reversal_minor"] == 1_100
    assert charged_back["recognized_revenue_minor"] == 0


def test_raw_economics_preserve_whale_patronage_while_quality_stays_bounded():
    whale_amount = 9_000_000_000_000_000_000
    current_time = [NOW]
    job = delivered_job()
    tips = InMemoryTipLedger(
        issuer="rappterbox",
        signer=Signer(),
        payment_verifier=TipVerifier(whale_amount),
        tip_policy=tip_policy(),
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
    )
    assert whale["amount_minor"] == whale_amount
    assert whale["rapterbox_amount_minor"] == whale_amount
    assert whale["raw_economic_view"]["amount_minor"] == whale_amount
    assert whale["normalized_quality_view"]["tip_signal_ppm"] == 1_000_000
    tips.payment_verifier = TipVerifier(100)
    small_job = delivered_job("tip-job-small", "account-2")
    tips.record(
        job=small_job,
        operation_id="tip-small",
        account_reference="account-2",
        tipped=True,
        currency="USD",
        suggested_tip_minor=100,
        reference_cost_minor=1_000,
        payment_proof="verified-tip",
        cohort_id="artifact-build-2026-08",
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
    )
    current_time[0] = NOW + timedelta(days=1)
    tips.payment_verifier = TipVerifier(500)
    repeat_job = delivered_job("tip-job-repeat", "account-1")
    tips.record(
        job=repeat_job,
        operation_id="tip-repeat",
        account_reference="account-1",
        tipped=True,
        currency="USD",
        suggested_tip_minor=500,
        reference_cost_minor=1_000,
        payment_proof="verified-tip",
        cohort_id="artifact-build-2026-08",
    )
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
    assert cohort["allocation_totals_minor"]["rapterbox_amount_minor"] == (
        lifetime_volume
    )
    assert cohort["benefit_free"] is True
    assert cohort["deliverable_conferred"] is False
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
    assert patronage["benefit_free"] is True
    assert patronage["deliverable_conferred"] is False
    assert [entry["amount_minor"] for entry in patronage["history"]] == [
        whale_amount,
        500,
    ]
    assert Signer().verify(
        {key: value for key, value in patronage.items() if key != "signature"},
        patronage["signature"],
    )
    sponsorships = InMemoryEvolutionSponsorshipLedger(
        issuer="rappterbox",
        signer=Signer(),
        verifier=SponsorshipVerifier(),
        policy=sponsorship_policy(),
        now=lambda: NOW,
    )
    sponsorship, _ = sponsorships.purchase(
        job=job,
        operation_id="quality-sponsorship",
        payment_proof="verified-sponsorship",
    )
    assert whale["ledger_id"] == "rapterworks-tips"
    assert sponsorship["ledger_id"] == "rapterworks-evolution-sponsorships"
    assert whale["shopify_line_item_reference_hash"] != (
        sponsorship["shopify_line_item_reference_hash"]
    )
    assert whale["deliverable_conferred"] is False
    assert sponsorship["deferred_revenue_liability_minor"] == 1_100
    evidence = bounded_quality_evidence(
        issuer="rappterbox",
        signer=Signer(),
        tip_event=whale,
        sponsorship_event=sponsorship,
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
    assert evidence["patronage_weighted_view"]["tip_market_alpha_signal_micros"] == (
        whale_amount * 5
    )
    assert evidence["evolution_sponsorship_view"]["selected_lens"] == "motion"
    assert evidence["evolution_sponsorship_view"]["purchased_units"] == {
        "mutation_frames": 2,
        "compute_units": 3,
        "iteration_units": 4,
        "premium_review_units": 1,
    }
    assert evidence["tip_conferred_deliverable"] is False
    assert evidence["tip_and_sponsorship_separate_line_items"] is True
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
