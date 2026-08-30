# Genesis Family interface

This document records the signed family and generation contract without
delaying the integration-ready Expo handoff. The typed interfaces live in
`src/genesis/types.ts`, with tested presentation rules in
`src/genesis/status.ts`.

## Canonical catalog

- Exactly **151 canonical Genesis Families**.
- Family indexes **1–3** are free Companion Families.
- Each Companion Family allows exactly one account-bound, non-transferable
  instance per account and is outside the scarce premium series.
- Family indexes **4–151** are the 148 premium families.
- Every premium family carries issuer-signed positive supply and simultaneous
  lease caps.

Family identifiers and display names must come from the signed canonical
catalog. The app must not generate creature names, elemental/type charts,
capture mechanics, or body silhouettes.

## Generation and mutation timing

Generation status comes from signed `eligible_after_utc` evidence. The UI may
display `Generation N` and `mutation_due`, but eligibility is not a mutation.
A mutation is shown only after a verified successor Rolling Core exists.

If compute is unavailable, offline, or budget-exhausted when mutation becomes
due, the truthful state is **Mutation due · Pending / Sleeping**. Old frames
remain immutable and inspectable; no placeholder frame, silhouette, or fake
evolution is generated.

## Deferred UI boundary

The immediate integration ships these interfaces and tests only. A later UI
patch should consume a verified 151-family catalog and signed generation
evidence without changing permanent Capsule/Credit ownership or the separate
Companion, rental, and Sovereign entitlement contracts.
