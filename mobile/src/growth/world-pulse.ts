const HEX64 = /^[0-9a-f]{64}$/;

export type WorldPulseMilestone = {
  milestoneId: string;
  signedLabel: string;
  thresholdGrowthPoints: number;
  progressGrowthPoints: number;
  unlocked: boolean;
};

export type SharedWorldUnlock = {
  unlockId: string;
  signedLabel: string;
  unlockedUtc: string;
  availableTo: "all-accounts";
  companionAccess: true;
  purchaseRequired: false;
};

export type WorldPulseCheckpoint = {
  schema: "rapp-world-pulse-checkpoint/1";
  checkpointId: string;
  checkpointUtc: string;
  aggregateGrowthPoints: number;
  participantCount: number;
  eventCount: number;
  milestone: WorldPulseMilestone;
  sharedWorldUnlocks: SharedWorldUnlock[];
  audience: "all-accounts";
  companionAccess: true;
  includesRawHealthData: false;
  cashValue: null;
  investmentValue: false;
  payToWin: false;
  signatureVerified: boolean;
};

export type WorldPulsePresentation = {
  global: {
    pointsLabel: string;
    countsLabel: string;
    milestoneLabel: string;
    milestonePercent: number;
    unlockLabels: string[];
  };
  individual: {
    pointsLabel: string;
  };
};

export function worldPulsePresentation(
  checkpoint: WorldPulseCheckpoint,
  individualGrowthPoints: number,
): WorldPulsePresentation {
  assertWorldPulseCheckpoint(checkpoint);
  if (
    !Number.isSafeInteger(individualGrowthPoints) ||
    individualGrowthPoints < 0
  ) {
    throw new Error("Individual Growth Points must be non-negative.");
  }
  const percent =
    checkpoint.milestone.thresholdGrowthPoints === 0
      ? 100
      : Math.min(
          100,
          Math.floor(
            (checkpoint.milestone.progressGrowthPoints * 100) /
              checkpoint.milestone.thresholdGrowthPoints,
          ),
        );
  return {
    global: {
      pointsLabel: `${checkpoint.aggregateGrowthPoints.toLocaleString(
        "en-US",
      )} global Growth Points`,
      countsLabel: `${checkpoint.participantCount.toLocaleString(
        "en-US",
      )} participants · ${checkpoint.eventCount.toLocaleString(
        "en-US",
      )} opt-in events`,
      milestoneLabel: checkpoint.milestone.signedLabel,
      milestonePercent: percent,
      unlockLabels: checkpoint.sharedWorldUnlocks.map(
        (unlock) => unlock.signedLabel,
      ),
    },
    individual: {
      pointsLabel: `${individualGrowthPoints.toLocaleString(
        "en-US",
      )} individual Growth Points`,
    },
  };
}

export function assertWorldPulseCheckpoint(
  checkpoint: WorldPulseCheckpoint,
): void {
  if (
    checkpoint.schema !== "rapp-world-pulse-checkpoint/1" ||
    !HEX64.test(checkpoint.checkpointId) ||
    !Number.isFinite(Date.parse(checkpoint.checkpointUtc)) ||
    !checkpoint.signatureVerified
  ) {
    throw new Error("World Pulse checkpoint signature or identity is invalid.");
  }
  for (const [label, value] of [
    ["aggregate points", checkpoint.aggregateGrowthPoints],
    ["participant count", checkpoint.participantCount],
    ["event count", checkpoint.eventCount],
    ["milestone threshold", checkpoint.milestone.thresholdGrowthPoints],
    ["milestone progress", checkpoint.milestone.progressGrowthPoints],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`World Pulse ${label} must be a non-negative integer.`);
    }
  }
  if (
    checkpoint.milestone.progressGrowthPoints >
      checkpoint.milestone.thresholdGrowthPoints ||
    checkpoint.milestone.unlocked !==
      (checkpoint.milestone.progressGrowthPoints >=
        checkpoint.milestone.thresholdGrowthPoints)
  ) {
    throw new Error("World Pulse milestone progress is inconsistent.");
  }
  if (
    checkpoint.audience !== "all-accounts" ||
    checkpoint.companionAccess !== true ||
    checkpoint.includesRawHealthData !== false ||
    checkpoint.cashValue !== null ||
    checkpoint.investmentValue !== false ||
    checkpoint.payToWin !== false
  ) {
    throw new Error(
      "World Pulse must be universal, non-financial, health-private, and not pay-to-win.",
    );
  }
  for (const unlock of checkpoint.sharedWorldUnlocks) {
    if (
      unlock.availableTo !== "all-accounts" ||
      unlock.companionAccess !== true ||
      unlock.purchaseRequired !== false ||
      !Number.isFinite(Date.parse(unlock.unlockedUtc))
    ) {
      throw new Error("Shared-world unlock is not universal.");
    }
  }
}
