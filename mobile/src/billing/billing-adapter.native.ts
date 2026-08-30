import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import Purchases, {
  type CustomerInfo,
  type CustomerInfoUpdateListener,
  LOG_LEVEL,
  PRODUCT_CATEGORY,
  type PurchasesPackage,
  type PurchasesStoreTransaction,
} from "react-native-purchases";
import {
  consumableTitle,
  productKind,
  wildPlanSummary,
} from "./catalog";
import { createPreviewBillingAdapter } from "./preview-adapter";
import type {
  BillingAdapter,
  BillingOffering,
  BillingSnapshot,
  PurchaseReceipt,
} from "./types";

let packages = new Map<string, PurchasesPackage>();

export function createBillingAdapter(): BillingAdapter {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return createPreviewBillingAdapter("Expo Go preview");
  }
  const apiKey =
    Platform.OS === "ios"
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
      : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
  if (!apiKey) return createMissingKeyAdapter();
  return {
    async initialize(onCustomerInfoUpdated) {
      if (!(await Purchases.isConfigured())) {
        if (__DEV__) await Purchases.setLogLevel(LOG_LEVEL.DEBUG);
        Purchases.configure({ apiKey });
      }
      const listener: CustomerInfoUpdateListener = (customerInfo) => {
        void snapshotFromCustomerInfo(customerInfo).then(onCustomerInfoUpdated);
      };
      Purchases.addCustomerInfoUpdateListener(listener);
      const customerInfo = await Purchases.getCustomerInfo();
      return {
        snapshot: await snapshotFromCustomerInfo(customerInfo),
        cleanup: () => {
          Purchases.removeCustomerInfoUpdateListener(listener);
        },
      };
    },
    async purchase(packageId) {
      const selectedPackage = packages.get(packageId);
      if (!selectedPackage) {
        throw new Error(
          "RevenueCat consumable offering is unavailable. Verify the current offering and product identifiers.",
        );
      }
      const result = await Purchases.purchasePackage(selectedPackage);
      return {
        snapshot: await snapshotFromCustomerInfo(result.customerInfo),
        purchasedReceipt: receiptFromTransaction(
          result.transaction,
          result.customerInfo.originalAppUserId,
        ),
      };
    },
    async syncPurchaseHistory() {
      return snapshotFromCustomerInfo(await Purchases.getCustomerInfo());
    },
  };
}

async function snapshotFromCustomerInfo(
  customerInfo: CustomerInfo,
): Promise<BillingSnapshot> {
  const offerings = await Purchases.getOfferings();
  packages = new Map();
  const available: BillingOffering[] = [];
  for (const item of offerings.current?.availablePackages ?? []) {
    if (item.product.productCategory === PRODUCT_CATEGORY.SUBSCRIPTION) {
      continue;
    }
    const kind = productKind(item.product.identifier);
    if (kind === null) continue;
    packages.set(item.identifier, item);
    available.push({
      id: item.product.identifier,
      packageId: item.identifier,
      productIdentifier: item.product.identifier,
      kind,
      title: item.product.title || consumableTitle(item.product.identifier),
      description:
        item.product.description ||
        (kind === "rapter_credit"
          ? wildPlanSummary
          : "Optional managed-compute and longer Growl credits."),
      price: item.product.priceString,
    });
  }
  return {
    initialized: true,
    billingEnvironment: "live",
    offerings: available,
    receipts: customerInfo.nonSubscriptionTransactions.map((transaction) =>
      receiptFromTransaction(transaction, customerInfo.originalAppUserId),
    ),
    error:
      available.length === 0
        ? "RevenueCat is configured, but the current one-time offering has no recognized consumable packages."
        : null,
  };
}

function receiptFromTransaction(
  transaction: PurchasesStoreTransaction,
  appUserId: string,
): PurchaseReceipt {
  return {
    transactionIdentifier: transaction.transactionIdentifier,
    productIdentifier: transaction.productIdentifier,
    purchaseDate: transaction.purchaseDate,
    store: Platform.OS === "ios" ? "APP_STORE" : "PLAY_STORE",
    appUserId,
  };
}

function createMissingKeyAdapter(): BillingAdapter {
  const platformName = Platform.OS === "ios" ? "IOS" : "ANDROID";
  const variable = `EXPO_PUBLIC_REVENUECAT_${platformName}_API_KEY`;
  const snapshot: BillingSnapshot = {
    initialized: true,
    billingEnvironment: "misconfigured",
    offerings: [],
    receipts: [],
    error: `${variable} is absent. Real one-time purchases are disabled in this EAS build.`,
  };
  return {
    async initialize() {
      return { snapshot, cleanup: () => undefined };
    },
    async purchase() {
      throw new Error(snapshot.error!);
    },
    async syncPurchaseHistory() {
      throw new Error(snapshot.error!);
    },
  };
}
