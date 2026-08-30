import base64
import hashlib
from datetime import datetime, timezone

import pytest

from credits.domain import CreditError, canonical_json
from credits.rapterworks import (
    SPECIES_COUNT,
    SPECIES_IDS,
    InMemoryOwnerInstanceRegistry,
    InMemoryRapterWorksLedger,
    VerifiedCommissionPayment,
    VerifiedShopifySale,
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
