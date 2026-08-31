import { domainHash } from "@/lib/strict-json";
import type { JsonObject, JsonValue } from "@/lib/types";
import type {
  RapterCoinEconomics,
  RapterCoinPolicy,
  RapterCoinRecord,
} from "./types";

const HEX64 = /^[0-9a-f]{64}$/;
const COIN_ID = /^rcoin:[0-9a-f]{64}$/;
const LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RAPPID_PATTERN =
  /^rappid:@[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*:[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const RECORD_KEYS = [
  "schema",
  "coin_id",
  "organism_rappid",
  "publisher_rappid",
  "publisher_authorization_hash",
  "dogg_publication_hash",
  "core_frame_hash",
  "core_seq",
  "coin_seq",
  "source_frame_hash",
  "previous_coin_id",
  "rights_profile_id",
  "rights_profile_hash",
  "visibility",
  "economics",
  "created_utc",
] as const;

const ECONOMICS_KEYS = [
  "status",
  "cash_value",
  "purchasable",
  "redeemable",
  "transferable",
  "yield_bearing",
] as const;

export const RAPTER_COIN_POLICY: RapterCoinPolicy = Object.freeze({
  schema: "rapp-rapter-coin-policy/1",
  rollout: "dormant",
  projectionEnabled: false,
  publicDisplayEnabled: false,
  walletEnabled: false,
  marketEnabled: false,
  titleAuthority: "rapter-credit-registry",
  publicationAuthority: "authorized-keyed-publisher",
  eligibleVisibility: "public-dogg",
  privateDataIncluded: false,
  tipsMayReferenceCoin: true,
  tipsAffectCoinValue: false,
});

export function rapterCoinIdFor(
  organismRappid: string,
  coreFrameHash: string,
): string {
  if (!rappidValid(organismRappid)) {
    throw new Error("organismRappid is not a valid RAPPID.");
  }
  if (!HEX64.test(coreFrameHash)) {
    throw new Error("coreFrameHash must be 64 lowercase hexadecimal characters.");
  }
  return `rcoin:${domainHash("rapp/1:rapter-coin", {
    core_frame_hash: coreFrameHash,
    organism_rappid: organismRappid,
  })}`;
}

export function buildDormantRapterCoin(input: {
  organismRappid: string;
  publisherRappid: string;
  publisherAuthorizationHash: string;
  doggPublicationHash: string;
  coreFrameHash: string;
  coreSeq: number;
  sourceFrameHash: string;
  rightsProfileId: string;
  rightsProfileHash: string;
  createdUtc: string;
  previous?: RapterCoinRecord;
}): RapterCoinRecord {
  const record: RapterCoinRecord = {
    schema: "rapp-rapter-coin/1",
    coinId: rapterCoinIdFor(input.organismRappid, input.coreFrameHash),
    organismRappid: input.organismRappid,
    publisherRappid: input.publisherRappid,
    publisherAuthorizationHash: input.publisherAuthorizationHash,
    doggPublicationHash: input.doggPublicationHash,
    coreFrameHash: input.coreFrameHash,
    coreSeq: input.coreSeq,
    coinSeq: input.previous ? input.previous.coinSeq + 1 : 0,
    sourceFrameHash: input.sourceFrameHash,
    previousCoinId: input.previous?.coinId ?? null,
    rightsProfileId: input.rightsProfileId,
    rightsProfileHash: input.rightsProfileHash,
    visibility: "public-dogg",
    economics: dormantEconomics(),
    createdUtc: input.createdUtc,
  };
  assertRapterCoin(record, input.previous);
  return record;
}

export function assertRapterCoin(
  record: RapterCoinRecord,
  previous?: RapterCoinRecord,
): void {
  assertRapterCoinShape(record);
  if (record.coinSeq === 0) {
    if (previous) {
      throw new Error("Genesis Rapter Coin cannot have a predecessor.");
    }
    return;
  }
  if (!previous) {
    throw new Error("Non-genesis Rapter Coin requires its resolved predecessor.");
  }
  assertRapterCoinShape(previous);
  if (
    record.organismRappid !== previous.organismRappid ||
    record.coinSeq !== previous.coinSeq + 1 ||
    record.coreSeq <= previous.coreSeq ||
    record.previousCoinId !== previous.coinId ||
    record.createdUtc < previous.createdUtc
  ) {
    throw new Error("Rapter Coin Trail continuity is invalid.");
  }
}

function assertRapterCoinShape(record: RapterCoinRecord): void {
  if (
    record.schema !== "rapp-rapter-coin/1" ||
    !COIN_ID.test(record.coinId) ||
    !rappidValid(record.organismRappid) ||
    !rappidValid(record.publisherRappid) ||
    !HEX64.test(record.publisherAuthorizationHash) ||
    !HEX64.test(record.doggPublicationHash) ||
    !HEX64.test(record.coreFrameHash) ||
    !Number.isSafeInteger(record.coreSeq) ||
    record.coreSeq < 0 ||
    !Number.isSafeInteger(record.coinSeq) ||
    record.coinSeq < 0 ||
    !HEX64.test(record.sourceFrameHash) ||
    !LABEL.test(record.rightsProfileId) ||
    record.rightsProfileId.length > 100 ||
    !HEX64.test(record.rightsProfileHash) ||
    record.visibility !== "public-dogg" ||
    !utcValid(record.createdUtc)
  ) {
    throw new Error("Rapter Coin record is invalid.");
  }
  if (
    record.coinId !==
    rapterCoinIdFor(record.organismRappid, record.coreFrameHash)
  ) {
    throw new Error("Rapter Coin ID does not match its public frame.");
  }
  if (
    (record.coinSeq === 0 && record.previousCoinId !== null) ||
    (record.coinSeq > 0 &&
      (record.previousCoinId === null || !COIN_ID.test(record.previousCoinId)))
  ) {
    throw new Error("Rapter Coin predecessor is invalid.");
  }
  assertDormantEconomics(record.economics);
}

export function validateRapterCoinValue(
  value: JsonValue,
  previous?: RapterCoinRecord,
): RapterCoinRecord {
  const record = exactObject(value, RECORD_KEYS, "Rapter Coin record");
  const economics = exactObject(
    record.economics,
    ECONOMICS_KEYS,
    "Rapter Coin economics",
  );
  if (
    record.schema !== "rapp-rapter-coin/1" ||
    record.visibility !== "public-dogg" ||
    economics.status !== "dormant" ||
    economics.cash_value !== null ||
    economics.purchasable !== false ||
    economics.redeemable !== false ||
    economics.transferable !== false ||
    economics.yield_bearing !== false
  ) {
    throw new Error(
      "Rapter Coin records must remain public-DOGG provenance with dormant economics.",
    );
  }
  const parsed: RapterCoinRecord = {
    schema: "rapp-rapter-coin/1",
    coinId: string(record.coin_id),
    organismRappid: string(record.organism_rappid),
    publisherRappid: string(record.publisher_rappid),
    publisherAuthorizationHash: string(
      record.publisher_authorization_hash,
    ),
    doggPublicationHash: string(record.dogg_publication_hash),
    coreFrameHash: string(record.core_frame_hash),
    coreSeq: integer(record.core_seq),
    coinSeq: integer(record.coin_seq),
    sourceFrameHash: string(record.source_frame_hash),
    previousCoinId: nullableString(record.previous_coin_id),
    rightsProfileId: string(record.rights_profile_id),
    rightsProfileHash: string(record.rights_profile_hash),
    visibility: "public-dogg",
    economics: {
      status: "dormant",
      cashValue: null,
      purchasable: false,
      redeemable: false,
      transferable: false,
      yieldBearing: false,
    },
    createdUtc: string(record.created_utc),
  };
  assertRapterCoin(parsed, previous);
  return parsed;
}

export function rapterCoinWireValue(
  record: RapterCoinRecord,
  previous?: RapterCoinRecord,
): JsonObject {
  assertRapterCoin(record, previous);
  return {
    schema: record.schema,
    coin_id: record.coinId,
    organism_rappid: record.organismRappid,
    publisher_rappid: record.publisherRappid,
    publisher_authorization_hash: record.publisherAuthorizationHash,
    dogg_publication_hash: record.doggPublicationHash,
    core_frame_hash: record.coreFrameHash,
    core_seq: record.coreSeq,
    coin_seq: record.coinSeq,
    source_frame_hash: record.sourceFrameHash,
    previous_coin_id: record.previousCoinId,
    rights_profile_id: record.rightsProfileId,
    rights_profile_hash: record.rightsProfileHash,
    visibility: record.visibility,
    economics: {
      status: record.economics.status,
      cash_value: record.economics.cashValue,
      purchasable: record.economics.purchasable,
      redeemable: record.economics.redeemable,
      transferable: record.economics.transferable,
      yield_bearing: record.economics.yieldBearing,
    },
    created_utc: record.createdUtc,
  };
}

function dormantEconomics(): RapterCoinEconomics {
  return {
    status: "dormant",
    cashValue: null,
    purchasable: false,
    redeemable: false,
    transferable: false,
    yieldBearing: false,
  };
}

function assertDormantEconomics(economics: RapterCoinEconomics): void {
  if (
    economics.status !== "dormant" ||
    economics.cashValue !== null ||
    economics.purchasable !== false ||
    economics.redeemable !== false ||
    economics.transferable !== false ||
    economics.yieldBearing !== false
  ) {
    throw new Error("Rapter Coin economics are dormant and non-financial.");
  }
}

function exactObject(
  value: JsonValue | undefined,
  keys: readonly string[],
  label: string,
): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  ) {
    throw new Error(`${label} has missing or unknown members.`);
  }
  return value;
}

function string(value: JsonValue | undefined): string {
  if (typeof value !== "string") throw new Error("Value must be a string.");
  return value;
}

function nullableString(value: JsonValue | undefined): string | null {
  if (value === null) return null;
  return string(value);
}

function rappidValid(value: string): boolean {
  const match = RAPPID_PATTERN.exec(value);
  if (!match) return false;
  const identity = value.slice("rappid:@".length, -65);
  const separator = identity.indexOf("/");
  if (separator < 1) return false;
  const owner = identity.slice(0, separator);
  const slug = identity.slice(separator + 1);
  return owner.length <= 39 && slug.length <= 100;
}

function utcValid(value: string): boolean {
  if (!UTC.test(value) || value.startsWith("0000-")) return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function integer(value: JsonValue | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("Value must be a safe integer.");
  }
  return value;
}
