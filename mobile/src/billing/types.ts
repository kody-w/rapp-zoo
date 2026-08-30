export type AccessMode = "direct" | "wild";

export type BillingEnvironment = "live" | "preview" | "misconfigured";

export type BillingProductKind = "rapter_credit" | "compute_credit";

export type BillingOffering = {
  id: string;
  packageId: string;
  productIdentifier: string;
  kind: BillingProductKind;
  title: string;
  description: string;
  price: string;
};

export type PurchaseReceipt = {
  transactionIdentifier: string;
  productIdentifier: string;
  purchaseDate: string;
  store: string;
  appUserId: string;
};

export type BillingSnapshot = {
  initialized: boolean;
  billingEnvironment: BillingEnvironment;
  offerings: BillingOffering[];
  receipts: PurchaseReceipt[];
  error: string | null;
};

export type PurchaseResult = {
  snapshot: BillingSnapshot;
  purchasedReceipt: PurchaseReceipt | null;
};

export type BillingAdapter = {
  initialize: (
    onCustomerInfoUpdated: (snapshot: BillingSnapshot) => void,
  ) => Promise<{ snapshot: BillingSnapshot; cleanup: () => void }>;
  purchase: (packageId: string) => Promise<PurchaseResult>;
  syncPurchaseHistory: () => Promise<BillingSnapshot>;
};

export type LedgerSnapshot = {
  availableRapterCredits: number;
  activeWildRapters: number;
  smallComputePacks: number;
  largeComputePacks: number;
  processedTransactions: number;
  status: "preview" | "live" | "unavailable";
  error: string | null;
};

export type AccessFeatures = {
  accessMode: AccessMode;
  localRapterSlots: 1;
  activeWildRapters: number;
  remoteAccess: boolean;
  hostedBrainstem: boolean;
  managedProviderRouting: boolean;
  quotaAndRevocation: boolean;
  managedAutocomplete: boolean;
  wildHistoryDepth: number;
  wildGrowlMaxNotes: number;
  wildGrowlExport: boolean;
  fantasyDrafts: boolean;
  rappterRooms: boolean;
  localPlayback: true;
  localHistory: true;
  localImport: true;
  protocolValidation: true;
  ownedLocalDataAccess: true;
  ownedLocalDataExport: true;
};
