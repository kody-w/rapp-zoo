import base64
import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from azure.core import MatchConditions
from azure.core.exceptions import ResourceNotFoundError
from azure.data.tables import UpdateMode

from credits.domain import (
    CreditConflict,
    CreditError,
    ProductCatalog,
    VerifiedPurchase,
    canonical_json,
)
from credits.lifecycle import (
    CANCEL_SCHEMA,
    LISTING_SCHEMA,
    RETURN_SCHEMA,
    SALE_SCHEMA,
    TRANSFER_SCHEMA,
    LifecycleService,
    OwnerClaims,
    RefundRouter,
    VerifiedRefund,
    VerifiedResaleSettlement,
)
from credits.quotes import BtcUsdQuote
from credits.repository import AzureTableCreditRepository, InMemoryCreditRepository
from credits.service import CreditService


PURCHASED = datetime(2026, 8, 1, 12, 0, 0, tzinfo=timezone.utc)
SUBJECT = "rappid:@owner/rapter:" + "a" * 64
TIERS = {
    "common": {"numerator": 1, "denominator": 1_000_000},
    "uncommon": {"numerator": 1, "denominator": 500_000},
    "rare": {"numerator": 1, "denominator": 250_000},
    "holo": {"numerator": 1, "denominator": 100_000},
    "ultra": {"numerator": 1, "denominator": 50_000},
    "secret": {"numerator": 1, "denominator": 10_000},
}


class Clock:
    def __init__(self):
        self.value = PURCHASED

    def __call__(self):
        return self.value


class Signer:
    key_id = "https://issuer.example/keys/credits/version-1"

    def sign(self, payload):
        digest = hashlib.sha256(canonical_json(payload)).digest()
        return {
            "algorithm": "ES256",
            "key_id": self.key_id,
            "value": base64.urlsafe_b64encode(digest + digest).rstrip(b"=").decode(),
        }

    def verify(self, payload, signature):
        return signature["value"] == self.sign(payload)["value"]

    def descriptor(self, key_id=None):
        del key_id
        return {
            "algorithm": "ES256",
            "key_id": self.key_id,
            "signing_ready": True,
            "jwk": {},
        }


class PurchaseVerifier:
    def verify(self, provider, receipt, product_id):
        rail = "bitcoin" if provider == "bitcoin" else "app-store"
        return VerifiedPurchase(
            provider=provider,
            payment_rail=rail,
            payment_reference=receipt,
            owner_reference="owner-1",
            purchased_utc=PURCHASED.isoformat(timespec="seconds"),
            product_id=product_id,
            bitcoin_outpoint=f"{'b' * 64}:0" if rail == "bitcoin" else None,
        )


class QuoteProvider:
    def fetch(self):
        return BtcUsdQuote(
            source="test",
            observed_utc=PURCHASED.isoformat(timespec="seconds"),
            raw_response_hash="f" * 64,
            btc_usd_micros=60_000_000_000,
        )


class OwnerAuthorizer:
    configured = True

    def authorize(self, token, credit_id):
        del credit_id
        owner = {
            "owner-1-token": "owner-1",
            "owner-2-token": "owner-2",
        }.get(token)
        if not owner:
            raise CreditError("Owner token is invalid.")
        return OwnerClaims(owner_reference=owner)


class RefundProcessor:
    configured = True

    def __init__(self, result):
        self.result = result
        self.calls = 0

    def refund(self, credit, refund_proof, operation_hash):
        del credit, refund_proof, operation_hash
        self.calls += 1
        return self.result


class ResaleVerifier:
    configured = True

    def __init__(self):
        self.calls = 0

    def verify(self, listing, settlement_proof, operation_hash):
        del listing, settlement_proof, operation_hash
        self.calls += 1
        return VerifiedResaleSettlement(
            rail="bitcoin",
            settlement_reference="sale-settlement-1",
            buyer_owner_reference="owner-2",
            sale_price_sats=175,
        )


def setup(rail="app-store", refund=None):
    clock = Clock()
    repository = InMemoryCreditRepository()
    signer = Signer()
    credit_service = CreditService(
        issuer="rappterbox",
        issuance_cap=100,
        quote_max_age_seconds=120,
        catalog=ProductCatalog.from_json('{"rapter_hatch_1":{"credits":1}}'),
        verifier=PurchaseVerifier(),
        quote_provider=QuoteProvider(),
        signer=signer,
        repository=repository,
        now=clock,
    )
    credit_service.publish_schedule({"set_id": "genesis", "tiers": TIERS})
    credit, _ = credit_service.redeem({
        "provider": rail,
        "receipt": "purchase-1",
        "product_id": "rapter_hatch_1",
        "set_id": "genesis",
        "tier": "common",
        "organism_rappid": SUBJECT,
        "genesis_core_id": "c" * 64,
        "core_manifest_hash": "d" * 64,
    })
    refund_processor = refund or RefundProcessor(VerifiedRefund(
        rail=rail,
        refund_reference="refund-1",
        refunded_sats=credit["price_sats"] if rail == "bitcoin" else None,
        fee_sats=0,
    ))
    resale = ResaleVerifier()
    lifecycle = LifecycleService(
        issuer="rappterbox",
        repository=repository,
        signer=signer,
        owner_authorizer=OwnerAuthorizer(),
        refund_router=RefundRouter({
            "app-store": refund_processor,
            "play-store": refund_processor,
            "bitcoin": refund_processor,
        }),
        resale_verifier=resale,
        verify_credit=lambda record: credit_service.verify(record)["valid"],
        bitcoin_refund_fee_sats=0,
        now=clock,
    )
    return clock, repository, lifecycle, credit, refund_processor, resale


def test_return_is_inclusive_through_day_30_and_idempotent():
    clock, repository, lifecycle, credit, refund, _ = setup()
    clock.value = PURCHASED + timedelta(days=30)
    request = {
        "operation_id": "return-operation-1",
        "credit_id": credit["credit_id"],
        "refund_proof": "original-store-receipt",
    }
    event, created = lifecycle.return_credit(request, "owner-1-token")
    repeated, repeated_created = lifecycle.return_credit(request, "owner-1-token")
    assert created is True
    assert repeated_created is False
    assert repeated == event
    assert refund.calls == 1
    assert event["schema"] == RETURN_SCHEMA
    assert event["kind"] == "body.pulse"
    assert event["original_issuance_id"] == credit["credit_id"]
    assert event["current_transfer_head"] == f"issuance:{credit['credit_id']}"
    assert event["refund_reference_hash"] != "refund-1"
    assert event["official_owned_after"] is False
    assert event["local_copy_status"] == "unowned-verifiable-copy"
    assert lifecycle.verify_event(event)["valid"] is True
    ownership = lifecycle.ownership(credit["credit_id"])
    assert ownership["state"] == "rappterbox-inventory"
    assert ownership["official_owned"] is False
    assert ownership["local_copy_status"] == "unowned-verifiable-copy"
    assert len(repository.list_lifecycle(credit["credit_id"], 0, 10)) == 1


def test_return_rejects_wrong_owner_conflicts_and_closed_window_before_refund():
    clock, repository, lifecycle, credit, refund, _ = setup()
    request = {
        "operation_id": "return-operation-2",
        "credit_id": credit["credit_id"],
        "refund_proof": "original-store-receipt",
    }
    with pytest.raises(CreditConflict, match="current official owner"):
        lifecycle.return_credit(request, "owner-2-token")
    assert refund.calls == 0

    repository.ownership[credit["credit_id"]]["state"] = "listed"
    repository.ownership[credit["credit_id"]]["event_seq"] = 1
    with pytest.raises(CreditConflict, match="no transfer or listing"):
        lifecycle.return_credit(request, "owner-1-token")
    assert refund.calls == 0

    repository.ownership[credit["credit_id"]]["state"] = "owned"
    repository.ownership[credit["credit_id"]]["event_seq"] = 0
    clock.value = PURCHASED + timedelta(days=30, seconds=1)
    with pytest.raises(CreditConflict, match="window has closed"):
        lifecycle.return_credit(request, "owner-1-token")
    assert refund.calls == 0


def test_bitcoin_refund_returns_recorded_sats_unless_fee_policy_changes():
    clock, _, lifecycle, credit, refund, _ = setup("bitcoin")
    clock.value = PURCHASED + timedelta(days=1)
    event, _ = lifecycle.return_credit({
        "operation_id": "btc-return-1",
        "credit_id": credit["credit_id"],
        "refund_proof": "verified-bitcoin-refund",
    }, "owner-1-token")
    assert event["refund_amount_sats"] == credit["price_sats"]
    assert event["refund_fee_sats"] == 0
    assert refund.calls == 1

    bad = RefundProcessor(VerifiedRefund(
        rail="bitcoin",
        refund_reference="bad-refund",
        refunded_sats=credit["price_sats"] - 1,
        fee_sats=0,
    ))
    clock2, repository2, _, credit2, _, resale2 = setup("bitcoin", bad)
    lifecycle2 = LifecycleService(
        issuer="rappterbox",
        repository=repository2,
        signer=Signer(),
        owner_authorizer=OwnerAuthorizer(),
        refund_router=RefundRouter({"bitcoin": bad}),
        resale_verifier=resale2,
        verify_credit=lambda _record: True,
        bitcoin_refund_fee_sats=0,
        now=clock2,
    )
    clock2.value = PURCHASED + timedelta(days=1)
    with pytest.raises(CreditError, match="fee policy"):
        lifecycle2.return_credit({
            "operation_id": "btc-return-bad",
            "credit_id": credit2["credit_id"],
            "refund_proof": "bad",
        }, "owner-1-token")


def test_resale_events_are_signed_append_only_and_birth_value_never_changes():
    clock, _, lifecycle, credit, _, resale = setup()
    clock.value = PURCHASED + timedelta(days=30)
    with pytest.raises(CreditConflict, match="opens after"):
        lifecycle.list_for_resale({
            "operation_id": "listing-too-early",
            "credit_id": credit["credit_id"],
            "ask_price_sats": 150,
        }, "owner-1-token")

    clock.value += timedelta(seconds=1)
    listing, created = lifecycle.list_for_resale({
        "operation_id": "listing-1",
        "credit_id": credit["credit_id"],
        "ask_price_sats": 150,
    }, "owner-1-token")
    repeated, repeated_created = lifecycle.list_for_resale({
        "operation_id": "listing-1",
        "credit_id": credit["credit_id"],
        "ask_price_sats": 150,
    }, "owner-1-token")
    assert created is True
    assert repeated_created is False
    assert repeated == listing
    assert listing["schema"] == LISTING_SCHEMA
    assert listing["ask_price_sats"] == 150
    assert listing["birth_price_sats"] == credit["price_sats"]
    assert listing["appreciation_guaranteed"] is False
    assert listing["liquidity_guaranteed"] is False

    cancelled, _ = lifecycle.cancel_listing({
        "operation_id": "cancel-1",
        "credit_id": credit["credit_id"],
        "listing_id": listing["event_id"],
    }, "owner-1-token")
    assert cancelled["schema"] == CANCEL_SCHEMA

    listing2, _ = lifecycle.list_for_resale({
        "operation_id": "listing-2",
        "credit_id": credit["credit_id"],
        "ask_price_sats": 200,
    }, "owner-1-token")
    events, sale_created = lifecycle.complete_sale({
        "operation_id": "sale-1",
        "credit_id": credit["credit_id"],
        "listing_id": listing2["event_id"],
        "settlement_proof": "verified-resale-settlement",
    }, "owner-1-token")
    repeated_events, repeated_sale_created = lifecycle.complete_sale({
        "operation_id": "sale-1",
        "credit_id": credit["credit_id"],
        "listing_id": listing2["event_id"],
        "settlement_proof": "verified-resale-settlement",
    }, "owner-1-token")
    assert sale_created is True
    assert repeated_sale_created is False
    assert repeated_events == events
    assert resale.calls == 1
    sale, transfer = events
    assert sale["schema"] == SALE_SCHEMA
    assert transfer["schema"] == TRANSFER_SCHEMA
    assert transfer["parent_event_id"] == sale["event_id"]
    assert sale["ask_price_sats"] == 200
    assert sale["sale_price_sats"] == 175
    assert sale["birth_price_sats"] == credit["price_sats"]
    assert lifecycle.verify_event(sale)["valid"] is True
    assert lifecycle.verify_event(transfer)["valid"] is True
    assert lifecycle.ownership(credit["credit_id"])["state"] == "owned"
    assert len(lifecycle.list_events(credit["credit_id"], 0, 20)["data"]) == 5


class Entity(dict):
    metadata = {"etag": 'W/"ownership-etag"'}


class LifecycleTable:
    def __init__(self, credit_id):
        self.credit_id = credit_id
        self.operations = None

    def get_entity(self, _partition, row_key):
        if row_key == f"ownership:{self.credit_id}":
            return Entity(
                PartitionKey="official",
                RowKey=row_key,
                credit_id=self.credit_id,
                current_owner_hash="a" * 64,
                current_event_id=f"issuance:{self.credit_id}",
                event_seq=0,
                state="owned",
                active_listing_id="",
                purchase_utc=PURCHASED.isoformat(timespec="seconds"),
            )
        raise ResourceNotFoundError("missing")

    def submit_transaction(self, operations):
        self.operations = operations


def test_return_ledger_append_is_one_etag_guarded_table_transaction():
    credit_id = "rcredit:" + "a" * 64
    table = LifecycleTable(credit_id)
    repository = AzureTableCreditRepository(table_client=table)
    event = {
        "event_id": "rce_" + "b" * 32,
        "event_seq": 1,
        "credit_id": credit_id,
    }
    events, created = repository.append_lifecycle(
        credit_id=credit_id,
        operation_hash="c" * 64,
        build_events=lambda head: (
            [event],
            {
                **head,
                "current_owner_hash": "d" * 64,
                "current_event_id": event["event_id"],
                "event_seq": 1,
                "state": "rappterbox-inventory",
                "active_listing_id": "",
            },
            [
                {
                    "PartitionKey": "official",
                    "RowKey": "refund:" + "e" * 64,
                    "credit_id": credit_id,
                },
                {
                    "PartitionKey": "official",
                    "RowKey": f"inventory:{credit_id}",
                    "credit_id": credit_id,
                },
            ],
        ),
    )
    assert created is True
    assert events == [event]
    assert len(table.operations) == 6
    assert table.operations[0][0] == "update"
    assert table.operations[0][2] == {
        "mode": UpdateMode.REPLACE,
        "etag": 'W/"ownership-etag"',
        "match_condition": MatchConditions.IfNotModified,
    }
    assert [operation[1]["RowKey"].split(":", 1)[0] for operation in table.operations] == [
        "ownership",
        "event",
        "lifecycle",
        "operation",
        "refund",
        "inventory",
    ]
    assert all(operation[1]["PartitionKey"] == "official" for operation in table.operations)
