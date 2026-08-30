import hashlib
import json
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Protocol

from azure.core import MatchConditions
from azure.core.exceptions import HttpResponseError, ResourceExistsError, ResourceNotFoundError
from azure.data.tables import UpdateMode

from .domain import (
    CreditConflict,
    CreditError,
    CreditNotFound,
    PurchaseVerificationUnavailable,
    bounded_text,
    canonical_json,
    hash_reference,
    validate_credit_id,
    validate_organism_rappid,
    validate_sha256,
)
from .lifecycle import INVENTORY_OWNER_HASH
from .generations import (
    ORIGINAL_COUNT,
    companion_source_original_for_account,
)
from .repository import PARTITION, CreditRepository
from .signing import RegistrySigner


COMPANION_SCHEMA = "rapp-rapter-companion-grant/2"
LEASE_START_SCHEMA = "rapp-rapter-credit-lease-start/1"
LEASE_RENEW_SCHEMA = "rapp-rapter-credit-lease-renew/1"
LEASE_CANCEL_SCHEMA = "rapp-rapter-credit-lease-cancel/1"
LEASE_EXPIRE_SCHEMA = "rapp-rapter-credit-lease-expire/1"
LEASE_REFUND_SCHEMA = "rapp-rapter-credit-lease-refund/1"
PURCHASE_CONVERSION_SCHEMA = "rapp-rapter-credit-purchase-conversion/1"
LEASE_TRANSFER_SCHEMA = "rapp-rapter-credit-transfer/1"
BILLING_TYPES = {
    "lease-start",
    "lease-renew",
    "lease-cancel",
    "lease-expire",
    "lease-refund",
    "subscription-recovered",
    "purchase-conversion",
}
CAPSULE_ACCESS_KEYS = {"credit_id", "organism_rappid", "core_manifest_hash"}


class AccountAuthorizationRequired(CreditError):
    code = "verified_account_authorization_required"
    status_code = 403


@dataclass(frozen=True)
class AccountClaims:
    account_reference: str


@dataclass(frozen=True)
class BillingEvent:
    event_id: str
    event_type: str
    credit_id: str
    account_reference: str
    product_id: str
    period_end_utc: str | None
    grace_until_utc: str | None
    transaction_reference: str
    purchase_price_sats: int | None = None


class AccountTokenVerifier(Protocol):
    configured: bool

    def verify(self, token: str) -> AccountClaims:
        ...


class BillingWebhookVerifier(Protocol):
    configured: bool

    def verify(self, payload: bytes, headers: dict[str, str]) -> BillingEvent:
        ...


class SubscriptionRecoveryAdapter(Protocol):
    configured: bool

    def recover(self, claims: AccountClaims, proof: str) -> list[BillingEvent]:
        ...


class DisabledAccountTokenVerifier:
    configured = False

    def verify(self, token: str) -> AccountClaims:
        del token
        raise PurchaseVerificationUnavailable(
            "Verified account token handling is not configured.",
        )


class DisabledBillingWebhookVerifier:
    configured = False

    def verify(self, payload: bytes, headers: dict[str, str]) -> BillingEvent:
        del payload, headers
        raise PurchaseVerificationUnavailable(
            "Billing webhook verification is not configured.",
        )


class DisabledSubscriptionRecoveryAdapter:
    configured = False

    def recover(self, claims: AccountClaims, proof: str) -> list[BillingEvent]:
        del claims, proof
        raise PurchaseVerificationUnavailable(
            "Subscription recovery is not configured.",
        )


def _utc(value: str | None, label: str) -> datetime | None:
    if value is None:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError) as error:
        raise CreditError(f"{label} is invalid.") from error
    if parsed.tzinfo is None:
        raise CreditError(f"{label} must include a timezone.")
    return parsed.astimezone(timezone.utc)


def _account_hash(reference: str) -> str:
    return hash_reference("account", bounded_text(reference, "account reference", 512))


def _event(
    *,
    schema: str,
    issuer: str,
    subject_id: str,
    event_seq: int,
    parent_event_id: str | None,
    occurred_utc: str,
    fields: dict[str, Any],
    signer: RegistrySigner,
) -> dict[str, Any]:
    base = {
        "schema": schema,
        "kind": "body.pulse",
        "issuer": issuer,
        "subject_id": subject_id,
        "event_seq": event_seq,
        "parent_event_id": parent_event_id,
        "occurred_utc": occurred_utc,
        **fields,
    }
    event_hash = hashlib.sha256(canonical_json(base)).hexdigest()
    payload = {
        **base,
        "event_id": f"rse_{event_hash[:32]}",
        "event_hash": event_hash,
    }
    return {**payload, "signature": signer.sign(payload)}


class SubscriptionRepository(Protocol):
    def grant_companion(
        self,
        account_hash: str,
        entitlement: dict[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        ...

    def get_companion(self, account_hash: str) -> dict[str, Any] | None:
        ...

    def apply_billing(
        self,
        *,
        billing_hash: str,
        credit_id: str,
        build: Callable[
            [dict[str, Any], dict[str, Any] | None],
            tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any] | None],
        ],
    ) -> tuple[list[dict[str, Any]], bool]:
        ...

    def get_lease(self, credit_id: str) -> dict[str, Any] | None:
        ...

    def list_lease_events(
        self,
        credit_id: str,
        after: int,
        limit: int,
    ) -> list[dict[str, Any]]:
        ...


class InMemorySubscriptionRepository:
    def __init__(self, credits: CreditRepository):
        self.credits = credits
        self.lock = threading.Lock()
        self.companions: dict[str, dict[str, Any]] = {}
        self.leases: dict[str, dict[str, Any]] = {}
        self.events: dict[str, list[dict[str, Any]]] = {}
        self.billing: dict[str, list[dict[str, Any]]] = {}

    def grant_companion(
        self,
        account_hash: str,
        entitlement: dict[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        with self.lock:
            if account_hash in self.companions:
                return self.companions[account_hash], False
            self.companions[account_hash] = entitlement
            return entitlement, True

    def get_companion(self, account_hash: str) -> dict[str, Any] | None:
        return self.companions.get(account_hash)

    def apply_billing(
        self,
        *,
        billing_hash: str,
        credit_id: str,
        build: Callable[
            [dict[str, Any], dict[str, Any] | None],
            tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any] | None],
        ],
    ) -> tuple[list[dict[str, Any]], bool]:
        with self.lock:
            if billing_hash in self.billing:
                return self.billing[billing_hash], False
            ownership = self.credits.get_ownership(credit_id)
            lease = self.leases.get(credit_id)
            events, lease_update, ownership_update = build(
                dict(ownership),
                dict(lease) if lease else None,
            )
            expected_seq = int(lease["event_seq"]) + 1 if lease else 1
            if not events or any(
                event.get("event_seq") != expected_seq + index
                for index, event in enumerate(events)
            ):
                raise CreditError("Lease event sequence is invalid.")
            self.leases[credit_id] = lease_update
            if ownership_update is not None:
                self.credits.ownership[credit_id] = ownership_update
            self.events.setdefault(credit_id, []).extend(events)
            self.billing[billing_hash] = events
            return events, True

    def get_lease(self, credit_id: str) -> dict[str, Any] | None:
        lease = self.leases.get(credit_id)
        return dict(lease) if lease else None

    def list_lease_events(
        self,
        credit_id: str,
        after: int,
        limit: int,
    ) -> list[dict[str, Any]]:
        return list(self.events.get(credit_id, []))[after:after + limit]


class AzureTableSubscriptionRepository:
    def __init__(self, table, credits: CreditRepository):
        self.table = table
        self.credits = credits

    @staticmethod
    def _companion_row(account_hash: str) -> str:
        return f"companion-account:{account_hash}"

    @staticmethod
    def _lease_row(credit_id: str) -> str:
        return f"lease:{credit_id}"

    @staticmethod
    def _event_row(event_id: str) -> str:
        return f"subscription-event:{event_id}"

    @staticmethod
    def _history_row(credit_id: str, event_seq: int) -> str:
        return f"lease-history:{credit_id}:{event_seq:012d}"

    @staticmethod
    def _billing_row(billing_hash: str) -> str:
        return f"billing:{billing_hash}"

    def _optional(self, row_key: str):
        try:
            return self.table.get_entity(PARTITION, row_key)
        except ResourceNotFoundError:
            return None

    def grant_companion(
        self,
        account_hash: str,
        entitlement: dict[str, Any],
    ) -> tuple[dict[str, Any], bool]:
        row = self._companion_row(account_hash)
        existing = self._optional(row)
        if existing is not None:
            return json.loads(existing["record_json"]), False
        operations = [
            ("create", {
                "PartitionKey": PARTITION,
                "RowKey": row,
                "account_hash": account_hash,
                "entitlement_id": entitlement["entitlement_id"],
                "record_json": json.dumps(entitlement, separators=(",", ":"), sort_keys=True),
            }),
            ("create", {
                "PartitionKey": PARTITION,
                "RowKey": self._event_row(entitlement["event_id"]),
                "subject_id": entitlement["entitlement_id"],
                "record_json": json.dumps(entitlement, separators=(",", ":"), sort_keys=True),
            }),
        ]
        try:
            self.table.submit_transaction(operations)
            return entitlement, True
        except HttpResponseError as error:
            existing = self._optional(row)
            if existing is not None:
                return json.loads(existing["record_json"]), False
            raise CreditConflict("Free Companion entitlement already exists.") from error

    def get_companion(self, account_hash: str) -> dict[str, Any] | None:
        entity = self._optional(self._companion_row(account_hash))
        return json.loads(entity["record_json"]) if entity else None

    def _billing_events(self, billing_hash: str) -> list[dict[str, Any]] | None:
        billing = self._optional(self._billing_row(billing_hash))
        if billing is None:
            return None
        return [
            json.loads(
                self.table.get_entity(
                    PARTITION,
                    self._event_row(event_id),
                )["record_json"],
            )
            for event_id in json.loads(billing["event_ids_json"])
        ]

    def apply_billing(
        self,
        *,
        billing_hash: str,
        credit_id: str,
        build: Callable[
            [dict[str, Any], dict[str, Any] | None],
            tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any] | None],
        ],
    ) -> tuple[list[dict[str, Any]], bool]:
        existing = self._billing_events(billing_hash)
        if existing is not None:
            return existing, False
        for _ in range(6):
            ownership = self.credits.get_ownership(credit_id)
            lease = self._optional(self._lease_row(credit_id))
            events, lease_update, ownership_update = build(
                dict(ownership),
                dict(lease) if lease else None,
            )
            expected_seq = int(lease["event_seq"]) + 1 if lease else 1
            if not events or any(
                event.get("event_seq") != expected_seq + index
                for index, event in enumerate(events)
            ):
                raise CreditError("Lease event sequence is invalid.")
            ownership_etag = getattr(ownership, "metadata", {}).get("etag")
            if not ownership_etag:
                raise CreditError("Ownership head did not provide an ETag.")
            operations: list[tuple[Any, ...]] = [
                (
                    "update",
                    {
                        "PartitionKey": PARTITION,
                        "RowKey": f"ownership:{credit_id}",
                        **(ownership_update or dict(ownership)),
                    },
                    {
                        "mode": UpdateMode.REPLACE,
                        "etag": ownership_etag,
                        "match_condition": MatchConditions.IfNotModified,
                    },
                ),
            ]
            lease_entity = {
                "PartitionKey": PARTITION,
                "RowKey": self._lease_row(credit_id),
                **lease_update,
            }
            if lease is None:
                operations.append(("create", lease_entity))
            else:
                lease_etag = getattr(lease, "metadata", {}).get("etag")
                if not lease_etag:
                    raise CreditError("Lease head did not provide an ETag.")
                operations.append((
                    "update",
                    lease_entity,
                    {
                        "mode": UpdateMode.REPLACE,
                        "etag": lease_etag,
                        "match_condition": MatchConditions.IfNotModified,
                    },
                ))
            for event in events:
                encoded = json.dumps(event, separators=(",", ":"), sort_keys=True)
                operations.extend([
                    ("create", {
                        "PartitionKey": PARTITION,
                        "RowKey": self._event_row(event["event_id"]),
                        "subject_id": credit_id,
                        "record_json": encoded,
                    }),
                    ("create", {
                        "PartitionKey": PARTITION,
                        "RowKey": self._history_row(credit_id, event["event_seq"]),
                        "subject_id": credit_id,
                        "record_json": encoded,
                    }),
                ])
            operations.append(("create", {
                "PartitionKey": PARTITION,
                "RowKey": self._billing_row(billing_hash),
                "credit_id": credit_id,
                "event_ids_json": json.dumps([event["event_id"] for event in events]),
            }))
            try:
                self.table.submit_transaction(operations)
                return events, True
            except HttpResponseError as error:
                existing = self._billing_events(billing_hash)
                if existing is not None:
                    return existing, False
                if getattr(error, "status_code", None) == 409:
                    raise CreditConflict("Lease is already assigned.") from error
                if getattr(error, "status_code", None) != 412:
                    raise
        raise CreditConflict("Lease state remained busy after bounded retries.")

    def get_lease(self, credit_id: str) -> dict[str, Any] | None:
        lease = self._optional(self._lease_row(credit_id))
        return dict(lease) if lease else None

    def list_lease_events(
        self,
        credit_id: str,
        after: int,
        limit: int,
    ) -> list[dict[str, Any]]:
        prefix = f"lease-history:{credit_id}:"
        entities = self.table.query_entities(
            query_filter=(
                "PartitionKey eq @partition and RowKey ge @start and RowKey lt @end"
            ),
            parameters={
                "partition": PARTITION,
                "start": f"{prefix}{after + 1:012d}",
                "end": f"{prefix};",
            },
            results_per_page=limit,
        )
        events = []
        for entity in entities:
            events.append(json.loads(entity["record_json"]))
            if len(events) >= limit:
                break
        return events


class SubscriptionService:
    def __init__(
        self,
        *,
        issuer: str,
        credits: CreditRepository,
        repository: SubscriptionRepository,
        signer: RegistrySigner,
        account_verifier: AccountTokenVerifier,
        webhook_verifier: BillingWebhookVerifier,
        recovery_adapter: SubscriptionRecoveryAdapter,
        verify_credit: Callable[[dict[str, Any]], bool],
        now: Callable[[], datetime] | None = None,
    ):
        self.issuer = issuer
        self.credits = credits
        self.repository = repository
        self.signer = signer
        self.account_verifier = account_verifier
        self.webhook_verifier = webhook_verifier
        self.recovery_adapter = recovery_adapter
        self.verify_credit = verify_credit
        self.now = now or (lambda: datetime.now(timezone.utc))

    def service_status(self) -> dict[str, Any]:
        return {
            "schema": "rappter-subscription-service-status/2",
            "free_companions_per_verified_account": 1,
            "canonical_originals": ORIGINAL_COUNT,
            "original_edition": "first-edition",
            "original_dimension": "first-dimension",
            "issuer_held_originals_at_publication": ORIGINAL_COUNT,
            "transferred_originals_at_publication": 0,
            "undiscovered_originals_at_publication": ORIGINAL_COUNT,
            "free_companion_identity": "separately-issued-offspring",
            "free_companion_transferable": False,
            "free_companion_resellable": False,
            "free_companion_uses_original_supply": False,
            "original_title_transfer_requires_rights_and_commerce": True,
            "offspring_distinct_rappid_and_rights": True,
            "exclusive_active_lessee": True,
            "original_title_owner_at_publication": "rappterbox",
            "expired_local_copy_status": "unowned-stale-lease-copy",
            "account_verifier_configured": self.account_verifier.configured,
            "billing_webhook_configured": self.webhook_verifier.configured,
            "subscription_recovery_configured": self.recovery_adapter.configured,
            "ownership_requires_subscription": False,
        }

    def claim_companion(self, token: str | None) -> tuple[dict[str, Any], bool]:
        claims = self._claims(token)
        account_hash = _account_hash(claims.account_reference)
        source_original_id = companion_source_original_for_account(account_hash)
        entitlement_id = "companion:" + hashlib.sha256(
            f"free-companion\0{account_hash}".encode(),
        ).hexdigest()
        offspring_digest = hashlib.sha256(
            f"free-companion-offspring\0{account_hash}\0{source_original_id}".encode(),
        ).hexdigest()
        payload = {
            "schema": COMPANION_SCHEMA,
            "kind": "body.pulse",
            "issuer": self.issuer,
            "event_id": "",
            "event_hash": "",
            "event_seq": 0,
            "parent_event_id": None,
            "occurred_utc": self.now().isoformat(timespec="seconds"),
            "entitlement_id": entitlement_id,
            "source_original_id": source_original_id,
            "generation_id": "generation-0001",
            "offspring_rappid": (
                f"rappid:@companion-{account_hash[:12]}/"
                f"{source_original_id}:{offspring_digest}"
            ),
            "rights_id": f"offspring-rights:{offspring_digest}",
            "rights_profile": "account-bound-companion-offspring",
            "account_hash": account_hash,
            "state": "active",
            "transferable": False,
            "resellable": False,
            "original_title_transferred": False,
            "uses_original_supply": False,
            "supply_rule": "one-active-free-offspring-companion-per-account",
        }
        event_hash = hashlib.sha256(canonical_json({
            key: item
            for key, item in payload.items()
            if key not in {"event_id", "event_hash"}
        })).hexdigest()
        payload["event_id"] = f"rse_{event_hash[:32]}"
        payload["event_hash"] = event_hash
        event = {**payload, "signature": self.signer.sign(payload)}
        return self.repository.grant_companion(account_hash, event)

    def entitlement_status(
        self,
        token: str | None,
        credit_id_value: Any = None,
    ) -> dict[str, Any]:
        claims = self._claims(token)
        account_hash = _account_hash(claims.account_reference)
        companion = self.repository.get_companion(account_hash)
        lease = None
        if credit_id_value:
            credit_id = validate_credit_id(credit_id_value)
            lease = self.repository.get_lease(credit_id)
            if lease and lease.get("lessee_account_hash") != account_hash:
                lease = None
        return {
            "schema": "rappter-entitlement-status/1",
            "account_hash": account_hash,
            "free_companion": companion,
            "premium_lease": self._lease_status(lease),
            "ownership_requires_subscription": False,
        }

    def public_events(
        self,
        credit_id_value: Any,
        after_value: Any,
        limit_value: Any,
    ) -> dict[str, Any]:
        credit_id = validate_credit_id(credit_id_value)
        try:
            after = int(after_value or 0)
            limit = int(limit_value or 50)
        except (TypeError, ValueError) as error:
            raise CreditError("Subscription event pagination is invalid.") from error
        if after < 0 or limit < 1 or limit > 100:
            raise CreditError("Subscription event pagination is invalid.")
        events = self.repository.list_lease_events(credit_id, after, limit)
        return {
            "object": "list",
            "credit_id": credit_id,
            "data": events,
            "next_after": events[-1]["event_seq"] if events else after,
        }

    def capsule_access(
        self,
        token: str | None,
        request: Any,
    ) -> dict[str, Any]:
        if not isinstance(request, dict) or set(request) != CAPSULE_ACCESS_KEYS:
            raise CreditError("Lease Capsule access request has an invalid shape.")
        claims = self._claims(token)
        account_hash = _account_hash(claims.account_reference)
        credit_id = validate_credit_id(request["credit_id"])
        organism_rappid = validate_organism_rappid(request["organism_rappid"])
        manifest_hash = validate_sha256(
            request["core_manifest_hash"],
            "core_manifest_hash",
        )
        credit = self.credits.get_credit(credit_id)
        if (
            not self.verify_credit(credit)
            or credit["organism_rappid"] != organism_rappid
            or credit["core_manifest_hash"] != manifest_hash
        ):
            raise CreditConflict("Lease Capsule binding does not match the official credit.")
        lease = self.repository.get_lease(credit_id)
        status = self._lease_status(lease)
        if (
            status is None
            or status["lessee_account_hash"] != account_hash
            or status["capsule_access"] != "allowed"
        ):
            raise CreditConflict("No active scoped lease authorizes this Capsule.")
        access_until = _utc(
            status.get("grace_until_utc") or status.get("period_end_utc"),
            "lease access end",
        )
        expires = min(self.now() + timedelta(minutes=5), access_until)
        payload = {
            "schema": "rapp-rapter-lease-capsule-access/1",
            "kind": "body.pulse",
            "issuer": self.issuer,
            "credit_id": credit_id,
            "lease_id": status["lease_id"],
            "lessee_account_hash": account_hash,
            "organism_rappid": organism_rappid,
            "core_manifest_hash": manifest_hash,
            "issued_utc": self.now().isoformat(timespec="seconds"),
            "expires_utc": expires.isoformat(timespec="seconds"),
            "access": ["download", "decrypt"],
        }
        return {**payload, "signature": self.signer.sign(payload)}

    def process_webhook(
        self,
        payload: bytes,
        headers: dict[str, str],
    ) -> tuple[list[dict[str, Any]], bool]:
        event = self.webhook_verifier.verify(payload, headers)
        return self.apply_billing_event(event)

    def recover(
        self,
        token: str | None,
        proof: Any,
    ) -> list[dict[str, Any]]:
        claims = self._claims(token)
        recovery_proof = bounded_text(proof, "recovery proof", 50_000)
        results = []
        for event in self.recovery_adapter.recover(claims, recovery_proof):
            normalized = BillingEvent(
                **{
                    **event.__dict__,
                    "event_type": (
                        "subscription-recovered"
                        if event.event_type in {"lease-start", "lease-renew"}
                        else event.event_type
                    ),
                },
            )
            records, created = self.apply_billing_event(normalized)
            results.append({"created": created, "events": records})
        return results

    def sync_expiry(
        self,
        token: str | None,
        credit_id_value: Any,
    ) -> tuple[list[dict[str, Any]], bool]:
        claims = self._claims(token)
        credit_id = validate_credit_id(credit_id_value)
        account_hash = _account_hash(claims.account_reference)
        lease = self.repository.get_lease(credit_id)
        if lease is None or lease.get("lessee_account_hash") != account_hash:
            raise CreditConflict("No matching active lease exists.")
        access_until = _utc(lease.get("grace_until_utc") or lease.get("period_end_utc"), "lease end")
        if access_until is None or self.now() < access_until:
            return [], False
        event = BillingEvent(
            event_id=f"local-expiry:{lease['lease_id']}:{access_until.isoformat()}",
            event_type="lease-expire",
            credit_id=credit_id,
            account_reference=claims.account_reference,
            product_id=lease["product_id"],
            period_end_utc=lease["period_end_utc"],
            grace_until_utc=lease.get("grace_until_utc"),
            transaction_reference=f"expiry:{lease['lease_id']}",
        )
        return self.apply_billing_event(event)

    def apply_billing_event(
        self,
        event: BillingEvent,
    ) -> tuple[list[dict[str, Any]], bool]:
        normalized = self._normalize_billing_event(event)
        billing_hash = hash_reference("billing-event", normalized.event_id)
        account_hash = _account_hash(normalized.account_reference)
        occurred_utc = self.now().isoformat(timespec="seconds")
        credit = self.credits.get_credit(normalized.credit_id)
        if not self.verify_credit(credit):
            raise CreditError("Lease target is not an official valid credit.")

        def build(ownership, lease):
            return self._build_billing_transition(
                normalized,
                billing_hash,
                account_hash,
                occurred_utc,
                credit,
                ownership,
                lease,
            )

        return self.repository.apply_billing(
            billing_hash=billing_hash,
            credit_id=normalized.credit_id,
            build=build,
        )

    def _build_billing_transition(
        self,
        event: BillingEvent,
        billing_hash: str,
        account_hash: str,
        occurred_utc: str,
        credit: dict[str, Any],
        ownership: dict[str, Any],
        lease: dict[str, Any] | None,
    ):
        if event.event_type == "lease-start":
            if ownership["state"] != "rappterbox-inventory":
                raise CreditConflict("Owned or sold Rapters cannot be leased.")
            if lease and lease["state"] in {"active", "grace"}:
                raise CreditConflict("Rapter already has an active lessee.")
            period_end = _utc(event.period_end_utc, "period_end_utc")
            if period_end is None or period_end <= self.now():
                raise CreditError("Lease start must have a future period end.")
            seq = int(lease["event_seq"]) + 1 if lease else 1
            parent = lease["current_event_id"] if lease else None
            lease_id = "lease:" + hashlib.sha256(
                f"{event.credit_id}\0{account_hash}\0{billing_hash}".encode(),
            ).hexdigest()
            record = _event(
                schema=LEASE_START_SCHEMA,
                issuer=self.issuer,
                subject_id=event.credit_id,
                event_seq=seq,
                parent_event_id=parent,
                occurred_utc=occurred_utc,
                fields={
                    "lease_id": lease_id,
                    "lessee_account_hash": account_hash,
                    "product_id": event.product_id,
                    "period_end_utc": event.period_end_utc,
                    "grace_until_utc": event.grace_until_utc,
                    "billing_event_hash": billing_hash,
                    "title_owner_hash": INVENTORY_OWNER_HASH,
                },
                signer=self.signer,
            )
            return [record], self._lease_head(record, "active"), None

        if lease is None or lease.get("lessee_account_hash") != account_hash:
            raise CreditConflict("Billing event does not match the active lessee.")
        seq = int(lease["event_seq"]) + 1
        parent = lease["current_event_id"]
        if event.event_type in {"lease-renew", "subscription-recovered"}:
            if lease["state"] not in {"active", "grace"}:
                raise CreditConflict("Only an active or grace lease can renew.")
            period_end = _utc(event.period_end_utc, "period_end_utc")
            current_end = _utc(lease["period_end_utc"], "current period end")
            if period_end is None or current_end is None or period_end <= current_end:
                raise CreditError("Lease renewal must extend the period end.")
            record = _event(
                schema=LEASE_RENEW_SCHEMA,
                issuer=self.issuer,
                subject_id=event.credit_id,
                event_seq=seq,
                parent_event_id=parent,
                occurred_utc=occurred_utc,
                fields={
                    "lease_id": lease["lease_id"],
                    "lessee_account_hash": account_hash,
                    "period_end_utc": event.period_end_utc,
                    "grace_until_utc": event.grace_until_utc,
                    "billing_event_hash": billing_hash,
                    "recovered": event.event_type == "subscription-recovered",
                },
                signer=self.signer,
            )
            return [record], self._lease_head(record, "active", lease), None

        if event.event_type == "lease-cancel":
            access_until = _utc(
                event.grace_until_utc or event.period_end_utc,
                "grace_until_utc",
            )
            state = "grace" if access_until and access_until > self.now() else "canceled"
            record = _event(
                schema=LEASE_CANCEL_SCHEMA,
                issuer=self.issuer,
                subject_id=event.credit_id,
                event_seq=seq,
                parent_event_id=parent,
                occurred_utc=occurred_utc,
                fields={
                    "lease_id": lease["lease_id"],
                    "lessee_account_hash": account_hash,
                    "period_end_utc": event.period_end_utc or lease["period_end_utc"],
                    "grace_until_utc": event.grace_until_utc,
                    "billing_event_hash": billing_hash,
                    "effective_state": state,
                },
                signer=self.signer,
            )
            return [record], self._lease_head(record, state, lease), None

        if event.event_type in {"lease-expire", "lease-refund"}:
            schema = (
                LEASE_EXPIRE_SCHEMA
                if event.event_type == "lease-expire"
                else LEASE_REFUND_SCHEMA
            )
            state = "expired" if event.event_type == "lease-expire" else "canceled"
            record = _event(
                schema=schema,
                issuer=self.issuer,
                subject_id=event.credit_id,
                event_seq=seq,
                parent_event_id=parent,
                occurred_utc=occurred_utc,
                fields={
                    "lease_id": lease["lease_id"],
                    "lessee_account_hash": account_hash,
                    "billing_event_hash": billing_hash,
                    "local_copy_status": "unowned-stale-lease-copy",
                    "capsule_access_after": "denied",
                },
                signer=self.signer,
            )
            return [record], self._lease_head(record, state, lease), None

        if event.event_type == "purchase-conversion":
            if ownership["state"] != "rappterbox-inventory":
                raise CreditConflict("Purchase conversion requires Rapterbox title.")
            purchase_price = event.purchase_price_sats
            if (
                isinstance(purchase_price, bool)
                or not isinstance(purchase_price, int)
                or purchase_price < 1
            ):
                raise CreditError("Verified purchase conversion price is invalid.")
            conversion = _event(
                schema=PURCHASE_CONVERSION_SCHEMA,
                issuer=self.issuer,
                subject_id=event.credit_id,
                event_seq=seq,
                parent_event_id=parent,
                occurred_utc=occurred_utc,
                fields={
                    "lease_id": lease["lease_id"],
                    "lessee_account_hash": account_hash,
                    "purchase_reference_hash": hash_reference(
                        "purchase-conversion",
                        event.transaction_reference,
                    ),
                    "purchase_price_sats": purchase_price,
                    "birth_price_sats": credit["price_sats"],
                    "billing_event_hash": billing_hash,
                },
                signer=self.signer,
            )
            transfer = _event(
                schema=LEASE_TRANSFER_SCHEMA,
                issuer=self.issuer,
                subject_id=event.credit_id,
                event_seq=seq + 1,
                parent_event_id=conversion["event_id"],
                occurred_utc=occurred_utc,
                fields={
                    "conversion_event_id": conversion["event_id"],
                    "owner_before_hash": INVENTORY_OWNER_HASH,
                    "owner_after_hash": account_hash,
                    "birth_price_sats": credit["price_sats"],
                },
                signer=self.signer,
            )
            ownership_update = {
                **ownership,
                "current_owner_hash": account_hash,
                "current_event_id": transfer["event_id"],
                "event_seq": int(ownership["event_seq"]) + 1,
                "state": "owned",
                "active_listing_id": "",
            }
            return [conversion, transfer], self._lease_head(
                transfer,
                "converted",
                lease,
            ), ownership_update

        raise CreditError("Unsupported billing event type.")

    def _lease_status(self, lease: dict[str, Any] | None) -> dict[str, Any] | None:
        if lease is None:
            return None
        access_until = _utc(
            lease.get("grace_until_utc") or lease.get("period_end_utc"),
            "lease access end",
        )
        stale = bool(
            lease["state"] in {"active", "grace"}
            and access_until
            and self.now() >= access_until
        )
        access = lease["state"] in {"active", "grace"} and not stale
        return {
            **lease,
            "capsule_access": "allowed" if access else "denied",
            "offline_stale": stale,
            "local_copy_status": (
                "leased-copy"
                if access
                else "unowned-stale-lease-copy"
            ),
        }

    @staticmethod
    def _lease_head(
        event: dict[str, Any],
        state: str,
        previous: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "credit_id": event["subject_id"],
            "lease_id": event.get("lease_id") or previous["lease_id"],
            "lessee_account_hash": (
                event.get("lessee_account_hash")
                or previous["lessee_account_hash"]
            ),
            "product_id": event.get("product_id") or previous["product_id"],
            "period_end_utc": event.get("period_end_utc") or previous["period_end_utc"],
            "grace_until_utc": (
                event.get("grace_until_utc")
                if "grace_until_utc" in event
                else previous.get("grace_until_utc")
            ),
            "state": state,
            "event_seq": event["event_seq"],
            "current_event_id": event["event_id"],
        }

    @staticmethod
    def _normalize_billing_event(event: BillingEvent) -> BillingEvent:
        if not isinstance(event, BillingEvent) or event.event_type not in BILLING_TYPES:
            raise CreditError("Verified billing event is invalid.")
        return BillingEvent(
            event_id=bounded_text(event.event_id, "billing event id", 512),
            event_type=event.event_type,
            credit_id=validate_credit_id(event.credit_id),
            account_reference=bounded_text(
                event.account_reference,
                "billing account reference",
                512,
            ),
            product_id=bounded_text(event.product_id, "product_id", 128),
            period_end_utc=event.period_end_utc,
            grace_until_utc=event.grace_until_utc,
            transaction_reference=bounded_text(
                event.transaction_reference,
                "billing transaction reference",
                512,
            ),
            purchase_price_sats=event.purchase_price_sats,
        )

    def _claims(self, token: str | None) -> AccountClaims:
        if not token:
            raise AccountAuthorizationRequired("A verified account token is required.")
        return self.account_verifier.verify(token)
