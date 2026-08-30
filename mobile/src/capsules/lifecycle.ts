import { lifecycleFixturesRaw } from "@/generated/capsule-fixtures";
import { strictParse } from "@/lib/strict-json";
import type { JsonObject, JsonValue } from "@/lib/types";
import type {
  CapsuleLifecycleSnapshot,
  LifecycleUxState,
  MarketplaceLifecycleListing,
  RapterCreditRegistryRecord,
  ValidatedCapsule,
} from "./types";

export const RETURN_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;
const HEX64 = /^[0-9a-f]{64}$/;
const EVENT_ID = /^rce_[0-9a-f]{32}$/;

export type ReturnEligibility = {
  eligible: boolean;
  reason: string;
};

export type ReturnConfirmation = {
  refundConfirmed: boolean;
  eventVerified: boolean;
  eventId: string;
  updatedUtc: string;
};

export type LifecycleReturnClient = {
  verifyEligibility: (creditId: string) => Promise<ReturnEligibility>;
  confirmReturn: (
    creditId: string,
    operationId: string,
  ) => Promise<ReturnConfirmation>;
};

export function deriveLifecycleSnapshot(
  capsule: ValidatedCapsule,
  registry: RapterCreditRegistryRecord | null,
  mirrored: CapsuleLifecycleSnapshot | null,
  nowMs = Date.now(),
): CapsuleLifecycleSnapshot {
  if (mirrored) return mirrored;
  if (!capsule.credit || !registry || registry.status !== "official") {
    return snapshot({
      creditId: capsule.credit?.creditId ?? null,
      state: "unverified-copy",
      officialOwned: false,
      updatedUtc: new Date(nowMs).toISOString(),
    });
  }
  const returnWindowEndsMs =
    Date.parse(capsule.credit.issuedUtc) + RETURN_WINDOW_DAYS * DAY_MS;
  return snapshot({
    creditId: capsule.credit.creditId,
    state: nowMs <= returnWindowEndsMs ? "return-eligible" : "owned",
    returnWindowEndsUtc: new Date(returnWindowEndsMs).toISOString(),
    officialOwned: true,
    eventVerified: true,
    lastEventId: registry.recordHash,
    updatedUtc: registry.updatedUtc,
  });
}

export async function performVerifiedReturn({
  client,
  current,
  onPending,
  operationId,
}: {
  client: LifecycleReturnClient;
  current: CapsuleLifecycleSnapshot;
  onPending: (
    pending: CapsuleLifecycleSnapshot,
  ) => void | Promise<void>;
  operationId: string;
}): Promise<CapsuleLifecycleSnapshot> {
  if (!current.creditId || current.state !== "return-eligible") {
    throw new Error("This capsule is not eligible for a 30-day return.");
  }
  const eligibility = await client.verifyEligibility(current.creditId);
  if (!eligibility.eligible) throw new Error(eligibility.reason);
  await onPending(
    snapshot({
      ...current,
      state: "return-pending",
      updatedUtc: new Date().toISOString(),
    }),
  );
  const confirmation = await client.confirmReturn(
    current.creditId,
    operationId,
  );
  if (!confirmation.refundConfirmed || !confirmation.eventVerified) {
    throw new Error(
      "Return remains pending until the refund and signed registry event verify.",
    );
  }
  if (!EVENT_ID.test(confirmation.eventId)) {
    throw new Error("Confirmed return event ID is invalid.");
  }
  return snapshot({
    ...current,
    state: "returned",
    officialOwned: false,
    localCopyStatus: "unowned-verifiable-copy",
    activeListingId: null,
    lastEventId: confirmation.eventId,
    eventVerified: true,
    updatedUtc: confirmation.updatedUtc,
  });
}

export function markListed(
  current: CapsuleLifecycleSnapshot,
  listingId: string,
  askPriceSats: number,
  updatedUtc: string,
): CapsuleLifecycleSnapshot {
  if (current.state !== "owned" || !current.officialOwned) {
    throw new Error("Only an official owner outside the return window may list.");
  }
  requireEventId(listingId, "listing ID");
  requirePositiveSats(askPriceSats, "seller ask");
  return snapshot({
    ...current,
    state: "listed",
    currentSellerAskSats: askPriceSats,
    activeListingId: listingId,
    lastEventId: listingId,
    eventVerified: true,
    updatedUtc,
  });
}

export function cancelListing(
  current: CapsuleLifecycleSnapshot,
  eventId: string,
  updatedUtc: string,
): CapsuleLifecycleSnapshot {
  if (current.state !== "listed" || !current.activeListingId) {
    throw new Error("No active listing can be cancelled.");
  }
  requireEventId(eventId, "cancellation event ID");
  return snapshot({
    ...current,
    state: "owned",
    currentSellerAskSats: null,
    activeListingId: null,
    lastEventId: eventId,
    eventVerified: true,
    updatedUtc,
  });
}

export function markSold(
  current: CapsuleLifecycleSnapshot,
  eventId: string,
  salePriceSats: number,
  updatedUtc: string,
): CapsuleLifecycleSnapshot {
  if (current.state !== "listed") {
    throw new Error("Only a listed capsule may receive a sale event.");
  }
  requireEventId(eventId, "sale event ID");
  requirePositiveSats(salePriceSats, "sale price");
  return snapshot({
    ...current,
    state: "sold",
    officialOwned: false,
    localCopyStatus: "unowned-verifiable-copy",
    currentSellerAskSats: null,
    lastVerifiedSaleSats: salePriceSats,
    activeListingId: null,
    lastEventId: eventId,
    eventVerified: true,
    updatedUtc,
  });
}

export function lifecycleStateLabel(state: LifecycleUxState): string {
  return {
    owned: "OWNED · RETURN WINDOW CLOSED",
    "return-eligible": "OWNED · 30-DAY RETURN ELIGIBLE",
    "return-pending": "RETURN PENDING · STILL LOCALLY INTACT",
    returned: "RETURNED · UNOWNED VERIFIABLE COPY",
    listed: "OFFICIAL OWNER · LISTED",
    sold: "SOLD · UNOWNED VERIFIABLE COPY",
    "unverified-copy": "UNVERIFIED COPY / PREVIEW",
  }[state];
}

export function loadLifecycleFixtures(): {
  states: { creditId: string | null; state: LifecycleUxState }[];
  marketplace: MarketplaceLifecycleListing[];
} {
  const root = object(strictParse(lifecycleFixturesRaw), "lifecycle fixtures");
  if (
    root.schema !== "rolling-core-lifecycle-fixtures/1" ||
    !Array.isArray(root.states) ||
    !Array.isArray(root.marketplace)
  ) {
    throw new Error("Lifecycle fixtures are invalid.");
  }
  return {
    states: root.states.map((value) => {
      const item = object(value, "lifecycle state fixture");
      const state = lifecycleState(item.state);
      const creditId =
        item.credit_id === null
          ? null
          : requireHex64(item.credit_id, "fixture credit ID");
      return { creditId, state };
    }),
    marketplace: root.marketplace.map((value) => {
      const item = object(value, "marketplace fixture");
      if (
        item.state !== "listed" ||
        item.event_verification !== "preview-fixture"
      ) {
        throw new Error("Marketplace fixture status is invalid.");
      }
      return {
        organismId: string(item.organism_id, "marketplace organism ID"),
        displayName: string(item.display_name, "marketplace display name"),
        state: "listed",
        officialBirthPriceSats: positiveSats(
          item.official_birth_price_sats,
          "official birth price",
        ),
        currentSellerAskSats: positiveSats(
          item.current_seller_ask_sats,
          "seller ask",
        ),
        lastVerifiedSaleSats:
          item.last_verified_sale_sats === null
            ? null
            : positiveSats(
                item.last_verified_sale_sats,
                "last verified sale",
              ),
        eventVerification: "preview-fixture",
      };
    }),
  };
}

function snapshot(
  value: Partial<CapsuleLifecycleSnapshot> &
    Pick<
      CapsuleLifecycleSnapshot,
      "creditId" | "state" | "officialOwned" | "updatedUtc"
    >,
): CapsuleLifecycleSnapshot {
  return {
    creditId: value.creditId,
    state: value.state,
    returnWindowEndsUtc: value.returnWindowEndsUtc ?? null,
    officialOwned: value.officialOwned,
    localCopyStatus:
      value.localCopyStatus ??
      (value.officialOwned
        ? "official-owner-copy"
        : "unowned-verifiable-copy"),
    currentSellerAskSats: value.currentSellerAskSats ?? null,
    lastVerifiedSaleSats: value.lastVerifiedSaleSats ?? null,
    activeListingId: value.activeListingId ?? null,
    lastEventId: value.lastEventId ?? null,
    eventVerified: value.eventVerified ?? false,
    updatedUtc: value.updatedUtc,
  };
}

function lifecycleState(value: JsonValue | undefined): LifecycleUxState {
  if (
    typeof value !== "string" ||
    ![
      "owned",
      "return-eligible",
      "return-pending",
      "returned",
      "listed",
      "sold",
      "unverified-copy",
    ].includes(value)
  ) {
    throw new Error("Lifecycle state is invalid.");
  }
  return value as LifecycleUxState;
}

function object(value: JsonValue | undefined, path: string): JsonObject {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function string(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function requireHex64(value: JsonValue | undefined, path: string): string {
  const result = string(value, path);
  if (!HEX64.test(result)) throw new Error(`${path} must be 64 lowercase hex.`);
  return result;
}

function positiveSats(value: JsonValue | undefined, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new Error(`${path} must be positive integer sats.`);
  }
  return value;
}

function requirePositiveSats(value: number, path: string): void {
  positiveSats(value, path);
}

function requireEventId(value: string, path: string): void {
  if (!EVENT_ID.test(value)) {
    throw new Error(`${path} must use the signed lifecycle event ID format.`);
  }
}
