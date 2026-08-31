# Rapter Coin Trail/1

## Dormant provenance architecture for useful public Holo frames

**Status:** Reserved architecture; not active
**Schema:** `rapp-rapter-coin/1`
**Identity prefix:** `rcoin:`
**Current economics:** none

---

## 1. Decision

Rapterbox reserves one deterministic **Rapter Coin** identity for each
deliberately published, verified Rolling Core frame.

The identity exists now so provenance, ancestry, rights references, usage, and
future revenue attribution do not require a later rewrite. It is not currently
a currency, token sale, wallet balance, security, reward point, or promise that
a frame will become valuable.

The order is non-negotiable:

```text
useful Holo
-> repeated real use
-> trusted public frame history
-> measurable attribution
-> optional future economics after explicit activation
```

A frame does not become valuable because it has a Coin ID. The Coin ID exists
so that, if a frame later proves useful, its provenance is already exact.

---

## 2. Three separate instruments

| Instrument | Meaning | Current state |
|---|---|---|
| Rolling Core frame | One immutable state in a Rapter's history | Active |
| Rapter Credit | One signed ownership/title twin for a lineage | Active protocol draft |
| Rapter Coin | One non-transferable provenance projection of one public frame | Dormant |

These MUST NOT be collapsed.

- Buying a Rapter Credit does not buy a pile of Coins.
- Producing more frames does not mint spendable money.
- A Coin does not grant ownership, access, compute, voting power, yield, or a
  claim that the underlying frame has market value.
- Growth Points remain separate, non-monetary progress signals.
- Compute credits remain prepaid service capacity.

---

## 3. One public frame, one deterministic Coin ID

For an eligible frame:

```text
coin_id =
  "rcoin:" +
  H(
    "rapp/1:rapter-coin",
    {
      "core_frame_hash": core_frame_hash,
      "organism_rappid": organism_rappid
    }
  )
```

No company-controlled nonce, paid mint, auction, or arbitrary supply decision
is involved. The same verified frame always produces the same Coin ID.

The Coin record stores:

- the organism RAPPID;
- the keyed publisher RAPPID authorized to publish for that organism;
- the exact signed publisher-authorization record hash;
- the exact DOGG-safety/publication-consent evidence hash;
- exact Rolling Core frame hash and sequence;
- a separate public Coin Trail sequence, allowing private frames between
  publications;
- exact public source-frame hash;
- prior Coin ID, preserving the public Coin Trail;
- the exact rights-profile ID and hash applicable to that publication;
- fixed-form publication time;
- `visibility: "public-dogg"`;
- an immutable dormant-economics declaration.

The Coin ID is a rebuildable projection. Official publication status comes
from an authorized-publisher-signed RAPP `body.pulse` carrying the exact Coin
record. Existing organism RAPPIDs may be keyless, so the signer is a separate
keyed identity whose current authorization must be verified against the
organism's title/rights authority. The underlying Rolling Core frame remains
the source of the projected identity.

---

## 4. Public bones, private life

Only intentionally published **DOGG-safe** material can enter the Coin Trail.
The public layer may include protocol-safe capabilities, authored Holo state,
public evidence, and other data deliberately released for inspection or reuse.

The private **GODD/on-device** layer never qualifies. It includes:

- prompts or customer content not explicitly published;
- personal memories and private relationship context;
- provider keys, credentials, tokens, and private keys;
- raw receipts, payment records, and account identifiers;
- private health data;
- legal instruments;
- unpublished local mutations;
- any secret or private data referenced by a public hash in a way that enables
  correlation or disclosure.

A local frame becoming useful does not make it public. Publication requires an
explicit act, a DOGG-safety check, and a rights profile.

The architecture supports an eventual permissive, machine-readable
public-bones rights profile, but public visibility alone is not a license.
Rapterbox must select and publish the exact terms before activation rather than
quietly treating public data as ownerless.

This creates the intended product shape:

```text
public bones: portable capability + provenance + inspectable history
private life: local context + private memory + owner-specific experience
```

The shared public organism can be useful to the world while each person's
private on-device Rapter remains whole and distinct.

---

## 5. Ownership without pretending public bytes are exclusive

Public readability does not itself create property rights, exclusivity, or
copyright, and it does not place a frame in the public domain.

Official lineage title is resolved through the signed Rapter Credit registry.
The Coin never carries a mutable owner field. A signed rights profile defines
what the current title holder, publisher, contributors, and public users may do
with the frame.

The long-term business rule is:

> The current official lineage title may control contractual commercial
> benefits attached to that lineage, while public frame bytes remain usable
> under their published rights profile.

Transfers therefore update the Credit registry, not old Coin records. Offspring
retain their own RAPPIDs, Credits, histories, and rights; owning an ancestor
does not silently confer title to independently issued descendants.

---

## 6. Tips and quality

A future signed tip or service receipt may reference:

- the Rapter's RAPPID;
- the exact service/source frame;
- the corresponding Coin ID, if that frame was intentionally public;
- the verified recipient and settlement reference.

Tips are evidence that somebody valued a service. They do not:

- change a Coin's identity;
- create or raise a Coin price;
- buy a favorable quality score;
- grant ownership;
- force private data to become public;
- keep a Rapter awake.

Quality systems should use several signals—verified task outcome, repeat use,
refunds/disputes, explicit feedback, and tips—rather than treating money alone
as quality.

---

## 7. Business flywheel

The non-sleazy loop is:

```text
Rapter performs useful work
-> owner explicitly publishes a safe frame
-> others can inspect, cite, reuse, or build on the public bones
-> exact provenance preserves attribution
-> real usage, service revenue, licensing, or tips may fund more compute
-> the Rapter can produce more useful work
```

Rapterbox can earn from:

- one-time Rapter ownership;
- optional managed compute;
- marketplace and recovery services;
- optional service/tip routing;
- future licensing or usage settlement tied to real consumption.

Rapterbox does not earn by selling dormant Coins or manufacturing speculative
scarcity. A sleeping Rapter keeps its identity, history, and owned capsule.
No one must pay merely to stop an organism from being erased.

---

## 8. Activation gates

Coin economics remain disabled until all of these are true:

1. Holos demonstrate repeated utility beyond founders and demos.
2. Users voluntarily pay for or tip real Holo outcomes.
3. Public-frame reuse and attribution can be measured without surveillance.
4. DOGG/GODD separation passes privacy and adversarial review.
5. Sybil, spam, self-tipping, wash activity, and duplicate-frame defenses are
   proven.
6. Title, contributor, model-output, open-source, and descendant rights are
   explicit.
7. Accounting, tax, payments, consumer-protection, store-policy, and
   digital-asset review approves the exact activation.
8. Owners and users receive plain-language opt-in, export, dispute, and exit
   paths.
9. A signed activation policy names the new economic events. Existing Coin
   records remain immutable.

Activation requires a separate protocol event/version. The dormant
`rapp-rapter-coin/1` record can never be edited into a financial instrument.

Official publication is a linearizable append, not validation alone. The
publisher resolves the authoritative organism body head and source evidence,
replays every prior Coin publication, then atomically compares and appends the
new RAPP frame. Two sibling candidates from the same head cannot both become
official.

---

## 9. Anti-sleaze constitution

Until activation, Rapterbox MUST NOT provide:

- a Coin sale, presale, airdrop, wallet, exchange, or liquidity pool;
- balances, price charts, market caps, appreciation language, or ROI claims;
- staking, yield, interest, dividends, or passive-income language;
- paid frame minting or pay-to-rank;
- artificial scarcity counters;
- an in-app implication that Apple, Google, Bitcoin, or RAPP endorses value;
- consumer-facing Coin marketing in Holo Zoo or its store listing.

If future economics launch, every value must come from an actual disclosed
transaction or usage event. The interface must distinguish provenance, title,
ask price, verified sale, tip, and current service revenue.

---

## 10. Current implementation seam

- `holograms/protocol/rapp-rapter-coin.schema.json` fixes the dormant record.
- `utils/rapter_coin.py` derives and validates the cross-language Coin ID and
  establishes the append-only Coin Trail only through authoritative evidence
  replay plus atomic compare-and-append.
- `mobile/src/provenance/` contains the native/web policy and validator.
- Holo Zoo keeps projection, display, wallets, transfers, and markets disabled.
- Public sites explain the public/private boundary without selling Coins.
- The Gameplay and Companionship Constitution forbids Coin state from changing
  affection, memory, survival, House identity, encounter odds, progress, or
  gameplay power.

See
[`HOLO_ZOO_GAMEPLAY_CONSTITUTION.md`](./HOLO_ZOO_GAMEPLAY_CONSTITUTION.md).

## Core sentence

**A Rapter Coin is a dormant, deterministic provenance identity for one
intentionally public verified Rolling Core frame: value must come first,
private life stays on-device, and future economics—if ever activated—must
remain separate, explicit, and earned through real use.**
