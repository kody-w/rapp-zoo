import copy
import hashlib
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Protocol

from .domain import (
    CreditError,
    bounded_text,
    canonical_json,
    hash_reference,
    validate_sha256,
)
from .signing import RegistrySigner


SPECIES_COUNT = 251
SPECIES_IDS = tuple(
    f"first-dimension-{index:03d}"
    for index in range(1, SPECIES_COUNT + 1)
)
JOB_STATES = {
    "requested",
    "accepted",
    "refused",
    "running",
    "proof_ready",
    "supervisor_approved",
    "revision_required",
    "delivered",
    "commission_offered",
    "paid",
    "declined",
    "ignored",
    "rated",
    "closed",
    "regression_open",
    "corrected",
    "redelivered",
}
TRANSITIONS = {
    ("requested", "accept"): "accepted",
    ("requested", "refuse"): "refused",
    ("refused", "close"): "closed",
    ("accepted", "start"): "running",
    ("running", "submit_proof"): "proof_ready",
    ("proof_ready", "approve"): "supervisor_approved",
    ("proof_ready", "request_revision"): "revision_required",
    ("revision_required", "resume"): "running",
    ("supervisor_approved", "deliver"): "delivered",
    ("delivered", "offer_commission"): "commission_offered",
    ("commission_offered", "mark_paid"): "paid",
    ("commission_offered", "decline_commission"): "declined",
    ("commission_offered", "ignore_commission"): "ignored",
    ("delivered", "rate"): "rated",
    ("paid", "rate"): "rated",
    ("declined", "rate"): "rated",
    ("ignored", "rate"): "rated",
    ("rated", "close"): "closed",
    ("rated", "open_regression"): "regression_open",
    ("regression_open", "correct"): "corrected",
    ("corrected", "redeliver"): "redelivered",
    ("redelivered", "rate"): "rated",
}


@dataclass(frozen=True)
class VerifiedShopifySale:
    sale_id: str
    account_reference: str
    product_id: str
    purchased_utc: str


@dataclass(frozen=True)
class VerifiedCommissionPayment:
    payment_reference: str
    amount_minor: int
    currency: str


@dataclass(frozen=True)
class VerifiedTipPayment:
    payment_reference: str
    shopify_line_item_reference: str
    shopify_line_item_kind: str
    amount_minor: int
    currency: str


@dataclass(frozen=True)
class VerifiedOutputRightsAcceptance:
    account_reference: str
    terms_version: str
    terms_hash: str
    accepted_utc: str


@dataclass(frozen=True)
class VerifiedEvolutionSponsorshipPayment:
    payment_reference: str
    shopify_line_item_reference: str
    shopify_line_item_kind: str
    account_reference: str
    currency: str
    subtotal_minor: int
    tax_minor: int
    total_minor: int
    evolution_target: str
    evolution_target_reference_hash: str
    selected_lens: str
    mutation_frames: int
    compute_units: int
    iteration_units: int
    premium_review_units: int


@dataclass(frozen=True)
class VerifiedSponsorshipAdjustment:
    reference: str
    amount_minor: int
    currency: str


class ShopifySaleVerifier(Protocol):
    configured: bool

    def verify(self, proof: str) -> VerifiedShopifySale:
        ...


class OfficialInstanceIssuer(Protocol):
    def issue(self, sale: VerifiedShopifySale, instance: dict[str, Any]) -> dict[str, Any]:
        ...


class PublicDoggVerifier(Protocol):
    configured: bool

    def verify(self, dogg_id: str, conformance_hash: str) -> bool:
        ...


class ShopifyCommissionAdapter(Protocol):
    configured: bool

    def create_draft_order(
        self,
        *,
        job_id: str,
        amount_minor: int,
        currency: str,
    ) -> tuple[str, str]:
        ...

    def verify_payment(self, proof: str) -> VerifiedCommissionPayment:
        ...


class TipPaymentVerifier(Protocol):
    configured: bool

    def verify_tip(self, proof: str, job_id: str) -> VerifiedTipPayment:
        ...


class OutputRightsVerifier(Protocol):
    configured: bool

    def verify(
        self,
        proof: str,
        account_reference: str,
    ) -> VerifiedOutputRightsAcceptance:
        ...


class EvolutionSponsorshipVerifier(Protocol):
    configured: bool

    def verify_purchase(
        self,
        proof: str,
        job_id: str,
    ) -> VerifiedEvolutionSponsorshipPayment:
        ...

    def verify_refund(
        self,
        proof: str,
        sponsorship_id: str,
    ) -> VerifiedSponsorshipAdjustment:
        ...

    def verify_chargeback(
        self,
        proof: str,
        sponsorship_id: str,
    ) -> VerifiedSponsorshipAdjustment:
        ...


class DisabledShopifyAdapter:
    configured = False

    def verify(self, proof: str) -> VerifiedShopifySale:
        del proof
        raise CreditError("Shopify sale verification is not configured.")

    def create_draft_order(
        self,
        *,
        job_id: str,
        amount_minor: int,
        currency: str,
    ) -> tuple[str, str]:
        del job_id, amount_minor, currency
        raise CreditError("Shopify commission Draft Orders are not configured.")

    def verify_payment(self, proof: str) -> VerifiedCommissionPayment:
        del proof
        raise CreditError("Shopify commission payment verification is not configured.")


class DisabledTipPaymentVerifier:
    configured = False

    def verify_tip(self, proof: str, job_id: str) -> VerifiedTipPayment:
        del proof, job_id
        raise CreditError("Post-service tip payment verification is not configured.")


class DisabledOutputRightsVerifier:
    configured = False

    def verify(
        self,
        proof: str,
        account_reference: str,
    ) -> VerifiedOutputRightsAcceptance:
        del proof, account_reference
        raise CreditError("Output-rights acceptance verification is not configured.")


class DisabledEvolutionSponsorshipVerifier:
    configured = False

    def verify_purchase(
        self,
        proof: str,
        job_id: str,
    ) -> VerifiedEvolutionSponsorshipPayment:
        del proof, job_id
        raise CreditError("Evolution sponsorship verification is not configured.")

    def verify_refund(
        self,
        proof: str,
        sponsorship_id: str,
    ) -> VerifiedSponsorshipAdjustment:
        del proof, sponsorship_id
        raise CreditError("Evolution sponsorship refund verification is not configured.")

    def verify_chargeback(
        self,
        proof: str,
        sponsorship_id: str,
    ) -> VerifiedSponsorshipAdjustment:
        del proof, sponsorship_id
        raise CreditError(
            "Evolution sponsorship chargeback verification is not configured.",
        )


def source_species(species_id: str) -> dict[str, Any]:
    if species_id not in SPECIES_IDS:
        raise CreditError("RapterWorks species id is not canonical.")
    digest = hashlib.sha256(
        f"rappterbox-first-edition\0{species_id}".encode(),
    ).hexdigest()
    return {
        "schema": "rapp-rapterworks-species/1",
        "edition": "first-edition",
        "dimension": "first-dimension",
        "species_id": species_id,
        "source_rappid": f"rappid:@rapterbox/{species_id}:{digest}",
        "title_owner": "rappterbox",
        "mutable": False,
    }


def _utc(value: str, label: str) -> str:
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError) as error:
        raise CreditError(f"{label} is invalid.") from error
    if parsed.tzinfo is None:
        raise CreditError(f"{label} must include a timezone.")
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


class InMemoryOwnerInstanceRegistry:
    def __init__(self):
        self.lock = threading.Lock()
        self.sales: dict[str, dict[str, Any]] = {}
        self.instance_ids: set[str] = set()

    def hatch(
        self,
        *,
        sale: VerifiedShopifySale,
        species_id: str,
        issue_credit: OfficialInstanceIssuer,
        build_capsule: Callable[[dict[str, Any]], dict[str, Any]],
    ) -> tuple[dict[str, Any], bool]:
        sale_hash = hash_reference(
            "shopify-sale",
            bounded_text(sale.sale_id, "Shopify sale id", 512),
        )
        bounded_text(sale.account_reference, "account reference", 512)
        bounded_text(sale.product_id, "Shopify product id", 128)
        _utc(sale.purchased_utc, "Shopify purchased_utc")
        with self.lock:
            if sale_hash in self.sales:
                return self.sales[sale_hash], False
            species = source_species(species_id)
            instance_tail = hashlib.sha256(
                b"rapp/1:rappid\n" + uuid.uuid4().bytes,
            ).hexdigest()
            account_hash = hash_reference(
                "account",
                bounded_text(sale.account_reference, "account reference", 512),
            )
            instance = {
                "schema": "rapp-rapterworks-player-instance/1",
                "source_species_id": species_id,
                "source_species_rappid": species["source_rappid"],
                "instance_rappid": (
                    f"rappid:@player-{account_hash[:12]}/{species_id}:{instance_tail}"
                ),
                "dimension_branch": f"dimension:{instance_tail}",
                "shopify_sale_hash": sale_hash,
                "title_transferable": True,
                "source_species_mutated": False,
            }
            if instance["instance_rappid"] in self.instance_ids:
                raise CreditError("Player instance identity collision.")
            credit = issue_credit.issue(sale, instance)
            capsule = build_capsule({**instance, "credit": credit})
            result = {
                **instance,
                "credit": credit,
                "capsule": capsule,
            }
            self.instance_ids.add(instance["instance_rappid"])
            self.sales[sale_hash] = result
            return result, True


def _job_event(
    *,
    issuer: str,
    job_id: str,
    sequence: int,
    previous_event_hash: str | None,
    state: str,
    occurred_utc: str,
    fields: dict[str, Any],
    signer: RegistrySigner,
) -> dict[str, Any]:
    if state not in JOB_STATES:
        raise CreditError("RapterWorks job state is invalid.")
    base = {
        "schema": "rapp-rapterworks-job-event/1",
        "kind": "body.pulse",
        "issuer": issuer,
        "job_id": job_id,
        "sequence": sequence,
        "previous_event_hash": previous_event_hash,
        "state": state,
        "occurred_utc": occurred_utc,
        **fields,
    }
    event_hash = hashlib.sha256(canonical_json(base)).hexdigest()
    payload = {
        **base,
        "event_id": f"rwj_{event_hash[:32]}",
        "event_hash": event_hash,
    }
    return {**payload, "signature": signer.sign(payload)}


class InMemoryRapterWorksLedger:
    def __init__(
        self,
        *,
        issuer: str,
        signer: RegistrySigner,
        dogg_verifier: PublicDoggVerifier,
        commission_adapter: ShopifyCommissionAdapter,
        output_rights_verifier: OutputRightsVerifier,
        now: Callable[[], datetime] | None = None,
        regression_rating_threshold: int = 2,
    ):
        self.issuer = issuer
        self.signer = signer
        self.dogg_verifier = dogg_verifier
        self.commission_adapter = commission_adapter
        self.output_rights_verifier = output_rights_verifier
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.regression_rating_threshold = regression_rating_threshold
        self.jobs: dict[str, dict[str, Any]] = {}
        self.events: dict[str, list[dict[str, Any]]] = {}
        self.operations: dict[tuple[str, str], list[dict[str, Any]]] = {}
        self.regression_fixtures: dict[str, dict[str, Any]] = {}

    def request_job(
        self,
        *,
        operation_id: str,
        account_reference: str,
        category: str,
        request_evidence_hash: str,
        output_rights_acceptance_proof: str,
    ) -> tuple[dict[str, Any], bool]:
        operation = self._operation("request", operation_id)
        if operation in self.operations:
            return self.operations[operation][0], False
        account_hash = hash_reference(
            "rapterworks-account",
            bounded_text(account_reference, "account reference", 512),
        )
        rights = self.output_rights_verifier.verify(
            bounded_text(
                output_rights_acceptance_proof,
                "output rights acceptance proof",
                2_048,
            ),
            account_reference,
        )
        if rights.account_reference != account_reference:
            raise CreditError("Output-rights acceptance account does not match.")
        terms_version = bounded_text(
            rights.terms_version,
            "output rights terms_version",
            128,
        )
        terms_hash = validate_sha256(rights.terms_hash, "output rights terms_hash")
        accepted_utc = _utc(rights.accepted_utc, "output rights accepted_utc")
        job_hash = hashlib.sha256(
            f"rapterworks-job\0{operation[1]}".encode(),
        ).hexdigest()
        job_id = f"rwj:{job_hash}"
        event = self._append(
            job_id,
            "requested",
            {
                "account_hash": account_hash,
                "category": bounded_text(category, "job category", 128),
                "request_evidence_hash": validate_sha256(
                    request_evidence_hash,
                    "request_evidence_hash",
                ),
                "output_rights_terms_version": terms_version,
                "output_rights_terms_hash": terms_hash,
                "output_rights_accepted_utc": accepted_utc,
                "merchant_of_record": "rappterbox",
                "operator": "rappterbox",
                "third_party_payouts_enabled": False,
                "artifact_access": "not-yet-delivered",
                "payment_required": False,
                "debt_created": False,
                "private_mutation_allowed": True,
            },
        )
        self.jobs[job_id] = {
            "job_id": job_id,
            "account_hash": account_hash,
            "state": "requested",
            "sequence": event["sequence"],
            "event_hash": event["event_hash"],
            "public_dogg_id": None,
            "proof_hash": None,
            "artifact_hash": None,
            "active_commission_hash": None,
            "active_commission_amount_minor": None,
            "active_commission_currency": None,
            "output_rights_terms_version": terms_version,
            "output_rights_terms_hash": terms_hash,
            "merchant_of_record": "rappterbox",
            "operator": "rappterbox",
            "third_party_payouts_enabled": False,
        }
        self.operations[operation] = [event]
        return event, True

    def transition(
        self,
        *,
        job_id: str,
        operation_id: str,
        action: str,
        fields: dict[str, Any] | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        operation = self._operation(action, operation_id, job_id)
        if operation in self.operations:
            return self.operations[operation], False
        job = self.jobs.get(job_id)
        if job is None:
            raise CreditError("RapterWorks job does not exist.")
        fields = fields or {}
        target = TRANSITIONS.get((job["state"], action))
        if target is None:
            raise CreditError(f"Transition {job['state']} -> {action} is not allowed.")
        event_fields: dict[str, Any] = {
            "account_hash": job["account_hash"],
            "private_mutation_allowed": True,
            "payment_required": False,
            "debt_created": False,
        }
        if action == "accept":
            if set(fields) != {"dogg_id", "conformance_hash"}:
                raise CreditError("Job acceptance requires DOGG conformance evidence.")
            dogg_id = bounded_text(fields["dogg_id"], "dogg_id", 256)
            if dogg_id != "rappterbox":
                raise CreditError("Launch commercial jobs are Rapterbox-operated only.")
            conformance_hash = validate_sha256(
                fields["conformance_hash"],
                "conformance_hash",
            )
            if not self.dogg_verifier.verify(dogg_id, conformance_hash):
                raise CreditError("Public DOGG conformance was not verified.")
            job["public_dogg_id"] = dogg_id
            event_fields.update({
                "public_dogg_id": dogg_id,
                "dogg_conformance_hash": conformance_hash,
                "merchant_of_record": "rappterbox",
                "operator": "rappterbox",
                "third_party_payouts_enabled": False,
            })
        elif action == "submit_proof":
            if set(fields) != {"proof_hash"}:
                raise CreditError("Proof submission requires proof_hash.")
            job["proof_hash"] = validate_sha256(fields["proof_hash"], "proof_hash")
            event_fields["proof_hash"] = job["proof_hash"]
        elif action == "approve":
            if fields:
                raise CreditError("Approval does not accept client evidence.")
            event_fields["proof_hash"] = job["proof_hash"]
        elif action == "request_revision":
            if set(fields) != {"revision_evidence_hash"}:
                raise CreditError("Revision requires evidence hash.")
            event_fields["revision_evidence_hash"] = validate_sha256(
                fields["revision_evidence_hash"],
                "revision_evidence_hash",
            )
        elif action == "deliver" or action == "redeliver":
            if set(fields) != {"artifact_hash"}:
                raise CreditError("Delivery requires artifact_hash.")
            job["artifact_hash"] = validate_sha256(fields["artifact_hash"], "artifact_hash")
            event_fields.update({
                "artifact_hash": job["artifact_hash"],
                "artifact_access": "full-and-free",
                "commission_required": False,
            })
        elif action == "offer_commission":
            if set(fields) != {"amount_minor", "currency"}:
                raise CreditError("Commission offer has an invalid shape.")
            amount = fields["amount_minor"]
            if isinstance(amount, bool) or not isinstance(amount, int) or amount < 1:
                raise CreditError("Commission amount must be a positive integer.")
            currency = bounded_text(fields["currency"], "currency", 3).upper()
            reference, payment_url = self.commission_adapter.create_draft_order(
                job_id=job_id,
                amount_minor=amount,
                currency=currency,
            )
            commission_hash = hash_reference("shopify-draft-order", reference)
            job["active_commission_hash"] = commission_hash
            job["active_commission_amount_minor"] = amount
            job["active_commission_currency"] = currency
            event_fields.update({
                "commission_reference_hash": commission_hash,
                "amount_minor": amount,
                "currency": currency,
                "optional": True,
                "merchant_of_record": "rappterbox",
                "operator": "rappterbox",
                "third_party_payouts_enabled": False,
                "artifact_access_gated": False,
                "payment_url": payment_url,
            })
        elif action == "mark_paid":
            if set(fields) != {"payment_proof"}:
                raise CreditError("Commission payment requires verified proof.")
            payment = self.commission_adapter.verify_payment(fields["payment_proof"])
            if (
                payment.amount_minor != job["active_commission_amount_minor"]
                or payment.currency != job["active_commission_currency"]
            ):
                raise CreditError("Commission payment does not match the optional offer.")
            event_fields.update({
                "commission_reference_hash": job["active_commission_hash"],
                "payment_reference_hash": hash_reference(
                    "shopify-commission-payment",
                    payment.payment_reference,
                ),
                "amount_minor": payment.amount_minor,
                "currency": payment.currency,
                "merchant_of_record": "rappterbox",
                "operator": "rappterbox",
                "third_party_payouts_enabled": False,
                "artifact_access_gated": False,
            })
        elif action in {"decline_commission", "ignore_commission"}:
            if fields:
                raise CreditError("Commission response does not accept extra fields.")
            event_fields.update({
                "commission_reference_hash": job["active_commission_hash"],
                "artifact_access_gated": False,
            })
        elif action == "rate":
            if set(fields) != {"rating", "rating_evidence_hash"}:
                raise CreditError("Rating has an invalid shape.")
            rating = fields["rating"]
            if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
                raise CreditError("Rating must be an integer from 1 to 5.")
            event_fields.update({
                "rating": rating,
                "rating_evidence_hash": validate_sha256(
                    fields["rating_evidence_hash"],
                    "rating_evidence_hash",
                ),
            })
        elif fields:
            raise CreditError("Transition does not accept extra fields.")
        event = self._append(job_id, target, event_fields)
        job["state"] = target
        job["sequence"] = event["sequence"]
        job["event_hash"] = event["event_hash"]
        self.operations[operation] = [event]
        return [event], True

    def resolve_rating(
        self,
        *,
        job_id: str,
        operation_id: str,
    ) -> tuple[list[dict[str, Any]], bool]:
        job = self.jobs.get(job_id)
        if job is None or job["state"] != "rated":
            raise CreditError("Only a rated job can be resolved.")
        rating = self.events[job_id][-1]["rating"]
        action = (
            "open_regression"
            if rating <= self.regression_rating_threshold
            else "close"
        )
        events, created = self.transition(
            job_id=job_id,
            operation_id=operation_id,
            action=action,
        )
        if action == "open_regression" and created:
            event = events[0]
            fixture_hash = hashlib.sha256(canonical_json({
                "job_id": job_id,
                "artifact_hash": job["artifact_hash"],
                "proof_hash": job["proof_hash"],
                "rating": rating,
                "rating_event_hash": self.events[job_id][-2]["event_hash"],
            })).hexdigest()
            self.regression_fixtures[fixture_hash] = {
                "schema": "rappter-works-regression-fixture/1",
                "fixture_hash": fixture_hash,
                "job_id": job_id,
                "artifact_hash": job["artifact_hash"],
                "proof_hash": job["proof_hash"],
                "rating": rating,
                "opened_by_event_id": event["event_id"],
                "immutable": True,
            }
        return events, created

    def state(self, job_id: str) -> dict[str, Any]:
        job = self.jobs.get(job_id)
        if job is None:
            raise CreditError("RapterWorks job does not exist.")
        return {
            **job,
            "artifact_access": (
                "full-and-free"
                if job["artifact_hash"]
                else "not-yet-delivered"
            ),
            "commission_optional": True,
            "debt_created": False,
            "private_mutation_allowed": True,
        }

    def _append(
        self,
        job_id: str,
        state: str,
        fields: dict[str, Any],
    ) -> dict[str, Any]:
        history = self.events.setdefault(job_id, [])
        event = _job_event(
            issuer=self.issuer,
            job_id=job_id,
            sequence=len(history),
            previous_event_hash=history[-1]["event_hash"] if history else None,
            state=state,
            occurred_utc=self.now().isoformat(timespec="seconds"),
            fields=fields,
            signer=self.signer,
        )
        history.append(event)
        return event

    @staticmethod
    def _operation(
        action: str,
        operation_id: str,
        job_id: str = "new-job",
    ) -> tuple[str, str]:
        return (
            action,
            hash_reference(
                "rapterworks-operation",
                (
                    f"{job_id}\0"
                    + bounded_text(operation_id, "operation_id", 256)
                ),
            ),
        )


MAX_MINOR_AMOUNT = 9_223_372_036_854_775_807
TIP_SPLIT_FIELDS = (
    ("rapterbox", "rapterbox_basis_points"),
)
EVOLUTION_TARGETS = {"owner-instance", "species-candidate"}


def build_tip_policy(
    *,
    issuer: str,
    rapterbox_reference_hash: str,
    rapterbox_basis_points: int,
    quality_tip_ratio_cap_basis_points: int,
    market_alpha_micros_per_minor: int,
    created_utc: str,
    signer: RegistrySigner,
) -> dict[str, Any]:
    issuer = bounded_text(issuer, "issuer", 128)
    validate_sha256(rapterbox_reference_hash, "rapterbox_reference_hash")
    if rapterbox_basis_points != 10_000:
        raise CreditError("Launch tips must allocate 10000 basis points to Rapterbox.")
    if (
        isinstance(quality_tip_ratio_cap_basis_points, bool)
        or not isinstance(quality_tip_ratio_cap_basis_points, int)
        or not 1 <= quality_tip_ratio_cap_basis_points <= 10_000
    ):
        raise CreditError("Quality tip ratio cap must be from 1 to 10000 basis points.")
    for label, value in {
        "market_alpha_micros_per_minor": market_alpha_micros_per_minor,
    }.items():
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or value < 1
            or value > MAX_MINOR_AMOUNT
        ):
            raise CreditError(f"{label} must be a positive storage-safe integer.")
    base = {
        "schema": "rapp-rapterworks-tip-policy/4",
        "kind": "body.pulse",
        "issuer": issuer,
        "shopify_line_item_kind": "tip",
        "ledger_id": "rapterworks-tips",
        "merchant_of_record": "rappterbox",
        "rapterbox_reference_hash": rapterbox_reference_hash,
        "rapterbox_basis_points": rapterbox_basis_points,
        "third_party_payouts_enabled": False,
        "benefit_free": True,
        "deliverable_conferred": False,
        "evolution_sponsorship_included": False,
        "quality_tip_ratio_cap_basis_points": quality_tip_ratio_cap_basis_points,
        "market_alpha_micros_per_minor": market_alpha_micros_per_minor,
        "raw_economic_signal_preserved": True,
        "quality_component_capped": True,
        "unweighted_technical_score_required": True,
        "artifact_access_gated": False,
        "debt_created": False,
        "rating_override_allowed": False,
        "created_utc": _utc(created_utc, "created_utc"),
    }
    policy_hash = hashlib.sha256(canonical_json(base)).hexdigest()
    payload = {
        **base,
        "policy_id": f"rapterworks-tip-policy:{policy_hash}",
        "policy_hash": policy_hash,
    }
    return {**payload, "signature": signer.sign(payload)}


def validate_tip_policy(
    value: Any,
    verifier: RegistrySigner,
) -> dict[str, Any]:
    expected = {
        "schema",
        "kind",
        "issuer",
        "shopify_line_item_kind",
        "ledger_id",
        "merchant_of_record",
        "rapterbox_reference_hash",
        "rapterbox_basis_points",
        "third_party_payouts_enabled",
        "benefit_free",
        "deliverable_conferred",
        "evolution_sponsorship_included",
        "quality_tip_ratio_cap_basis_points",
        "market_alpha_micros_per_minor",
        "raw_economic_signal_preserved",
        "quality_component_capped",
        "unweighted_technical_score_required",
        "artifact_access_gated",
        "debt_created",
        "rating_override_allowed",
        "created_utc",
        "policy_id",
        "policy_hash",
        "signature",
    }
    if (
        not isinstance(value, dict)
        or set(value) != expected
        or value.get("schema") != "rapp-rapterworks-tip-policy/4"
        or value.get("kind") != "body.pulse"
        or value.get("shopify_line_item_kind") != "tip"
        or value.get("ledger_id") != "rapterworks-tips"
        or value.get("merchant_of_record") != "rappterbox"
    ):
        raise CreditError("Tip split policy has an invalid shape.")
    bounded_text(value["issuer"], "issuer", 128)
    if _utc(value["created_utc"], "created_utc") != value["created_utc"]:
        raise CreditError("Tip split policy created_utc must be canonical UTC.")
    validate_sha256(value["rapterbox_reference_hash"], "rapterbox_reference_hash")
    if value["rapterbox_basis_points"] != 10_000:
        raise CreditError("Launch tips must allocate only to Rapterbox.")
    cap = value["quality_tip_ratio_cap_basis_points"]
    if isinstance(cap, bool) or not isinstance(cap, int) or not 1 <= cap <= 10_000:
        raise CreditError("Quality tip ratio cap must be from 1 to 10000 basis points.")
    for field in ("market_alpha_micros_per_minor",):
        amount = value[field]
        if (
            isinstance(amount, bool)
            or not isinstance(amount, int)
            or amount < 1
            or amount > MAX_MINOR_AMOUNT
        ):
            raise CreditError(f"{field} must be a positive storage-safe integer.")
    if (
        value["third_party_payouts_enabled"] is not False
        or value["benefit_free"] is not True
        or value["deliverable_conferred"] is not False
        or value["evolution_sponsorship_included"] is not False
        or value["raw_economic_signal_preserved"] is not True
        or value["quality_component_capped"] is not True
        or value["unweighted_technical_score_required"] is not True
        or value["artifact_access_gated"] is not False
        or value["debt_created"] is not False
        or value["rating_override_allowed"] is not False
    ):
        raise CreditError("Tip policy violates launch accounting guardrails.")
    hash_payload = {
        key: item
        for key, item in value.items()
        if key not in {"policy_id", "policy_hash", "signature"}
    }
    expected_hash = hashlib.sha256(canonical_json(hash_payload)).hexdigest()
    if (
        value.get("policy_hash") != expected_hash
        or value.get("policy_id") != f"rapterworks-tip-policy:{expected_hash}"
    ):
        raise CreditError("Tip split policy content address is invalid.")
    payload = {
        key: item
        for key, item in value.items()
        if key != "signature"
    }
    if not verifier.verify(payload, value.get("signature")):
        raise CreditError("Tip policy signature is invalid.")
    return value


def build_evolution_sponsorship_policy(
    *,
    issuer: str,
    mutation_frame_cost_minor: int,
    compute_unit_cost_minor: int,
    iteration_unit_cost_minor: int,
    premium_review_cost_minor: int,
    selected_lens_weight_micros_per_minor: int,
    market_alpha_micros_per_minor: int,
    created_utc: str,
    signer: RegistrySigner,
) -> dict[str, Any]:
    issuer = bounded_text(issuer, "issuer", 128)
    costs = {
        "mutation_frame_cost_minor": mutation_frame_cost_minor,
        "compute_unit_cost_minor": compute_unit_cost_minor,
        "iteration_unit_cost_minor": iteration_unit_cost_minor,
        "premium_review_cost_minor": premium_review_cost_minor,
        "selected_lens_weight_micros_per_minor": (
            selected_lens_weight_micros_per_minor
        ),
        "market_alpha_micros_per_minor": market_alpha_micros_per_minor,
    }
    for label, amount in costs.items():
        if (
            isinstance(amount, bool)
            or not isinstance(amount, int)
            or amount < 1
            or amount > MAX_MINOR_AMOUNT
        ):
            raise CreditError(f"{label} must be a positive storage-safe integer.")
    base = {
        "schema": "rapp-rapterworks-evolution-sponsorship-policy/1",
        "kind": "body.pulse",
        "issuer": issuer,
        "shopify_line_item_kind": "evolution-sponsorship",
        "ledger_id": "rapterworks-evolution-sponsorships",
        "merchant_of_record": "rappterbox",
        "operator": "rappterbox",
        "third_party_payouts_enabled": False,
        "revenue_recognition": "deferred-until-delivery",
        "tax_tracking_required": True,
        "refund_tracking_required": True,
        "chargeback_tracking_required": True,
        "output_rights_terms_required": True,
        "canon_acceptance_authority": "rappterbox",
        "canonical_mutation_guaranteed": False,
        "evolution_service_not_equity": True,
        "return_guaranteed": False,
        "third_party_enablement_requirements": [
            "signed-commercial-agreement",
            "identity-onboarding",
            "tax-onboarding",
            "indemnity-controls",
            "warranty-controls",
            "refund-controls",
            "chargeback-controls",
        ],
        **costs,
        "created_utc": _utc(created_utc, "created_utc"),
    }
    policy_hash = hashlib.sha256(canonical_json(base)).hexdigest()
    payload = {
        **base,
        "policy_id": f"rapterworks-evolution-policy:{policy_hash}",
        "policy_hash": policy_hash,
    }
    return {**payload, "signature": signer.sign(payload)}


def validate_evolution_sponsorship_policy(
    value: Any,
    verifier: RegistrySigner,
) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or value.get("schema")
        != "rapp-rapterworks-evolution-sponsorship-policy/1"
        or value.get("shopify_line_item_kind") != "evolution-sponsorship"
        or value.get("ledger_id") != "rapterworks-evolution-sponsorships"
        or value.get("merchant_of_record") != "rappterbox"
        or value.get("operator") != "rappterbox"
        or value.get("third_party_payouts_enabled") is not False
        or value.get("revenue_recognition") != "deferred-until-delivery"
        or value.get("tax_tracking_required") is not True
        or value.get("refund_tracking_required") is not True
        or value.get("chargeback_tracking_required") is not True
        or value.get("output_rights_terms_required") is not True
        or value.get("canon_acceptance_authority") != "rappterbox"
        or value.get("canonical_mutation_guaranteed") is not False
        or value.get("evolution_service_not_equity") is not True
        or value.get("return_guaranteed") is not False
    ):
        raise CreditError("Evolution sponsorship policy is invalid.")
    if value.get("third_party_enablement_requirements") != [
        "signed-commercial-agreement",
        "identity-onboarding",
        "tax-onboarding",
        "indemnity-controls",
        "warranty-controls",
        "refund-controls",
        "chargeback-controls",
    ]:
        raise CreditError("Third-party commercial controls are incomplete.")
    bounded_text(value.get("issuer"), "issuer", 128)
    if _utc(value.get("created_utc"), "created_utc") != value.get("created_utc"):
        raise CreditError("Evolution sponsorship policy UTC is not canonical.")
    for field in (
        "mutation_frame_cost_minor",
        "compute_unit_cost_minor",
        "iteration_unit_cost_minor",
        "premium_review_cost_minor",
        "selected_lens_weight_micros_per_minor",
        "market_alpha_micros_per_minor",
    ):
        amount = value.get(field)
        if (
            isinstance(amount, bool)
            or not isinstance(amount, int)
            or amount < 1
            or amount > MAX_MINOR_AMOUNT
        ):
            raise CreditError("Evolution sponsorship policy cost is invalid.")
    hash_payload = {
        key: item
        for key, item in value.items()
        if key not in {"policy_id", "policy_hash", "signature"}
    }
    expected_hash = hashlib.sha256(canonical_json(hash_payload)).hexdigest()
    if (
        value.get("policy_hash") != expected_hash
        or value.get("policy_id") != f"rapterworks-evolution-policy:{expected_hash}"
    ):
        raise CreditError("Evolution sponsorship policy content address is invalid.")
    payload = {key: item for key, item in value.items() if key != "signature"}
    if not verifier.verify(payload, value.get("signature")):
        raise CreditError("Evolution sponsorship policy signature is invalid.")
    return value


def _allocate_tip_amount(
    amount_minor: int,
    policy: dict[str, Any],
) -> dict[str, int]:
    allocations: dict[str, int] = {}
    remainders: list[tuple[int, int, str]] = []
    for index, (name, field) in enumerate(TIP_SPLIT_FIELDS):
        allocated, remainder = divmod(amount_minor * policy[field], 10_000)
        allocations[f"{name}_amount_minor"] = allocated
        remainders.append((remainder, index, name))
    undistributed = amount_minor - sum(allocations.values())
    for _, _, name in sorted(remainders, key=lambda item: (-item[0], item[1]))[
        :undistributed
    ]:
        allocations[f"{name}_amount_minor"] += 1
    return allocations


def _median(values: list[int]) -> int:
    if not values:
        return 0
    if len(values) % 2:
        return values[len(values) // 2]
    middle = len(values) // 2
    return (values[middle - 1] + values[middle] + 1) // 2


def _currency_code(value: Any) -> str:
    currency = bounded_text(value, "currency", 3).upper()
    if len(currency) != 3 or not currency.isascii() or not currency.isalpha():
        raise CreditError("currency must be a three-letter ASCII code.")
    return currency


class InMemoryTipLedger:
    def __init__(
        self,
        *,
        issuer: str,
        signer: RegistrySigner,
        payment_verifier: TipPaymentVerifier,
        tip_policy: dict[str, Any],
        now: Callable[[], datetime] | None = None,
    ):
        self.issuer = bounded_text(issuer, "issuer", 128)
        self.signer = signer
        self.payment_verifier = payment_verifier
        validated_policy = validate_tip_policy(tip_policy, signer)
        if validated_policy["issuer"] != self.issuer:
            raise CreditError("Tip split policy issuer does not match the ledger.")
        self.tip_policy = copy.deepcopy(validated_policy)
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.tips: dict[tuple[str, str], dict[str, Any]] = {}
        self.job_operations: dict[str, tuple[str, str]] = {}
        self.payment_operations: dict[str, tuple[str, str]] = {}
        self.line_item_operations: dict[str, tuple[str, str]] = {}
        self._lock = threading.RLock()

    def record(
        self,
        *,
        job: dict[str, Any],
        operation_id: str,
        account_reference: str,
        tipped: bool,
        currency: str,
        suggested_tip_minor: int,
        reference_cost_minor: int,
        payment_proof: str | None,
        cohort_id: str,
    ) -> tuple[dict[str, Any], bool]:
        with self._lock:
            return self._record_locked(
                job=job,
                operation_id=operation_id,
                account_reference=account_reference,
                tipped=tipped,
                currency=currency,
                suggested_tip_minor=suggested_tip_minor,
                reference_cost_minor=reference_cost_minor,
                payment_proof=payment_proof,
                cohort_id=cohort_id,
            )

    def _record_locked(
        self,
        *,
        job: dict[str, Any],
        operation_id: str,
        account_reference: str,
        tipped: bool,
        currency: str,
        suggested_tip_minor: int,
        reference_cost_minor: int,
        payment_proof: str | None,
        cohort_id: str,
    ) -> tuple[dict[str, Any], bool]:
        if not job.get("artifact_hash") or job.get("state") not in {
            "delivered",
            "commission_offered",
            "paid",
            "declined",
            "ignored",
            "rated",
            "closed",
            "redelivered",
            "regression_open",
            "corrected",
        }:
            raise CreditError("Tips are available only after full artifact delivery.")
        operation_hash = hash_reference(
            "rapterworks-tip",
            f"{job['job_id']}\0{bounded_text(operation_id, 'operation_id', 256)}",
        )
        key = (job["job_id"], operation_hash)
        if key in self.tips:
            return copy.deepcopy(self.tips[key]), False
        if job["job_id"] in self.job_operations:
            raise CreditError("This job already has a post-service tip signal.")
        if not isinstance(tipped, bool):
            raise CreditError("tipped must be a boolean.")
        currency = _currency_code(currency)
        account_hash = hash_reference(
            "rapterworks-account",
            bounded_text(account_reference, "account reference", 512),
        )
        if account_hash != job.get("account_hash"):
            raise CreditError("Tip account does not match the delivered job.")
        for amount, label, minimum in (
            (suggested_tip_minor, "suggested_tip_minor", 0),
            (reference_cost_minor, "reference_cost_minor", 1),
        ):
            if (
                isinstance(amount, bool)
                or not isinstance(amount, int)
                or amount < minimum
                or amount > MAX_MINOR_AMOUNT
            ):
                raise CreditError(f"{label} is invalid.")
        if tipped:
            if not payment_proof:
                raise CreditError("A tipped event requires verified payment proof.")
            payment = self.payment_verifier.verify_tip(payment_proof, job["job_id"])
            if payment.shopify_line_item_kind != "tip":
                raise CreditError("Verified payment is not a Shopify TIP line item.")
            payment_currency = _currency_code(payment.currency)
            if payment_currency != currency:
                raise CreditError("Tip payment currency does not match.")
            if (
                isinstance(payment.amount_minor, bool)
                or not isinstance(payment.amount_minor, int)
                or payment.amount_minor < 1
                or payment.amount_minor > MAX_MINOR_AMOUNT
            ):
                raise CreditError("Verified tip amount is invalid.")
            amount_minor = payment.amount_minor
            payment_reference_hash = hash_reference(
                "rapterworks-tip-payment",
                bounded_text(
                    payment.payment_reference,
                    "tip payment reference",
                    512,
                ),
            )
            if payment_reference_hash in self.payment_operations:
                raise CreditError("This verified tip payment has already been recorded.")
            line_item_reference_hash = hash_reference(
                "rapterworks-tip-line-item",
                bounded_text(
                    payment.shopify_line_item_reference,
                    "tip Shopify line item reference",
                    512,
                ),
            )
            if line_item_reference_hash in self.line_item_operations:
                raise CreditError("This Shopify tip line item has already been recorded.")
        else:
            if payment_proof:
                raise CreditError("A zero-tip event cannot include payment proof.")
            amount_minor = 0
            payment_reference_hash = None
            line_item_reference_hash = None
        cap = self.tip_policy["quality_tip_ratio_cap_basis_points"]
        suggested_ratio_bps = min(
            cap,
            (suggested_tip_minor * 10_000 + reference_cost_minor // 2)
            // reference_cost_minor,
        )
        quality_ratio_bps = min(
            cap,
            (amount_minor * 10_000 + reference_cost_minor // 2)
            // reference_cost_minor,
        )
        quality_signal_ppm = (
            quality_ratio_bps * 1_000_000 + cap // 2
        ) // cap
        allocations = _allocate_tip_amount(amount_minor, self.tip_policy)
        market_alpha_signal_micros = (
            amount_minor * self.tip_policy["market_alpha_micros_per_minor"]
        )
        occurred_utc = _utc(
            self.now().isoformat(timespec="seconds"),
            "tip occurred_utc",
        )
        economic_view = {
            "amount_minor": amount_minor,
            "currency": currency,
            "payment_reference_hash": payment_reference_hash,
            "shopify_line_item_reference_hash": line_item_reference_hash,
            "reference_cost_minor": reference_cost_minor,
            "suggested_tip_minor": suggested_tip_minor,
            "allocations_minor": allocations,
            "market_alpha_signal_micros": market_alpha_signal_micros,
            "shopify_line_item_kind": "tip",
            "ledger_id": "rapterworks-tips",
            "merchant_of_record": "rappterbox",
            "demand_market_alpha_influence": amount_minor > 0,
            "market_evaluation_influence": market_alpha_signal_micros > 0,
            "third_party_payouts_enabled": False,
            "benefit_free": True,
            "deliverable_conferred": False,
            "evolution_sponsorship_included": False,
            "rating_override_allowed": False,
        }
        quality_view = {
            "tip_ratio_basis_points": quality_ratio_bps,
            "tip_signal_ppm": quality_signal_ppm,
            "ratio_cap_basis_points": cap,
            "raw_amount_used_directly": False,
            "rating_override_allowed": False,
        }
        base = {
            "schema": "rapp-rapterworks-tip-signal/4",
            "kind": "body.pulse",
            "issuer": self.issuer,
            "shopify_line_item_kind": "tip",
            "ledger_id": "rapterworks-tips",
            "merchant_of_record": "rappterbox",
            "job_id": job["job_id"],
            "cohort_id": bounded_text(cohort_id, "cohort_id", 128),
            "account_hash": account_hash,
            "occurred_utc": occurred_utc,
            "tipped": tipped,
            "currency": currency,
            "amount_minor": amount_minor,
            "payment_reference_hash": payment_reference_hash,
            "shopify_line_item_reference_hash": line_item_reference_hash,
            "reference_cost_minor": reference_cost_minor,
            "suggested_tip_minor": suggested_tip_minor,
            "suggested_tip_ratio_basis_points": suggested_ratio_bps,
            "quality_tip_ratio_basis_points": quality_ratio_bps,
            "quality_tip_signal_ppm": quality_signal_ppm,
            "tip_policy_id": self.tip_policy["policy_id"],
            "market_alpha_signal_micros": market_alpha_signal_micros,
            **allocations,
            "raw_economic_view": economic_view,
            "normalized_quality_view": quality_view,
            "third_party_payouts_enabled": False,
            "benefit_free": True,
            "deliverable_conferred": False,
            "evolution_sponsorship_included": False,
            "rating_included": False,
            "rating_incentivized": False,
            "artifact_access_gated": False,
            "debt_created": False,
        }
        event_hash = hashlib.sha256(canonical_json(base)).hexdigest()
        payload = {
            **base,
            "event_id": f"rwt_{event_hash[:32]}",
            "event_hash": event_hash,
        }
        event = {**payload, "signature": self.signer.sign(payload)}
        self.tips[key] = copy.deepcopy(event)
        self.job_operations[job["job_id"]] = key
        if payment_reference_hash is not None:
            self.payment_operations[payment_reference_hash] = key
            self.line_item_operations[line_item_reference_hash] = key
        return copy.deepcopy(event), True

    def cohort(
        self,
        *,
        cohort_id: str,
        currency: str,
        completed_job_count: int,
        window_start_utc: str,
        window_end_utc: str,
    ) -> dict[str, Any]:
        if (
            isinstance(completed_job_count, bool)
            or not isinstance(completed_job_count, int)
            or completed_job_count < 1
            or completed_job_count > MAX_MINOR_AMOUNT
        ):
            raise CreditError("completed_job_count must be positive.")
        cohort_id = bounded_text(cohort_id, "cohort_id", 128)
        currency = _currency_code(currency)
        window_start_utc = _utc(window_start_utc, "window_start_utc")
        window_end_utc = _utc(window_end_utc, "window_end_utc")
        window_start = datetime.fromisoformat(window_start_utc)
        window_end = datetime.fromisoformat(window_end_utc)
        if window_end <= window_start:
            raise CreditError("Tip cohort window end must follow its start.")
        with self._lock:
            lifetime = [
                copy.deepcopy(event)
                for event in self.tips.values()
                if event["currency"] == currency and event["cohort_id"] == cohort_id
            ]
        window = [
            event
            for event in lifetime
            if window_start
            <= datetime.fromisoformat(event["occurred_utc"])
            < window_end
        ]
        if completed_job_count < len(window):
            raise CreditError(
                "completed_job_count cannot be less than recorded window signals.",
            )
        lifetime_tips = [event for event in lifetime if event["tipped"]]
        window_tips = [event for event in window if event["tipped"]]
        amounts = sorted(event["amount_minor"] for event in lifetime_tips)
        lifetime_volume = sum(amounts)
        payer_totals: dict[str, int] = {}
        payer_tip_counts: dict[str, int] = {}
        allocation_totals = {
            f"{name}_amount_minor": 0
            for name, _ in TIP_SPLIT_FIELDS
        }
        for event in lifetime_tips:
            account_hash = event["account_hash"]
            payer_totals[account_hash] = (
                payer_totals.get(account_hash, 0) + event["amount_minor"]
            )
            payer_tip_counts[account_hash] = payer_tip_counts.get(account_hash, 0) + 1
            for allocation_field in allocation_totals:
                allocation_totals[allocation_field] += event[allocation_field]
        if lifetime_volume:
            largest_payer_volume = max(payer_totals.values())
            largest_payer_share_ppm = (
                largest_payer_volume * 1_000_000 + lifetime_volume // 2
            ) // lifetime_volume
            concentration_denominator = lifetime_volume * lifetime_volume
            payer_concentration_hhi_ppm = (
                sum(value * value for value in payer_totals.values()) * 1_000_000
                + concentration_denominator // 2
            ) // concentration_denominator
        else:
            largest_payer_volume = 0
            largest_payer_share_ppm = 0
            payer_concentration_hhi_ppm = 0
        window_seconds = int((window_end - window_start).total_seconds())
        window_volume = sum(event["amount_minor"] for event in window_tips)
        tip_velocity_minor_per_day = (
            window_volume * 86_400 + window_seconds // 2
        ) // window_seconds
        tip_count_velocity_ppm_per_day = (
            len(window_tips) * 1_000_000 * 86_400 + window_seconds // 2
        ) // window_seconds
        tip_rate_ppm = min(
            1_000_000,
            (len(window_tips) * 1_000_000) // completed_job_count,
        )
        raw_economic_view = {
            "lifetime_tip_volume_minor": lifetime_volume,
            "largest_tip_minor": amounts[-1] if amounts else 0,
            "median_tip_minor": _median(amounts),
            "unique_payer_count": len(payer_totals),
            "repeat_tipper_count": sum(
                1 for count in payer_tip_counts.values() if count > 1
            ),
            "largest_payer_volume_minor": largest_payer_volume,
            "largest_payer_share_ppm": largest_payer_share_ppm,
            "payer_concentration_hhi_ppm": payer_concentration_hhi_ppm,
            "window_tip_volume_minor": window_volume,
            "tip_velocity_minor_per_day": tip_velocity_minor_per_day,
            "tip_count_velocity_ppm_per_day": tip_count_velocity_ppm_per_day,
            "allocation_totals_minor": allocation_totals,
            "market_alpha_signal_micros": sum(
                event["market_alpha_signal_micros"] for event in lifetime_tips
            ),
            "demand_market_alpha_influence": lifetime_volume > 0,
            "market_evaluation_influence": lifetime_volume > 0,
            "benefit_free": True,
            "deliverable_conferred": False,
            "evolution_sponsorship_included": False,
            "third_party_payouts_enabled": False,
            "rating_override_allowed": False,
        }
        quality_view = {
            "tip_rate_ppm": tip_rate_ppm,
            "raw_volume_used_directly": False,
            "payer_concentration_used_directly": False,
            "largest_tip_used_directly": False,
        }
        base = {
            "schema": "rapp-rapterworks-tip-cohort/4",
            "kind": "swarm.telemetry",
            "issuer": self.issuer,
            "cohort_id": cohort_id,
            "currency": currency,
            "window_start_utc": window_start_utc,
            "window_end_utc": window_end_utc,
            "completed_job_count": completed_job_count,
            "tip_count": len(window_tips),
            "tip_rate_ppm": tip_rate_ppm,
            **raw_economic_view,
            "raw_economic_view": raw_economic_view,
            "normalized_quality_view": quality_view,
        }
        aggregate_hash = hashlib.sha256(canonical_json(base)).hexdigest()
        payload = {
            **base,
            "aggregate_id": f"rapterworks-tip-cohort:{aggregate_hash}",
            "aggregate_hash": aggregate_hash,
        }
        return {**payload, "signature": self.signer.sign(payload)}

    def patronage(
        self,
        *,
        account_reference: str,
        currency: str,
    ) -> dict[str, Any]:
        account_hash = hash_reference(
            "rapterworks-account",
            bounded_text(account_reference, "account reference", 512),
        )
        currency = _currency_code(currency)
        with self._lock:
            matching = sorted(
                (
                    copy.deepcopy(event)
                    for event in self.tips.values()
                    if event["account_hash"] == account_hash
                    and event["currency"] == currency
                ),
                key=lambda event: (event["occurred_utc"], event["event_id"]),
            )
        history = [
            {
                "event_id": event["event_id"],
                "job_id": event["job_id"],
                "occurred_utc": event["occurred_utc"],
                "tipped": event["tipped"],
                "amount_minor": event["amount_minor"],
                "payment_reference_hash": event["payment_reference_hash"],
                "shopify_line_item_reference_hash": (
                    event["shopify_line_item_reference_hash"]
                ),
                "raw_economic_view": event["raw_economic_view"],
            }
            for event in matching
        ]
        tipped_events = [event for event in matching if event["tipped"]]
        amounts = [event["amount_minor"] for event in tipped_events]
        lifetime_volume = sum(amounts)
        if len(tipped_events) > 1:
            first_tip = datetime.fromisoformat(tipped_events[0]["occurred_utc"])
            last_tip = datetime.fromisoformat(tipped_events[-1]["occurred_utc"])
            velocity_seconds = max(1, int((last_tip - first_tip).total_seconds()))
            velocity = (
                lifetime_volume * 86_400 + velocity_seconds // 2
            ) // velocity_seconds
        else:
            velocity_seconds = 0
            velocity = 0
        allocation_totals = {
            field: sum(event[field] for event in tipped_events)
            for field in (
                f"{name}_amount_minor"
                for name, _ in TIP_SPLIT_FIELDS
            )
        }
        history_hash = hashlib.sha256(canonical_json(history)).hexdigest()
        base = {
            "schema": "rapp-rapterworks-patronage/3",
            "kind": "body.pulse",
            "issuer": self.issuer,
            "account_hash": account_hash,
            "currency": currency,
            "tip_count": len(tipped_events),
            "no_tip_count": len(matching) - len(tipped_events),
            "repeat_tip_count": max(0, len(tipped_events) - 1),
            "repeat_tipping": len(tipped_events) > 1,
            "lifetime_tip_volume_minor": lifetime_volume,
            "largest_tip_minor": max(amounts, default=0),
            "first_tip_utc": (
                tipped_events[0]["occurred_utc"] if tipped_events else None
            ),
            "last_tip_utc": (
                tipped_events[-1]["occurred_utc"] if tipped_events else None
            ),
            "tip_velocity_observation_seconds": velocity_seconds,
            "tip_velocity_minor_per_day": velocity,
            "allocation_totals_minor": allocation_totals,
            "market_alpha_signal_micros": sum(
                event["market_alpha_signal_micros"] for event in tipped_events
            ),
            "history": history,
            "history_hash": history_hash,
            "demand_market_alpha_influence": lifetime_volume > 0,
            "market_evaluation_influence": lifetime_volume > 0,
            "benefit_free": True,
            "deliverable_conferred": False,
            "evolution_sponsorship_included": False,
            "third_party_payouts_enabled": False,
            "rating_override_allowed": False,
        }
        patronage_hash = hashlib.sha256(canonical_json(base)).hexdigest()
        payload = {
            **base,
            "patronage_id": f"rapterworks-patronage:{patronage_hash}",
            "patronage_hash": patronage_hash,
        }
        return {**payload, "signature": self.signer.sign(payload)}


SPONSORSHIP_UNIT_FIELDS = (
    ("mutation_frames", "mutation_frame_cost_minor"),
    ("compute_units", "compute_unit_cost_minor"),
    ("iteration_units", "iteration_unit_cost_minor"),
    ("premium_review_units", "premium_review_cost_minor"),
)


class InMemoryEvolutionSponsorshipLedger:
    def __init__(
        self,
        *,
        issuer: str,
        signer: RegistrySigner,
        verifier: EvolutionSponsorshipVerifier,
        policy: dict[str, Any],
        now: Callable[[], datetime] | None = None,
    ):
        self.issuer = bounded_text(issuer, "issuer", 128)
        self.signer = signer
        self.verifier = verifier
        validated = validate_evolution_sponsorship_policy(policy, signer)
        if validated["issuer"] != self.issuer:
            raise CreditError("Evolution sponsorship policy issuer does not match.")
        self.policy = copy.deepcopy(validated)
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.sponsorships: dict[str, dict[str, Any]] = {}
        self.events: dict[str, list[dict[str, Any]]] = {}
        self.operations: dict[tuple[str, str], dict[str, Any]] = {}
        self.payment_references: set[str] = set()
        self.line_item_references: set[str] = set()
        self.adjustment_references: set[str] = set()
        self._lock = threading.RLock()

    def purchase(
        self,
        *,
        job: dict[str, Any],
        operation_id: str,
        payment_proof: str,
    ) -> tuple[dict[str, Any], bool]:
        with self._lock:
            operation = (
                job["job_id"],
                hash_reference(
                    "rapterworks-evolution-operation",
                    bounded_text(operation_id, "operation_id", 256),
                ),
            )
            if operation in self.operations:
                return copy.deepcopy(self.operations[operation]), False
            if (
                not job.get("artifact_hash")
                or job.get("merchant_of_record") != "rappterbox"
                or job.get("operator") != "rappterbox"
                or job.get("third_party_payouts_enabled") is not False
                or not job.get("output_rights_terms_hash")
            ):
                raise CreditError(
                    "Evolution sponsorship requires a delivered, rights-cleared "
                    "Rapterbox-operated job.",
                )
            payment = self.verifier.verify_purchase(
                bounded_text(payment_proof, "sponsorship payment proof", 2_048),
                job["job_id"],
            )
            if payment.shopify_line_item_kind != "evolution-sponsorship":
                raise CreditError(
                    "Verified payment is not an EVOLUTION SPONSORSHIP line item.",
                )
            account_hash = hash_reference(
                "rapterworks-account",
                bounded_text(payment.account_reference, "account reference", 512),
            )
            if account_hash != job["account_hash"]:
                raise CreditError("Evolution sponsorship account does not match job.")
            currency = _currency_code(payment.currency)
            units = {
                field: getattr(payment, field)
                for field, _ in SPONSORSHIP_UNIT_FIELDS
            }
            for field, amount in units.items():
                if (
                    isinstance(amount, bool)
                    or not isinstance(amount, int)
                    or amount < 0
                    or amount > MAX_MINOR_AMOUNT
                ):
                    raise CreditError(f"{field} is invalid.")
            if not any(units.values()):
                raise CreditError("Evolution sponsorship must purchase service units.")
            expected_subtotal = sum(
                units[field] * self.policy[cost_field]
                for field, cost_field in SPONSORSHIP_UNIT_FIELDS
            )
            if expected_subtotal > MAX_MINOR_AMOUNT:
                raise CreditError("Evolution sponsorship subtotal exceeds storage.")
            for field in ("subtotal_minor", "tax_minor", "total_minor"):
                amount = getattr(payment, field)
                minimum = 0 if field == "tax_minor" else 1
                if (
                    isinstance(amount, bool)
                    or not isinstance(amount, int)
                    or amount < minimum
                    or amount > MAX_MINOR_AMOUNT
                ):
                    raise CreditError(f"Verified sponsorship {field} is invalid.")
            if (
                payment.subtotal_minor != expected_subtotal
                or payment.total_minor != payment.subtotal_minor + payment.tax_minor
            ):
                raise CreditError(
                    "Verified sponsorship amount does not match purchased service units.",
                )
            target = bounded_text(payment.evolution_target, "evolution_target", 32)
            if target not in EVOLUTION_TARGETS:
                raise CreditError("Evolution sponsorship target is invalid.")
            target_hash = validate_sha256(
                payment.evolution_target_reference_hash,
                "evolution_target_reference_hash",
            )
            selected_lens = bounded_text(
                payment.selected_lens,
                "selected_lens",
                64,
            )
            if (
                not selected_lens.isascii()
                or not selected_lens[0].isalnum()
                or any(
                    not (character.isalnum() or character in {"-", "_"})
                    for character in selected_lens
                )
            ):
                raise CreditError("selected_lens must be a safe identifier.")
            payment_hash = hash_reference(
                "rapterworks-evolution-payment",
                bounded_text(payment.payment_reference, "payment reference", 512),
            )
            line_item_hash = hash_reference(
                "rapterworks-evolution-line-item",
                bounded_text(
                    payment.shopify_line_item_reference,
                    "Shopify line item reference",
                    512,
                ),
            )
            if payment_hash in self.payment_references:
                raise CreditError("Evolution sponsorship payment was already recorded.")
            if line_item_hash in self.line_item_references:
                raise CreditError("Evolution sponsorship line item was already recorded.")
            sponsorship_digest = hashlib.sha256(
                f"rapterworks-evolution\0{payment_hash}".encode(),
            ).hexdigest()
            sponsorship_id = f"rwes:{sponsorship_digest}"
            state = {
                "sponsorship_id": sponsorship_id,
                "job_id": job["job_id"],
                "account_hash": account_hash,
                "policy_id": self.policy["policy_id"],
                "shopify_line_item_kind": "evolution-sponsorship",
                "ledger_id": "rapterworks-evolution-sponsorships",
                "merchant_of_record": "rappterbox",
                "operator": "rappterbox",
                "third_party_payouts_enabled": False,
                "payment_reference_hash": payment_hash,
                "shopify_line_item_reference_hash": line_item_hash,
                "currency": currency,
                "subtotal_minor": payment.subtotal_minor,
                "tax_minor": payment.tax_minor,
                "total_minor": payment.total_minor,
                "recognized_revenue_minor": 0,
                "deferred_revenue_liability_minor": payment.subtotal_minor,
                "tax_state": "collected-pending-remittance",
                "refund_state": "eligible",
                "chargeback_state": "none",
                "status": "paid-deferred",
                "evolution_target": target,
                "evolution_target_reference_hash": target_hash,
                "selected_lens": selected_lens,
                "selected_lens_weight_micros": (
                    payment.subtotal_minor
                    * self.policy["selected_lens_weight_micros_per_minor"]
                ),
                "market_alpha_signal_micros": (
                    payment.subtotal_minor
                    * self.policy["market_alpha_micros_per_minor"]
                ),
                "purchased_units": units,
                "delivered_units": {field: 0 for field, _ in SPONSORSHIP_UNIT_FIELDS},
                "outstanding_units": copy.deepcopy(units),
                "cancelled_units": {
                    field: 0 for field, _ in SPONSORSHIP_UNIT_FIELDS
                },
                "output_rights_terms_version": job["output_rights_terms_version"],
                "output_rights_terms_hash": job["output_rights_terms_hash"],
                "canon_acceptance_authority": "rappterbox",
                "canonical_mutation_guaranteed": False,
                "evolution_service_not_equity": True,
                "return_guaranteed": False,
            }
            event = self._append(sponsorship_id, "paid-deferred", state)
            state["sequence"] = event["sequence"]
            state["event_hash"] = event["event_hash"]
            self.sponsorships[sponsorship_id] = state
            self.payment_references.add(payment_hash)
            self.line_item_references.add(line_item_hash)
            self.operations[operation] = copy.deepcopy(event)
            return copy.deepcopy(event), True

    def deliver(
        self,
        *,
        sponsorship_id: str,
        operation_id: str,
        delivery_evidence_hash: str,
        mutation_frames: int,
        compute_units: int,
        iteration_units: int,
        premium_review_units: int,
    ) -> tuple[dict[str, Any], bool]:
        with self._lock:
            state = self._state(sponsorship_id)
            operation = self._operation(sponsorship_id, "deliver", operation_id)
            if operation in self.operations:
                return copy.deepcopy(self.operations[operation]), False
            if state["status"] not in {
                "paid-deferred",
                "partially-delivered-deferred",
            }:
                raise CreditError("Evolution sponsorship cannot accept delivery.")
            next_state = copy.deepcopy(state)
            delivered_now = {
                "mutation_frames": mutation_frames,
                "compute_units": compute_units,
                "iteration_units": iteration_units,
                "premium_review_units": premium_review_units,
            }
            for field, amount in delivered_now.items():
                if (
                    isinstance(amount, bool)
                    or not isinstance(amount, int)
                    or amount < 0
                    or amount > next_state["outstanding_units"][field]
                ):
                    raise CreditError(f"Delivered {field} is invalid.")
            if not any(delivered_now.values()):
                raise CreditError("Evolution delivery must fulfill at least one unit.")
            for field in delivered_now:
                next_state["delivered_units"][field] += delivered_now[field]
                next_state["outstanding_units"][field] -= delivered_now[field]
            fully_delivered = not any(next_state["outstanding_units"].values())
            next_state["recognized_revenue_minor"] = (
                next_state["subtotal_minor"] if fully_delivered else 0
            )
            next_state["deferred_revenue_liability_minor"] = (
                0 if fully_delivered else next_state["subtotal_minor"]
            )
            next_state["status"] = (
                "delivered-recognized"
                if fully_delivered
                else "partially-delivered-deferred"
            )
            next_state["refund_state"] = "post-delivery-policy-review"
            event = self._append(
                sponsorship_id,
                next_state["status"],
                {
                    **next_state,
                    "delivery_evidence_hash": validate_sha256(
                        delivery_evidence_hash,
                        "delivery_evidence_hash",
                    ),
                    "delivered_now": delivered_now,
                },
            )
            next_state["sequence"] = event["sequence"]
            next_state["event_hash"] = event["event_hash"]
            self.sponsorships[sponsorship_id] = next_state
            self.operations[operation] = copy.deepcopy(event)
            return copy.deepcopy(event), True

    def refund(
        self,
        *,
        sponsorship_id: str,
        operation_id: str,
        refund_proof: str,
    ) -> tuple[dict[str, Any], bool]:
        with self._lock:
            state = self._state(sponsorship_id)
            operation = self._operation(sponsorship_id, "refund", operation_id)
            if operation in self.operations:
                return copy.deepcopy(self.operations[operation]), False
            if state["recognized_revenue_minor"] != 0 or state["status"] != "paid-deferred":
                raise CreditError(
                    "Automatic sponsorship refund requires no delivered service.",
                )
            adjustment = self.verifier.verify_refund(
                bounded_text(refund_proof, "refund proof", 2_048),
                sponsorship_id,
            )
            adjustment_hash = self._validate_adjustment(
                state,
                adjustment,
                "refund",
            )
            next_state = copy.deepcopy(state)
            next_state["cancelled_units"] = copy.deepcopy(
                next_state["outstanding_units"],
            )
            next_state["outstanding_units"] = {
                field: 0 for field, _ in SPONSORSHIP_UNIT_FIELDS
            }
            next_state.update({
                "status": "refunded",
                "recognized_revenue_minor": 0,
                "deferred_revenue_liability_minor": 0,
                "tax_state": "refund-adjustment-pending",
                "refund_state": "refunded",
                "refund_reference_hash": adjustment_hash,
            })
            event = self._append(sponsorship_id, "refunded", next_state)
            self.adjustment_references.add(adjustment_hash)
            next_state["sequence"] = event["sequence"]
            next_state["event_hash"] = event["event_hash"]
            self.sponsorships[sponsorship_id] = next_state
            self.operations[operation] = copy.deepcopy(event)
            return copy.deepcopy(event), True

    def chargeback(
        self,
        *,
        sponsorship_id: str,
        operation_id: str,
        chargeback_proof: str,
    ) -> tuple[dict[str, Any], bool]:
        with self._lock:
            state = self._state(sponsorship_id)
            operation = self._operation(sponsorship_id, "chargeback", operation_id)
            if operation in self.operations:
                return copy.deepcopy(self.operations[operation]), False
            if state["status"] in {"refunded", "charged-back"}:
                raise CreditError("Evolution sponsorship is already reversed.")
            adjustment = self.verifier.verify_chargeback(
                bounded_text(chargeback_proof, "chargeback proof", 2_048),
                sponsorship_id,
            )
            adjustment_hash = self._validate_adjustment(
                state,
                adjustment,
                "chargeback",
            )
            recognized_reversal = state["recognized_revenue_minor"]
            next_state = copy.deepcopy(state)
            next_state["cancelled_units"] = copy.deepcopy(
                next_state["outstanding_units"],
            )
            next_state["outstanding_units"] = {
                field: 0 for field, _ in SPONSORSHIP_UNIT_FIELDS
            }
            next_state.update({
                "status": "charged-back",
                "recognized_revenue_minor": 0,
                "deferred_revenue_liability_minor": 0,
                "tax_state": "chargeback-adjustment-pending",
                "refund_state": "chargeback-closed",
                "chargeback_state": "charged-back",
                "chargeback_reference_hash": adjustment_hash,
                "recognized_revenue_reversal_minor": recognized_reversal,
            })
            event = self._append(sponsorship_id, "charged-back", next_state)
            self.adjustment_references.add(adjustment_hash)
            next_state["sequence"] = event["sequence"]
            next_state["event_hash"] = event["event_hash"]
            self.sponsorships[sponsorship_id] = next_state
            self.operations[operation] = copy.deepcopy(event)
            return copy.deepcopy(event), True

    def state(self, sponsorship_id: str) -> dict[str, Any]:
        with self._lock:
            return copy.deepcopy(self._state(sponsorship_id))

    def _state(self, sponsorship_id: str) -> dict[str, Any]:
        state = self.sponsorships.get(sponsorship_id)
        if state is None:
            raise CreditError("Evolution sponsorship does not exist.")
        return state

    def _operation(
        self,
        sponsorship_id: str,
        action: str,
        operation_id: str,
    ) -> tuple[str, str]:
        return (
            sponsorship_id,
            hash_reference(
                "rapterworks-evolution-operation",
                (
                    f"{bounded_text(action, 'action', 64)}\0"
                    f"{bounded_text(operation_id, 'operation_id', 256)}"
                ),
            ),
        )

    def _validate_adjustment(
        self,
        state: dict[str, Any],
        adjustment: VerifiedSponsorshipAdjustment,
        kind: str,
    ) -> str:
        if (
            adjustment.amount_minor != state["total_minor"]
            or _currency_code(adjustment.currency) != state["currency"]
        ):
            raise CreditError(f"Verified sponsorship {kind} amount does not match.")
        reference_hash = hash_reference(
            f"rapterworks-evolution-{kind}",
            bounded_text(adjustment.reference, f"{kind} reference", 512),
        )
        if reference_hash in self.adjustment_references:
            raise CreditError(f"Evolution sponsorship {kind} was already recorded.")
        return reference_hash

    def _append(
        self,
        sponsorship_id: str,
        status: str,
        fields: dict[str, Any],
    ) -> dict[str, Any]:
        history = self.events.setdefault(sponsorship_id, [])
        reserved = {
            "schema",
            "kind",
            "issuer",
            "sponsorship_id",
            "sequence",
            "previous_event_hash",
            "occurred_utc",
            "status",
            "event_id",
            "event_hash",
            "signature",
        }
        base = {
            "schema": "rapp-rapterworks-evolution-sponsorship/1",
            "kind": "body.pulse",
            "issuer": self.issuer,
            "sponsorship_id": sponsorship_id,
            "sequence": len(history),
            "previous_event_hash": (
                history[-1]["event_hash"] if history else None
            ),
            "occurred_utc": _utc(
                self.now().isoformat(timespec="seconds"),
                "sponsorship occurred_utc",
            ),
            "status": status,
            **{
                key: value
                for key, value in fields.items()
                if key not in reserved
            },
        }
        event_hash = hashlib.sha256(canonical_json(base)).hexdigest()
        payload = {
            **base,
            "event_id": f"rwes_{event_hash[:32]}",
            "event_hash": event_hash,
        }
        event = {**payload, "signature": self.signer.sign(payload)}
        history.append(copy.deepcopy(event))
        return event


def bounded_quality_evidence(
    *,
    issuer: str,
    signer: RegistrySigner,
    tip_event: dict[str, Any] | None,
    sponsorship_event: dict[str, Any] | None,
    cohort: dict[str, Any],
    rating: int,
    repeat_count: int,
    completed: bool,
    dispute_count: int,
    cost_ratio_ppm: int,
    tests_passed: int,
    tests_total: int,
) -> dict[str, Any]:
    issuer = bounded_text(issuer, "issuer", 128)
    if isinstance(rating, bool) or not isinstance(rating, int) or not 1 <= rating <= 5:
        raise CreditError("rating must be from 1 to 5.")
    if not isinstance(completed, bool):
        raise CreditError("completed must be a boolean.")
    for value, label, maximum in (
        (repeat_count, "repeat_count", 10),
        (dispute_count, "dispute_count", 10),
        (cost_ratio_ppm, "cost_ratio_ppm", 1_000_000),
    ):
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not 0 <= value <= maximum
        ):
            raise CreditError(f"{label} is invalid.")
    if (
        isinstance(tests_passed, bool)
        or not isinstance(tests_passed, int)
        or isinstance(tests_total, bool)
        or not isinstance(tests_total, int)
        or tests_total < 1
        or tests_passed < 0
        or tests_passed > tests_total
    ):
        raise CreditError("Technical test counts are invalid.")
    if not isinstance(cohort, dict):
        raise CreditError("Tip cohort evidence is invalid.")
    cohort_quality = cohort.get("normalized_quality_view", {})
    if (
        cohort.get("schema") != "rapp-rapterworks-tip-cohort/4"
        or cohort.get("issuer") != issuer
        or not isinstance(cohort_quality, dict)
        or isinstance(cohort_quality.get("tip_rate_ppm"), bool)
        or not isinstance(cohort_quality.get("tip_rate_ppm"), int)
        or not 0 <= cohort_quality["tip_rate_ppm"] <= 1_000_000
    ):
        raise CreditError("Tip cohort evidence is invalid.")
    cohort_payload = {
        key: value
        for key, value in cohort.items()
        if key != "signature"
    }
    if not signer.verify(cohort_payload, cohort.get("signature")):
        raise CreditError("Tip cohort signature is invalid.")
    for field in (
        "payer_concentration_hhi_ppm",
        "lifetime_tip_volume_minor",
        "largest_tip_minor",
        "tip_velocity_minor_per_day",
    ):
        value = cohort.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise CreditError("Tip cohort economic evidence is invalid.")
    bounded_text(cohort.get("aggregate_id"), "tip cohort aggregate_id", 256)
    if tip_event is None:
        tip_present = False
        tip_component_ppm = 0
        patronage_weighted_view = {
            "tip_present": False,
            "raw_tip_amount_minor": 0,
            "currency": None,
            "tip_market_alpha_signal_micros": 0,
            "normalized_tip_component_ppm": 0,
        }
    else:
        if not isinstance(tip_event, dict):
            raise CreditError("Tip event evidence is invalid.")
        quality_view = tip_event.get("normalized_quality_view", {})
        if (
            tip_event.get("schema") != "rapp-rapterworks-tip-signal/4"
            or tip_event.get("issuer") != issuer
            or tip_event.get("shopify_line_item_kind") != "tip"
            or tip_event.get("benefit_free") is not True
            or tip_event.get("deliverable_conferred") is not False
            or tip_event.get("evolution_sponsorship_included") is not False
            or not isinstance(tip_event.get("tipped"), bool)
            or not isinstance(quality_view, dict)
            or isinstance(quality_view.get("tip_signal_ppm"), bool)
            or not isinstance(quality_view.get("tip_signal_ppm"), int)
            or not 0 <= quality_view["tip_signal_ppm"] <= 1_000_000
            or quality_view.get("raw_amount_used_directly") is not False
        ):
            raise CreditError("Tip event evidence is invalid.")
        tip_payload = {
            key: value
            for key, value in tip_event.items()
            if key != "signature"
        }
        if not signer.verify(tip_payload, tip_event.get("signature")):
            raise CreditError("Tip event signature is invalid.")
        for field in (
            "amount_minor",
            "market_alpha_signal_micros",
        ):
            value = tip_event.get(field)
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise CreditError("Tip event economic evidence is invalid.")
        tip_present = tip_event["tipped"]
        tip_component_ppm = quality_view["tip_signal_ppm"]
        patronage_weighted_view = {
            "tip_present": tip_present,
            "raw_tip_amount_minor": tip_event["amount_minor"],
            "currency": tip_event["currency"],
            "tip_market_alpha_signal_micros": (
                tip_event["market_alpha_signal_micros"]
            ),
            "normalized_tip_component_ppm": tip_component_ppm,
        }
    if sponsorship_event is None:
        sponsorship_view = {
            "sponsorship_present": False,
            "subtotal_minor": 0,
            "tax_minor": 0,
            "currency": None,
            "evolution_target": None,
            "evolution_target_reference_hash": None,
            "selected_lens": None,
            "selected_lens_weight_micros": 0,
            "market_alpha_signal_micros": 0,
            "purchased_units": {
                field: 0 for field, _ in SPONSORSHIP_UNIT_FIELDS
            },
            "delivered_units": {
                field: 0 for field, _ in SPONSORSHIP_UNIT_FIELDS
            },
            "outstanding_units": {
                field: 0 for field, _ in SPONSORSHIP_UNIT_FIELDS
            },
            "cancelled_units": {
                field: 0 for field, _ in SPONSORSHIP_UNIT_FIELDS
            },
            "deferred_revenue_liability_minor": 0,
            "recognized_revenue_minor": 0,
            "tax_state": None,
            "refund_state": None,
            "chargeback_state": None,
        }
    else:
        if (
            not isinstance(sponsorship_event, dict)
            or sponsorship_event.get("schema")
            != "rapp-rapterworks-evolution-sponsorship/1"
            or sponsorship_event.get("issuer") != issuer
            or sponsorship_event.get("shopify_line_item_kind")
            != "evolution-sponsorship"
            or sponsorship_event.get("merchant_of_record") != "rappterbox"
            or sponsorship_event.get("third_party_payouts_enabled") is not False
        ):
            raise CreditError("Evolution sponsorship evidence is invalid.")
        sponsorship_payload = {
            key: value
            for key, value in sponsorship_event.items()
            if key != "signature"
        }
        if not signer.verify(
            sponsorship_payload,
            sponsorship_event.get("signature"),
        ):
            raise CreditError("Evolution sponsorship signature is invalid.")
        sponsorship_view = {
            "sponsorship_present": True,
            "subtotal_minor": sponsorship_event["subtotal_minor"],
            "tax_minor": sponsorship_event["tax_minor"],
            "currency": sponsorship_event["currency"],
            "evolution_target": sponsorship_event["evolution_target"],
            "evolution_target_reference_hash": (
                sponsorship_event["evolution_target_reference_hash"]
            ),
            "selected_lens": sponsorship_event["selected_lens"],
            "selected_lens_weight_micros": (
                sponsorship_event["selected_lens_weight_micros"]
            ),
            "market_alpha_signal_micros": (
                sponsorship_event["market_alpha_signal_micros"]
            ),
            "purchased_units": sponsorship_event["purchased_units"],
            "delivered_units": sponsorship_event["delivered_units"],
            "outstanding_units": sponsorship_event["outstanding_units"],
            "cancelled_units": sponsorship_event["cancelled_units"],
            "deferred_revenue_liability_minor": (
                sponsorship_event["deferred_revenue_liability_minor"]
            ),
            "recognized_revenue_minor": (
                sponsorship_event["recognized_revenue_minor"]
            ),
            "tax_state": sponsorship_event["tax_state"],
            "refund_state": sponsorship_event["refund_state"],
            "chargeback_state": sponsorship_event["chargeback_state"],
        }
    technical_score_ppm = (tests_passed * 1_000_000) // tests_total
    unweighted_technical_view = {
        "tests_passed": tests_passed,
        "tests_total": tests_total,
        "technical_test_score_ppm": technical_score_ppm,
        "patronage_inputs_used": False,
        "tip_amount_used": False,
        "payer_concentration_used": False,
        "market_alpha_used": False,
    }
    base = {
        "schema": "rapp-rapterworks-quality-evidence/4",
        "kind": "swarm.telemetry",
        "issuer": issuer,
        "tip_event_id": tip_event["event_id"] if tip_event else None,
        "sponsorship_event_id": (
            sponsorship_event["event_id"] if sponsorship_event else None
        ),
        "tip_cohort_aggregate_id": cohort["aggregate_id"],
        "unweighted_technical_test_score_ppm": technical_score_ppm,
        "unweighted_technical_view": unweighted_technical_view,
        "patronage_weighted_view": patronage_weighted_view,
        "evolution_sponsorship_view": sponsorship_view,
        "tip_and_sponsorship_separate_line_items": True,
        "tip_conferred_deliverable": False,
        "rating_ppm": rating * 200_000,
        "repeat_signal_ppm": repeat_count * 100_000,
        "completion_signal_ppm": 1_000_000 if completed else 0,
        "dispute_signal_ppm": dispute_count * 100_000,
        "cost_ratio_ppm": cost_ratio_ppm,
        "tip_present": tip_present,
        "normalized_tip_component_ppm": tip_component_ppm,
        "cohort_tip_rate_ppm": cohort_quality["tip_rate_ppm"],
        "money_influence_disclosed": True,
        "raw_tip_amount_used_in_unweighted_technical_score": False,
        "raw_tip_amount_used_in_patronage_weighted_view": tip_present,
        "payer_concentration_disclosed": cohort["payer_concentration_hhi_ppm"],
        "lifetime_volume_disclosed_minor": cohort["lifetime_tip_volume_minor"],
        "largest_tip_disclosed_minor": cohort["largest_tip_minor"],
        "tip_velocity_disclosed_minor_per_day": (
            cohort["tip_velocity_minor_per_day"]
        ),
        "rating_overridden_by_tip": False,
        "money_influenced_fields": [
            "demand-market-alpha",
            "patronage-history",
            "selected-lens-weight",
            "mutation-frame-count",
            "compute-units",
            "iteration-priority",
            "premium-review",
            "species-candidate-work",
            "rapterbox-merchant-receipts",
        ],
        "tip_influenced_fields": [
            "demand-market-alpha",
            "patronage-history",
        ],
        "sponsorship_purchased_fields": [
            "selected-lens-weight",
            "mutation-frame-count",
            "compute-units",
            "iteration-priority",
            "premium-review",
            "species-candidate-work",
        ],
        "money_did_not_influence": [
            "unweighted-technical-test-score",
            "recorded-rating",
            "history",
            "rappterbox-canon-acceptance",
        ],
        "canon_acceptance_authority": "rappterbox",
        "canonical_mutation_guaranteed": False,
        "evolution_service_not_equity": True,
        "return_guaranteed": False,
    }
    report_hash = hashlib.sha256(canonical_json(base)).hexdigest()
    payload = {
        **base,
        "report_id": f"rapterworks-quality:{report_hash}",
        "report_hash": report_hash,
    }
    return {**payload, "signature": signer.sign(payload)}
