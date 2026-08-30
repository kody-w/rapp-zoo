import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertFirstEditionCatalog,
  assertOffspringIssuance,
  assertOriginalTitleTransfer,
  dimensionGenerationPresentation,
  originalTitleTransferAllowed,
} from "@/genesis/status";
import type {
  DimensionGenerationEvidence,
  FirstEditionCatalog,
  FirstEditionOriginal,
} from "@/genesis/types";

function original(ordinal: number): FirstEditionOriginal {
  const hex = ordinal.toString(16).padStart(64, "0");
  return {
    originalOrdinal: ordinal,
    originalId: `first-edition-${String(ordinal).padStart(3, "0")}`,
    originalRappid: `rappid:@kody-w/original-${String(ordinal).padStart(
      3,
      "0",
    )}:${hex}`,
    edition: "first-edition",
    dimension: "first-dimension",
    titleStatus: "issuer-held",
    discoveryStatus: "undiscovered",
    rightsStatus: "issuer-reserved",
    shadowHolo: {
      assetKind: "authored-shadow-holo",
      holoId: "a".repeat(64),
      sourceFrameHash: "b".repeat(64),
      authored: true,
      fallbackGenerated: false,
      visibility: "published-shadow",
    },
    fullHolo: {
      assetKind: "authored-full-holo",
      holoId: "c".repeat(64),
      sourceFrameHash: "d".repeat(64),
      authored: true,
      fallbackGenerated: false,
      visibility: "sealed-until-discovery",
    },
    signatureVerified: true,
  };
}

function catalog(): FirstEditionCatalog {
  return {
    schema: "rapp-first-edition-catalog/1",
    edition: "first-edition",
    dimension: "first-dimension",
    originalTitleCount: 251,
    issuerHeldCount: 251,
    transferredCount: 0,
    undiscoveredCount: 251,
    publishedUtc: "2026-08-30T04:00:00.000Z",
    originals: Array.from({ length: 251 }, (_, index) => original(index + 1)),
    companionOrigins: [
      {
        companionOrdinal: 1,
        originId: "companion-origin-1",
        accountInstanceCap: 1,
        transferable: false,
        outsidePremiumOriginalInventory: true,
      },
      {
        companionOrdinal: 2,
        originId: "companion-origin-2",
        accountInstanceCap: 1,
        transferable: false,
        outsidePremiumOriginalInventory: true,
      },
      {
        companionOrdinal: 3,
        originId: "companion-origin-3",
        accountInstanceCap: 1,
        transferable: false,
        outsidePremiumOriginalInventory: true,
      },
    ],
    signatureVerified: true,
  };
}

function generation(
  computeStatus: DimensionGenerationEvidence["computeStatus"],
): DimensionGenerationEvidence {
  return {
    schema: "rapp-dimension-generation-evidence/1",
    instanceRappid: `rappid:@kody-w/dimension-instance:${"e".repeat(64)}`,
    generation: 7,
    currentCoreId: "f".repeat(64),
    immutableAncestorCoreIds: ["1".repeat(64)],
    eligibleAfterUtc: "2026-08-30T03:00:00.000Z",
    eligibilityRecordHash: "2".repeat(64),
    eligibilitySignatureVerified: true,
    verifiedSuccessorCoreId: null,
    computeStatus,
  };
}

describe("First Edition / First Dimension interfaces", () => {
  it("publishes 251 unique issuer-held, untransferred, undiscovered Originals", () => {
    assert.doesNotThrow(() => assertFirstEditionCatalog(catalog()));
    const transferred = catalog();
    transferred.transferredCount = 1 as 0;
    assert.throws(
      () => assertFirstEditionCatalog(transferred),
      /251 issuer-held, undiscovered Originals/,
    );
  });

  it("requires shared authored shadow and full-Holo references", () => {
    const invalid = catalog();
    invalid.originals[0]!.shadowHolo.fallbackGenerated = true as false;
    assert.throws(
      () => assertFirstEditionCatalog(invalid),
      /without fallback morphology/,
    );
  });

  it("gates exact Original title transfer on rights and commerce", () => {
    const gates = {
      rightsTermsAccepted: true,
      commerceSettlementVerified: true,
      ownerIdentityVerified: true,
      signedRegistryReady: true,
    };
    assert.equal(originalTitleTransferAllowed(gates), true);
    assert.doesNotThrow(() =>
      assertOriginalTitleTransfer({
        schema: "rapp-first-edition-title-transfer/1",
        originalId: "first-edition-001",
        originalRappid: original(1).originalRappid,
        fromIssuer: true,
        buyerOwnerHash: "3".repeat(64),
        rightsGrantId: "rights-grant-1",
        settlementReferenceHash: "4".repeat(64),
        signedRegistryEventId: `rce_${"5".repeat(32)}`,
        gates,
        signatureVerified: true,
      }),
    );
    assert.equal(
      originalTitleTransferAllowed({
        ...gates,
        commerceSettlementVerified: false,
      }),
      false,
    );
  });

  it("keeps offspring RAPPIDs and rights separate from Original title", () => {
    assert.doesNotThrow(() =>
      assertOffspringIssuance({
        schema: "rapp-first-dimension-offspring/1",
        parentOriginalId: "first-edition-001",
        parentOriginalRappid: original(1).originalRappid,
        offspringRappid: `rappid:@kody-w/offspring-001:${"6".repeat(64)}`,
        offspringCapsuleId: "7".repeat(64),
        offspringRightsGrantId: "offspring-rights-1",
        ownsOriginalTitle: false,
        signatureVerified: true,
      }),
    );
  });

  it("never converts mutation_due into an unverified mutation", () => {
    const pending = dimensionGenerationPresentation(
      generation("offline"),
      Date.parse("2026-08-30T04:00:00.000Z"),
    );
    assert.equal(pending.state, "pending-sleeping");
    assert.equal(pending.mutationDue, true);
    assert.equal(pending.mutationOccurred, false);
  });
});
