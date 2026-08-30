# Holo Zoo entitlement interface

This document records the next UI/backend contract without delaying the
integration-ready Expo handoff. The typed source of truth is
`src/entitlements/types.ts`; presentation rules are in
`src/entitlements/status.ts`.

## Four product states

1. **Free Companion**
   - Exactly one per account.
   - Account-bound and non-transferable.
   - Outside scarce premium Rapter series.
2. **Rented premium Rapter**
   - A subscription lease, never ownership.
   - Exactly one active lessee.
   - Carries start, expiry, freshness, last-sync, renewal, and cancel-at-expiry
     evidence.
   - Offline UI must show `RENTAL STALE · SYNC REQUIRED` after `freshUntilUtc`
     and `RENTAL EXPIRED` after `expiresUtc`.
3. **Owned Rapter**
   - One-time permanent signed Rolling Core Capsule plus Rapter Credit.
   - Never requires a subscription for local viewing, playback, history,
     import, export, or backup.
   - Official transfer occurs only through signed registry events.
4. **Sovereign application**
   - A separate application grant with its own issuance, expiry/revocation, and
     signature status.
   - Does not silently confer ownership of any Rapter.

## UI integration boundary

The current handoff intentionally stops at typed interfaces and tested state
derivation. A later UI patch should consume only verified server snapshots,
show rental renewal/cancel controls through store-compliant subscription APIs,
and never reinterpret a rental as capsule ownership. Owned local capsules
remain usable when rental or Sovereign grants expire.
