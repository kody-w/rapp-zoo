import type {
  LedgerSnapshot,
  BillingProductKind,
  AccessFeatures,
} from "./types";

export const CONSUMABLE_PRODUCTS = {
  hatchOne: "rapter_hatch_1",
  flockThree: "rappter_flock_3",
  flockTen: "rappter_flock_10",
  computeSmall: "rolling_compute_small",
  computeLarge: "rolling_compute_large",
} as const;

export const directPlan = {
  title: "Holo Zoo Direct",
  summary:
    "One local Rapter, BYOK OpenAI-compatible provider, and unrestricted ownership of local Rolling Core data.",
} as const;

export const wildPlanSummary =
  "One-time Wild Rapter hatches plus optional managed-compute/Growl credit packs. No repeating charge.";

export function productKind(
  identifier: string,
): BillingProductKind | null {
  if (
    identifier === CONSUMABLE_PRODUCTS.hatchOne ||
    identifier === CONSUMABLE_PRODUCTS.flockThree ||
    identifier === CONSUMABLE_PRODUCTS.flockTen
  ) {
    return "rapter_credit";
  }
  if (
    identifier === CONSUMABLE_PRODUCTS.computeSmall ||
    identifier === CONSUMABLE_PRODUCTS.computeLarge
  ) {
    return "compute_credit";
  }
  return null;
}

export function rapterCreditsForProduct(identifier: string): number {
  if (identifier === CONSUMABLE_PRODUCTS.hatchOne) return 1;
  if (identifier === CONSUMABLE_PRODUCTS.flockThree) return 3;
  if (identifier === CONSUMABLE_PRODUCTS.flockTen) return 10;
  return 0;
}

export function featuresForLedger(
  ledger: Pick<
    LedgerSnapshot,
    "activeWildRapters" | "smallComputePacks" | "largeComputePacks"
  >,
): AccessFeatures {
  const wild =
    ledger.activeWildRapters > 0 ||
    ledger.smallComputePacks > 0 ||
    ledger.largeComputePacks > 0;
  return {
    accessMode: wild ? "wild" : "direct",
    localRapterSlots: 1,
    activeWildRapters: ledger.activeWildRapters,
    remoteAccess: wild,
    hostedBrainstem: wild,
    managedProviderRouting: wild,
    quotaAndRevocation: wild,
    managedAutocomplete: wild,
    wildHistoryDepth:
      ledger.largeComputePacks > 0
        ? 256
        : ledger.smallComputePacks > 0 || ledger.activeWildRapters > 0
          ? 64
          : 0,
    wildGrowlMaxNotes:
      ledger.largeComputePacks > 0
        ? 512
        : ledger.smallComputePacks > 0 || ledger.activeWildRapters > 0
          ? 128
          : 0,
    wildGrowlExport: wild,
    fantasyDrafts: ledger.largeComputePacks > 0,
    rappterRooms: ledger.largeComputePacks > 0,
    localPlayback: true,
    localHistory: true,
    localImport: true,
    protocolValidation: true,
    ownedLocalDataAccess: true,
    ownedLocalDataExport: true,
  };
}

export function consumableTitle(identifier: string): string {
  if (identifier === CONSUMABLE_PRODUCTS.hatchOne) {
    return "Hatch 1 Wild Rapter";
  }
  if (identifier === CONSUMABLE_PRODUCTS.flockThree) {
    return "Rappter Flock Pack · 3 Rapter credits";
  }
  if (identifier === CONSUMABLE_PRODUCTS.flockTen) {
    return "Rappter Flock Pack · 10 Rapter credits";
  }
  if (identifier === CONSUMABLE_PRODUCTS.computeSmall) {
    return "Rolling Compute · Small";
  }
  if (identifier === CONSUMABLE_PRODUCTS.computeLarge) {
    return "Rolling Compute · Large";
  }
  return identifier;
}
