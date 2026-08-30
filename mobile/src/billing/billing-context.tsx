import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createBillingAdapter } from "./billing-adapter";
import { featuresForLedger } from "./catalog";
import {
  configuredLedgerEndpoint,
  createPreviewLedgerClient,
  createWildLedgerClient,
  unavailableLedger,
  type WildLedgerClient,
} from "./ledger";
import type {
  BillingOffering,
  BillingSnapshot,
  AccessFeatures,
  LedgerSnapshot,
} from "./types";

type BillingContextValue = BillingSnapshot & {
  features: AccessFeatures;
  ledger: LedgerSnapshot;
  busy: boolean;
  purchase: (offering: BillingOffering) => Promise<void>;
  syncPurchaseHistory: () => Promise<void>;
  consumeRapterCredit: (redemptionId: string) => Promise<void>;
  refreshLedger: () => Promise<void>;
  refresh: () => Promise<void>;
};

const initialSnapshot: BillingSnapshot = {
  initialized: false,
  billingEnvironment: "preview",
  offerings: [],
  receipts: [],
  error: null,
};
const initialLedger = unavailableLedger("Wild ledger is initializing.");
const Context = createContext<BillingContextValue | null>(null);

export function BillingProvider({ children }: PropsWithChildren) {
  const adapter = useRef(createBillingAdapter()).current;
  const previewLedger = useRef(createPreviewLedgerClient()).current;
  const liveLedger = useRef<WildLedgerClient | null>(null);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [ledger, setLedger] = useState(initialLedger);
  const [busy, setBusy] = useState(false);
  const cleanup = useRef<() => void>(() => undefined);

  function ledgerFor(value: BillingSnapshot): WildLedgerClient | null {
    if (value.billingEnvironment === "preview") return previewLedger;
    if (value.billingEnvironment !== "live") {
      setLedger(
        unavailableLedger(
          value.error ?? "RevenueCat is not configured for one-time purchases.",
        ),
      );
      return null;
    }
    if (liveLedger.current) return liveLedger.current;
    const configured = configuredLedgerEndpoint();
    if (!configured.endpoint) {
      setLedger(unavailableLedger(configured.error!));
      return null;
    }
    liveLedger.current = createWildLedgerClient({
      endpoint: configured.endpoint,
    });
    return liveLedger.current;
  }

  async function reconcile(value: BillingSnapshot): Promise<void> {
    setSnapshot(value);
    const client = ledgerFor(value);
    if (!client) return;
    try {
      let balance = await client.getBalance();
      for (const receipt of value.receipts) {
        balance = await client.claimReceipt(receipt);
      }
      setLedger(balance);
    } catch (caught) {
      setLedger(unavailableLedger((caught as Error).message));
    }
  }

  async function initialize(): Promise<void> {
    try {
      const result = await adapter.initialize((value) => void reconcile(value));
      cleanup.current();
      cleanup.current = result.cleanup;
      await reconcile(result.snapshot);
    } catch (caught) {
      const failed: BillingSnapshot = {
        initialized: true,
        billingEnvironment: "misconfigured",
        offerings: [],
        receipts: [],
        error: (caught as Error).message,
      };
      setSnapshot(failed);
      setLedger(unavailableLedger(failed.error!));
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void initialize(), 0);
    return () => {
      clearTimeout(timer);
      cleanup.current();
    };
    // The adapter is stable for the lifetime of this provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function purchase(offering: BillingOffering): Promise<void> {
    const client = ledgerFor(snapshot);
    if (!client) {
      setSnapshot((current) => ({
        ...current,
        error:
          ledger.error ??
          "Wild ledger is unavailable; purchase is disabled to avoid an ungrantable charge.",
      }));
      return;
    }
    setBusy(true);
    try {
      const result = await adapter.purchase(offering.packageId);
      setSnapshot(result.snapshot);
      if (!result.purchasedReceipt) {
        throw new Error("Store purchase returned no transaction receipt.");
      }
      setLedger(await client.claimReceipt(result.purchasedReceipt));
    } catch (caught) {
      setSnapshot((current) => ({ ...current, error: (caught as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  async function syncPurchaseHistory(): Promise<void> {
    setBusy(true);
    try {
      await reconcile(await adapter.syncPurchaseHistory());
    } catch (caught) {
      setSnapshot((current) => ({ ...current, error: (caught as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  async function consumeRapterCredit(redemptionId: string): Promise<void> {
    const client = ledgerFor(snapshot);
    if (!client) return;
    setBusy(true);
    try {
      setLedger(await client.consumeRapterCredit(redemptionId));
    } catch (caught) {
      setLedger((current) => ({ ...current, error: (caught as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  async function refreshLedger(): Promise<void> {
    const client = ledgerFor(snapshot);
    if (!client) return;
    try {
      setLedger(await client.getBalance());
    } catch (caught) {
      setLedger(unavailableLedger((caught as Error).message));
    }
  }

  const value: BillingContextValue = {
    ...snapshot,
    features: featuresForLedger(ledger),
    ledger,
    busy,
    purchase,
    syncPurchaseHistory,
    consumeRapterCredit,
    refreshLedger,
    refresh: initialize,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBilling(): BillingContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("useBilling must be used inside BillingProvider.");
  return value;
}
