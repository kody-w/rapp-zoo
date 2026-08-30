import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertGenesisCatalog,
  generationPresentation,
} from "@/genesis/status";
import type {
  GenerationEvidence,
  GenesisFamily,
  GenesisFamilyCatalog,
} from "@/genesis/types";

function catalog(): GenesisFamilyCatalog {
  const families: GenesisFamily[] = Array.from({ length: 151 }, (_, offset) => {
    const familyIndex = offset + 1;
    if (familyIndex <= 3) {
      return {
        familyClass: "companion",
        familyIndex: familyIndex as 1 | 2 | 3,
        familyId: `genesis-family-${String(familyIndex).padStart(3, "0")}`,
        canonical: true,
        accountInstanceCap: 1,
        transferable: false,
        scarcePremiumSeries: false,
        signatureVerified: true,
      };
    }
    return {
      familyClass: "premium",
      familyIndex,
      familyId: `genesis-family-${String(familyIndex).padStart(3, "0")}`,
      canonical: true,
      signedSupplyCap: 100,
      signedLeaseCap: 10,
      supplyCapRecordHash: "a".repeat(64),
      leaseCapRecordHash: "b".repeat(64),
      scarcePremiumSeries: true,
      signatureVerified: true,
    };
  });
  return {
    schema: "rapp-genesis-family-catalog/1",
    canonicalFamilyCount: 151,
    companionFamilyCount: 3,
    premiumFamilyCount: 148,
    families,
    signatureVerified: true,
  };
}

function generation(
  computeStatus: GenerationEvidence["computeStatus"],
): GenerationEvidence {
  return {
    schema: "rapp-generation-evidence/1",
    organismRappid: `rappid:@kody-w/generation-test:${"c".repeat(64)}`,
    generation: 7,
    currentCoreId: "d".repeat(64),
    immutableAncestorCoreIds: ["e".repeat(64)],
    eligibleAfterUtc: "2026-08-30T03:00:00.000Z",
    eligibilityRecordHash: "f".repeat(64),
    eligibilitySignatureVerified: true,
    verifiedSuccessorCoreId: null,
    computeStatus,
  };
}

describe("Genesis Family and generation interfaces", () => {
  it("locks 151 canonical families to 3 Companions and 148 premium families", () => {
    assert.doesNotThrow(() => assertGenesisCatalog(catalog()));
    const invalid = catalog();
    invalid.families[3] = invalid.families[0]!;
    assert.throws(() => assertGenesisCatalog(invalid), /indexes|Premium/);
  });

  it("shows mutation due without pretending a mutation occurred", () => {
    const due = generationPresentation(
      generation("available"),
      Date.parse("2026-08-30T04:00:00.000Z"),
    );
    assert.equal(due.generationLabel, "Generation 7");
    assert.equal(due.mutationDue, true);
    assert.equal(due.mutationOccurred, false);
    assert.equal(due.state, "mutation-due");
  });

  it("shows pending and sleeping when due but compute is unavailable", () => {
    for (const status of [
      "unavailable",
      "offline",
      "budget-exhausted",
    ] as const) {
      const pending = generationPresentation(
        generation(status),
        Date.parse("2026-08-30T04:00:00.000Z"),
      );
      assert.equal(pending.state, "pending-sleeping");
      assert.equal(pending.mutationOccurred, false);
    }
  });

  it("preserves immutable ancestors when presenting generation status", () => {
    const evidence = generation("offline");
    const ancestors = [...evidence.immutableAncestorCoreIds];
    generationPresentation(evidence, Date.parse("2026-08-30T04:00:00.000Z"));
    assert.deepEqual(evidence.immutableAncestorCoreIds, ancestors);
  });
});
