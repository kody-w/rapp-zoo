export const HOLO_ZOO_GAMEPLAY_CONSTITUTION = Object.freeze({
  schema: "holo-zoo-gameplay-constitution/1",
  companionship: Object.freeze({
    accessIndependentOfSpend: true,
    affectionIndependentOfSpend: true,
    memoryIndependentOfSpend: true,
    personalityIndependentOfSpend: true,
    ownedCapsuleSurvivesSleep: true,
    salesInCompanionDialogue: false,
    guiltForSpend: false,
    spendRequiredForSurvival: false,
    sentienceClaimsAllowed: false,
    exclusivityClaimsAllowed: false,
    distressWhenUserLeavesAllowed: false,
  }),
  gameplay: Object.freeze({
    powerPurchasable: false,
    encounterOddsPurchasable: false,
    houseEconomicWeight: false,
    houseChangesCompanionCapability: false,
    growthPointsPurchasable: false,
    worldPulseWeightPurchasable: false,
    provenanceRankPurchasable: false,
    streakLossAllowed: false,
    absenceDecayAllowed: false,
    timeLimitedProgressionAllowed: false,
    excessiveSessionRewardsAllowed: false,
  }),
  work: Object.freeze({
    explicitModeSwitch: true,
    fullDeliveryBeforeTip: true,
    zeroTipPenalty: false,
    ratingIndependentOfTip: true,
    sponsorshipInCoreLoop: false,
    privateByDefault: true,
  }),
  privacy: Object.freeze({
    rawLocationStored: false,
    rawLocationUploaded: false,
    housePiiCollected: false,
    privateGoddPublishedByDefault: false,
  }),
  safety: Object.freeze({
    minorsAllowedInCurrentTestFlight: false,
    unsupervisedHouseSocialFeatures: false,
    houseChangePenalty: false,
    atHomeParityRequired: true,
    permissionlessProgressionRequired: true,
  }),
  provenance: Object.freeze({
    coinEconomicsInGameplay: false,
    coinAffectsCompanionship: false,
    coinAffectsPower: false,
    publicProofRequiresExplicitOptIn: true,
  }),
});

export function assertGameplayConstitution(): void {
  const policy = HOLO_ZOO_GAMEPLAY_CONSTITUTION;
  if (
    !policy.companionship.accessIndependentOfSpend ||
    !policy.companionship.affectionIndependentOfSpend ||
    !policy.companionship.memoryIndependentOfSpend ||
    !policy.companionship.personalityIndependentOfSpend ||
    !policy.companionship.ownedCapsuleSurvivesSleep ||
    policy.companionship.salesInCompanionDialogue ||
    policy.companionship.guiltForSpend ||
    policy.companionship.spendRequiredForSurvival ||
    policy.companionship.sentienceClaimsAllowed ||
    policy.companionship.exclusivityClaimsAllowed ||
    policy.companionship.distressWhenUserLeavesAllowed ||
    policy.gameplay.powerPurchasable ||
    policy.gameplay.encounterOddsPurchasable ||
    policy.gameplay.houseEconomicWeight ||
    policy.gameplay.houseChangesCompanionCapability ||
    policy.gameplay.growthPointsPurchasable ||
    policy.gameplay.worldPulseWeightPurchasable ||
    policy.gameplay.provenanceRankPurchasable ||
    policy.gameplay.streakLossAllowed ||
    policy.gameplay.absenceDecayAllowed ||
    policy.gameplay.timeLimitedProgressionAllowed ||
    policy.gameplay.excessiveSessionRewardsAllowed ||
    !policy.work.explicitModeSwitch ||
    !policy.work.fullDeliveryBeforeTip ||
    policy.work.zeroTipPenalty ||
    !policy.work.ratingIndependentOfTip ||
    policy.work.sponsorshipInCoreLoop ||
    !policy.work.privateByDefault ||
    policy.privacy.rawLocationStored ||
    policy.privacy.rawLocationUploaded ||
    policy.privacy.housePiiCollected ||
    policy.privacy.privateGoddPublishedByDefault ||
    policy.safety.minorsAllowedInCurrentTestFlight ||
    policy.safety.unsupervisedHouseSocialFeatures ||
    policy.safety.houseChangePenalty ||
    !policy.safety.atHomeParityRequired ||
    !policy.safety.permissionlessProgressionRequired ||
    policy.provenance.coinEconomicsInGameplay ||
    policy.provenance.coinAffectsCompanionship ||
    policy.provenance.coinAffectsPower ||
    !policy.provenance.publicProofRequiresExplicitOptIn
  ) {
    throw new Error(
      "Holo Zoo gameplay or companionship violates the binding constitution.",
    );
  }
}
