export type BtcTransitionReference = {
  amountSats: number;
  referenceUtc: string;
  recordHash: string;
  signed: boolean;
  convertsFromGrowthPoints: false;
  investmentValue: false;
};

export type GrowthPointStatus = {
  schema: "rapp-growth-points/1";
  organismRappid: string;
  generation: number;
  currentStage: number;
  points: number;
  nextStageThreshold: number | null;
  eligibleAfterUtc: string;
  eligibilitySignatureVerified: boolean;
  mutationSuccessorCoreId: string | null;
  computeStatus: "available" | "unavailable" | "offline" | "budget-exhausted";
  btcTransitionReference: BtcTransitionReference | null;
  cashValue: null;
  purchasable: false;
  redeemable: false;
  medicalAdvice: false;
};

export type MicroPositiveEvent = {
  eventId: string;
  occurredUtc: string;
  pointsDelta: number;
  source: "manual-opt-in" | "healthkit-summary" | "preview-synthetic";
  consent: "explicit-opt-in";
  accessibilityAlternativeAvailable: true;
  rawHealthDataLeavesDevice: false;
  medicalAdvice: false;
};

export type GrowthPresentation = {
  pointsLabel: string;
  stageLabel: string;
  thresholdLabel: string;
  eligibleAfterLabel: string;
  mutationDue: boolean;
  mutationState: "not-due" | "ready" | "pending-sleeping" | "verified";
  btcReferenceLabel: string;
};

export type HealthDataAdapter = {
  mode: "disabled" | "mock-preview" | "healthkit-native";
  requiresEasNativeBuild: true;
  available: boolean;
  detail: string;
  readOptInEvents: () => Promise<MicroPositiveEvent[]>;
};
