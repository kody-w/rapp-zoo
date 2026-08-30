import {
  capsuleGalleryRaw,
  lumenDriftCapsuleRaw,
  meshBloomCapsuleRaw,
  meshBloomRegistryRaw,
  orbitalGardenCapsuleRaw,
  orbitalGardenRegistryRaw,
} from "@/generated/capsule-fixtures";
import { canonicalize, strictParse } from "@/lib/strict-json";
import type { JsonObject, JsonValue } from "@/lib/types";
import { validateHoloValue } from "@/lib/holo";
import { validateCapsuleRaw } from "./capsule";
import { validateRegistryRecordRaw } from "./registry";
import type { BirthValuationProof, GalleryOrganism } from "./types";

const capsuleByAsset: Record<string, string> = {
  "lumen-drift.rollingcore.json": lumenDriftCapsuleRaw,
  "mesh-bloom.rollingcore.json": meshBloomCapsuleRaw,
  "orbital-garden.rollingcore.json": orbitalGardenCapsuleRaw,
};
const registryByAsset: Record<string, string> = {
  "mesh-bloom.registry.json": meshBloomRegistryRaw,
  "orbital-garden.registry.json": orbitalGardenRegistryRaw,
};

function valuationWireValue(valuation: BirthValuationProof): JsonObject {
  return {
    schema: valuation.schema,
    schedule_id: valuation.scheduleId,
    schedule_version: valuation.scheduleVersion,
    set_id: valuation.setId,
    tier: valuation.tier,
    price_sats: valuation.priceSats,
    btc_usd_cents_per_btc: valuation.btcUsdCentsPerBtc,
    quote_utc: valuation.quoteUtc,
    quote_source: valuation.quoteSource,
    fiat_currency: valuation.fiatCurrency,
    birth_fiat_cents: valuation.birthFiatCents,
  };
}

export function loadBundledGallery(): GalleryOrganism[] {
  const root = asObject(strictParse(capsuleGalleryRaw));
  if (root.schema !== "rolling-core-gallery/1" || !Array.isArray(root.organisms)) {
    throw new Error("Bundled Rolling Core gallery schema is invalid.");
  }
  return root.organisms.map((value) => {
    const item = asObject(value);
    if (
      typeof item.id !== "string" ||
      typeof item.display_name !== "string" ||
      typeof item.description !== "string" ||
      typeof item.value_summary !== "string" ||
      !(
        item.price_sats === null ||
        (typeof item.price_sats === "number" &&
          Number.isSafeInteger(item.price_sats) &&
          item.price_sats >= 0)
      ) ||
      !(
        item.valuation === null ||
        (typeof item.valuation === "object" && !Array.isArray(item.valuation))
      ) ||
      typeof item.capsule_id !== "string" ||
      typeof item.asset !== "string" ||
      !(
        item.registry_asset === null ||
        typeof item.registry_asset === "string"
      )
    ) {
      throw new Error("Bundled gallery organism is malformed.");
    }
    const capsuleRaw = capsuleByAsset[item.asset];
    if (!capsuleRaw) throw new Error("Bundled gallery capsule asset is missing.");
    const capsule = validateCapsuleRaw(capsuleRaw);
    if (
      capsule.capsuleId !== item.capsule_id ||
      capsule.organism.id !== item.id ||
      (capsule.credit?.priceSats ?? null) !== item.price_sats
    ) {
      throw new Error("Gallery preview and capsule ownership proof disagree.");
    }
    if (
      canonicalize(
        capsule.credit ? valuationWireValue(capsule.credit.valuation) : null,
      ) !==
      canonicalize(item.valuation ?? null)
    ) {
      throw new Error("Gallery birth valuation and signed capsule disagree.");
    }
    if (capsule.credit) {
      if (typeof item.registry_asset !== "string") {
        throw new Error("Purchased gallery organism has no registry proof asset.");
      }
      const registryRaw = registryByAsset[item.registry_asset];
      if (!registryRaw) throw new Error("Gallery registry asset is missing.");
      validateRegistryRecordRaw(registryRaw, capsule);
    } else if (item.registry_asset !== null) {
      throw new Error("Free gallery organism cannot claim a registry proof.");
    }
    return {
      id: item.id,
      displayName: item.display_name,
      description: item.description,
      valueSummary: item.value_summary,
      priceSats: item.price_sats,
      valuation: capsule.credit?.valuation ?? null,
      capsuleId: item.capsule_id,
      previewFrame: validateHoloValue(item.preview_frame!),
      capsuleAsset: item.asset,
      registryAsset: item.registry_asset,
    };
  });
}

export function bundledPreviewCapsule(asset: string): string | null {
  return capsuleByAsset[asset] ?? null;
}

function asObject(value: JsonValue): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object.");
  }
  return value;
}
