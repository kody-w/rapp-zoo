export type AuthoredHoloAssetReference = {
  assetKind: "authored-shadow-holo" | "authored-full-holo";
  holoId: string;
  sourceFrameHash: string;
  authored: true;
  fallbackGenerated: false;
  visibility: "published-shadow" | "sealed-until-discovery";
};

export type FirstEditionOriginal = {
  originalOrdinal: number;
  originalId: string;
  originalRappid: string;
  edition: "first-edition";
  dimension: "first-dimension";
  titleStatus: "issuer-held";
  discoveryStatus: "undiscovered";
  rightsStatus: "issuer-reserved";
  shadowHolo: AuthoredHoloAssetReference;
  fullHolo: AuthoredHoloAssetReference;
  signatureVerified: boolean;
};

export type CompanionOriginReference = {
  companionOrdinal: 1 | 2 | 3;
  originId: string;
  accountInstanceCap: 1;
  transferable: false;
  outsidePremiumOriginalInventory: true;
};

export type FirstEditionCatalog = {
  schema: "rapp-first-edition-catalog/1";
  edition: "first-edition";
  dimension: "first-dimension";
  originalTitleCount: 251;
  issuerHeldCount: 251;
  transferredCount: 0;
  undiscoveredCount: 251;
  publishedUtc: string;
  originals: FirstEditionOriginal[];
  companionOrigins: [
    CompanionOriginReference,
    CompanionOriginReference,
    CompanionOriginReference,
  ];
  signatureVerified: boolean;
};

export type OriginalTitleTransferGates = {
  rightsTermsAccepted: boolean;
  commerceSettlementVerified: boolean;
  ownerIdentityVerified: boolean;
  signedRegistryReady: boolean;
};

export type OriginalTitleTransfer = {
  schema: "rapp-first-edition-title-transfer/1";
  originalId: string;
  originalRappid: string;
  fromIssuer: true;
  buyerOwnerHash: string;
  rightsGrantId: string;
  settlementReferenceHash: string;
  signedRegistryEventId: string;
  gates: OriginalTitleTransferGates;
  signatureVerified: boolean;
};

export type OffspringIssuance = {
  schema: "rapp-first-dimension-offspring/1";
  parentOriginalId: string;
  parentOriginalRappid: string;
  offspringRappid: string;
  offspringCapsuleId: string;
  offspringRightsGrantId: string;
  ownsOriginalTitle: false;
  signatureVerified: boolean;
};

export type DimensionGenerationEvidence = {
  schema: "rapp-dimension-generation-evidence/1";
  instanceRappid: string;
  generation: number;
  currentCoreId: string;
  immutableAncestorCoreIds: readonly string[];
  eligibleAfterUtc: string;
  eligibilityRecordHash: string;
  eligibilitySignatureVerified: boolean;
  verifiedSuccessorCoreId: string | null;
  computeStatus: "available" | "unavailable" | "offline" | "budget-exhausted";
};

export type DimensionGenerationPresentation = {
  generationLabel: string;
  mutationDue: boolean;
  mutationOccurred: boolean;
  state:
    | "current"
    | "mutation-due"
    | "pending-sleeping"
    | "verified-successor"
    | "unverified";
  label: string;
};
