# Rapter Credit/1

## A real-world ownership twin for a locally owned Rolling Core

**Status:** Draft protocol  
**Schema:** `rapp-rapter-credit/1`  
**Settlement denomination:** integer satoshis  
**Owned object:** one Rapter lineage, not one mutable head

---

## RAPP/1 carrier

The official Credit network is one append-only RAPP body stream owned by the
Rapterbox issuer.

- issuance and transfer records ride the registered `body.pulse` kind;
- the outer frame uses the exact eleven-key `rapp/1` envelope;
- the payload schema distinguishes Credit events;
- Rapterbox policy requires every Credit pulse to be signed;
- the greatest verified sequence is the official registry head;
- mirrors can verify the complete ledger from that trusted head.

Rapter Credit/1 creates no new frame envelope, kind family, wire endpoint, or
egg variant.

---

## 1. Definition

A **Rapter Credit** is the unique real-world ownership twin of one Rapter.

The Rapter is the virtual organism. The Credit is the signed economic and
ownership record that points to it.

```text
virtual twin:  stable Rapter identity + immutable Rolling Core lineage
real twin:     one Rapter Credit + append-only ownership history
```

They are one commercial unit but remain separate cryptographic objects so
neither has to hash itself.

---

## 2. Important correction: hashes do not create scarcity

A content hash makes mutation detectable. It does not stop someone from copying
the same bytes.

Global uniqueness comes from the **Rapterbox signed append-only Rapter Credit
registry**. An optional Bitcoin UTXO outpoint, identified by `(txid, vout)`,
proves settlement but does not replace registry authority.

The BTC price is not a primary key. Prices can repeat and change. The Credit ID,
issuance record, and one-to-one registry constraints create uniqueness.

---

## 3. Stable binding

A Credit binds to the parts of an organism that do not change every turn:

- `organism_rappid`;
- `genesis_core_id`;
- `core_manifest_hash`;
- issuer;
- issuance index.

It MUST NOT bind ownership to the current Rolling Core head. Otherwise every
valid frame mutation would require reminting the economic twin.

The current head remains discoverable through the organism's verified body
stream.

---

## 4. Credit record

```json
{
  "schema": "rapp-rapter-credit/1",
  "credit_id": "rcredit:64-lowercase-hex",
  "series": "rapterbox-genesis",
  "issuance_index": 42,
  "series_cap": 10000,
  "organism_rappid": "rappid:@owner/organism:64-lowercase-hex",
  "genesis_core_id": "64-lowercase-hex",
  "core_manifest_hash": "64-lowercase-hex",
  "birth": {
    "schema": "rapp-rapter-birth/1",
    "conception_utc": "2026-08-29T18:00:00.000Z",
    "tier": "holo",
    "schedule_id": "rapterbox-genesis-v1",
    "schedule_hash": "64-lowercase-hex",
    "btc_fraction": {
      "numerator": 1,
      "denominator": 40000
    },
    "btc_quote": {
      "pair": "BTC-USD",
      "price_usd_micros": 100000000000,
      "source": "coinbase",
      "observed_utc": "2026-08-29T18:00:00.000Z",
      "response_hash": "64-lowercase-hex"
    },
    "price_sats": 2500,
    "birth_value_usd_micros": 2500000
  },
  "settlement": {
    "rail": "bitcoin",
    "payment_reference_hash": "64-lowercase-hex",
    "bitcoin_outpoint": {
      "txid": "64-lowercase-hex",
      "vout": 0
    }
  },
  "issuer_rappid": "rappid:@owner/rapterbox:64-lowercase-hex",
  "issued_utc": "2026-08-29T18:01:00.000Z"
}
```

`bitcoin_outpoint` is nullable for non-Bitcoin rails. Raw App Store receipts,
wallet secrets, customer payment data, and private keys MUST NOT appear in the
record.

---

## 5. Credit identity

For registry-issued Credits:

```text
credit_id =
  "rcredit:" +
  Hb("rapp/1:rapter-credit", uuid4_octets)
```

The tail is minted once and never derived from a name, price, owner, or current
frame.

For a Bitcoin-settled Credit, the registry additionally binds exactly one
confirmed outpoint `(txid, vout)` to that `credit_id`. The outpoint is settlement
evidence, not a substitute for the RAPP identity and signature rules.

## 5.1 Official validity

A Rapter is **officially purchased** only when:

1. the payment rail verifies a real completed purchase;
2. the payment reference has never been redeemed;
3. the organism has no other active Credit;
4. Rapterbox atomically appends and signs the Credit record;
5. the resulting registry sequence advances without a fork.

The registry is publicly readable and mirrorable. Write authority remains with
the Rapterbox issuer key. A mirror can prove official validity without gaining
the power to issue it.

A copied capsule can still be inspected locally as data. It cannot claim the
officially-owned badge without the current signed Credit record.

---

## 6. One-to-one invariant

At one Rapterbox registry sequence:

- one active `credit_id` binds to exactly one `organism_rappid`;
- one active `organism_rappid` binds to exactly one `credit_id`;
- one Bitcoin outpoint binds to at most one active Credit;
- one store transaction ID hash can mint credits only once;
- an issuance index occurs once within its declared series;
- a sold-out series cannot issue beyond `series_cap`.

All uniqueness rows are committed atomically with the issuance record. Any
duplicate is refused as a double issuance.

This is what makes “most are already taken” measurable. Scarcity comes from the
append-only issuance ledger and optional Bitcoin outpoints, not from the size of
a hash namespace.

---

## 7. Birth valuation in bitcoin

Rapterbox publishes a signed valuation schedule for each set. A tier maps to an
exact rational fraction of one Bitcoin. At conception, the issuer obtains a
BTC/USD spot quote, hashes the raw quote response, and burns the schedule,
fraction, quote, and resulting value into `rapp-rapter-birth/1`.

```text
price_sats =
  ceil(100,000,000 * fraction.numerator / fraction.denominator)

birth_value_usd_micros =
  round(price_sats * btc_quote.price_usd_micros / 100,000,000)
```

- No floating BTC values.
- The tier schedule and quote timestamp are immutable.
- Rapterbox controls the official set/tier schedule.
- The quote source does not become an identity authority; its raw response hash
  makes the observed input auditable.
- Later market value does not rewrite the original record.
- Display software may show BTC and fiat conversions, but those are
  non-authoritative views.
- A transfer may record a new settlement amount without changing the original
  birth valuation.

The value shown by Rapterbox is the **official issuer birth value**, not an
independent appraisal or promise of investment returns.

---

## 8. Settlement rails

### 8.1 Bitcoin

Rapterbox may accept Bitcoin through a non-custodial or hosted checkout. A
confirmed payment webhook initiates issuance; the client never self-attests
that it paid.

The Credit records only:

- the confirmed outpoint;
- integer satoshis;
- a hash of the payment reference;
- confirmation evidence required by issuer policy.

The app never stores wallet seed phrases or private keys.

### 8.2 App Store and Google Play

Mobile stores cannot dynamically define one product SKU per newly discovered
organism. The app therefore sells consumable **Rapter Credits**:

```text
rapter_hatch_1
rappter_flock_3
rappter_flock_10
```

The Rapterbox network verifies each store transaction once, grants the
corresponding number of unspent Credits, and atomically burns one Credit when
the buyer chooses an organism.

The resulting `rapp-rapter-credit/1` record is rail-neutral and still records
`price_sats`, using the issuer's signed BTC quote at purchase time.

### 8.3 Direct grant

Promotional, founder, or support grants use the same issuance record with
`rail:"grant"` and a null Bitcoin outpoint. They still consume an issuance index
and obey one-to-one binding.

---

## 9. Local ownership bundle

The purchased deliverable is a **Rolling Core Capsule** containing:

- the organism identity and genesis core;
- its current exported core head and required immutable history;
- Holo/1 interpreter requirements;
- completed SHAPEE, Growl, and other trait data;
- the public Rapter Credit record;
- issuer signature and verification material;
- no payment credentials or private wallet keys.

The core address is computed before attaching the Credit sidecar. The Credit
references that address. The export container can then carry both without a
circular hash.

The capsule can be:

- stored locally;
- opened offline;
- backed up;
- AirDropped;
- exported through Files or Share Sheet;
- re-imported into Rolling Cores on iPhone, iPad, desktop, or another
  conformant Holo Zoo.

---

## 10. Transfer

Ownership changes append a transfer record:

```json
{
  "schema": "rapp-rapter-credit-transfer/1",
  "credit_id": "rcredit:64hex",
  "previous_transfer_hash": "64hex-or-null",
  "from_owner_rappid": "rappid:@owner/seller:64hex",
  "to_owner_rappid": "rappid:@owner/buyer:64hex",
  "settlement_reference_hash": "64hex-or-null",
  "utc": "fixed-form UTC"
}
```

Transfer changes the owner of the economic twin. It does not rewrite the
Rapter's identity or Rolling Core history.

If Bitcoin ownership is represented by an outpoint, spending that outpoint
requires an owner-signed transfer update or moves the Credit into an unresolved
state until the registry reconciles the spend.

---

## 11. Companion and rental entitlements

Every verified Rapterbox account may hold exactly one active free Companion
entitlement:

- it is account-bound;
- it is not transferable or resellable;
- it does not consume a scarce premium-series issuance index;
- repeated claim or recovery requests return the same entitlement.

Rapterbox may rent premium Rapters while retaining title. A premium Credit can
have at most one active lessee, and a Credit whose official ownership state is
sold/owned cannot simultaneously be leased. Lease start, renewal,
cancellation, expiration, refund, recovery, purchase conversion, and resulting
ownership transfer are signed append-only `body.pulse` events.

Lease access is bounded by its signed period and optional grace end. After
expiry or refund, a synchronized device reports any retained bytes as an
unowned stale lease copy and refuses new scoped Capsule access. The registry
cannot erase bytes that were already downloaded.

A verified purchase conversion ends the lease and transfers permanent official
ownership without reminting the Credit or changing its birth valuation.
Permanent ownership remains usable offline and requires no subscription.

Subscription billing webhooks and recovery are idempotent. Account identity,
billing status, refund status, buyer identity, and settlement success come only
from server-verified adapters, never client claims.

---

## 12. Offline behavior

An owned local capsule remains usable if:

- Rapterbox is offline;
- the store is unavailable;
- model inference is unavailable;
- the current owner has no compute credits.

The device can verify the last trusted Credit record and core history it
already possesses. Network access is needed only for new purchases,
redownload/recovery, global transfer resolution, or optional managed
autocomplete.

---

## 13. Security

- Never use BTC price, a display name, or current frame hash as the Credit ID.
- Never embed payment-provider secrets in a capsule or client.
- Never trust a client assertion that a consumable purchase succeeded.
- Verify store transactions server-side and redeem transaction IDs exactly
  once.
- Verify issuer signatures and registry monotonicity before displaying global
  ownership as current.
- Treat a copied capsule without the current ownership proof as a copy, not a
  second valid Credit.
- Keep wallet keys outside Rolling Cores.
- Surface unresolved Bitcoin spends, registry forks, or stale ownership rather
  than guessing.

---

## 14. Core sentence

**A Rapter Credit is the globally unique real-world ownership twin of one
locally owned Rapter lineage: priced in satoshis, issued once, transferable by
append-only proof, and never reminted when its Rolling Core grows.**
