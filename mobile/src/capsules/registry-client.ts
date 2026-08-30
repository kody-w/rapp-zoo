import { canonicalize, domainHash } from "@/lib/strict-json";
import type { JsonObject, JsonValue } from "@/lib/types";
import type {
  RapterCreditRegistryRecord,
  ValidatedCapsule,
} from "./types";

type FetchLike = typeof fetch;
const CREDIT_KEYS = new Set([
  "schema",
  "issuer",
  "credit_id",
  "issuance_index",
  "issuance_cap",
  "issued_at",
  "payment_provider",
  "payment_rail",
  "payment_reference_hash",
  "owner_reference_hash",
  "purchase_utc",
  "product_id",
  "set_id",
  "tier",
  "btc_fraction",
  "price_sats",
  "birth_value_usd_micros",
  "valuation_schedule_id",
  "valuation_schedule_hash",
  "btc_quote",
  "conception_utc",
  "organism_rappid",
  "genesis_core_id",
  "core_manifest_hash",
  "bitcoin_outpoint",
  "status",
  "signature",
]);
const VERIFY_KEYS = new Set(["valid", "credit_id", "issuer"]);
const CREDIT_ID = /^rcredit:[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ES256_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

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
  const registryBase = creditRegistryBase(normalized);
  return {
    async fetchStatus(creditId, capsule) {
      const lookupUrl = new URL(`${registryBase}/lookup`);
      lookupUrl.searchParams.set("credit_id", creditId);
      const response = await fetchImpl(
        lookupUrl.toString(),
        { headers: { Accept: "application/json" } },
      );
      if (!response.ok) {
        throw new Error(
          `Rapterbox registry returned HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`,
        );
      }
      const value = validateAzureCredit(await response.json(), creditId, capsule);
      const verificationResponse = await fetchImpl(`${registryBase}/verify`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(value),
      });
      if (!verificationResponse.ok) {
        throw new Error(
          `Rapterbox registry verification returned HTTP ${verificationResponse.status}: ${(await verificationResponse.text()).slice(0, 240)}`,
        );
      }
      const verification = exactObject(
        await verificationResponse.json(),
        VERIFY_KEYS,
        "registry verification",
      );
      if (
        verification.valid !== true ||
        verification.credit_id !== creditId ||
        verification.issuer !== value.issuer
      ) {
        throw new Error("Rapterbox registry did not verify the signed credit.");
      }
      const raw = canonicalize(value);
      return {
        recordHash: domainHash("rappter-credit-registry-entry/1:record", value),
        raw,
        root: value,
        registryId: string(value.issuer, "credit.issuer"),
        registrySequence: integer(value.issuance_index, "credit.issuance_index"),
        creditId,
        organismRappid: string(value.organism_rappid, "credit.organism_rappid"),
        genesisCoreId: string(value.genesis_core_id, "credit.genesis_core_id"),
        capsuleId: capsule.capsuleId,
        status: "official",
        updatedUtc: string(value.issued_at, "credit.issued_at"),
        previousStatusHash: null,
        issuerKeyId: string(
          exactObject(
            value.signature,
            new Set(["algorithm", "key_id", "value"]),
            "credit.signature",
          ).key_id,
          "credit.signature.key_id",
        ),
        verifiedAt: new Date().toISOString(),
      };
    },
  };
}

function validateAzureCredit(
  value: unknown,
  creditId: string,
  capsule: ValidatedCapsule,
): JsonObject {
  const credit = exactObject(value, CREDIT_KEYS, "signed credit");
  if (credit.schema !== "rappter-credit-registry-entry/1") {
    throw new Error("Rapterbox registry credit schema is unsupported.");
  }
  if (!CREDIT_ID.test(creditId) || credit.credit_id !== creditId) {
    throw new Error("Rapterbox registry returned a different credit_id.");
  }
  if (credit.status !== "active") {
    throw new Error("Rapterbox registry credit status is not active.");
  }
  if (
    !capsule.credit ||
    capsule.credit.creditId !== creditId ||
    credit.organism_rappid !== capsule.credit.organismRappid ||
    credit.genesis_core_id !== capsule.credit.genesisCoreId
  ) {
    throw new Error("Rapterbox registry credit does not match the capsule binding.");
  }
  if (
    !HEX64.test(string(credit.genesis_core_id, "credit.genesis_core_id")) ||
    !HEX64.test(string(credit.core_manifest_hash, "credit.core_manifest_hash"))
  ) {
    throw new Error("Rapterbox registry credit hashes are invalid.");
  }
  const issuanceIndex = integer(credit.issuance_index, "credit.issuance_index");
  const issuanceCap = integer(credit.issuance_cap, "credit.issuance_cap");
  if (issuanceIndex < 1 || issuanceCap < issuanceIndex) {
    throw new Error("Rapterbox registry issuance bounds are invalid.");
  }
  const signature = exactObject(
    credit.signature,
    new Set(["algorithm", "key_id", "value"]),
    "credit.signature",
  );
  if (
    signature.algorithm !== "ES256" ||
    !string(signature.key_id, "credit.signature.key_id").startsWith("https://") ||
    !ES256_SIGNATURE.test(string(signature.value, "credit.signature.value"))
  ) {
    throw new Error("Rapterbox registry credit signature is invalid.");
  }
  return credit;
}

function exactObject(
  value: unknown,
  keys: Set<string>,
  path: string,
): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  const object = value as JsonObject;
  const actual = Object.keys(object);
  if (
    actual.length !== keys.size ||
    actual.some((key) => !keys.has(key))
  ) {
    throw new Error(`${path} has missing or unknown members.`);
  }
  return object;
}

function string(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function integer(value: JsonValue | undefined, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative safe integer.`);
  }
  return value as number;
}

function creditRegistryBase(endpoint: string): string {
  if (endpoint.endsWith("/v1/credit-registry")) return endpoint;
  if (endpoint.endsWith("/v1")) return `${endpoint}/credit-registry`;
  return `${endpoint}/v1/credit-registry`;
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
