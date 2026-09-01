import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HOLO_ZOO_GAMEPLAY_CONSTITUTION,
  assertGameplayConstitution,
} from "@/constitution/gameplay";
import { RAPTER_COIN_POLICY } from "@/provenance/policy";

describe("Holo Zoo gameplay and companionship constitution", () => {
  it("keeps companionship independent from every economic signal", () => {
    assert.doesNotThrow(assertGameplayConstitution);
    assert.equal(
      HOLO_ZOO_GAMEPLAY_CONSTITUTION.companionship.affectionIndependentOfSpend,
      true,
    );
    assert.equal(
      HOLO_ZOO_GAMEPLAY_CONSTITUTION.companionship.memoryIndependentOfSpend,
      true,
    );
    assert.equal(
      HOLO_ZOO_GAMEPLAY_CONSTITUTION.companionship.spendRequiredForSurvival,
      false,
    );
    assert.equal(
      HOLO_ZOO_GAMEPLAY_CONSTITUTION.companionship.salesInCompanionDialogue,
      false,
    );
  });

  it("keeps Houses, Growth, encounters, and provenance free of pay-to-win", () => {
    const gameplay = HOLO_ZOO_GAMEPLAY_CONSTITUTION.gameplay;
    assert.equal(gameplay.powerPurchasable, false);
    assert.equal(gameplay.encounterOddsPurchasable, false);
    assert.equal(gameplay.houseEconomicWeight, false);
    assert.equal(gameplay.houseChangesCompanionCapability, false);
    assert.equal(gameplay.growthPointsPurchasable, false);
    assert.equal(gameplay.worldPulseWeightPurchasable, false);
    assert.equal(gameplay.provenanceRankPurchasable, false);
  });

  it("allows commerce only as explicit proof-first work", () => {
    const work = HOLO_ZOO_GAMEPLAY_CONSTITUTION.work;
    assert.equal(work.explicitModeSwitch, true);
    assert.equal(work.fullDeliveryBeforeTip, true);
    assert.equal(work.zeroTipPenalty, false);
    assert.equal(work.ratingIndependentOfTip, true);
    assert.equal(work.sponsorshipInCoreLoop, false);
    assert.equal(work.privateByDefault, true);
  });

  it("keeps Coin economics dormant and outside the game", () => {
    assert.equal(RAPTER_COIN_POLICY.rollout, "dormant");
    assert.equal(RAPTER_COIN_POLICY.publicDisplayEnabled, false);
    assert.equal(RAPTER_COIN_POLICY.walletEnabled, false);
    assert.equal(RAPTER_COIN_POLICY.marketEnabled, false);
    assert.equal(
      HOLO_ZOO_GAMEPLAY_CONSTITUTION.provenance.coinEconomicsInGameplay,
      false,
    );
    assert.equal(
      HOLO_ZOO_GAMEPLAY_CONSTITUTION.provenance.coinAffectsCompanionship,
      false,
    );
  });

  it("blocks dependency mechanics, unhealthy retention, and youth exposure", () => {
    const policy = HOLO_ZOO_GAMEPLAY_CONSTITUTION;
    assert.equal(policy.companionship.sentienceClaimsAllowed, false);
    assert.equal(policy.companionship.exclusivityClaimsAllowed, false);
    assert.equal(policy.companionship.distressWhenUserLeavesAllowed, false);
    assert.equal(policy.gameplay.streakLossAllowed, false);
    assert.equal(policy.gameplay.absenceDecayAllowed, false);
    assert.equal(policy.gameplay.timeLimitedProgressionAllowed, false);
    assert.equal(policy.gameplay.excessiveSessionRewardsAllowed, false);
    assert.equal(policy.safety.minorsAllowedInCurrentTestFlight, false);
    assert.equal(policy.safety.unsupervisedHouseSocialFeatures, false);
    assert.equal(policy.safety.houseChangePenalty, false);
    assert.equal(policy.safety.atHomeParityRequired, true);
    assert.equal(policy.safety.permissionlessProgressionRequired, true);
  });
});
