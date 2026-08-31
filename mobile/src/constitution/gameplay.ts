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
  }),
  gameplay: Object.freeze({
    powerPurchasable: false,
    encounterOddsPurchasable: false,
    houseEconomicWeight: false,
    houseChangesCompanionCapability: false,
    growthPointsPurchasable: false,
    worldPulseWeightPurchasable: false,
    provenanceRankPurchasable: false,
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
    policy.gameplay.powerPurchasable ||
    policy.gameplay.encounterOddsPurchasable ||
    policy.gameplay.houseEconomicWeight ||
    policy.gameplay.houseChangesCompanionCapability ||
    policy.gameplay.growthPointsPurchasable ||
    policy.gameplay.worldPulseWeightPurchasable ||
    policy.gameplay.provenanceRankPurchasable ||
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
