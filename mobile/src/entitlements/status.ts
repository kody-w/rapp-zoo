import type {
  EntitlementPresentation,
  ProductEntitlement,
} from "./types";

export function entitlementPresentation(
  entitlement: ProductEntitlement,
  options: { nowMs: number; online: boolean },
): EntitlementPresentation {
  assertEntitlementInvariant(entitlement);
  if (!entitlement.signatureVerified) {
    return {
      state: "unverified",
      label: "UNVERIFIED ENTITLEMENT",
      usable: entitlement.kind === "owned-rapter",
      transferable: false,
    };
  }
  if (entitlement.kind === "companion") {
    return {
      state: "companion",
      label: "FREE COMPANION · ACCOUNT-BOUND",
      usable: true,
      transferable: false,
    };
  }
  if (entitlement.kind === "owned-rapter") {
    return {
      state: "owned",
      label: "OWNED RAPTER · PERMANENT LOCAL CAPSULE",
      usable: true,
      transferable: true,
    };
  }
  if (entitlement.kind === "rented-premium-rapter") {
    if (options.nowMs >= Date.parse(entitlement.expiresUtc)) {
      return {
        state: "rented-expired",
        label: "RENTAL EXPIRED",
        usable: false,
        transferable: false,
      };
    }
    if (
      !options.online &&
      options.nowMs >= Date.parse(entitlement.freshUntilUtc)
    ) {
      return {
        state: "rented-stale-offline",
        label: "RENTAL STALE · SYNC REQUIRED",
        usable: false,
        transferable: false,
      };
    }
    return {
      state: "rented-active",
      label:
        entitlement.renewal === "renews"
          ? "RENTED PREMIUM RAPTER · RENEWS"
          : "RENTED PREMIUM RAPTER · CANCELS AT EXPIRY",
      usable: true,
      transferable: false,
    };
  }
  if (entitlement.status === "revoked") {
    return {
      state: "revoked",
      label: "SOVEREIGN APPLICATION · REVOKED",
      usable: false,
      transferable: false,
    };
  }
  if (
    entitlement.expiresUtc !== null &&
    options.nowMs >= Date.parse(entitlement.expiresUtc)
  ) {
    return {
      state: "sovereign-expired",
      label: "SOVEREIGN APPLICATION · EXPIRED",
      usable: false,
      transferable: false,
    };
  }
  return {
    state: "sovereign-active",
    label: "SOVEREIGN APPLICATION · ACTIVE",
    usable: true,
    transferable: false,
  };
}

export function assertEntitlementInvariant(
  entitlement: ProductEntitlement,
): void {
  if (entitlement.kind === "companion") {
    if (
      entitlement.accountCap !== 1 ||
      entitlement.transferable !== false ||
      entitlement.scarcePremiumSeries !== false
    ) {
      throw new Error(
        "Free Companion must be one-per-account, non-transferable, and outside scarce premium series.",
      );
    }
    return;
  }
  if (entitlement.kind === "rented-premium-rapter") {
    if (
      entitlement.exclusiveActiveLessee !== true ||
      Date.parse(entitlement.expiresUtc) <= Date.parse(entitlement.startedUtc) ||
      Date.parse(entitlement.freshUntilUtc) >
        Date.parse(entitlement.expiresUtc)
    ) {
      throw new Error(
        "Premium rental must have one active lessee and bounded freshness/expiry.",
      );
    }
    return;
  }
  if (entitlement.kind === "owned-rapter") {
    if (
      entitlement.ownership !== "permanent-local-capsule" ||
      entitlement.subscriptionRequired !== false ||
      entitlement.transferableBy !== "signed-registry-events"
    ) {
      throw new Error(
        "Owned Rapters must remain permanent local capsules independent of subscriptions.",
      );
    }
    return;
  }
  if (entitlement.confersOrganismOwnership !== false) {
    throw new Error(
      "A Sovereign application grant cannot silently confer Rapter ownership.",
    );
  }
}
