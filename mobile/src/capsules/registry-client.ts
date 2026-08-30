import { validateRegistryRecordRaw } from "./registry";
import type {
  RapterCreditRegistryRecord,
  ValidatedCapsule,
} from "./types";

type FetchLike = typeof fetch;

export function createCreditRegistryClient(
  endpoint: string,
  fetchImpl: FetchLike = fetch,
): {
  fetchStatus: (
    creditId: string,
    capsule: ValidatedCapsule,
  ) => Promise<RapterCreditRegistryRecord>;
} {
  const normalized = normalizeEndpoint(endpoint);
  return {
    async fetchStatus(creditId, capsule) {
      const response = await fetchImpl(
        `${normalized}/credits/${encodeURIComponent(creditId)}`,
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) {
        throw new Error(
          `Rapterbox registry returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`,
        );
      }
      const value = (await response.json()) as { record?: unknown };
      if (typeof value.record !== "string") {
        throw new Error("Rapterbox registry returned no signed status record.");
      }
      return validateRegistryRecordRaw(value.record, capsule);
    },
  };
}

export function configuredCreditRegistryEndpoint(): {
  endpoint: string | null;
  error: string | null;
} {
  const value =
    process.env.EXPO_PUBLIC_RAPTERBOX_CREDIT_REGISTRY_URL?.trim();
  if (!value) {
    return {
      endpoint: null,
      error:
        "EXPO_PUBLIC_RAPTERBOX_CREDIT_REGISTRY_URL is absent. Official ownership refresh is unavailable.",
    };
  }
  try {
    return { endpoint: normalizeEndpoint(value), error: null };
  } catch (caught) {
    return { endpoint: null, error: (caught as Error).message };
  }
}

function normalizeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid Rapterbox registry URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(
      "Rapterbox registry URL must use HTTPS and cannot contain credentials.",
    );
  }
  return url.toString().replace(/\/$/, "");
}
