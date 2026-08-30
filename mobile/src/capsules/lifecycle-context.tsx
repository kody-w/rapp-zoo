import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Linking, Platform } from "react-native";
import { useBilling } from "@/billing/billing-context";
import { useHoloStore } from "@/state/holo-store";
import {
  configuredLifecycleEndpoint,
  createLifecyclePublicClient,
  type LifecycleEvents,
  type LifecycleOwnership,
} from "./lifecycle-client";
import {
  cancelListing,
  deriveLifecycleSnapshot,
  lifecycleStateLabel,
  loadLifecycleFixtures,
  markListed,
  markSold,
  performVerifiedReturn,
  RETURN_WINDOW_DAYS,
  type LifecycleReturnClient,
} from "./lifecycle";
import {
  loadLifecycleSnapshot,
  storeLifecycleSnapshot,
} from "./lifecycle-mirror";
import type {
  CapsuleLifecycleSnapshot,
  MarketplaceLifecycleListing,
  RapterCreditRegistryRecord,
  ValidatedCapsule,
} from "./types";

type LifecycleContextValue = {
  snapshot: CapsuleLifecycleSnapshot | null;
  marketplace: MarketplaceLifecycleListing[];
  label: string;
  preview: boolean;
  busy: boolean;
  message: string | null;
  refresh: () => Promise<void>;
  requestReturn: () => Promise<void>;
  listForSale: (askPriceSats: number) => Promise<void>;
  cancelSaleListing: () => Promise<void>;
  manageSaleTransfer: () => Promise<void>;
};

const LifecycleContext = createContext<LifecycleContextValue | null>(null);

export function LifecycleProvider({ children }: PropsWithChildren) {
  const billing = useBilling();
  const store = useHoloStore();
  const marketplace = useMemo(
    () => loadLifecycleFixtures().marketplace,
    [],
  );
  const [snapshot, setSnapshot] =
    useState<CapsuleLifecycleSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const capsule = store.selectedCapsule;
  const creditId = capsule?.credit?.creditId ?? null;
  const preview = billing.billingEnvironment === "preview";

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!capsule || !creditId) {
        if (active) {
          setSnapshot(
            capsule
              ? deriveLifecycleSnapshot(
                  capsule,
                  store.selectedRegistryRecord,
                  null,
                )
              : null,
          );
        }
        return;
      }
      const mirrored = await loadLifecycleSnapshot(creditId);
      if (active) {
        setSnapshot(
          deriveLifecycleSnapshot(
            capsule,
            store.selectedRegistryRecord,
            mirrored,
          ),
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [capsule, creditId, store.selectedRegistryRecord]);

  const persist = async (next: CapsuleLifecycleSnapshot) => {
    setSnapshot(next);
    await storeLifecycleSnapshot(next);
  };

  const refresh = async () => {
    if (!capsule || !creditId) return;
    const endpoint = configuredLifecycleEndpoint();
    if (!endpoint) {
      setMessage(
        preview
          ? "Preview lifecycle is local-only."
          : "Lifecycle service is not configured.",
      );
      return;
    }
    setBusy(true);
    try {
      const client = createLifecyclePublicClient(endpoint);
      const [status, ownership, events] = await Promise.all([
        client.status(),
        client.ownership(creditId),
        client.events(creditId),
      ]);
      if (status.returnWindowDays !== RETURN_WINDOW_DAYS) {
        throw new Error("The server return policy does not match this build.");
      }
      const latest = events.data.at(-1) ?? null;
      const eventVerified = latest ? await client.verifyEvent(latest) : true;
      if (!eventVerified) throw new Error("Latest lifecycle event was refused.");
      const next = snapshotFromRemote(
        capsule,
        store.selectedRegistryRecord,
        ownership,
        events,
      );
      await persist(next);
      setMessage("Official lifecycle refreshed from signed registry events.");
    } catch (caught) {
      setMessage((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const requestReturn = async () => {
    if (!snapshot || !capsule?.credit) return;
    setBusy(true);
    try {
      if (preview) {
        const client = previewReturnClient();
        const returned = await performVerifiedReturn({
          client,
          current: snapshot,
          onPending: persist,
          operationId: `preview-return-${capsule.credit.creditId}`,
        });
        await persist(returned);
        setMessage(
          "PREVIEW: refund confirmed and signed return event verified. Immutable capsule bytes remain as an unowned preview.",
        );
        return;
      }
      const endpoint = configuredLifecycleEndpoint();
      if (!endpoint) throw new Error("Lifecycle service is not configured.");
      const client = createLifecyclePublicClient(endpoint);
      const [status, ownership] = await Promise.all([
        client.status(),
        client.ownership(capsule.credit.creditId),
      ]);
      const eligible =
        ownership.state === "owned" &&
        Date.now() <=
          Date.parse(capsule.credit.issuedUtc) +
            status.returnWindowDays * 86_400_000;
      if (!eligible) {
        throw new Error("Server evidence says the return is not eligible.");
      }
      const pending: CapsuleLifecycleSnapshot = {
        ...snapshot,
        state: "return-pending",
        updatedUtc: new Date().toISOString(),
      };
      await persist(pending);
      const url =
        capsule.credit.mintChannel === "rapterbox_btc"
          ? "https://rapterbox.com/support"
          : Platform.OS === "ios"
            ? "https://reportaproblem.apple.com"
            : "https://support.google.com/googleplay/workflow/9813244";
      await Linking.openURL(url);
      setMessage(
        capsule.credit.mintChannel === "rapterbox_btc"
          ? "Return pending. Rapterbox must verify BTC settlement before signed ownership changes."
          : "Return pending. Complete the platform-store refund flow, then refresh; local ownership changes only after backend confirmation.",
      );
    } catch (caught) {
      setMessage((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const listForSale = async (askPriceSats: number) => {
    if (!snapshot) return;
    setBusy(true);
    try {
      if (!preview) {
        await Linking.openURL("https://rapterbox.com/holo");
        setMessage(
          "Listing requires official-owner authorization and a signed Rapterbox registry event. Refresh after completing the web flow.",
        );
        return;
      }
      const listed = markListed(
        snapshot,
        `rce_${"8".repeat(32)}`,
        askPriceSats,
        new Date().toISOString(),
      );
      await persist(listed);
      setMessage(
        "PREVIEW: signed listing fixture recorded. Ask price is separate from immutable birth value.",
      );
    } catch (caught) {
      setMessage((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelSaleListing = async () => {
    if (!snapshot) return;
    setBusy(true);
    try {
      if (!preview) {
        await Linking.openURL("https://rapterbox.com/holo");
        setMessage(
          "Cancellation requires a signed official-owner registry event. Refresh after the web flow.",
        );
        return;
      }
      const owned = cancelListing(
        snapshot,
        `rce_${"9".repeat(32)}`,
        new Date().toISOString(),
      );
      await persist(owned);
      setMessage("PREVIEW: listing cancellation event recorded.");
    } catch (caught) {
      setMessage((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const manageSaleTransfer = async () => {
    if (!snapshot) return;
    setBusy(true);
    try {
      if (!preview) {
        await Linking.openURL("https://rapterbox.com/holo");
        setMessage(
          "Sale settlement and ownership transfer require signed backend events. Refresh after the official web flow completes.",
        );
        return;
      }
      const sold = markSold(
        snapshot,
        `rce_${"a".repeat(32)}`,
        snapshot.currentSellerAskSats ?? 1,
        new Date().toISOString(),
      );
      await persist(sold);
      setMessage(
        "PREVIEW: verified sale and transfer fixtures recorded. Local bytes remain an unowned preview.",
      );
    } catch (caught) {
      setMessage((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <LifecycleContext.Provider
      value={{
        snapshot,
        marketplace,
        label: snapshot
          ? lifecycleStateLabel(snapshot.state)
          : "NO CAPSULE SELECTED",
        preview,
        busy,
        message,
        refresh,
        requestReturn,
        listForSale,
        cancelSaleListing,
        manageSaleTransfer,
      }}
    >
      {children}
    </LifecycleContext.Provider>
  );
}

export function useLifecycle(): LifecycleContextValue {
  const value = useContext(LifecycleContext);
  if (!value) {
    throw new Error("useLifecycle must be used inside LifecycleProvider.");
  }
  return value;
}

function previewReturnClient(): LifecycleReturnClient {
  return {
    async verifyEligibility() {
      return { eligible: true, reason: "preview eligible" };
    },
    async confirmReturn() {
      return {
        refundConfirmed: true,
        eventVerified: true,
        eventId: `rce_${"7".repeat(32)}`,
        updatedUtc: new Date().toISOString(),
      };
    },
  };
}

function snapshotFromRemote(
  capsule: ValidatedCapsule,
  registry: RapterCreditRegistryRecord | null,
  ownership: LifecycleOwnership,
  events: LifecycleEvents,
): CapsuleLifecycleSnapshot {
  const latestReturn = [...events.data]
    .reverse()
    .find((event) => event.schema === "rapp-rapter-credit-return/1");
  const latestListing = [...events.data]
    .reverse()
    .find((event) => event.schema === "rapp-rapter-credit-listing/1");
  const latestSale = [...events.data]
    .reverse()
    .find((event) => event.schema === "rapp-rapter-credit-sale/1");
  const base = deriveLifecycleSnapshot(capsule, registry, null);
  if (ownership.state === "rappterbox-inventory" && latestReturn) {
    return {
      ...base,
      state: "returned",
      officialOwned: false,
      localCopyStatus: "unowned-verifiable-copy",
      lastEventId: String(latestReturn.event_id),
      eventVerified: true,
      updatedUtc: String(latestReturn.occurred_utc),
    };
  }
  if (ownership.state === "listed" && latestListing) {
    return {
      ...base,
      state: "listed",
      officialOwned: true,
      currentSellerAskSats: Number(latestListing.ask_price_sats),
      lastVerifiedSaleSats:
        typeof latestSale?.sale_price_sats === "number"
          ? latestSale.sale_price_sats
          : null,
      activeListingId: ownership.activeListingId,
      lastEventId: ownership.currentEventId,
      eventVerified: true,
      updatedUtc: String(latestListing.occurred_utc),
    };
  }
  if (registry?.status === "transferred" && latestSale) {
    return {
      ...base,
      state: "sold",
      officialOwned: false,
      localCopyStatus: "unowned-verifiable-copy",
      currentSellerAskSats: null,
      lastVerifiedSaleSats: Number(latestSale.sale_price_sats),
      activeListingId: null,
      lastEventId: ownership.currentEventId,
      eventVerified: true,
      updatedUtc: String(latestSale.occurred_utc),
    };
  }
  return {
    ...base,
    state:
      base.state === "return-eligible" ? "return-eligible" : "owned",
    officialOwned: ownership.officialOwned,
    activeListingId: ownership.activeListingId,
    lastVerifiedSaleSats:
      typeof latestSale?.sale_price_sats === "number"
        ? latestSale.sale_price_sats
        : null,
    lastEventId: ownership.currentEventId,
    eventVerified: true,
    updatedUtc: new Date().toISOString(),
  };
}
