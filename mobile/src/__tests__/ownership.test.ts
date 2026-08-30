import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONSUMABLE_PRODUCTS,
  featuresForLedger,
  productKind,
  rapterCreditsForProduct,
} from "@/billing/catalog";

describe("ownership-oriented Direct and Wild contract", () => {
  it("keeps Direct local data and validation free", () => {
    const direct = featuresForLedger({
      activeWildRapters: 0,
      smallComputePacks: 0,
      largeComputePacks: 0,
    });
    assert.equal(direct.accessMode, "direct");
    assert.equal(direct.localRapterSlots, 1);
    assert.equal(direct.remoteAccess, false);
    assert.equal(direct.localPlayback, true);
    assert.equal(direct.localHistory, true);
    assert.equal(direct.localImport, true);
    assert.equal(direct.protocolValidation, true);
    assert.equal(direct.ownedLocalDataAccess, true);
    assert.equal(direct.ownedLocalDataExport, true);
  });

  it("maps canonical one-time products to ledger grant kinds", () => {
    assert.equal(productKind(CONSUMABLE_PRODUCTS.hatchOne), "rapter_credit");
    assert.equal(productKind(CONSUMABLE_PRODUCTS.flockThree), "rapter_credit");
    assert.equal(productKind(CONSUMABLE_PRODUCTS.flockTen), "rapter_credit");
    assert.equal(productKind(CONSUMABLE_PRODUCTS.computeSmall), "compute_credit");
    assert.equal(productKind(CONSUMABLE_PRODUCTS.computeLarge), "compute_credit");
    assert.equal(productKind("unknown_product"), null);
    assert.equal(rapterCreditsForProduct(CONSUMABLE_PRODUCTS.hatchOne), 1);
    assert.equal(rapterCreditsForProduct(CONSUMABLE_PRODUCTS.flockThree), 3);
    assert.equal(rapterCreditsForProduct(CONSUMABLE_PRODUCTS.flockTen), 10);
  });

  it("enables optional Wild capabilities from prepaid compute or active sessions", () => {
    const small = featuresForLedger({
      activeWildRapters: 0,
      smallComputePacks: 1,
      largeComputePacks: 0,
    });
    const large = featuresForLedger({
      activeWildRapters: 0,
      smallComputePacks: 0,
      largeComputePacks: 1,
    });
    const active = featuresForLedger({
      activeWildRapters: 3,
      smallComputePacks: 0,
      largeComputePacks: 0,
    });
    for (const features of [small, large, active]) {
      assert.equal(features.accessMode, "wild");
      assert.equal(features.remoteAccess, true);
      assert.equal(features.hostedBrainstem, true);
      assert.equal(features.managedProviderRouting, true);
      assert.equal(features.quotaAndRevocation, true);
      assert.equal(features.managedAutocomplete, true);
    }
    assert.equal(small.wildHistoryDepth, 64);
    assert.equal(large.wildHistoryDepth, 256);
    assert.equal(small.rappterRooms, false);
    assert.equal(large.rappterRooms, true);
    assert.equal(large.wildGrowlMaxNotes, 512);
  });
});
