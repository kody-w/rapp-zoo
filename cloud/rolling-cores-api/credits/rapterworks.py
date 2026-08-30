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
        now: Callable[[], datetime] | None = None,
        regression_rating_threshold: int = 2,
    ):
        self.issuer = issuer
        self.signer = signer
        self.dogg_verifier = dogg_verifier
        self.commission_adapter = commission_adapter
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
    ) -> tuple[dict[str, Any], bool]:
        operation = self._operation("request", operation_id)
        if operation in self.operations:
            return self.operations[operation][0], False
        account_hash = hash_reference(
            "rapterworks-account",
            bounded_text(account_reference, "account reference", 512),
        )
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
