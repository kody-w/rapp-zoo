import type { JsonObject, ValidatedHolo } from "@/lib/types";

export type CapsuleOrganism = {
  id: string;
  rappid: string;
  displayName: string;
  description: string;
};

export type RapterCreditUniqueness =
  | {
      kind: "signed-ledger";
      ledgerId: string;
      sequence: number;
      previousCreditId: string | null;
    }
  | {
      kind: "bitcoin-utxo";
      txid: string;
      vout: number;
    };

export type BirthValuationProof = {
  schema: "rapp-rapter-birth-valuation/1";
  scheduleId: string;
  scheduleVersion: number;
  setId: string;
  tier: string;
  priceSats: number;
  btcUsdCentsPerBtc: number;
  quoteUtc: string;
  quoteSource: string;
  fiatCurrency: "USD";
  birthFiatCents: number;
};

export type RapterCreditBinding = {
  creditId: string;
  organismRappid: string;
  genesisCoreId: string;
  priceSats: number;
  mintChannel: "store_iap" | "rapterbox_btc";
  issuedUtc: string;
  valuation: BirthValuationProof;
  uniqueness: RapterCreditUniqueness;
  issuerKeyId: string;
};

export type RapterCreditRegistryStatus =
  | "official"
  | "transferred"
  | "revoked";

export type RapterCreditRegistryRecord = {
  recordHash: string;
  raw: string;
  root: JsonObject;
  registryId: string;
  registrySequence: number;
  creditId: string;
  organismRappid: string;
  genesisCoreId: string;
  capsuleId: string;
  status: RapterCreditRegistryStatus;
  updatedUtc: string;
  previousStatusHash: string | null;
  issuerKeyId: string;
  verifiedAt: string;
};

export type ValidatedCapsule = {
  capsuleId: string;
  raw: string;
  root: JsonObject;
  organism: CapsuleOrganism;
  frames: ValidatedHolo[];
  sourceFrames: JsonObject[];
  credit: RapterCreditBinding | null;
  trustedSigner: string;
};

export type CapsuleLibraryEntry = {
  id: string;
  importedAt: string;
  capsule: ValidatedCapsule;
};

export type CapsuleRedemptionResult = {
  capsule: ValidatedCapsule;
  registryRecord: RapterCreditRegistryRecord;
};

export type LifecycleUxState =
  | "owned"
  | "return-eligible"
  | "return-pending"
  | "returned"
  | "listed"
  | "sold"
  | "unverified-copy";

export type CapsuleLifecycleSnapshot = {
  creditId: string | null;
  state: LifecycleUxState;
  returnWindowEndsUtc: string | null;
  officialOwned: boolean;
  localCopyStatus: "official-owner-copy" | "unowned-verifiable-copy";
  currentSellerAskSats: number | null;
  lastVerifiedSaleSats: number | null;
  activeListingId: string | null;
  lastEventId: string | null;
  eventVerified: boolean;
  updatedUtc: string;
};

export type MarketplaceLifecycleListing = {
  organismId: string;
  displayName: string;
  state: "listed";
  officialBirthPriceSats: number;
  currentSellerAskSats: number;
  lastVerifiedSaleSats: number | null;
  eventVerification: "preview-fixture" | "verified";
};

export type GalleryOrganism = {
  id: string;
  displayName: string;
  description: string;
  valueSummary: string;
  priceSats: number | null;
  valuation: BirthValuationProof | null;
  capsuleId: string;
  previewFrame: ValidatedHolo;
  capsuleAsset: string;
  registryAsset: string | null;
};
