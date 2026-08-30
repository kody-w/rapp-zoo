import type {
  GrowthPointStatus,
  GrowthPresentation,
  HealthDataAdapter,
  MicroPositiveEvent,
} from "./types";

const HEX64 = /^[0-9a-f]{64}$/;

export function growthPresentation(
  status: GrowthPointStatus,
  nowMs: number,
): GrowthPresentation {
  assertGrowthStatus(status);
  const due = nowMs >= Date.parse(status.eligibleAfterUtc);
  const verified = status.mutationSuccessorCoreId !== null;
  const mutationState = verified
    ? "verified"
    : !due
      ? "not-due"
      : status.computeStatus === "available"
        ? "ready"
        : "pending-sleeping";
  return {
    pointsLabel: `${status.points.toLocaleString("en-US")} Growth Points · non-monetary`,
    stageLabel: `Stage ${status.currentStage} · Generation ${status.generation}`,
    thresholdLabel:
      status.nextStageThreshold === null
        ? "Final signed threshold reached"
        : `${status.points}/${status.nextStageThreshold} Growth Points`,
    eligibleAfterLabel: `Eligible after ${status.eligibleAfterUtc}`,
    mutationDue: due,
    mutationState,
    btcReferenceLabel:
      status.btcTransitionReference === null
        ? "No BTC transition reference"
        : `${status.btcTransitionReference.amountSats.toLocaleString(
            "en-US",
          )} sats · separate transition reference`,
  };
}

export function assertGrowthStatus(status: GrowthPointStatus): void {
  for (const [label, value] of [
    ["generation", status.generation],
    ["currentStage", status.currentStage],
    ["points", status.points],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative safe integer.`);
    }
  }
  if (
    status.nextStageThreshold !== null &&
    (!Number.isSafeInteger(status.nextStageThreshold) ||
      status.nextStageThreshold <= status.points)
  ) {
    throw new Error("Next stage threshold must be above current points.");
  }
  if (!status.eligibilitySignatureVerified) {
    throw new Error("eligible_after_utc evidence must be signed and verified.");
  }
  if (!Number.isFinite(Date.parse(status.eligibleAfterUtc))) {
    throw new Error("eligible_after_utc is invalid.");
  }
  if (
    status.mutationSuccessorCoreId !== null &&
    !HEX64.test(status.mutationSuccessorCoreId)
  ) {
    throw new Error("Mutation successor core ID is invalid.");
  }
  if (
    status.cashValue !== null ||
    status.purchasable !== false ||
    status.redeemable !== false ||
    status.medicalAdvice !== false
  ) {
    throw new Error(
      "Growth Points cannot be cash-valued, purchased, redeemed, or presented as medical advice.",
    );
  }
  const btc = status.btcTransitionReference;
  if (
    btc &&
    (!Number.isSafeInteger(btc.amountSats) ||
      btc.amountSats < 0 ||
      !HEX64.test(btc.recordHash) ||
      !Number.isFinite(Date.parse(btc.referenceUtc)) ||
      !btc.signed ||
      btc.convertsFromGrowthPoints !== false ||
      btc.investmentValue !== false)
  ) {
    throw new Error(
      "BTC transition reference must remain signed and separate from Growth Points.",
    );
  }
}

export function assertMicroPositiveEvent(event: MicroPositiveEvent): void {
  if (
    event.consent !== "explicit-opt-in" ||
    event.accessibilityAlternativeAvailable !== true ||
    event.rawHealthDataLeavesDevice !== false ||
    event.medicalAdvice !== false ||
    !Number.isSafeInteger(event.pointsDelta) ||
    event.pointsDelta < 1
  ) {
    throw new Error(
      "Micro-positive events require opt-in, local health data, and an accessibility alternative.",
    );
  }
}

export function createPreviewHealthAdapter(options?: {
  explicitlyEnableMock?: boolean;
  syntheticEvents?: MicroPositiveEvent[];
}): HealthDataAdapter {
  const enabled = options?.explicitlyEnableMock === true;
  return {
    mode: enabled ? "mock-preview" : "disabled",
    requiresEasNativeBuild: true,
    available: enabled,
    detail: enabled
      ? "Synthetic preview events only; no HealthKit access."
      : "HealthKit is disabled in Expo Go/web and requires an EAS native build.",
    async readOptInEvents() {
      if (!enabled) return [];
      const events = options?.syntheticEvents ?? [];
      events.forEach(assertMicroPositiveEvent);
      return events;
    },
  };
}
