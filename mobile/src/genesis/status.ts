import type {
  GenerationEvidence,
  GenerationPresentation,
  GenesisFamilyCatalog,
} from "./types";

const HEX64 = /^[0-9a-f]{64}$/;

export function assertGenesisCatalog(
  catalog: GenesisFamilyCatalog,
): void {
  if (
    catalog.schema !== "rapp-genesis-family-catalog/1" ||
    catalog.canonicalFamilyCount !== 151 ||
    catalog.companionFamilyCount !== 3 ||
    catalog.premiumFamilyCount !== 148 ||
    catalog.families.length !== 151 ||
    !catalog.signatureVerified
  ) {
    throw new Error("Genesis catalog count or signature invariant failed.");
  }
  const indexes = new Set(catalog.families.map((family) => family.familyIndex));
  if (
    indexes.size !== 151 ||
    [...indexes].some((index) => index < 1 || index > 151)
  ) {
    throw new Error("Genesis family indexes must be unique from 1 through 151.");
  }
  for (const family of catalog.families) {
    if (!family.signatureVerified) {
      throw new Error("Every Genesis family cap record must verify.");
    }
    if (family.familyIndex <= 3) {
      if (
        family.familyClass !== "companion" ||
        family.accountInstanceCap !== 1 ||
        family.transferable !== false ||
        family.scarcePremiumSeries !== false
      ) {
        throw new Error(
          "The first three Genesis Families must be one-per-account free Companions.",
        );
      }
    } else if (
      family.familyClass !== "premium" ||
      family.signedSupplyCap < 1 ||
      family.signedLeaseCap < 1 ||
      !HEX64.test(family.supplyCapRecordHash) ||
      !HEX64.test(family.leaseCapRecordHash) ||
      family.scarcePremiumSeries !== true
    ) {
      throw new Error(
        "Premium Genesis Families require signed positive supply and lease caps.",
      );
    }
  }
}

export function generationPresentation(
  evidence: GenerationEvidence,
  nowMs: number,
): GenerationPresentation {
  if (
    !Number.isSafeInteger(evidence.generation) ||
    evidence.generation < 0 ||
    !HEX64.test(evidence.currentCoreId) ||
    !evidence.immutableAncestorCoreIds.every((id) => HEX64.test(id)) ||
    new Set(evidence.immutableAncestorCoreIds).size !==
      evidence.immutableAncestorCoreIds.length ||
    !HEX64.test(evidence.eligibilityRecordHash) ||
    !evidence.eligibilitySignatureVerified
  ) {
    return {
      generationLabel: `Generation ${Math.max(0, evidence.generation || 0)}`,
      mutationDue: false,
      mutationOccurred: false,
      state: "unverified",
      label: "GENERATION EVIDENCE UNVERIFIED",
    };
  }
  const dueAt = Date.parse(evidence.eligibleAfterUtc);
  if (!Number.isFinite(dueAt)) {
    return {
      generationLabel: `Generation ${evidence.generation}`,
      mutationDue: false,
      mutationOccurred: false,
      state: "unverified",
      label: "GENERATION EVIDENCE UNVERIFIED",
    };
  }
  if (evidence.verifiedSuccessorCoreId !== null) {
    if (
      !HEX64.test(evidence.verifiedSuccessorCoreId) ||
      evidence.verifiedSuccessorCoreId === evidence.currentCoreId ||
      evidence.immutableAncestorCoreIds.includes(
        evidence.verifiedSuccessorCoreId,
      )
    ) {
      return {
        generationLabel: `Generation ${evidence.generation}`,
        mutationDue: false,
        mutationOccurred: false,
        state: "unverified",
        label: "SUCCESSOR EVIDENCE UNVERIFIED",
      };
    }
    return {
      generationLabel: `Generation ${evidence.generation}`,
      mutationDue: nowMs >= dueAt,
      mutationOccurred: true,
      state: "verified-successor",
      label: "VERIFIED SUCCESSOR",
    };
  }
  if (nowMs < dueAt) {
    return {
      generationLabel: `Generation ${evidence.generation}`,
      mutationDue: false,
      mutationOccurred: false,
      state: "current",
      label: `CURRENT · ELIGIBLE AFTER ${evidence.eligibleAfterUtc}`,
    };
  }
  if (evidence.computeStatus !== "available") {
    return {
      generationLabel: `Generation ${evidence.generation}`,
      mutationDue: true,
      mutationOccurred: false,
      state: "pending-sleeping",
      label: "MUTATION DUE · PENDING / SLEEPING",
    };
  }
  return {
    generationLabel: `Generation ${evidence.generation}`,
    mutationDue: true,
    mutationOccurred: false,
    state: "mutation-due",
    label: "MUTATION DUE · VERIFIED SUCCESSOR NOT YET PRESENT",
  };
}
