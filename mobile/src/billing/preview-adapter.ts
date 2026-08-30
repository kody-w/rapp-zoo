import {
  CONSUMABLE_PRODUCTS,
  consumableTitle,
  productKind,
  wildPlanSummary,
} from "./catalog";
import type {
  BillingAdapter,
  BillingOffering,
  BillingSnapshot,
  PurchaseReceipt,
} from "./types";

const previewOfferings: BillingOffering[] = Object.values(
  CONSUMABLE_PRODUCTS,
).map((productIdentifier) => ({
  id: productIdentifier,
  packageId: `preview-${productIdentifier}`,
  productIdentifier,
  kind: productKind(productIdentifier)!,
  title: consumableTitle(productIdentifier),
  description:
    productKind(productIdentifier) === "rapter_credit"
      ? wildPlanSummary
      : "Optional managed-compute and longer Growl capacity for ongoing Azure/model cost.",
  price: "Store price shown in EAS build",
}));

export function createPreviewBillingAdapter(label: string): BillingAdapter {
  const receipts: PurchaseReceipt[] = [];
  let transaction = 0;
  let listener: ((snapshot: BillingSnapshot) => void) | null = null;
  const snapshot = (): BillingSnapshot => ({
    initialized: true,
    billingEnvironment: "preview",
    offerings: previewOfferings,
    receipts: [...receipts],
    error: `${label}: consumable purchases and ledger grants are simulated in memory; no store transaction occurs.`,
  });
  return {
    async initialize(onCustomerInfoUpdated) {
      listener = onCustomerInfoUpdated;
      return {
        snapshot: snapshot(),
        cleanup: () => {
          listener = null;
        },
      };
    },
    async purchase(packageId) {
      const offering = previewOfferings.find(
        (candidate) => candidate.packageId === packageId,
      );
      if (!offering) throw new Error("Unknown preview offering.");
      transaction += 1;
      const purchasedReceipt: PurchaseReceipt = {
        transactionIdentifier: `preview-transaction-${transaction}`,
        productIdentifier: offering.productIdentifier,
        purchaseDate: new Date(0).toISOString(),
        store: "TEST_STORE",
        appUserId: "preview-user",
      };
      receipts.push(purchasedReceipt);
      const value = snapshot();
      listener?.(value);
      return { snapshot: value, purchasedReceipt };
    },
    async syncPurchaseHistory() {
      const value = snapshot();
      listener?.(value);
      return value;
    },
  };
}
