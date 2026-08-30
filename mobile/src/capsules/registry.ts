import nacl from "tweetnacl";
import { canonicalize, domainHash, strictParse } from "@/lib/strict-json";
import type { JsonObject, JsonValue } from "@/lib/types";
import type {
  RapterCreditRegistryRecord,
  RapterCreditRegistryStatus,
  ValidatedCapsule,
} from "./types";

const RECORD_KEYS = new Set([
  "record_hash",
  "schema",
  "registry_id",
  "registry_sequence",
  "credit_id",
  "organism_rappid",
  "genesis_core_id",
  "capsule_id",
  "status",
  "updated_utc",
  "previous_status_hash",
  "issuer",
  "signature",
]);
const UNSIGNED_KEYS = [
  "schema",
  "registry_id",
  "registry_sequence",
  "credit_id",
  "organism_rappid",
  "genesis_core_id",
  "capsule_id",
  "status",
  "updated_utc",
  "previous_status_hash",
  "issuer",
];
const TRUSTED_REGISTRY_ISSUERS: Record<string, string> = {
  "rapterbox-credit-registry-demo-2026-3":
    "wJ-BRlj2vbYdAGS8u88uQ_-jChsm6PNAo-b6K3Dnf1g",
};
const HEX64 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function validateRegistryRecordRaw(
  raw: string,
  capsule?: ValidatedCapsule,
): RapterCreditRegistryRecord {
  const root = asObject(strictParse(raw), "registry record");
  exactKeys(root, RECORD_KEYS);
  if (root.schema !== "rapp-rapter-credit-status/1") {
    throw new Error("Registry record schema is unsupported.");
  }
  const recordHash = hex64(root.record_hash, "record_hash");
  const creditId = hex64(root.credit_id, "credit_id");
  const genesisCoreId = hex64(root.genesis_core_id, "genesis_core_id");
  const capsuleId = hex64(root.capsule_id, "capsule_id");
  const status = string(root.status, "status") as RapterCreditRegistryStatus;
  if (!["official", "transferred", "revoked"].includes(status)) {
    throw new Error("Registry status is unsupported.");
  }
  const issuer = exactObject(root.issuer, [
    "algorithm",
    "key_id",
    "public_key",
  ]);
  if (issuer.algorithm !== "Ed25519") {
    throw new Error("Registry issuer must use Ed25519.");
  }
  const issuerKeyId = string(issuer.key_id, "issuer.key_id");
  const publicKey = string(issuer.public_key, "issuer.public_key");
  if (TRUSTED_REGISTRY_ISSUERS[issuerKeyId] !== publicKey) {
    throw new Error("Registry issuer is not trusted by this build.");
  }
  const unsigned: JsonObject = {};
  for (const key of UNSIGNED_KEYS) unsigned[key] = root[key]!;
  if (domainHash("rapp-rapter-credit/1:status", unsigned) !== recordHash) {
    throw new Error("Registry record_hash mismatch.");
  }
  const signed: JsonObject = { record_hash: recordHash, ...unsigned };
  const signature = decodeBase64Url(string(root.signature, "signature"));
  const key = decodeBase64Url(publicKey);
  if (
    signature.length !== 64 ||
    key.length !== 32 ||
    !nacl.sign.detached.verify(
      new TextEncoder().encode(canonicalize(signed)),
      signature,
      key,
    )
  ) {
    throw new Error("Registry signature verification failed.");
  }
  const organismRappid = string(root.organism_rappid, "organism_rappid");
  if (!UTC.test(string(root.updated_utc, "updated_utc"))) {
    throw new Error("Registry updated_utc is invalid.");
  }
  const previousStatusHash =
    root.previous_status_hash === null
      ? null
      : hex64(root.previous_status_hash, "previous_status_hash");
  if (capsule) {
    if (!capsule.credit) {
      throw new Error("Registry proof cannot attach to a capsule without credit.");
    }
    if (
      capsule.credit.creditId !== creditId ||
      capsule.credit.organismRappid !== organismRappid ||
      capsule.credit.genesisCoreId !== genesisCoreId ||
      capsule.capsuleId !== capsuleId
    ) {
      throw new Error("Registry record does not match capsule credit binding.");
    }
  }
  return {
    recordHash,
    raw,
    root,
    registryId: string(root.registry_id, "registry_id"),
    registrySequence: integer(root.registry_sequence, "registry_sequence"),
    creditId,
    organismRappid,
    genesisCoreId,
    capsuleId,
    status,
    updatedUtc: string(root.updated_utc, "updated_utc"),
    previousStatusHash,
    issuerKeyId,
    verifiedAt: new Date().toISOString(),
  };
}

export function ownershipStatusLabel(
  capsule: ValidatedCapsule,
  record: RapterCreditRegistryRecord | null,
): string {
  if (!capsule.credit) return "LOCAL CAPSULE · NO PURCHASED CREDIT";
  if (!record) return "UNVERIFIED COPY / PREVIEW";
  if (record.status === "official") {
    return `OFFICIAL · LAST VERIFIED ${record.verifiedAt}`;
  }
  return `LOCAL COPY · OFFICIAL STATUS ${record.status.toUpperCase()}`;
}

function exactObject(value: JsonValue | undefined, keys: string[]): JsonObject {
  const object = asObject(value, "object");
  exactKeys(object, new Set(keys));
  return object;
}

function exactKeys(value: JsonObject, keys: Set<string>): void {
  const actual = new Set(Object.keys(value));
  if (
    actual.size !== keys.size ||
    [...actual].some((key) => !keys.has(key))
  ) {
    throw new Error("Registry record has missing or unknown members.");
  }
}

function asObject(value: JsonValue | undefined, path: string): JsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value;
}

function string(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  return value;
}

function integer(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path} must be a non-negative safe integer.`);
  }
  return value;
}

function hex64(value: JsonValue | undefined, path: string): string {
  const result = string(value, path);
  if (!HEX64.test(result)) throw new Error(`${path} must be 64 lowercase hex.`);
  return result;
}

function decodeBase64Url(value: string): Uint8Array {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of value) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid registry base64url.");
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits >= 6 || (buffer !== 0 && bits > 0)) {
    throw new Error("Invalid registry base64url padding.");
  }
  return Uint8Array.from(bytes);
}
