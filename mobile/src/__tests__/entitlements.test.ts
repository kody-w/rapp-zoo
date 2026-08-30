import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertEntitlementInvariant,
  entitlementPresentation,
} from "@/entitlements/status";
import type {
  CompanionEntitlement,
  OwnedRapterEntitlement,
  RentedPremiumRapterEntitlement,
  SovereignApplicationEntitlement,
} from "@/entitlements/types";

const now = Date.parse("2026-08-30T04:00:00.000Z");

describe("four-state product entitlements", () => {
  it("keeps the free Companion account-bound and outside scarce series", () => {
    const companion: CompanionEntitlement = {
      kind: "companion",
      accountIdHash: "account-hash",
      organismRappid: `rappid:@kody-w/companion:${"a".repeat(64)}`,
      accountCap: 1,
      transferable: false,
      scarcePremiumSeries: false,
      signatureVerified: true,
    };
    assert.equal(
      entitlementPresentation(companion, { nowMs: now, online: true }).state,
      "companion",
    );
  });

  it("shows active, stale offline, and expired rental leases honestly", () => {
    const rental: RentedPremiumRapterEntitlement = {
      kind: "rented-premium-rapter",
      leaseId: "lease-1",
      organismRappid: `rappid:@kody-w/rental:${"b".repeat(64)}`,
      activeLesseeAccountHash: "lessee-hash",
      exclusiveActiveLessee: true,
      startedUtc: "2026-08-29T00:00:00.000Z",
      expiresUtc: "2026-09-29T00:00:00.000Z",
      freshUntilUtc: "2026-08-30T05:00:00.000Z",
      lastSyncedUtc: "2026-08-30T03:55:00.000Z",
      renewal: "cancels-at-expiry",
      signatureVerified: true,
    };
    assert.equal(
      entitlementPresentation(rental, { nowMs: now, online: true }).state,
      "rented-active",
    );
    assert.equal(
      entitlementPresentation(rental, {
        nowMs: Date.parse("2026-08-30T06:00:00.000Z"),
        online: false,
      }).state,
      "rented-stale-offline",
    );
    assert.equal(
      entitlementPresentation(rental, {
        nowMs: Date.parse("2026-10-01T00:00:00.000Z"),
        online: false,
      }).state,
      "rented-expired",
    );
  });

  it("keeps one-time ownership permanent and non-subscription", () => {
    const owned: OwnedRapterEntitlement = {
      kind: "owned-rapter",
      organismRappid: `rappid:@kody-w/owned:${"c".repeat(64)}`,
      capsuleId: "d".repeat(64),
      creditId: "e".repeat(64),
      ownership: "permanent-local-capsule",
      transferableBy: "signed-registry-events",
      subscriptionRequired: false,
      signatureVerified: true,
    };
    const presentation = entitlementPresentation(owned, {
      nowMs: now,
      online: false,
    });
    assert.equal(presentation.state, "owned");
    assert.equal(presentation.usable, true);
    assert.equal(presentation.transferable, true);
  });

  it("keeps Sovereign application grants separate from organism ownership", () => {
    const sovereign: SovereignApplicationEntitlement = {
      kind: "sovereign-application",
      applicationId: "sovereign-app",
      grantId: "grant-1",
      accountIdHash: "account-hash",
      issuedUtc: "2026-08-01T00:00:00.000Z",
      expiresUtc: null,
      status: "active",
      confersOrganismOwnership: false,
      signatureVerified: true,
    };
    assert.equal(
      entitlementPresentation(sovereign, { nowMs: now, online: false }).state,
      "sovereign-active",
    );
    assert.doesNotThrow(() => assertEntitlementInvariant(sovereign));
  });
});
