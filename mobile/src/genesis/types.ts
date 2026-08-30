export type CompanionGenesisFamily = {
  familyClass: "companion";
  familyIndex: 1 | 2 | 3;
  familyId: string;
  canonical: true;
  accountInstanceCap: 1;
  transferable: false;
  scarcePremiumSeries: false;
  signatureVerified: boolean;
};

export type PremiumGenesisFamily = {
  familyClass: "premium";
  familyIndex: number;
  familyId: string;
  canonical: true;
  signedSupplyCap: number;
  signedLeaseCap: number;
  supplyCapRecordHash: string;
  leaseCapRecordHash: string;
  scarcePremiumSeries: true;
  signatureVerified: boolean;
};

export type GenesisFamily =
  | CompanionGenesisFamily
  | PremiumGenesisFamily;

export type GenesisFamilyCatalog = {
  schema: "rapp-genesis-family-catalog/1";
  canonicalFamilyCount: 151;
  companionFamilyCount: 3;
  premiumFamilyCount: 148;
  families: GenesisFamily[];
  signatureVerified: boolean;
};

export type MutationComputeStatus =
  | "available"
  | "unavailable"
  | "offline"
  | "budget-exhausted";

export type GenerationEvidence = {
  schema: "rapp-generation-evidence/1";
  organismRappid: string;
  generation: number;
  currentCoreId: string;
  immutableAncestorCoreIds: readonly string[];
  eligibleAfterUtc: string;
  eligibilityRecordHash: string;
  eligibilitySignatureVerified: boolean;
  verifiedSuccessorCoreId: string | null;
  computeStatus: MutationComputeStatus;
};

export type GenerationPresentation = {
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
