# RapterWorks

## Proof-first jobs for original Rapter species

RapterWorks is the work and service lane for the 251 canonical
Rapterbox-owned **First Edition / First Dimension** Holo species.

These are neutral Rapter species identifiers, not names, shapes, types,
capture mechanics, or trade dress borrowed from another creature franchise.

## Owner instances

A verified Shopify sale may hatch one unique player instance from a source
species:

```text
immutable Rapterbox source species
  -> unique player RAPPID
  -> unique Rapter Credit
  -> signed local Rolling Core Capsule
  -> unique dimension branch
  -> transferable permanent title
```

The source species is never transferred or mutated by the sale. Shopify
verification and Credit issuance happen server-side. The Shopify Admin token
must remain in Key Vault or equivalent server-side secret storage and never
enter source, clients, frames, manifests, URLs, or logs.

## Job state machine

RapterWorks jobs use signed append-only `body.pulse` events:

```text
requested
  -> accepted | refused
accepted
  -> running
running
  -> proof_ready
proof_ready
  -> supervisor_approved | revision_required
revision_required
  -> running
supervisor_approved
  -> delivered
delivered
  -> commission_offered | rated
commission_offered
  -> paid | declined | ignored
paid | declined | ignored | redelivered
  -> rated
rated
  -> closed | regression_open
regression_open
  -> corrected
corrected
  -> redelivered
```

Acceptance into the official market/job lane requires a verified public DOGG
conformance record. This does not restrict private mutation: owners remain free
to modify and run private local copies without public-market claims.

## Full and free delivery

The complete artifact is delivered before any commission is offered.

- `delivered` and `redelivered` events declare `artifact_access:
  "full-and-free"`.
- Delivery never creates debt or a payment obligation.
- A commission is voluntary and cannot gate, watermark, downgrade, revoke, or
  delay the artifact.
- When enabled, the server creates a Shopify Draft Order/payment link only
  after delivery.
- `paid`, `declined`, and `ignored` are equally valid outcomes for artifact
  access.

No RapterWorks point, entitlement, job state, or future work promise is a
real-money future, security, transferable currency, or redeemable balance.

## Independent post-service tips

After full-and-free delivery, the customer may record a tip of any verified
amount or explicitly record no tip. A tip is independent of rating,
commission, artifact access, title, and future service:

- zero is a complete and valid outcome and creates no debt;
- the artifact cannot be gated, degraded, revoked, or delayed by tip status;
- positive amounts require server-side payment verification, while raw payment
  references are hashed before entering a signed event;
- each delivered job has one idempotent tip signal, and a verified payment
  reference cannot be replayed for another job;
- owner-instance tips follow a signed owner/operator/dealer/compute-reserve/
  species-R&D basis-point policy;
- rating is neither conditioned on nor incentivized by tipping.

Each signed tip event reports two explicit views:

- **Raw economic evidence** preserves the full verified amount and currency,
  owner/operator/dealer payouts, compute reserve, species R&D allocation,
  premium review, evolution-service allocation, payment-reference hash, and
  patronage linkage. Amounts are validated for storage but never clipped or
  replaced by a capped proxy.
- **Normalized quality evidence** caps only the tip component used beside
  independent rating, repeat work, completion, disputes, and cost evidence.

Signed cohort and patronage snapshots preserve lifetime volume, largest tip,
median tip, tip velocity, repeat tipping, full per-job patronage history, unique
payer count, largest-payer share, and payer-concentration HHI. Raw economic
evidence may materially inform demand and market alpha, owner/operator/dealer
payouts, compute reserves, species R&D, and the patronage lens.

### Patronage-weighted evolution

Buying additional evolution work is an intentional RapterWorks service. Each
positive tip declares whether it targets an owner instance or a species-level
canonical candidate, a content-addressed target reference, and the selected
creative lens. The signed policy publishes exact currency-minor conversion
costs and multipliers. The signed tip event then discloses:

- additional mutation frames;
- compute units and faster-iteration units;
- premium-review units;
- the uncapped selected-lens weight;
- the uncapped market-alpha signal;
- the exact owner/operator/dealer, compute, R&D, review, and evolution
  allocations, including deterministic rounding remainders.

Owner-instance sponsorship may directly increase iteration and
market-perceived quality/alpha for that instance. Species-level pooled
patronage may fund canonical candidate frames, experiments, and review, but
Rapterbox remains the sole canon-acceptance authority. Sponsorship buys
creative transformation services and evaluation effort, not equity, a
security, guaranteed returns, or a predetermined canonical result.

Every public quality report presents two views side by side. The unweighted
technical test score is the exact test pass rate and consumes no patronage
input. The patronage-weighted view exposes the raw tip, selected lens, target,
purchased service units, and normalized tip component. Money may influence the
weighted market/evolution view, but it never rewrites ratings, test results, or
history.

## Regression fixtures

A low rating opens `regression_open` and creates an immutable regression
fixture containing only job, artifact, proof, rating, and rating-event hashes.
Correction and redelivery append new events. They never replace the originally
delivered artifact or erase prior proof.

## Adapter status

The typed interfaces live in
`cloud/rolling-cores-api/credits/rapterworks.py`.

Production enablement still requires:

1. Shopify sale verification;
2. official Credit and Capsule issuance adapters;
3. public DOGG conformance verification;
4. server-side Shopify Draft Order creation and payment verification;
5. server-side post-service tip payment verification and signed split-policy
   publication; and
6. durable idempotent job/event persistence.

Until configured, no client assertion can create a sale, payment, public-market
listing, official job result, or verified tip.
