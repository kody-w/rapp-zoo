import {
  CONSUMABLE_PRODUCTS,
  productKind,
  rapterCreditsForProduct,
} from "./catalog";
import type { LedgerSnapshot, PurchaseReceipt } from "./types";

export type WildLedgerClient = {
  getBalance: () => Promise<LedgerSnapshot>;
  claimReceipt: (receipt: PurchaseReceipt) => Promise<LedgerSnapshot>;
  consumeRapterCredit: (redemptionId: string) => Promise<LedgerSnapshot>;
};

type FetchLike = typeof fetch;

export function createWildLedgerClient(
  options: {
    endpoint: string;
    sessionToken?: string;
  },
  fetchImpl: FetchLike = fetch,
): WildLedgerClient {
  const endpoint = normalizeLedgerEndpoint(options.endpoint);
  const headers = (): Record<string, string> => ({
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(options.sessionToken
      ? { Authorization: `Bearer ${options.sessionToken}` }
      : {}),
  });
  return {
    async getBalance() {
      return requestLedger(fetchImpl, `${endpoint}/balance`, {
        method: "GET",
        headers: headers(),
      });
    },
    async claimReceipt(receipt) {
      if (!receipt.transactionIdentifier) {
        throw new Error("Store transaction identifier is required for ledger grant.");
      }
      if (productKind(receipt.productIdentifier) === null) {
        throw new Error("Ledger grant product is not in the consumable catalog.");
      }
      return requestLedger(fetchImpl, `${endpoint}/grants`, {
        method: "POST",
        headers: {
          ...headers(),
          "Idempotency-Key": receipt.transactionIdentifier,
        },
        body: JSON.stringify(receipt),
      });
    },
    async consumeRapterCredit(redemptionId) {
      return requestLedger(fetchImpl, `${endpoint}/credits/redeem`, {
        method: "POST",
        headers: {
          ...headers(),
          "Idempotency-Key": redemptionId,
        },
        body: JSON.stringify({ redemption_id: redemptionId }),
      });
    },
  };
}

export function createPreviewLedgerClient(): WildLedgerClient {
  const processed = new Set<string>();
  let availableRapterCredits = 0;
  let activeWildRapters = 0;
  let smallComputePacks = 0;
  let largeComputePacks = 0;
  const redemptions = new Set<string>();
  const snapshot = (): LedgerSnapshot => ({
    availableRapterCredits,
    activeWildRapters,
    smallComputePacks,
    largeComputePacks,
    processedTransactions: processed.size,
    status: "preview",
    error:
      "Preview ledger is session-only. No store receipt or backend grant is created.",
  });
  return {
    async getBalance() {
      return snapshot();
    },
    async claimReceipt(receipt) {
      if (processed.has(receipt.transactionIdentifier)) return snapshot();
      if (productKind(receipt.productIdentifier) === null) {
        throw new Error("Preview ledger product is not in the consumable catalog.");
      }
      processed.add(receipt.transactionIdentifier);
      availableRapterCredits += rapterCreditsForProduct(
        receipt.productIdentifier,
      );
      if (receipt.productIdentifier === CONSUMABLE_PRODUCTS.computeSmall) {
        smallComputePacks += 1;
      }
      if (receipt.productIdentifier === CONSUMABLE_PRODUCTS.computeLarge) {
        largeComputePacks += 1;
      }
      return snapshot();
    },
    async consumeRapterCredit(redemptionId) {
      if (redemptions.has(redemptionId)) return snapshot();
      if (availableRapterCredits < 1) {
        throw new Error("A Rapter credit is required for capsule redemption.");
      }
      redemptions.add(redemptionId);
      availableRapterCredits -= 1;
      return snapshot();
    },
  };
}

export function configuredLedgerEndpoint(): {
  endpoint: string | null;
  error: string | null;
} {
  const value = process.env.EXPO_PUBLIC_RAPTERBOX_WILD_LEDGER_URL?.trim();
  if (!value) {
    return {
      endpoint: null,
      error:
        "EXPO_PUBLIC_RAPTERBOX_WILD_LEDGER_URL is absent. Consumable purchases are disabled because grants cannot be recorded safely.",
    };
  }
  try {
    return { endpoint: normalizeLedgerEndpoint(value), error: null };
  } catch (caught) {
    return { endpoint: null, error: (caught as Error).message };
  }
}

export function unavailableLedger(error: string): LedgerSnapshot {
  return {
    availableRapterCredits: 0,
    activeWildRapters: 0,
    smallComputePacks: 0,
    largeComputePacks: 0,
    processedTransactions: 0,
    status: "unavailable",
    error,
  };
}

function normalizeLedgerEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid Wild ledger URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(
      "Wild ledger URL must use HTTPS and cannot contain credentials.",
    );
  }
  return url.toString().replace(/\/$/, "");
}

async function requestLedger(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<LedgerSnapshot> {
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    throw new Error(
      `Wild ledger returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`,
    );
  }
  const value = (await response.json()) as Partial<LedgerSnapshot>;
  for (const key of [
    "availableRapterCredits",
    "activeWildRapters",
    "smallComputePacks",
    "largeComputePacks",
    "processedTransactions",
  ] as const) {
    if (
      typeof value[key] !== "number" ||
      !Number.isSafeInteger(value[key]) ||
      value[key]! < 0
    ) {
      throw new Error(`Wild ledger response has invalid ${key}.`);
    }
  }
  return {
    availableRapterCredits: value.availableRapterCredits!,
    activeWildRapters: value.activeWildRapters!,
    smallComputePacks: value.smallComputePacks!,
    largeComputePacks: value.largeComputePacks!,
    processedTransactions: value.processedTransactions!,
    status: "live",
    error: null,
  };
}
