import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertStarterStageTimeline,
  stageTimelinePresentation,
  type StarterStageTimeline,
} from "@/growth/stage-timeline";

function timeline(): StarterStageTimeline {
  const familyId = "genesis-family-001";
  return {
    schema: "rapp-starter-stage-timeline/1",
    familyId,
    stages: [
      {
        stage: "origin",
        ordinal: 0,
        requiredGrowthPoints: 0,
        eligibleAfterUtc: "2026-08-01T00:00:00.000Z",
        freeOrigin: true,
        officialReference: null,
        purchaseRequired: false,
        payToEvolve: false,
      },
      {
        stage: "journey",
        ordinal: 1,
        requiredGrowthPoints: 100,
        eligibleAfterUtc: "2026-09-01T00:00:00.000Z",
        freeOrigin: false,
        officialReference: {
          familyId,
          issuerReferenceSats: 23_438,
          btcUsdCentsPerBtc: 6_400_000,
          fiatReferenceCents: 1_500,
          quoteUtc: "2026-08-01T00:00:00.000Z",
          recordHash: "a".repeat(64),
          signatureVerified: true,
          priceOwed: false,
          cashValue: false,
          resaleGuarantee: false,
        },
        purchaseRequired: false,
        payToEvolve: false,
      },
      {
        stage: "ascendant",
        ordinal: 2,
        requiredGrowthPoints: 250,
        eligibleAfterUtc: "2026-10-01T00:00:00.000Z",
        freeOrigin: false,
        officialReference: {
          familyId,
          issuerReferenceSats: 54_688,
          btcUsdCentsPerBtc: 6_400_000,
          fiatReferenceCents: 3_500,
          quoteUtc: "2026-08-01T00:00:00.000Z",
          recordHash: "b".repeat(64),
          signatureVerified: true,
          priceOwed: false,
          cashValue: false,
          resaleGuarantee: false,
        },
        purchaseRequired: false,
        payToEvolve: false,
      },
    ],
    signatureVerified: true,
  };
}

describe("starter stage timeline", () => {
  it("shows free Origin and separate signed Journey/Ascendant references", () => {
    const value = timeline();
    assert.doesNotThrow(() => assertStarterStageTimeline(value));
    const presentation = stageTimelinePresentation(
      value,
      120,
      Date.parse("2026-09-02T00:00:00.000Z"),
    );
    assert.equal(presentation[0]?.officialReferenceLabel, "FREE ORIGIN");
    assert.match(
      presentation[1]?.officialReferenceLabel ?? "",
      /23,438 sats · ≈\$15\.00 at/,
    );
    assert.match(
      presentation[2]?.officialReferenceLabel ?? "",
      /54,688 sats · ≈\$35\.00 at/,
    );
  });

  it("requires both Growth Points and eligible-after UTC without pay-to-evolve", () => {
    const value = timeline();
    const beforeUtc = stageTimelinePresentation(
      value,
      120,
      Date.parse("2026-08-15T00:00:00.000Z"),
    );
    assert.equal(beforeUtc[1]?.unlocked, false);
    const insufficientPoints = stageTimelinePresentation(
      value,
      99,
      Date.parse("2026-09-02T00:00:00.000Z"),
    );
    assert.equal(insufficientPoints[1]?.unlocked, false);
    const eligible = stageTimelinePresentation(
      value,
      100,
      Date.parse("2026-09-02T00:00:00.000Z"),
    );
    assert.equal(eligible[1]?.unlocked, true);
    assert.equal(value.stages[1].purchaseRequired, false);
    assert.equal(value.stages[1].payToEvolve, false);
  });

  it("refuses references that imply price owed or resale value", () => {
    const invalid = timeline();
    const reference = invalid.stages[1].officialReference!;
    (reference as unknown as { priceOwed: boolean }).priceOwed = true;
    assert.throws(
      () => assertStarterStageTimeline(invalid),
      /non-financial/,
    );
  });
});
