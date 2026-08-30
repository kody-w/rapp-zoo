import type { JsonObject } from "@/lib/types";

type FetchLike = typeof fetch;

export type LifecycleServiceStatus = {
  returnWindowDays: number;
  refundRails: Record<string, boolean>;
  resaleSettlementConfigured: boolean;
};

export type LifecycleOwnership = {
  creditId: string;
  state: "owned" | "listed" | "rappterbox-inventory";
  activeListingId: string | null;
  officialOwned: boolean;
  localCopyStatus: "official-owner-copy" | "unowned-verifiable-copy";
  currentEventId: string;
};

export type LifecycleEvents = {
  creditId: string;
  data: JsonObject[];
};

export type LifecyclePublicClient = {
  status: () => Promise<LifecycleServiceStatus>;
  ownership: (creditId: string) => Promise<LifecycleOwnership>;
  events: (creditId: string) => Promise<LifecycleEvents>;
  verifyEvent: (event: JsonObject) => Promise<boolean>;
};

export function configuredLifecycleEndpoint(): string | null {
  const value =
    process.env.EXPO_PUBLIC_RAPTERBOX_CREDIT_REGISTRY_URL?.trim() ?? "";
  if (!value) return null;
  return normalizeEndpoint(value);
}

export function createLifecyclePublicClient(
  endpoint: string,
  fetchImpl: FetchLike = fetch,
): LifecyclePublicClient {
  const base = normalizeEndpoint(endpoint);
  const json = async (
    path: string,
    init?: RequestInit,
  ): Promise<Record<string, unknown>> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(`${base}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Lifecycle service returned HTTP ${response.status}.`);
      }
      const value: unknown = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Lifecycle service returned malformed JSON.");
      }
      return value as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  };
  return {
    async status() {
      const value = await json("/credit-registry/lifecycle/status");
      if (
        value.schema !== "rapp-rapter-credit-lifecycle-status/1" ||
        value.return_window_days !== 30 ||
        !value.refund_rails ||
        typeof value.refund_rails !== "object" ||
        typeof value.resale_settlement_configured !== "boolean"
      ) {
        throw new Error("Lifecycle status contract is invalid.");
      }
      return {
        returnWindowDays: 30,
        refundRails: value.refund_rails as Record<string, boolean>,
        resaleSettlementConfigured: value.resale_settlement_configured,
      };
    },
    async ownership(creditId) {
      const value = await json(
        `/credit-registry/ownership?credit_id=${encodeURIComponent(creditId)}`,
      );
      if (
        value.schema !== "rapp-rapter-credit-ownership/1" ||
        value.credit_id !== creditId ||
        !["owned", "listed", "rappterbox-inventory"].includes(
          String(value.state),
        ) ||
        typeof value.official_owned !== "boolean" ||
        typeof value.current_event_id !== "string"
      ) {
        throw new Error("Lifecycle ownership contract is invalid.");
      }
      return {
        creditId,
        state: value.state as LifecycleOwnership["state"],
        activeListingId:
          typeof value.active_listing_id === "string"
            ? value.active_listing_id
            : null,
        officialOwned: value.official_owned,
        localCopyStatus:
          value.local_copy_status === "unowned-verifiable-copy"
            ? "unowned-verifiable-copy"
            : "official-owner-copy",
        currentEventId: value.current_event_id,
      };
    },
    async events(creditId) {
      const value = await json(
        `/credit-registry/lifecycle?credit_id=${encodeURIComponent(creditId)}&after=0&limit=100`,
      );
      if (
        value.object !== "list" ||
        value.credit_id !== creditId ||
        !Array.isArray(value.data)
      ) {
        throw new Error("Lifecycle event list contract is invalid.");
      }
      return {
        creditId,
        data: value.data.filter(
          (item): item is JsonObject =>
            item !== null && typeof item === "object" && !Array.isArray(item),
        ),
      };
    },
    async verifyEvent(event) {
      const value = await json("/credit-registry/verify", {
        method: "POST",
        body: JSON.stringify(event),
      });
      return value.valid === true && value.event_id === event.event_id;
    },
  };
}

function normalizeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Lifecycle service URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(
      "Lifecycle service URL must use HTTPS and contain no credentials.",
    );
  }
  return url.toString().replace(/\/$/, "");
}
