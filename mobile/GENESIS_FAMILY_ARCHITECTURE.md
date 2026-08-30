# First Edition / First Dimension interface

This document replaces the earlier family-count proposal without delaying the
integration-ready Expo handoff. The authoritative typed contracts live in
`src/genesis/types.ts`, with tested invariants in `src/genesis/status.ts`.

## Canonical First Edition

- Exactly **251 unique Originals**.
- Edition: **First Edition**.
- Dimension: **First Dimension**.
- At catalog publication all 251 titles are issuer-held.
- Transferred title count is exactly zero.
- All 251 Originals are undiscovered.
- Each catalog entry references the shared authored shadow Holo and sealed
  authored full Holo. The client must never invent fallback morphology,
  silhouettes, creature names, type charts, or capture mechanics.

An exact Original title may transfer only after rights acceptance, verified
commerce settlement, verified owner identity, and signed registry readiness.
No client purchase-success flag can transfer title.

## Offspring and player dimensions

Player-owned offspring are separate issuances derived from an Original line.
Every offspring has:

- a distinct organism RAPPID;
- a separate signed capsule;
- a separate rights grant;
- no ownership claim over the parent Original title.

Different owners may therefore grow different First Dimension instances from
the same Original line without merging identities, rights, or immutable frame
histories.

## Companion origins

The three already-canonical free Companion origins remain one-per-account,
account-bound, and non-transferable. They sit outside the scarce premium
inventory of 251 Original titles and do not change the Original counts.

## Generation evidence

Generation and `mutation_due` remain derived from signed
`eligible_after_utc`. Due is not mutated. Without a verified successor, the UI
must show pending/sleeping when compute is unavailable and retain every prior
frame immutably.

## Deferred UI boundary

The immediate integration ships types and tests only. Future UI must consume
the signed catalog and shared authored shadow/full-Holo references; it must not
manufacture placeholder bodies or transfer rights before the commerce gates.
