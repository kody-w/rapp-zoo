import type {
  DimensionGenerationEvidence,
  DimensionGenerationPresentation,
  FirstEditionCatalog,
  OffspringIssuance,
  OriginalTitleTransfer,
  OriginalTitleTransferGates,
} from "./types";

const HEX64 = /^[0-9a-f]{64}$/;
const RAPPID =
  /^rappid:@[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*:[0-9a-f]{64}$/;
const EVENT_ID = /^rce_[0-9a-f]{32}$/;

export function assertFirstEditionCatalog(
  catalog: FirstEditionCatalog,
): void {
  if (
    catalog.schema !== "rapp-first-edition-catalog/1" ||
    catalog.edition !== "first-edition" ||
    catalog.dimension !== "first-dimension" ||
    catalog.originalTitleCount !== 251 ||
    catalog.issuerHeldCount !== 251 ||
    catalog.transferredCount !== 0 ||
    catalog.undiscoveredCount !== 251 ||
    catalog.originals.length !== 251 ||
    catalog.companionOrigins.length !== 3 ||
    !catalog.signatureVerified ||
    !Number.isFinite(Date.parse(catalog.publishedUtc))
  ) {
    throw new Error(
      "First Edition publication must contain 251 issuer-held, undiscovered Originals.",
    );
  }
  const ordinals = new Set<number>();
  const originalIds = new Set<string>();
  const rappids = new Set<string>();
  for (const original of catalog.originals) {
    ordinals.add(original.originalOrdinal);
    originalIds.add(original.originalId);
    rappids.add(original.originalRappid);
    if (
      original.originalOrdinal < 1 ||
      original.originalOrdinal > 251 ||
      original.edition !== "first-edition" ||
      original.dimension !== "first-dimension" ||
      original.titleStatus !== "issuer-held" ||
      original.discoveryStatus !== "undiscovered" ||
      original.rightsStatus !== "issuer-reserved" ||
      !RAPPID.test(original.originalRappid) ||
      !original.signatureVerified
    ) {
      throw new Error("First Edition Original invariant failed.");
    }
    assertAuthoredAsset(original.shadowHolo, "published-shadow");
    assertAuthoredAsset(original.fullHolo, "sealed-until-discovery");
  }
  if (
    ordinals.size !== 251 ||
    originalIds.size !== 251 ||
    rappids.size !== 251
  ) {
    throw new Error("First Edition Originals must be globally unique.");
  }
  catalog.companionOrigins.forEach((origin, index) => {
    if (
      origin.companionOrdinal !== index + 1 ||
      origin.accountInstanceCap !== 1 ||
      origin.transferable !== false ||
      origin.outsidePremiumOriginalInventory !== true
    ) {
      throw new Error(
        "Canonical Companion origins must remain outside scarce Original inventory.",
      );
    }
  });
}

export function originalTitleTransferAllowed(
  gates: OriginalTitleTransferGates,
): boolean {
  return (
    gates.rightsTermsAccepted &&
    gates.commerceSettlementVerified &&
    gates.ownerIdentityVerified &&
    gates.signedRegistryReady
  );
}

export function assertOriginalTitleTransfer(
  transfer: OriginalTitleTransfer,
): void {
  if (
    transfer.schema !== "rapp-first-edition-title-transfer/1" ||
    transfer.fromIssuer !== true ||
    !RAPPID.test(transfer.originalRappid) ||
    !HEX64.test(transfer.buyerOwnerHash) ||
    !HEX64.test(transfer.settlementReferenceHash) ||
    !EVENT_ID.test(transfer.signedRegistryEventId) ||
    !transfer.rightsGrantId ||
    !originalTitleTransferAllowed(transfer.gates) ||
    !transfer.signatureVerified
  ) {
    throw new Error(
      "Original title transfer requires rights, commerce, identity, and signed-registry gates.",
    );
  }
}

export function assertOffspringIssuance(
  offspring: OffspringIssuance,
): void {
  if (
    offspring.schema !== "rapp-first-dimension-offspring/1" ||
    !RAPPID.test(offspring.parentOriginalRappid) ||
    !RAPPID.test(offspring.offspringRappid) ||
    offspring.offspringRappid === offspring.parentOriginalRappid ||
    !HEX64.test(offspring.offspringCapsuleId) ||
    !offspring.offspringRightsGrantId ||
    offspring.ownsOriginalTitle !== false ||
    !offspring.signatureVerified
  ) {
    throw new Error(
      "Offspring require a distinct RAPPID, capsule, and separately issued rights.",
    );
  }
}

export function dimensionGenerationPresentation(
  evidence: DimensionGenerationEvidence,
  nowMs: number,
): DimensionGenerationPresentation {
  if (
    !Number.isSafeInteger(evidence.generation) ||
    evidence.generation < 0 ||
    !RAPPID.test(evidence.instanceRappid) ||
    !HEX64.test(evidence.currentCoreId) ||
    !evidence.immutableAncestorCoreIds.every((id) => HEX64.test(id)) ||
    new Set(evidence.immutableAncestorCoreIds).size !==
      evidence.immutableAncestorCoreIds.length ||
    !HEX64.test(evidence.eligibilityRecordHash) ||
    !evidence.eligibilitySignatureVerified
  ) {
    return unverifiedGeneration(evidence.generation);
  }
  const dueAt = Date.parse(evidence.eligibleAfterUtc);
  if (!Number.isFinite(dueAt)) return unverifiedGeneration(evidence.generation);
  if (evidence.verifiedSuccessorCoreId !== null) {
    if (
      !HEX64.test(evidence.verifiedSuccessorCoreId) ||
      evidence.verifiedSuccessorCoreId === evidence.currentCoreId ||
      evidence.immutableAncestorCoreIds.includes(
        evidence.verifiedSuccessorCoreId,
      )
    ) {
      return unverifiedGeneration(evidence.generation);
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

function assertAuthoredAsset(
  asset: {
    assetKind: string;
    holoId: string;
    sourceFrameHash: string;
    authored: boolean;
    fallbackGenerated: boolean;
    visibility: string;
  },
  visibility: "published-shadow" | "sealed-until-discovery",
): void {
  if (
    !["authored-shadow-holo", "authored-full-holo"].includes(asset.assetKind) ||
    !HEX64.test(asset.holoId) ||
    !HEX64.test(asset.sourceFrameHash) ||
    asset.authored !== true ||
    asset.fallbackGenerated !== false ||
    asset.visibility !== visibility
  ) {
    throw new Error(
      "Originals must reference shared authored shadow/full-Holo assets without fallback morphology.",
    );
  }
}

function unverifiedGeneration(
  generation: number,
): DimensionGenerationPresentation {
  return {
    generationLabel: `Generation ${Math.max(0, generation || 0)}`,
    mutationDue: false,
    mutationOccurred: false,
    state: "unverified",
    label: "GENERATION EVIDENCE UNVERIFIED",
  };
}
