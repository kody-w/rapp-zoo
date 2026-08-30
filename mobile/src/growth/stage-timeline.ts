export type StarterStageName = "origin" | "journey" | "ascendant";

export type OfficialStageReference = {
  familyId: string;
  issuerReferenceSats: number;
  btcUsdCentsPerBtc: number;
  fiatReferenceCents: number;
  quoteUtc: string;
  recordHash: string;
  signatureVerified: boolean;
  priceOwed: false;
  cashValue: false;
  resaleGuarantee: false;
};

export type StarterStageMilestone = {
  stage: StarterStageName;
  ordinal: 0 | 1 | 2;
  requiredGrowthPoints: number;
  eligibleAfterUtc: string;
  freeOrigin: boolean;
  officialReference: OfficialStageReference | null;
  purchaseRequired: false;
  payToEvolve: false;
};

export type StarterStageTimeline = {
  schema: "rapp-starter-stage-timeline/1";
  familyId: string;
  stages: [
    StarterStageMilestone,
    StarterStageMilestone,
    StarterStageMilestone,
  ];
  signatureVerified: boolean;
};

export type StageTimelinePresentation = {
  stage: StarterStageName;
  unlocked: boolean;
  unlockLabel: string;
  officialReferenceLabel: string;
};

const HEX64 = /^[0-9a-f]{64}$/;
const ORDER: StarterStageName[] = ["origin", "journey", "ascendant"];

export function stageTimelinePresentation(
  timeline: StarterStageTimeline,
  growthPoints: number,
  nowMs: number,
): StageTimelinePresentation[] {
  assertStarterStageTimeline(timeline);
  if (!Number.isSafeInteger(growthPoints) || growthPoints < 0) {
    throw new Error("Growth Points must be a non-negative safe integer.");
  }
  return timeline.stages.map((milestone) => {
    const pointsReady = growthPoints >= milestone.requiredGrowthPoints;
    const utcReady = nowMs >= Date.parse(milestone.eligibleAfterUtc);
    const unlocked = pointsReady && utcReady;
    return {
      stage: milestone.stage,
      unlocked,
      unlockLabel: unlocked
        ? "POINTS + UTC ELIGIBLE"
        : `${growthPoints}/${milestone.requiredGrowthPoints} Growth Points · eligible after ${milestone.eligibleAfterUtc}`,
      officialReferenceLabel:
        milestone.officialReference === null
          ? "FREE ORIGIN"
          : `OFFICIAL STAGE REFERENCE · ${milestone.officialReference.issuerReferenceSats.toLocaleString(
              "en-US",
            )} sats · ≈${formatUsdCents(
              milestone.officialReference.fiatReferenceCents,
            )} at ${milestone.officialReference.quoteUtc}`,
    };
  });
}

export function assertStarterStageTimeline(
  timeline: StarterStageTimeline,
): void {
  if (
    timeline.schema !== "rapp-starter-stage-timeline/1" ||
    !timeline.signatureVerified ||
    timeline.stages.length !== 3
  ) {
    throw new Error("Starter stage timeline signature or shape is invalid.");
  }
  let priorPoints = -1;
  let priorUtc = -1;
  timeline.stages.forEach((milestone, index) => {
    const eligibleMs = Date.parse(milestone.eligibleAfterUtc);
    if (
      milestone.stage !== ORDER[index] ||
      milestone.ordinal !== index ||
      !Number.isSafeInteger(milestone.requiredGrowthPoints) ||
      milestone.requiredGrowthPoints < 0 ||
      milestone.requiredGrowthPoints <= priorPoints ||
      !Number.isFinite(eligibleMs) ||
      eligibleMs < priorUtc ||
      milestone.purchaseRequired !== false ||
      milestone.payToEvolve !== false
    ) {
      throw new Error("Starter stage order or points/UTC unlock is invalid.");
    }
    priorPoints = milestone.requiredGrowthPoints;
    priorUtc = eligibleMs;
    if (milestone.stage === "origin") {
      if (
        milestone.freeOrigin !== true ||
        milestone.officialReference !== null ||
        milestone.requiredGrowthPoints !== 0
      ) {
        throw new Error("Origin must be free with no issuer value reference.");
      }
      return;
    }
    const reference = milestone.officialReference;
    const referenceNumbersValid =
      reference !== null &&
      Number.isSafeInteger(reference.issuerReferenceSats) &&
      reference.issuerReferenceSats >= 0 &&
      Number.isSafeInteger(reference.btcUsdCentsPerBtc) &&
      reference.btcUsdCentsPerBtc >= 1;
    const expectedFiatCents = referenceNumbersValid
      ? Number(
          (BigInt(reference!.issuerReferenceSats) *
            BigInt(reference!.btcUsdCentsPerBtc) +
            50_000_000n) /
            100_000_000n,
        )
      : null;
    if (
      milestone.freeOrigin ||
      !reference ||
      reference.familyId !== timeline.familyId ||
      !referenceNumbersValid ||
      !Number.isSafeInteger(reference.fiatReferenceCents) ||
      reference.fiatReferenceCents < 1 ||
      reference.fiatReferenceCents !== expectedFiatCents ||
      !Number.isFinite(Date.parse(reference.quoteUtc)) ||
      !HEX64.test(reference.recordHash) ||
      !reference.signatureVerified ||
      reference.priceOwed !== false ||
      reference.cashValue !== false ||
      reference.resaleGuarantee !== false
    ) {
      throw new Error(
        "Official stage reference must be signed, family-specific, and non-financial.",
      );
    }
  });
}

function formatUsdCents(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}
