import base64
import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from credits.domain import CreditConflict, ProductCatalog, VerifiedPurchase, canonical_json
from credits.quotes import BtcUsdQuote
from credits.repository import InMemoryCreditRepository
from credits.service import CreditService
from credits.subscriptions import (
    LEASE_CANCEL_SCHEMA,
    LEASE_EXPIRE_SCHEMA,
    LEASE_REFUND_SCHEMA,
    LEASE_RENEW_SCHEMA,
    LEASE_START_SCHEMA,
    LEASE_TRANSFER_SCHEMA,
    PURCHASE_CONVERSION_SCHEMA,
    AccountClaims,
    BillingEvent,
    InMemorySubscriptionRepository,
    SubscriptionService,
)


NOW = datetime(2026, 8, 29, 20, 0, 0, tzinfo=timezone.utc)
SUBJECT = "rappid:@rapterbox/premium:" + "a" * 64
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
        self.value = NOW

    def __call__(self):
        return self.value


class Signer:
    def sign(self, payload):
        digest = hashlib.sha256(canonical_json(payload)).digest()
        return {
            "algorithm": "ES256",
            "key_id": "https://issuer.example/key/v1",
            "value": base64.urlsafe_b64encode(digest + digest).rstrip(b"=").decode(),
        }

    def verify(self, payload, signature):
        return self.sign(payload)["value"] == signature["value"]

    def descriptor(self, key_id=None):
        del key_id
        return {"algorithm": "ES256", "key_id": "v1", "signing_ready": True, "jwk": {}}


class PurchaseVerifier:
    def verify(self, provider, receipt, product_id):
        del receipt
        return VerifiedPurchase(
            provider=provider,
            payment_rail="app-store",
            payment_reference="purchase-1",
            owner_reference="initial-owner",
            purchased_utc=NOW.isoformat(timespec="seconds"),
            product_id=product_id,
        )


class QuoteProvider:
    def fetch(self):
        return BtcUsdQuote(
            source="test",
            observed_utc=NOW.isoformat(timespec="seconds"),
            raw_response_hash="f" * 64,
            btc_usd_micros=60_000_000_000,
        )


class AccountVerifier:
    configured = True

    def verify(self, token):
        account = {
            "account-1-token": "account-1",
            "account-2-token": "account-2",
        }.get(token)
        if not account:
            raise CreditConflict("account token invalid")
        return AccountClaims(account_reference=account)


class BillingVerifier:
    configured = True

    def __init__(self, event):
        self.event = event
        self.calls = 0

    def verify(self, payload, headers):
        del payload, headers
        self.calls += 1
        return self.event


class RecoveryAdapter:
    configured = True

    def __init__(self, events):
        self.events = events

    def recover(self, claims, proof):
        assert claims.account_reference == "account-1"
        assert proof == "recovery-proof"
        return self.events


def setup():
    clock = Clock()
    credits = InMemoryCreditRepository()
    signer = Signer()
    credit_service = CreditService(
        issuer="rappterbox",
        issuance_cap=10,
        quote_max_age_seconds=120,
        catalog=ProductCatalog.from_json('{"rapter_hatch_1":{"credits":1}}'),
        verifier=PurchaseVerifier(),
        quote_provider=QuoteProvider(),
        signer=signer,
        repository=credits,
        now=clock,
    )
    credit_service.publish_schedule({"set_id": "premium", "tiers": TIERS})
    credit, _ = credit_service.redeem({
        "provider": "revenuecat",
        "receipt": "receipt",
        "product_id": "rapter_hatch_1",
        "set_id": "premium",
        "tier": "holo",
        "organism_rappid": SUBJECT,
        "genesis_core_id": "b" * 64,
        "core_manifest_hash": "c" * 64,
    })
    subscriptions = InMemorySubscriptionRepository(credits)
    return clock, credits, credit_service, subscriptions, signer, credit


def service(
    clock,
    credits,
    credit_service,
    subscriptions,
    signer,
    *,
    webhook=None,
    recovery=None,
):
    return SubscriptionService(
        issuer="rappterbox",
        credits=credits,
        repository=subscriptions,
        signer=signer,
        account_verifier=AccountVerifier(),
        webhook_verifier=webhook or BillingVerifier(None),
        recovery_adapter=recovery or RecoveryAdapter([]),
        verify_credit=lambda record: credit_service.verify(record)["valid"],
        now=clock,
    )


def billing(event_id, event_type, credit_id, account="account-1", **overrides):
    values = {
        "event_id": event_id,
        "event_type": event_type,
        "credit_id": credit_id,
        "account_reference": account,
        "product_id": "premium-monthly",
        "period_end_utc": (NOW + timedelta(days=30)).isoformat(timespec="seconds"),
        "grace_until_utc": None,
        "transaction_reference": f"transaction-{event_id}",
        "purchase_price_sats": None,
    }
    values.update(overrides)
    return BillingEvent(**values)


def make_inventory(credits, credit_id):
    credits.ownership[credit_id]["state"] = "rappterbox-inventory"
    credits.ownership[credit_id]["current_owner_hash"] = hashlib.sha256(
        b"owner\0rappterbox-inventory",
    ).hexdigest()


def test_free_companion_is_idempotent_one_per_verified_account_and_outside_supply():
    clock, credits, credit_service, subscriptions, signer, _credit = setup()
    subscription_service = service(
        clock,
        credits,
        credit_service,
        subscriptions,
        signer,
    )
    issued_before = credits.issued_count
    first, created = subscription_service.claim_companion("account-1-token")
    repeated, repeated_created = subscription_service.claim_companion("account-1-token")
    second_account, second_created = subscription_service.claim_companion("account-2-token")
    assert created is True
    assert repeated_created is False
    assert repeated == first
    assert second_created is True
    assert second_account["entitlement_id"] != first["entitlement_id"]
    assert first["transferable"] is False
    assert first["resellable"] is False
    assert first["source_original_id"].startswith("first-dimension-")
    assert first["generation_id"] == "generation-0001"
    assert first["offspring_rappid"].startswith("rappid:@companion-")
    assert first["rights_id"].startswith("offspring-rights:")
    assert first["rights_profile"] == "account-bound-companion-offspring"
    assert first["original_title_transferred"] is False
    assert first["uses_original_supply"] is False
    assert credits.issued_count == issued_before
    status = subscription_service.service_status()
    assert status["canonical_originals"] == 251
    assert status["issuer_held_originals_at_publication"] == 251
    assert status["transferred_originals_at_publication"] == 0
    assert status["undiscovered_originals_at_publication"] == 251
    assert status["free_companion_identity"] == "separately-issued-offspring"
    assert status["free_companion_uses_original_supply"] is False
    assert status["offspring_distinct_rappid_and_rights"] is True


def test_owned_rapter_cannot_lease_and_active_lease_cannot_double_assign():
    clock, credits, credit_service, subscriptions, signer, credit = setup()
    subscription_service = service(
        clock,
        credits,
        credit_service,
        subscriptions,
        signer,
    )
    with pytest.raises(CreditConflict, match="cannot be leased"):
        subscription_service.apply_billing_event(
            billing("start-owned", "lease-start", credit["credit_id"]),
        )
    make_inventory(credits, credit["credit_id"])
    started, created = subscription_service.apply_billing_event(
        billing("start-1", "lease-start", credit["credit_id"]),
    )
    assert created is True
    assert started[0]["schema"] == LEASE_START_SCHEMA
    with pytest.raises(CreditConflict, match="active lessee"):
        subscription_service.apply_billing_event(
            billing(
                "start-2",
                "lease-start",
                credit["credit_id"],
                account="account-2",
            ),
        )
    assert credits.issued_count == 1


def test_cancellation_grace_expiry_and_offline_stale_copy():
    clock, credits, credit_service, subscriptions, signer, credit = setup()
    make_inventory(credits, credit["credit_id"])
    subscription_service = service(
        clock,
        credits,
        credit_service,
        subscriptions,
        signer,
    )
    subscription_service.apply_billing_event(
        billing("start-1", "lease-start", credit["credit_id"]),
    )
    access = subscription_service.capsule_access("account-1-token", {
        "credit_id": credit["credit_id"],
        "organism_rappid": credit["organism_rappid"],
        "core_manifest_hash": credit["core_manifest_hash"],
    })
    assert access["schema"] == "rapp-rapter-lease-capsule-access/1"
    assert access["access"] == ["download", "decrypt"]
    grace_until = NOW + timedelta(days=2)
    canceled, _ = subscription_service.apply_billing_event(
        billing(
            "cancel-1",
            "lease-cancel",
            credit["credit_id"],
            grace_until_utc=grace_until.isoformat(timespec="seconds"),
        ),
    )
    assert canceled[0]["schema"] == LEASE_CANCEL_SCHEMA
    status = subscription_service.entitlement_status(
        "account-1-token",
        credit["credit_id"],
    )
    assert status["premium_lease"]["state"] == "grace"
    assert status["premium_lease"]["capsule_access"] == "allowed"
    clock.value = grace_until + timedelta(seconds=1)
    stale = subscription_service.entitlement_status(
        "account-1-token",
        credit["credit_id"],
    )
    assert stale["premium_lease"]["offline_stale"] is True
    assert stale["premium_lease"]["local_copy_status"] == "unowned-stale-lease-copy"
    with pytest.raises(CreditConflict, match="No active scoped lease"):
        subscription_service.capsule_access("account-1-token", {
            "credit_id": credit["credit_id"],
            "organism_rappid": credit["organism_rappid"],
            "core_manifest_hash": credit["core_manifest_hash"],
        })
    expired, created = subscription_service.sync_expiry(
        "account-1-token",
        credit["credit_id"],
    )
    assert created is True
    assert expired[0]["schema"] == LEASE_EXPIRE_SCHEMA


def test_duplicate_webhook_renewal_and_subscription_recovery_are_idempotent():
    clock, credits, credit_service, subscriptions, signer, credit = setup()
    make_inventory(credits, credit["credit_id"])
    start = billing("start-1", "lease-start", credit["credit_id"])
    verifier = BillingVerifier(start)
    subscription_service = service(
        clock,
        credits,
        credit_service,
        subscriptions,
        signer,
        webhook=verifier,
    )
    first, created = subscription_service.process_webhook(b"opaque", {"x-signature": "safe"})
    repeated, repeated_created = subscription_service.process_webhook(
        b"opaque",
        {"x-signature": "safe"},
    )
    assert created is True
    assert repeated_created is False
    assert repeated == first

    recovery_event = billing(
        "recover-1",
        "lease-renew",
        credit["credit_id"],
        period_end_utc=(NOW + timedelta(days=60)).isoformat(timespec="seconds"),
    )
    recovered_service = service(
        clock,
        credits,
        credit_service,
        subscriptions,
        signer,
        recovery=RecoveryAdapter([recovery_event]),
    )
    recovered = recovered_service.recover("account-1-token", "recovery-proof")
    assert recovered[0]["events"][0]["schema"] == LEASE_RENEW_SCHEMA
    assert recovered[0]["events"][0]["recovered"] is True


def test_refund_stops_access_and_purchase_conversion_preserves_supply_and_birth():
    clock, credits, credit_service, subscriptions, signer, credit = setup()
    make_inventory(credits, credit["credit_id"])
    subscription_service = service(
        clock,
        credits,
        credit_service,
        subscriptions,
        signer,
    )
    subscription_service.apply_billing_event(
        billing("start-refund", "lease-start", credit["credit_id"]),
    )
    refunded, _ = subscription_service.apply_billing_event(
        billing("refund-1", "lease-refund", credit["credit_id"]),
    )
    assert refunded[0]["schema"] == LEASE_REFUND_SCHEMA
    assert subscription_service.entitlement_status(
        "account-1-token",
        credit["credit_id"],
    )["premium_lease"]["capsule_access"] == "denied"

    start_again = billing(
        "start-convert",
        "lease-start",
        credit["credit_id"],
        period_end_utc=(NOW + timedelta(days=45)).isoformat(timespec="seconds"),
    )
    subscription_service.apply_billing_event(start_again)
    issued_before = credits.issued_count
    birth_price = credit["price_sats"]
    converted, _ = subscription_service.apply_billing_event(
        billing(
            "convert-1",
            "purchase-conversion",
            credit["credit_id"],
            purchase_price_sats=999,
        ),
    )
    conversion, transfer = converted
    assert conversion["schema"] == PURCHASE_CONVERSION_SCHEMA
    assert transfer["schema"] == LEASE_TRANSFER_SCHEMA
    assert conversion["purchase_price_sats"] == 999
    assert conversion["birth_price_sats"] == birth_price
    assert credits.get_credit(credit["credit_id"])["price_sats"] == birth_price
    assert credits.issued_count == issued_before
    assert subscriptions.get_lease(credit["credit_id"])["state"] == "converted"
    assert credits.get_ownership(credit["credit_id"])["state"] == "owned"
    public_events = subscription_service.public_events(credit["credit_id"], 0, 20)
    assert public_events["data"][-2:] == [conversion, transfer]
