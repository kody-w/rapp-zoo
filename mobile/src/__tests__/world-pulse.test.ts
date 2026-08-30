import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertWorldPulseCheckpoint,
  worldPulsePresentation,
  type WorldPulseCheckpoint,
} from "@/growth/world-pulse";

function checkpoint(): WorldPulseCheckpoint {
  return {
    schema: "rapp-world-pulse-checkpoint/1",
    checkpointId: "a".repeat(64),
    checkpointUtc: "2026-08-30T04:00:00.000Z",
    aggregateGrowthPoints: 750_000,
    participantCount: 12_500,
    eventCount: 420_000,
    milestone: {
      milestoneId: "shared-world-1",
      signedLabel: "Shared habitat expansion",
      thresholdGrowthPoints: 1_000_000,
      progressGrowthPoints: 750_000,
      unlocked: false,
    },
    sharedWorldUnlocks: [
      {
        unlockId: "world-entry",
        signedLabel: "World entry",
        unlockedUtc: "2026-08-01T00:00:00.000Z",
        availableTo: "all-accounts",
        companionAccess: true,
        purchaseRequired: false,
      },
    ],
    audience: "all-accounts",
    companionAccess: true,
    includesRawHealthData: false,
    cashValue: null,
    investmentValue: false,
    payToWin: false,
    signatureVerified: true,
  };
}

describe("World Pulse aggregate progress", () => {
  it("keeps literal global progress separate from individual progress", () => {
    const view = worldPulsePresentation(checkpoint(), 80);
    assert.equal(view.global.pointsLabel, "750,000 global Growth Points");
    assert.equal(view.individual.pointsLabel, "80 individual Growth Points");
    assert.equal(view.global.milestonePercent, 75);
    assert.equal("combinedPoints" in view, false);
  });

  it("is available to free Companion accounts without purchase", () => {
    const value = checkpoint();
    assert.equal(value.audience, "all-accounts");
    assert.equal(value.companionAccess, true);
    assert.equal(value.sharedWorldUnlocks[0]?.purchaseRequired, false);
    assert.doesNotThrow(() => assertWorldPulseCheckpoint(value));
  });

  it("refuses raw health data, financial value, or pay-to-win checkpoints", () => {
    for (const mutation of [
      { includesRawHealthData: true },
      { cashValue: 100 },
      { investmentValue: true },
      { payToWin: true },
    ]) {
      const invalid = {
        ...checkpoint(),
        ...mutation,
      } as unknown as WorldPulseCheckpoint;
      assert.throws(
        () => assertWorldPulseCheckpoint(invalid),
        /universal, non-financial, health-private, and not pay-to-win/,
      );
    }
  });

  it("requires a signed aggregate checkpoint and consistent milestone", () => {
    const unsigned = { ...checkpoint(), signatureVerified: false };
    assert.throws(
      () => assertWorldPulseCheckpoint(unsigned),
      /signature or identity/,
    );
    const inconsistent = checkpoint();
    inconsistent.milestone.progressGrowthPoints = 1_000_000;
    assert.throws(
      () => assertWorldPulseCheckpoint(inconsistent),
      /milestone progress is inconsistent/,
    );
  });
});
