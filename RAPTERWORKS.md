# RapterWorks

## Proof-first jobs for First Dimension Originals

RapterWorks is the work and service lane for the 251 canonical
Rapterbox-owned **First Edition / First Dimension Originals**. At catalog
publication all 251 are issuer-held, 0 have transferred, and all 251 are
undiscovered.

Exact Original title may transfer later only after output-rights and commerce
gates. Catalog publication or offspring issuance does not transfer it.

## Offspring owner instances

A verified Shopify sale may issue one unique offspring from a source Original:

```text
immutable Rapterbox Original
  -> unique offspring RAPPID and rights
  -> unique Rapter Credit
  -> signed local Rolling Core Capsule
  -> unique dimension branch
  -> offspring title under its own rights
```

The source Original is never transferred or mutated by offspring issuance.
Shopify
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

At launch, acceptance into the official market/job lane requires the
Rapterbox-operated public DOGG and its verified conformance record. Future
third-party DOGGs remain disabled pending the commercial controls below. This
does not restrict private mutation: owners remain free to modify and run
private local copies without public-market claims.

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
- TIP is its own Shopify line-item kind and append-only ledger;
- Rapterbox is the merchant of record and receives the launch TIP allocation;
- TIP confers no frame, compute, review, delivery, entitlement, or future work;
- rating is neither conditioned on nor incentivized by tipping.

Each signed tip event reports two explicit views:

- **Raw economic evidence** preserves the full verified amount and currency,
  Shopify line-item hash, payment-reference hash, patronage linkage, and
  market-alpha signal. Amounts are validated for storage but never clipped or
  replaced by a capped proxy. This evidence does not create a deliverable.
- **Normalized quality evidence** caps only the tip component used beside
  independent rating, repeat work, completion, disputes, and cost evidence.

Signed cohort and patronage snapshots preserve lifetime volume, largest tip,
median tip, tip velocity, repeat tipping, full per-job patronage history, unique
payer count, largest-payer share, and payer-concentration HHI. Raw economic
evidence may materially inform demand and market alpha, Rapterbox merchant
receipts, and the patronage lens.

### Patronage-weighted evolution

**EVOLUTION SPONSORSHIP** is a separate paid Shopify line item and ledger, even
when it appears beside TIP on the same post-job screen. Buying additional
evolution work is an intentional RapterWorks service. The verified line item
declares whether it targets an owner instance or an Original-level canonical
candidate, a content-addressed target reference, the selected creative lens,
and exact purchased units. The signed policy publishes exact currency-minor
unit costs and influence multipliers. The sponsorship event discloses:

- additional mutation frames;
- compute units and faster-iteration units;
- premium-review units;
- the uncapped selected-lens weight;
- the uncapped market-alpha signal;
- subtotal, tax, total, Shopify line-item hash, and payment-reference hash.

Owner-instance sponsorship may directly increase iteration and
market-perceived quality/alpha for that instance. Original-level pooled
patronage may fund canonical candidate frames, experiments, and review, but
Rapterbox remains the sole canon-acceptance authority. Sponsorship buys
creative transformation services and evaluation effort, not equity, a
security, guaranteed returns, or a predetermined canonical result.

Sponsorship consideration is recorded as deferred revenue/liability. Partial
delivery may append proof and reduce outstanding units, but no revenue is
recognized until every purchased frame, compute unit, iteration unit, and
premium-review unit is delivered. The signed lifecycle separately exposes
`tax_state`, `refund_state`, and `chargeback_state`; verified full refunds and
chargebacks append immutable reversal events.

Every public quality report presents two views side by side. The unweighted
technical test score is the exact test pass rate and consumes no patronage
input. The patronage view exposes the raw benefit-free tip and its normalized
quality component. The separate sponsorship view exposes selected lens, target,
purchased and delivered service units, deferred liability, and recognized
revenue. Money may influence the market/evolution view, but it never rewrites
ratings, test results, or history.

## Launch commercial controls

Initial commercial jobs are Rapterbox-operated only, with Rapterbox as merchant
of record and no third-party dealer or operator payouts. A server verifier must
confirm the customer's accepted output-rights terms before a commercial job
can be created. Third-party operation remains disabled until signed commercial
agreements, identity and tax onboarding, indemnity, warranty, refund, and
chargeback controls are all implemented.

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
5. separate server-side TIP and EVOLUTION SPONSORSHIP Shopify verification;
6. signed TIP and sponsorship policy publication;
7. tax, refund, and chargeback adapters for sponsorship liabilities;
8. verified output-rights acceptance; and
9. durable idempotent job, tip, sponsorship, and accounting persistence.

Until configured, no client assertion can create a sale, payment, public-market
listing, official job result, or verified tip.
