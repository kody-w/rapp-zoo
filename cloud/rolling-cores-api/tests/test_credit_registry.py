import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from azure.core import MatchConditions
from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError
from azure.data.tables import UpdateMode

from credits.domain import (
    CreditConflict,
    CreditError,
    IssuanceCapReached,
    ProductCatalog,
    PurchaseVerificationUnavailable,
    SigningUnavailable,
    VerifiedPurchase,
    birth_value_usd_micros,
    canonical_json,
    price_sats_for_fraction,
    signature_payload,
)
from credits.purchases import DisabledPurchaseVerifier
from credits.quotes import (
    BtcUsdQuote,
    FallbackQuoteProvider,
    PublicHttpQuoteProvider,
    QuoteUnavailable,
    StaleQuote,
)
from credits.repository import AzureTableCreditRepository, InMemoryCreditRepository
from credits.service import CreditService
from credits.signing import DisabledRegistrySigner
from credits.valuation import schedule_signature_payload


NOW = datetime(2026, 8, 29, 19, 0, 0, tzinfo=timezone.utc)
TIERS = {
    "common": {"numerator": 1, "denominator": 1_000_000},
    "uncommon": {"numerator": 1, "denominator": 500_000},
    "rare": {"numerator": 1, "denominator": 250_000},
    "holo": {"numerator": 1, "denominator": 100_000},
    "ultra": {"numerator": 1, "denominator": 50_000},
    "secret": {"numerator": 1, "denominator": 10_000},
}


class FakeSigner:
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
        assert key_id in (None, self.key_id)
        return {
            "algorithm": "ES256",
            "key_id": self.key_id,
            "signing_ready": True,
            "jwk": {
                "kty": "EC",
                "crv": "P-256",
                "x": "public-x",
                "y": "public-y",
                "use": "sig",
                "alg": "ES256",
                "kid": self.key_id,
            },
        }


class FakeVerifier:
    def verify(self, provider, receipt, product_id):
        assert provider in {"app-store", "revenuecat", "bitcoin"}
        assert receipt.startswith("verified:")
        return VerifiedPurchase(
            provider=provider,
            payment_rail=("bitcoin" if provider == "bitcoin" else "app-store"),
            payment_reference=receipt.removeprefix("verified:"),
            owner_reference="owner-account-1",
            purchased_utc=NOW.isoformat(timespec="seconds"),
            product_id=product_id,
            bitcoin_outpoint=f"{'b' * 64}:0" if provider == "bitcoin" else None,
        )


class FakeQuoteProvider:
    def __init__(self, quote=None, error=None):
        self.quote = quote or BtcUsdQuote(
            source="test-btc-usd",
            observed_utc=NOW.isoformat(timespec="seconds"),
            raw_response_hash="f" * 64,
            btc_usd_micros=60_000_000_000,
        )
        self.error = error
        self.calls = 0

    def fetch(self):
        self.calls += 1
        if self.error:
            raise self.error
        return self.quote


def service(
    repository=None,
    cap=2,
    verifier=None,
    signer=None,
    quote_provider=None,
):
    return CreditService(
        issuer="rappterbox",
        issuance_cap=cap,
        quote_max_age_seconds=120,
        catalog=ProductCatalog.from_json(
            '{"rapter_hatch_1":{"credits":1}}',
        ),
        verifier=verifier or FakeVerifier(),
        quote_provider=quote_provider or FakeQuoteProvider(),
        signer=signer or FakeSigner(),
        repository=repository or InMemoryCreditRepository(),
        now=lambda: NOW,
    )


def redemption(receipt="verified:transaction-1", organism="rappid:@owner/rapter:abc"):
    return {
        "provider": "app-store",
        "receipt": receipt,
        "product_id": "rapter_hatch_1",
        "set_id": "genesis-2026",
        "tier": "common",
        "organism_rappid": organism,
        "genesis_core_id": "a" * 64,
        "core_manifest_hash": "c" * 64,
    }


def publish_schedule(credit_service):
    schedule = credit_service.publish_schedule({
        "set_id": "genesis-2026",
        "tiers": TIERS,
    })
    assert credit_service.signer.verify(
        schedule_signature_payload(schedule),
        schedule["signature"],
    )
    return schedule


def test_rational_pricing_is_integer_only_and_deterministic():
    assert price_sats_for_fraction(1, 3) == 33_333_334
    assert price_sats_for_fraction(1, 1_000_000) == 100
    assert birth_value_usd_micros(100, 60_000_000_000) == 60_000
    assert birth_value_usd_micros(1, 150_000_000) == 2
    with pytest.raises(CreditError):
        price_sats_for_fraction(2, 4)


def test_signed_append_only_schedule_controls_birth_valuation():
    credit_service = service()
    schedule = publish_schedule(credit_service)
    quote = credit_service.quote("genesis-2026")
    assert schedule["schedule_index"] == 1
    assert schedule["previous_schedule_hash"] is None
    assert quote["language"] == "official issuer value"
    assert quote["schedule_hash"] == schedule["schedule_hash"]
    assert quote["tiers"][0] == {
        "tier": "common",
        "btc_fraction": {"numerator": 1, "denominator": 1_000_000},
        "price_sats": 100,
        "birth_value_usd_micros": 60_000,
    }
    next_tiers = {name: dict(fraction) for name, fraction in TIERS.items()}
    next_tiers["common"] = {"numerator": 1, "denominator": 900_000}
    successor = credit_service.publish_schedule({
        "set_id": "genesis-2026",
        "tiers": next_tiers,
    })
    assert successor["schedule_index"] == 2
    assert successor["previous_schedule_hash"] == schedule["schedule_hash"]
    assert credit_service.get_current_schedule("genesis-2026") == successor


def test_verified_purchase_atomically_issues_a_signed_birth_credit():
    registry = InMemoryCreditRepository()
    quote_provider = FakeQuoteProvider()
    credit_service = service(registry, quote_provider=quote_provider)
    schedule = publish_schedule(credit_service)
    record, created = credit_service.redeem(redemption())
    assert created is True
    assert record["schema"] == "rappter-credit-registry-entry/1"
    assert record["credit_id"].startswith("rcredit:")
    assert len(record["credit_id"]) == 72
    assert record["issuance_index"] == 1
    assert record["issuance_cap"] == 2
    assert record["valuation_schedule_id"] == schedule["schedule_id"]
    assert record["valuation_schedule_hash"] == schedule["schedule_hash"]
    assert record["tier"] == "common"
    assert record["btc_fraction"] == {"numerator": 1, "denominator": 1_000_000}
    assert record["price_sats"] == 100
    assert record["birth_value_usd_micros"] == 60_000
    assert record["btc_quote"] == {
        "source": "test-btc-usd",
        "observed_utc": NOW.isoformat(timespec="seconds"),
        "raw_response_hash": "f" * 64,
        "btc_usd_micros": 60_000_000_000,
    }
    assert record["conception_utc"] == NOW.isoformat(timespec="seconds")
    assert record["payment_reference_hash"] != "transaction-1"
    assert "transaction-1" not in json.dumps(record)
    assert credit_service.verify(record)["valid"] is True


def test_payment_is_idempotent_without_repricing_and_organism_is_unique():
    registry = InMemoryCreditRepository()
    quote_provider = FakeQuoteProvider()
    credit_service = service(registry, quote_provider=quote_provider)
    publish_schedule(credit_service)
    first, created = credit_service.redeem(redemption())
    quote_provider.quote = BtcUsdQuote(
        source="later-price",
        observed_utc=(NOW + timedelta(seconds=1)).isoformat(timespec="seconds"),
        raw_response_hash="e" * 64,
        btc_usd_micros=120_000_000_000,
    )
    repeated, repeated_created = credit_service.redeem(redemption())
    assert created is True
    assert repeated_created is False
    assert repeated == first
    assert quote_provider.calls == 1
    with pytest.raises(CreditConflict, match="organism"):
        credit_service.redeem(redemption(receipt="verified:transaction-2"))
    assert registry.issued_count == 1


def test_stale_or_unavailable_quote_refuses_without_issuance():
    stale = FakeQuoteProvider(BtcUsdQuote(
        source="stale",
        observed_utc=(NOW - timedelta(seconds=121)).isoformat(timespec="seconds"),
        raw_response_hash="f" * 64,
        btc_usd_micros=60_000_000_000,
    ))
    registry = InMemoryCreditRepository()
    credit_service = service(registry, quote_provider=stale)
    publish_schedule(credit_service)
    with pytest.raises(StaleQuote):
        credit_service.redeem(redemption())
    assert registry.credits == {}

    unavailable = service(
        InMemoryCreditRepository(),
        quote_provider=FakeQuoteProvider(error=QuoteUnavailable("offline")),
    )
    publish_schedule(unavailable)
    with pytest.raises(QuoteUnavailable):
        unavailable.redeem(redemption())


def test_primary_quote_provider_falls_back_and_hashes_raw_response():
    primary = FakeQuoteProvider(error=QuoteUnavailable("offline"))
    response = httpx.Response(
        200,
        content=b'{"result":{"XXBTZUSD":{"c":["61234.125000","1"]}}}',
        headers={"content-type": "application/json"},
    )
    fallback = PublicHttpQuoteProvider(
        source="kraken-xbt-usd-ticker",
        url="https://example.test/fallback",
        parser=lambda body: body["result"]["XXBTZUSD"]["c"][0],
        fetch_impl=lambda *_args, **_kwargs: response,
        now=lambda: NOW,
    )
    quote = FallbackQuoteProvider([primary, fallback]).fetch()
    assert quote.source == "kraken-xbt-usd-ticker"
    assert quote.btc_usd_micros == 61_234_125_000
    assert quote.raw_response_hash == hashlib.sha256(response.content).hexdigest()


def test_issuance_cap_is_enforced_before_any_partial_write():
    registry = InMemoryCreditRepository()
    credit_service = service(registry, cap=1)
    publish_schedule(credit_service)
    credit_service.redeem(redemption())
    with pytest.raises(IssuanceCapReached):
        credit_service.redeem(redemption(
            receipt="verified:transaction-2",
            organism="rappid:@owner/rapter:def",
        ))
    assert registry.issued_count == 1
    assert len(registry.credits) == 1


def test_client_declared_payment_success_is_rejected_and_disabled_adapter_never_issues():
    credit_service = service(verifier=DisabledPurchaseVerifier())
    publish_schedule(credit_service)
    with pytest.raises(CreditError, match="unknown field"):
        credit_service.redeem({**redemption(), "payment_success": True})
    with pytest.raises(PurchaseVerificationUnavailable):
        credit_service.redeem(redemption())


def test_official_issuance_fails_closed_without_a_signer():
    registry = InMemoryCreditRepository()
    credit_service = service(repository=registry, signer=DisabledRegistrySigner())
    with pytest.raises(SigningUnavailable, match="signing is not configured"):
        credit_service.publish_schedule({"set_id": "genesis-2026", "tiers": TIERS})
    assert registry.issued_count == 0
    assert registry.credits == {}
    assert registry.schedules == {}


def test_bitcoin_outpoint_is_only_accepted_from_verified_purchase():
    credit_service = service()
    publish_schedule(credit_service)
    value = redemption()
    value["provider"] = "bitcoin"
    record, _ = credit_service.redeem(value)
    assert record["bitcoin_outpoint"] == f"{'b' * 64}:0"
    with pytest.raises(CreditError, match="unknown field"):
        credit_service.redeem({**redemption("verified:transaction-2"), "bitcoin_outpoint": "x:0"})


def test_capsule_authorization_requires_matching_signed_active_credit():
    credit_service = service()
    publish_schedule(credit_service)
    record, _ = credit_service.redeem(redemption())
    authorization = credit_service.authorize_capsule({
        "credit_id": record["credit_id"],
        "organism_rappid": record["organism_rappid"],
        "core_manifest_hash": record["core_manifest_hash"],
    })
    assert authorization["schema"] == "rappter-capsule-download/1"
    assert authorization["signature"]["algorithm"] == "ES256"
    with pytest.raises(CreditError, match="does not authorize"):
        credit_service.authorize_capsule({
            "credit_id": record["credit_id"],
            "organism_rappid": record["organism_rappid"],
            "core_manifest_hash": "d" * 64,
        })


class Entity(dict):
    metadata = {"etag": 'W/"entity-etag"'}


class FakeTable:
    def __init__(self):
        self.operations = None

    def create_entity(self, _entity):
        raise ResourceExistsError("exists")

    def get_entity(self, _partition, row_key):
        if row_key == "meta:issuance":
            return Entity(issued_count=0, issuance_cap=10)
        if row_key.startswith("schedule-current:"):
            return Entity(
                PartitionKey="official",
                RowKey=row_key,
                set_id="genesis-2026",
                schedule_id="rvs_" + "1" * 32,
                schedule_hash="1" * 64,
            )
        raise ResourceNotFoundError("missing")

    def submit_transaction(self, operations):
        self.operations = operations


def test_table_issuance_is_one_etag_guarded_partition_transaction():
    table = FakeTable()
    repository = AzureTableCreditRepository(table_client=table)
    record, created = repository.issue(
        credit_id="rcredit:" + "a" * 64,
        payment_reference_hash="b" * 64,
        organism_lookup_hash="c" * 64,
        issuance_cap=10,
        set_lookup_hash="d" * 64,
        schedule_id="rvs_" + "1" * 32,
        build_record=lambda index, cap: {
            "credit_id": "rcredit:" + "a" * 64,
            "payment_reference_hash": "b" * 64,
            "owner_reference_hash": "f" * 64,
            "purchase_utc": NOW.isoformat(timespec="seconds"),
            "product_id": "rapter_hatch_1",
            "organism_rappid": "rappid:@owner/rapter:abc",
            "genesis_core_id": "d" * 64,
            "core_manifest_hash": "e" * 64,
            "issuance_index": index,
            "issuance_cap": cap,
        },
    )
    assert created is True
    assert record["issuance_index"] == 1
    assert len(table.operations) == 7
    assert [operation[1]["RowKey"].split(":", 1)[0] for operation in table.operations] == [
        "meta",
        "credit",
        "organism",
        "payment",
        "issuance",
        "ownership",
        "schedule-current",
    ]
    assert all(operation[1]["PartitionKey"] == "official" for operation in table.operations)
    for operation in (table.operations[0], table.operations[-1]):
        options = operation[2]
        assert options["mode"] == UpdateMode.REPLACE
        assert options["match_condition"] == MatchConditions.IfNotModified
        assert options["etag"] == 'W/"entity-etag"'


class FakeScheduleTable:
    def __init__(self):
        self.operations = None

    def create_entity(self, _entity):
        raise ResourceExistsError("exists")

    def get_entity(self, _partition, row_key):
        if row_key == "meta:valuation":
            return Entity(schedule_count=0)
        raise ResourceNotFoundError("missing")

    def submit_transaction(self, operations):
        self.operations = operations


def test_table_schedule_publication_is_append_only_and_etag_guarded():
    table = FakeScheduleTable()
    repository = AzureTableCreditRepository(table_client=table)
    record = repository.publish_schedule(
        set_lookup_hash="a" * 64,
        build_record=lambda index, previous: {
            "schedule_id": "rvs_" + "b" * 32,
            "schedule_hash": "b" * 64,
            "schedule_index": index,
            "set_id": "genesis-2026",
            "previous_schedule_hash": previous,
        },
    )
    assert record["schedule_index"] == 1
    assert record["previous_schedule_hash"] is None
    assert [operation[0] for operation in table.operations] == [
        "update",
        "create",
        "create",
        "create",
    ]
    assert all(operation[1]["PartitionKey"] == "official" for operation in table.operations)
    assert table.operations[1][1]["RowKey"].startswith("schedule:rvs_")
    assert table.operations[2][1]["RowKey"].startswith("schedule-index:")
    assert table.operations[3][1]["RowKey"].startswith("schedule-current:")
    assert table.operations[0][2]["etag"] == 'W/"entity-etag"'
