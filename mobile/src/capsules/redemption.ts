import {
  lumenDriftCapsuleRaw,
  meshBloomCapsuleRaw,
  meshBloomRegistryRaw,
  orbitalGardenCapsuleRaw,
  orbitalGardenRegistryRaw,
} from "@/generated/capsule-fixtures";
import { validateCapsuleRaw } from "./capsule";
import { validateRegistryRecordRaw } from "./registry";
import type {
  CapsuleRedemptionResult,
} from "./types";

export type CapsuleRedemptionClient = {
  redeem: (request: {
    organismId: string;
    capsuleAsset?: string;
    registryAsset?: string | null;
    redemptionId: string;
  }) => Promise<CapsuleRedemptionResult>;
  redownload: (capsuleId: string) => Promise<CapsuleRedemptionResult>;
};

type FetchLike = typeof fetch;

const previewCapsules: Record<string, string> = {
  "lumen-drift.rollingcore.json": lumenDriftCapsuleRaw,
  "mesh-bloom.rollingcore.json": meshBloomCapsuleRaw,
  "orbital-garden.rollingcore.json": orbitalGardenCapsuleRaw,
};
const previewRegistry: Record<string, string> = {
  "mesh-bloom.registry.json": meshBloomRegistryRaw,
  "orbital-garden.registry.json": orbitalGardenRegistryRaw,
};

export function createCapsuleRedemptionClient(
  endpoint: string,
  fetchImpl: FetchLike = fetch,
): CapsuleRedemptionClient {
  const normalized = normalizeEndpoint(endpoint);
  return {
    async redeem(request) {
      const response = await fetchImpl(`${normalized}/redeem`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": request.redemptionId,
        },
        body: JSON.stringify({ organism_id: request.organismId }),
      });
      return resultFromResponse(response);
    },
    async redownload(capsuleId) {
      const response = await fetchImpl(
        `${normalized}/capsules/${encodeURIComponent(capsuleId)}`,
        { headers: { Accept: "application/json" } },
      );
      return resultFromResponse(response);
    },
  };
}

export function createPreviewRedemptionClient(): CapsuleRedemptionClient {
  const redemptions = new Map<string, CapsuleRedemptionResult>();
  const owned = new Map<string, CapsuleRedemptionResult>();
  return {
    async redeem(request) {
      const existing = redemptions.get(request.redemptionId);
      if (existing) return existing;
      if (!request.capsuleAsset || !request.registryAsset) {
        throw new Error(
          "Preview purchase redemption requires capsule and official registry assets.",
        );
      }
      const capsuleRaw = previewCapsules[request.capsuleAsset];
      const registryRaw = previewRegistry[request.registryAsset];
      if (!capsuleRaw || !registryRaw) {
        throw new Error("Preview ownership assets are unavailable.");
      }
      const capsule = validateCapsuleRaw(capsuleRaw);
      if (capsule.organism.id !== request.organismId) {
        throw new Error("Preview capsule organism does not match redemption.");
      }
      const result = {
        capsule,
        registryRecord: validateRegistryRecordRaw(registryRaw, capsule),
      };
      redemptions.set(request.redemptionId, result);
      owned.set(capsule.capsuleId, result);
      return result;
    },
    async redownload(capsuleId) {
      const result = owned.get(capsuleId);
      if (!result) throw new Error("Preview recovery record is unavailable.");
      return result;
    },
  };
}

export function configuredCapsuleServiceEndpoint(): {
  endpoint: string | null;
  error: string | null;
} {
  const value =
    process.env.EXPO_PUBLIC_RAPTERBOX_CAPSULE_SERVICE_URL?.trim();
  if (!value) {
    return {
      endpoint: null,
      error:
        "EXPO_PUBLIC_RAPTERBOX_CAPSULE_SERVICE_URL is absent. Live capsule redemption is unavailable.",
    };
  }
  try {
    return { endpoint: normalizeEndpoint(value), error: null };
  } catch (caught) {
    return { endpoint: null, error: (caught as Error).message };
  }
}

async function resultFromResponse(
  response: Response,
): Promise<CapsuleRedemptionResult> {
  if (!response.ok) {
    throw new Error(
      `Capsule service returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`,
    );
  }
  const value = (await response.json()) as {
    capsule?: unknown;
    registry_record?: unknown;
  };
  if (
    typeof value.capsule !== "string" ||
    typeof value.registry_record !== "string"
  ) {
    throw new Error(
      "Atomic redemption response must include signed capsule and registry record.",
    );
  }
  const capsule = validateCapsuleRaw(value.capsule);
  return {
    capsule,
    registryRecord: validateRegistryRecordRaw(
      value.registry_record,
      capsule,
    ),
  };
}

function normalizeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid capsule service URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(
      "Capsule service URL must use HTTPS and cannot contain credentials.",
    );
  }
  return url.toString().replace(/\/$/, "");
}
