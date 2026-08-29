import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Protocol

from .domain import (
    CreditConflict,
    CreditError,
    PurchaseVerificationUnavailable,
    bounded_text,
    canonical_json,
    hash_reference,
    validate_credit_id,
    validate_sha256,
)
from .repository import CreditRepository, PARTITION
from .signing import RegistrySigner


RETURN_SCHEMA = "rapp-rapter-credit-return/1"
LISTING_SCHEMA = "rapp-rapter-credit-listing/1"
CANCEL_SCHEMA = "rapp-rapter-credit-listing-cancel/1"
SALE_SCHEMA = "rapp-rapter-credit-sale/1"
TRANSFER_SCHEMA = "rapp-rapter-credit-transfer/1"
RETURN_KEYS = {"operation_id", "credit_id", "refund_proof"}
LIST_KEYS = {"operation_id", "credit_id", "ask_price_sats"}
CANCEL_KEYS = {"operation_id", "credit_id", "listing_id"}
SALE_KEYS = {"operation_id", "credit_id", "listing_id", "settlement_proof"}
INVENTORY_OWNER_HASH = hash_reference("owner", "rappterbox-inventory")
EVENT_SCHEMAS = {
    RETURN_SCHEMA,
    LISTING_SCHEMA,
    CANCEL_SCHEMA,
    SALE_SCHEMA,
    TRANSFER_SCHEMA,
}
COMMON_EVENT_KEYS = {
    "schema",
    "kind",
    "issuer",
    "credit_id",
    "event_seq",
    "parent_event_id",
    "occurred_utc",
    "event_id",
    "event_hash",
    "signature",
}
EVENT_EXTRA_KEYS = {
    RETURN_SCHEMA: {
        "original_issuance_id",
        "current_transfer_head",
        "owner_before_hash",
        "owner_after_hash",
        "refund_rail",
        "refund_reference_hash",
        "refund_amount_sats",
        "refund_fee_sats",
        "birth_price_sats",
        "official_owned_after",
        "local_copy_status",
    },
    LISTING_SCHEMA: {
        "owner_hash",
        "ask_price_sats",
        "birth_price_sats",
        "appreciation_guaranteed",
        "liquidity_guaranteed",
    },
    CANCEL_SCHEMA: {"owner_hash", "listing_id"},
    SALE_SCHEMA: {
        "listing_id",
        "seller_owner_hash",
        "buyer_owner_hash",
        "ask_price_sats",
        "sale_price_sats",
        "birth_price_sats",
        "settlement_rail",
        "settlement_reference_hash",
        "appreciation_guaranteed",
        "liquidity_guaranteed",
    },
    TRANSFER_SCHEMA: {
        "sale_event_id",
        "owner_before_hash",
        "owner_after_hash",
        "birth_price_sats",
    },
}


class OwnerAuthorizationRequired(CreditError):
    code = "official_owner_authorization_required"
    status_code = 403


@dataclass(frozen=True)
class OwnerClaims:
    owner_reference: str


@dataclass(frozen=True)
class VerifiedRefund:
    rail: str
    refund_reference: str
    refunded_sats: int | None
    fee_sats: int


@dataclass(frozen=True)
class VerifiedResaleSettlement:
    rail: str
    settlement_reference: str
    buyer_owner_reference: str
    sale_price_sats: int


class OwnerAuthorizer(Protocol):
    configured: bool

    def authorize(self, token: str, credit_id: str) -> OwnerClaims:
        ...


class RefundProcessor(Protocol):
    configured: bool

    def refund(
        self,
        credit: dict[str, Any],
        refund_proof: str,
        operation_hash: str,
    ) -> VerifiedRefund:
        ...


class ResaleSettlementVerifier(Protocol):
    configured: bool

    def verify(
        self,
        listing: dict[str, Any],
        settlement_proof: str,
        operation_hash: str,
    ) -> VerifiedResaleSettlement:
        ...


class DisabledOwnerAuthorizer:
    configured = False

    def authorize(self, token: str, credit_id: str) -> OwnerClaims:
        del token, credit_id
        raise PurchaseVerificationUnavailable(
            "Scoped official-owner token verification is not configured.",
        )


class DisabledRefundProcessor:
    configured = False

    def __init__(self, rail: str):
        self.rail = rail

    def refund(
        self,
        credit: dict[str, Any],
        refund_proof: str,
        operation_hash: str,
    ) -> VerifiedRefund:
        del credit, refund_proof, operation_hash
        raise PurchaseVerificationUnavailable(
            f"{self.rail} refund verification is not configured.",
        )


class DisabledResaleSettlementVerifier:
    configured = False

    def verify(
        self,
        listing: dict[str, Any],
        settlement_proof: str,
        operation_hash: str,
    ) -> VerifiedResaleSettlement:
        del listing, settlement_proof, operation_hash
        raise PurchaseVerificationUnavailable(
            "Resale settlement verification is not configured.",
        )


class RefundRouter:
    def __init__(self, processors: dict[str, RefundProcessor]):
        self.processors = processors

    def for_rail(self, rail: str) -> RefundProcessor:
        processor = self.processors.get(rail)
        if processor is None:
            raise PurchaseVerificationUnavailable(
                "The original payment rail cannot be refunded by this issuer.",
            )
        return processor


def configured_refund_router() -> RefundRouter:
    return RefundRouter({
        "app-store": DisabledRefundProcessor("App Store"),
        "play-store": DisabledRefundProcessor("Play Store"),
        "bitcoin": DisabledRefundProcessor("Bitcoin"),
    })


def _exact(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise CreditError(f"{label} has an invalid shape.")
    return value


def _positive_sats(value: Any, label: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 1
        or value > 2_100_000_000_000_000
    ):
        raise CreditError(f"{label} must be a positive integer satoshi amount.")
    return value


def _operation_hash(action: str, credit_id: str, operation_id: Any) -> str:
    normalized = bounded_text(operation_id, "operation_id", 256)
    return hash_reference(action, f"{credit_id}\0{normalized}")


def _timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise CreditError("Signed purchase timestamp is invalid.") from error
    if parsed.tzinfo is None:
        raise CreditError("Signed purchase timestamp lacks a timezone.")
    return parsed.astimezone(timezone.utc)


def _event(
    *,
    schema: str,
    issuer: str,
    credit_id: str,
    event_seq: int,
    parent_event_id: str,
    occurred_utc: str,
    fields: dict[str, Any],
    signer: RegistrySigner,
) -> dict[str, Any]:
    base = {
        "schema": schema,
        "kind": "body.pulse",
        "issuer": issuer,
        "credit_id": credit_id,
        "event_seq": event_seq,
        "parent_event_id": parent_event_id,
        "occurred_utc": occurred_utc,
        **fields,
    }
    event_hash = hashlib.sha256(canonical_json(base)).hexdigest()
    payload = {
        **base,
        "event_id": f"rce_{event_hash[:32]}",
        "event_hash": event_hash,
    }
    return {**payload, "signature": signer.sign(payload)}


def validate_lifecycle_event(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") not in EVENT_SCHEMAS:
        raise CreditError("Lifecycle event schema is invalid.")
    schema = value["schema"]
    if set(value) != COMMON_EVENT_KEYS | EVENT_EXTRA_KEYS[schema]:
        raise CreditError("Lifecycle event shape is invalid.")
    if value.get("kind") != "body.pulse":
        raise CreditError("Lifecycle event kind must be body.pulse.")
    bounded_text(value.get("issuer"), "issuer", 128)
    validate_credit_id(value.get("credit_id"))
    if (
        isinstance(value.get("event_seq"), bool)
        or not isinstance(value.get("event_seq"), int)
        or value["event_seq"] < 1
    ):
        raise CreditError("Lifecycle event sequence is invalid.")
    bounded_text(value.get("parent_event_id"), "parent_event_id", 256)
    _timestamp(bounded_text(value.get("occurred_utc"), "occurred_utc", 64))
    event_hash = validate_sha256(value.get("event_hash"), "event_hash")
    event_id = bounded_text(value.get("event_id"), "event_id", 36)
    if event_id != f"rce_{event_hash[:32]}":
        raise CreditError("Lifecycle event id does not match its hash.")
    for key, item in value.items():
        if key.endswith("_hash"):
            validate_sha256(item, key)
    for key in (
        "birth_price_sats",
        "ask_price_sats",
        "sale_price_sats",
    ):
        if key in value:
            _positive_sats(value[key], key)
    if schema == RETURN_SCHEMA:
        validate_credit_id(value["original_issuance_id"])
        if value["official_owned_after"] is not False:
            raise CreditError("Returned credit cannot remain officially owned.")
        if value["local_copy_status"] != "unowned-verifiable-copy":
            raise CreditError("Return local-copy status is invalid.")
        if value["refund_amount_sats"] is not None:
            _positive_sats(value["refund_amount_sats"], "refund_amount_sats")
        if (
            isinstance(value["refund_fee_sats"], bool)
            or not isinstance(value["refund_fee_sats"], int)
            or value["refund_fee_sats"] < 0
        ):
            raise CreditError("refund_fee_sats is invalid.")
    if schema in {LISTING_SCHEMA, SALE_SCHEMA} and (
        value["appreciation_guaranteed"] is not False
        or value["liquidity_guaranteed"] is not False
    ):
        raise CreditError("Lifecycle market events cannot guarantee returns or liquidity.")
    unsigned = {
        key: item
        for key, item in value.items()
        if key not in {"event_id", "event_hash", "signature"}
    }
    expected_hash = hashlib.sha256(canonical_json(unsigned)).hexdigest()
    if event_hash != expected_hash:
        raise CreditError("Lifecycle event hash is invalid.")
    if not isinstance(value.get("signature"), dict):
        raise CreditError("Lifecycle event signature is invalid.")
    return value


class LifecycleService:
    def __init__(
        self,
        *,
        issuer: str,
        repository: CreditRepository,
        signer: RegistrySigner,
        owner_authorizer: OwnerAuthorizer,
        refund_router: RefundRouter,
        resale_verifier: ResaleSettlementVerifier,
        verify_credit: Callable[[dict[str, Any]], bool],
        bitcoin_refund_fee_sats: int = 0,
        now: Callable[[], datetime] | None = None,
    ):
        self.issuer = issuer
        self.repository = repository
        self.signer = signer
        self.owner_authorizer = owner_authorizer
        self.refund_router = refund_router
        self.resale_verifier = resale_verifier
        self.verify_credit = verify_credit
        if (
            isinstance(bitcoin_refund_fee_sats, bool)
            or not isinstance(bitcoin_refund_fee_sats, int)
            or bitcoin_refund_fee_sats < 0
        ):
            raise RuntimeError("BITCOIN_REFUND_FEE_SATS must be a nonnegative integer.")
        self.bitcoin_refund_fee_sats = bitcoin_refund_fee_sats
        self.now = now or (lambda: datetime.now(timezone.utc))

    def status(self) -> dict[str, Any]:
        return {
            "schema": "rapp-rapter-credit-lifecycle-status/1",
            "return_window_days": 30,
            "owner_authorizer_configured": self.owner_authorizer.configured,
            "refund_rails": {
                rail: processor.configured
                for rail, processor in self.refund_router.processors.items()
            },
            "resale_settlement_configured": self.resale_verifier.configured,
            "birth_valuation_mutable": False,
            "appreciation_guaranteed": False,
            "liquidity_guaranteed": False,
        }

    def verify_event(self, value: Any) -> dict[str, Any]:
        event = validate_lifecycle_event(value)
        payload = {
            key: item
            for key, item in event.items()
            if key != "signature"
        }
        return {
            "valid": (
                event["issuer"] == self.issuer
                and self.signer.verify(payload, event["signature"])
            ),
            "event_id": event["event_id"],
            "credit_id": event["credit_id"],
            "schema": event["schema"],
        }

    def ownership(self, credit_id_value: Any) -> dict[str, Any]:
        credit_id = validate_credit_id(credit_id_value)
        head = self.repository.get_ownership(credit_id)
        state = head["state"]
        return {
            "schema": "rapp-rapter-credit-ownership/1",
            "credit_id": credit_id,
            "state": state,
            "current_owner_hash": head["current_owner_hash"],
            "current_event_id": head["current_event_id"],
            "event_seq": int(head["event_seq"]),
            "active_listing_id": head.get("active_listing_id") or None,
            "official_owned": state in {"owned", "listed"},
            "rappterbox_inventory": state == "rappterbox-inventory",
            "local_copy_status": (
                "unowned-verifiable-copy"
                if state == "rappterbox-inventory"
                else "official-owner-copy"
            ),
        }

    def list_events(self, credit_id_value: Any, after: Any, limit: Any) -> dict[str, Any]:
        credit_id = validate_credit_id(credit_id_value)
        try:
            after_value = int(after or 0)
            limit_value = int(limit or 50)
        except (TypeError, ValueError) as error:
            raise CreditError("after and limit must be integers.") from error
        if after_value < 0 or limit_value < 1 or limit_value > 100:
            raise CreditError("Lifecycle pagination is invalid.")
        events = self.repository.list_lifecycle(credit_id, after_value, limit_value)
        return {
            "object": "list",
            "credit_id": credit_id,
            "data": events,
            "next_after": events[-1]["event_seq"] if events else after_value,
        }

    def return_credit(
        self,
        request: Any,
        scoped_token: str | None,
    ) -> tuple[dict[str, Any], bool]:
        value = _exact(request, RETURN_KEYS, "return request")
        credit_id = validate_credit_id(value["credit_id"])
        operation_hash = _operation_hash("return", credit_id, value["operation_id"])
        refund_proof = bounded_text(value["refund_proof"], "refund_proof", 50_000)
        claims = self._claims(scoped_token, credit_id)
        owner_hash = hash_reference("owner", claims.owner_reference)
        existing = self.repository.get_operation_events(operation_hash)
        if existing is not None:
            self._assert_event_owner(existing[0], owner_hash)
            return existing[0], False
        credit = self._official_credit(credit_id)
        deadline = _timestamp(credit["purchase_utc"]) + timedelta(days=30)
        if self.now() > deadline:
            raise CreditConflict("The 30-day return window has closed.")
        current_head = self.repository.get_ownership(credit_id)
        self._require_owner(current_head, owner_hash)
        if current_head["state"] != "owned" or int(current_head["event_seq"]) != 0:
            raise CreditConflict(
                "Return requires the original owner with no transfer or listing history.",
            )
        processor = self.refund_router.for_rail(credit["payment_rail"])
        refund = processor.refund(
            credit,
            refund_proof,
            hash_reference("refund-operation", credit["payment_reference_hash"]),
        )
        refund_rail = self._validate_refund(credit, refund)
        refund_hash = hash_reference(
            f"refund:{refund_rail}",
            refund.refund_reference,
        )
        occurred_utc = self.now().isoformat(timespec="seconds")

        def build(head):
            self._require_owner(head, owner_hash)
            if head["state"] != "owned" or int(head["event_seq"]) != 0:
                raise CreditConflict(
                    "Return requires the original owner with no transfer or listing history.",
                )
            event = _event(
                schema=RETURN_SCHEMA,
                issuer=self.issuer,
                credit_id=credit_id,
                event_seq=1,
                parent_event_id=head["current_event_id"],
                occurred_utc=occurred_utc,
                fields={
                    "original_issuance_id": credit_id,
                    "current_transfer_head": head["current_event_id"],
                    "owner_before_hash": owner_hash,
                    "owner_after_hash": INVENTORY_OWNER_HASH,
                    "refund_rail": refund_rail,
                    "refund_reference_hash": refund_hash,
                    "refund_amount_sats": refund.refunded_sats,
                    "refund_fee_sats": refund.fee_sats,
                    "birth_price_sats": credit["price_sats"],
                    "official_owned_after": False,
                    "local_copy_status": "unowned-verifiable-copy",
                },
                signer=self.signer,
            )
            head_update = {
                **head,
                "current_owner_hash": INVENTORY_OWNER_HASH,
                "current_event_id": event["event_id"],
                "event_seq": 1,
                "state": "rappterbox-inventory",
                "active_listing_id": "",
            }
            unique_rows = [
                {
                    "PartitionKey": PARTITION,
                    "RowKey": f"refund:{refund_hash}",
                    "credit_id": credit_id,
                    "event_id": event["event_id"],
                },
                {
                    "PartitionKey": PARTITION,
                    "RowKey": f"inventory:{credit_id}",
                    "credit_id": credit_id,
                    "event_id": event["event_id"],
                },
            ]
            return [event], head_update, unique_rows

        events, created = self.repository.append_lifecycle(
            credit_id=credit_id,
            operation_hash=operation_hash,
            build_events=build,
        )
        return events[0], created

    def list_for_resale(
        self,
        request: Any,
        scoped_token: str | None,
    ) -> tuple[dict[str, Any], bool]:
        value = _exact(request, LIST_KEYS, "listing request")
        credit_id = validate_credit_id(value["credit_id"])
        operation_hash = _operation_hash("listing", credit_id, value["operation_id"])
        ask_price = _positive_sats(value["ask_price_sats"], "ask_price_sats")
        claims = self._claims(scoped_token, credit_id)
        owner_hash = hash_reference("owner", claims.owner_reference)
        existing = self.repository.get_operation_events(operation_hash)
        if existing is not None:
            self._assert_event_owner(existing[0], owner_hash)
            return existing[0], False
        credit = self._official_credit(credit_id)
        if self.now() <= _timestamp(credit["purchase_utc"]) + timedelta(days=30):
            raise CreditConflict("Resale listing opens after the 30-day return window.")
        occurred_utc = self.now().isoformat(timespec="seconds")

        def build(head):
            self._require_owner(head, owner_hash)
            if head["state"] != "owned" or head.get("active_listing_id"):
                raise CreditConflict("Credit already has a conflicting listing or transfer.")
            event = _event(
                schema=LISTING_SCHEMA,
                issuer=self.issuer,
                credit_id=credit_id,
                event_seq=int(head["event_seq"]) + 1,
                parent_event_id=head["current_event_id"],
                occurred_utc=occurred_utc,
                fields={
                    "owner_hash": owner_hash,
                    "ask_price_sats": ask_price,
                    "birth_price_sats": credit["price_sats"],
                    "appreciation_guaranteed": False,
                    "liquidity_guaranteed": False,
                },
                signer=self.signer,
            )
            return [event], {
                **head,
                "current_event_id": event["event_id"],
                "event_seq": event["event_seq"],
                "state": "listed",
                "active_listing_id": event["event_id"],
            }, []

        events, created = self.repository.append_lifecycle(
            credit_id=credit_id,
            operation_hash=operation_hash,
            build_events=build,
        )
        return events[0], created

    def cancel_listing(
        self,
        request: Any,
        scoped_token: str | None,
    ) -> tuple[dict[str, Any], bool]:
        value = _exact(request, CANCEL_KEYS, "listing cancellation request")
        credit_id = validate_credit_id(value["credit_id"])
        listing_id = bounded_text(value["listing_id"], "listing_id", 36)
        operation_hash = _operation_hash(
            "listing-cancel",
            credit_id,
            value["operation_id"],
        )
        claims = self._claims(scoped_token, credit_id)
        owner_hash = hash_reference("owner", claims.owner_reference)
        existing = self.repository.get_operation_events(operation_hash)
        if existing is not None:
            self._assert_event_owner(existing[0], owner_hash)
            return existing[0], False
        occurred_utc = self.now().isoformat(timespec="seconds")

        def build(head):
            self._require_owner(head, owner_hash)
            if head["state"] != "listed" or head.get("active_listing_id") != listing_id:
                raise CreditConflict("The active listing does not match.")
            event = _event(
                schema=CANCEL_SCHEMA,
                issuer=self.issuer,
                credit_id=credit_id,
                event_seq=int(head["event_seq"]) + 1,
                parent_event_id=head["current_event_id"],
                occurred_utc=occurred_utc,
                fields={
                    "owner_hash": owner_hash,
                    "listing_id": listing_id,
                },
                signer=self.signer,
            )
            return [event], {
                **head,
                "current_event_id": event["event_id"],
                "event_seq": event["event_seq"],
                "state": "owned",
                "active_listing_id": "",
            }, []

        events, created = self.repository.append_lifecycle(
            credit_id=credit_id,
            operation_hash=operation_hash,
            build_events=build,
        )
        return events[0], created

    def complete_sale(
        self,
        request: Any,
        scoped_token: str | None,
    ) -> tuple[list[dict[str, Any]], bool]:
        value = _exact(request, SALE_KEYS, "sale request")
        credit_id = validate_credit_id(value["credit_id"])
        listing_id = bounded_text(value["listing_id"], "listing_id", 36)
        settlement_proof = bounded_text(
            value["settlement_proof"],
            "settlement_proof",
            50_000,
        )
        operation_hash = _operation_hash("sale", credit_id, value["operation_id"])
        claims = self._claims(scoped_token, credit_id)
        seller_hash = hash_reference("owner", claims.owner_reference)
        existing = self.repository.get_operation_events(operation_hash)
        if existing is not None:
            self._assert_event_owner(existing[0], seller_hash)
            return existing, False
        credit = self._official_credit(credit_id)
        head = self.repository.get_ownership(credit_id)
        self._require_owner(head, seller_hash)
        if head["state"] != "listed" or head.get("active_listing_id") != listing_id:
            raise CreditConflict("The active listing does not match.")
        listing = self.repository.get_event(listing_id)
        settlement = self.resale_verifier.verify(
            listing,
            settlement_proof,
            operation_hash,
        )
        sale_price = _positive_sats(settlement.sale_price_sats, "sale_price_sats")
        settlement_rail = bounded_text(
            settlement.rail,
            "settlement rail",
            32,
        ).lower()
        settlement_reference = bounded_text(
            settlement.settlement_reference,
            "settlement reference",
            512,
        )
        buyer_reference = bounded_text(
            settlement.buyer_owner_reference,
            "buyer owner reference",
            512,
        )
        buyer_hash = hash_reference("owner", buyer_reference)
        settlement_hash = hash_reference(
            f"resale:{settlement_rail}",
            settlement_reference,
        )
        occurred_utc = self.now().isoformat(timespec="seconds")

        def build(current):
            self._require_owner(current, seller_hash)
            if (
                current["state"] != "listed"
                or current.get("active_listing_id") != listing_id
            ):
                raise CreditConflict("The active listing changed before sale.")
            sale = _event(
                schema=SALE_SCHEMA,
                issuer=self.issuer,
                credit_id=credit_id,
                event_seq=int(current["event_seq"]) + 1,
                parent_event_id=current["current_event_id"],
                occurred_utc=occurred_utc,
                fields={
                    "listing_id": listing_id,
                    "seller_owner_hash": seller_hash,
                    "buyer_owner_hash": buyer_hash,
                    "ask_price_sats": listing["ask_price_sats"],
                    "sale_price_sats": sale_price,
                    "birth_price_sats": credit["price_sats"],
                    "settlement_rail": settlement_rail,
                    "settlement_reference_hash": settlement_hash,
                    "appreciation_guaranteed": False,
                    "liquidity_guaranteed": False,
                },
                signer=self.signer,
            )
            transfer = _event(
                schema=TRANSFER_SCHEMA,
                issuer=self.issuer,
                credit_id=credit_id,
                event_seq=sale["event_seq"] + 1,
                parent_event_id=sale["event_id"],
                occurred_utc=occurred_utc,
                fields={
                    "sale_event_id": sale["event_id"],
                    "owner_before_hash": seller_hash,
                    "owner_after_hash": buyer_hash,
                    "birth_price_sats": credit["price_sats"],
                },
                signer=self.signer,
            )
            return [sale, transfer], {
                **current,
                "current_owner_hash": buyer_hash,
                "current_event_id": transfer["event_id"],
                "event_seq": transfer["event_seq"],
                "state": "owned",
                "active_listing_id": "",
            }, [{
                "PartitionKey": PARTITION,
                "RowKey": f"settlement:{settlement_hash}",
                "credit_id": credit_id,
                "event_id": sale["event_id"],
            }]

        return self.repository.append_lifecycle(
            credit_id=credit_id,
            operation_hash=operation_hash,
            build_events=build,
        )

    def _claims(self, token: str | None, credit_id: str) -> OwnerClaims:
        if not token:
            raise OwnerAuthorizationRequired("A scoped official-owner token is required.")
        return self.owner_authorizer.authorize(token, credit_id)

    def _official_credit(self, credit_id: str) -> dict[str, Any]:
        credit = self.repository.get_credit(credit_id)
        if not self.verify_credit(credit):
            raise CreditError("The original issuance is not an official valid credit.")
        return credit

    def _validate_refund(self, credit: dict[str, Any], refund: VerifiedRefund) -> str:
        refund_rail = bounded_text(refund.rail, "refund rail", 32).lower()
        if refund_rail != credit["payment_rail"]:
            raise CreditError("Refund rail does not match the original purchase rail.")
        bounded_text(refund.refund_reference, "refund reference", 512)
        if (
            isinstance(refund.fee_sats, bool)
            or not isinstance(refund.fee_sats, int)
            or refund.fee_sats < 0
        ):
            raise CreditError("Refund fee cannot be negative.")
        if refund_rail == "bitcoin":
            expected = credit["price_sats"] - self.bitcoin_refund_fee_sats
            if (
                isinstance(refund.refunded_sats, bool)
                or not isinstance(refund.refunded_sats, int)
                or refund.fee_sats != self.bitcoin_refund_fee_sats
                or refund.refunded_sats != expected
            ):
                raise CreditError("Bitcoin refund amount violates the configured fee policy.")
        elif refund.refunded_sats is not None:
            _positive_sats(refund.refunded_sats, "refund amount")
        return refund_rail

    @staticmethod
    def _require_owner(head: dict[str, Any], owner_hash: str) -> None:
        if head.get("current_owner_hash") != owner_hash:
            raise CreditConflict("The scoped caller is not the current official owner.")

    @staticmethod
    def _assert_event_owner(event: dict[str, Any], owner_hash: str) -> None:
        event_owner = (
            event.get("owner_before_hash")
            or event.get("owner_hash")
            or event.get("seller_owner_hash")
        )
        if event_owner != owner_hash:
            raise CreditConflict("Operation id belongs to another official owner.")
