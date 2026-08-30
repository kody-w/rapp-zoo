import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertGrowthStatus,
  createPreviewHealthAdapter,
  growthPresentation,
} from "@/growth/status";
import type { GrowthPointStatus, MicroPositiveEvent } from "@/growth/types";

function status(
  computeStatus: GrowthPointStatus["computeStatus"],
): GrowthPointStatus {
  return {
    schema: "rapp-growth-points/1",
    organismRappid: `rappid:@kody-w/growth-test:${"a".repeat(64)}`,
    generation: 4,
    currentStage: 2,
    points: 80,
    nextStageThreshold: 100,
    eligibleAfterUtc: "2026-08-30T03:00:00.000Z",
    eligibilitySignatureVerified: true,
    mutationSuccessorCoreId: null,
    computeStatus,
    btcTransitionReference: {
      amountSats: 21_000,
      referenceUtc: "2026-08-30T02:00:00.000Z",
      recordHash: "b".repeat(64),
      signed: true,
      convertsFromGrowthPoints: false,
      investmentValue: false,
    },
    cashValue: null,
    purchasable: false,
    redeemable: false,
    medicalAdvice: false,
  };
}

describe("non-monetary Growth Points", () => {
  it("keeps points, stage threshold, eligibility, and BTC reference separate", () => {
    const value = status("available");
    const presentation = growthPresentation(
      value,
      Date.parse("2026-08-30T04:00:00.000Z"),
    );
    assert.equal(presentation.pointsLabel, "80 Growth Points · non-monetary");
    assert.equal(presentation.stageLabel, "Stage 2 · Generation 4");
    assert.equal(presentation.thresholdLabel, "80/100 Growth Points");
    assert.equal(presentation.mutationDue, true);
    assert.equal(presentation.mutationState, "ready");
    assert.match(presentation.btcReferenceLabel, /separate transition reference/);
  });

  it("shows mutation pending and sleeping when compute is unavailable", () => {
    for (const compute of [
      "unavailable",
      "offline",
      "budget-exhausted",
    ] as const) {
      const presentation = growthPresentation(
        status(compute),
        Date.parse("2026-08-30T04:00:00.000Z"),
      );
      assert.equal(presentation.mutationState, "pending-sleeping");
      assert.equal(presentation.mutationDue, true);
    }
  });

  it("refuses monetary or purchasable Growth Points", () => {
    const invalid = {
      ...status("available"),
      cashValue: 100,
      purchasable: true,
    } as unknown as GrowthPointStatus;
    assert.throws(
      () => assertGrowthStatus(invalid),
      /cannot be cash-valued/,
    );
  });

  it("keeps HealthKit disabled by default in preview", async () => {
    const disabled = createPreviewHealthAdapter();
    assert.equal(disabled.mode, "disabled");
    assert.equal(disabled.requiresEasNativeBuild, true);
    assert.deepEqual(await disabled.readOptInEvents(), []);
  });

  it("allows only explicit synthetic opt-in events with accessibility alternatives", async () => {
    const event: MicroPositiveEvent = {
      eventId: "event-1",
      occurredUtc: "2026-08-30T03:00:00.000Z",
      pointsDelta: 1,
      source: "preview-synthetic",
      consent: "explicit-opt-in",
      accessibilityAlternativeAvailable: true,
      rawHealthDataLeavesDevice: false,
      medicalAdvice: false,
    };
    const mock = createPreviewHealthAdapter({
      explicitlyEnableMock: true,
      syntheticEvents: [event],
    });
    assert.equal(mock.mode, "mock-preview");
    assert.deepEqual(await mock.readOptInEvents(), [event]);
  });
});
