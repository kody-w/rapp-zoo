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
5. durable idempotent job/event persistence.

Until configured, no client assertion can create a sale, payment, public-market
listing, or official job result.
