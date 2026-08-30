import nacl from "tweetnacl";
import { canonicalize, domainHash, strictParse } from "@/lib/strict-json";
import type { JsonObject, JsonValue } from "@/lib/types";
import { validateHoloValue, verifySourceFrame } from "@/lib/holo";
import type {
  CapsuleLibraryEntry,
  BirthValuationProof,
  CapsuleOrganism,
  RapterCreditBinding,
  RapterCreditUniqueness,
  ValidatedCapsule,
} from "./types";

const CAPSULE_KEYS = new Set([
  "capsule_id",
  "schema",
  "issued_utc",
  "organism",
  "frames",
  "source_frames",
  "credit",
  "signer",
  "signature",
]);
const SIGNED_KEYS = new Set([
  "schema",
  "issued_utc",
  "organism",
  "frames",
  "source_frames",
  "credit",
  "signer",
]);
const TRUSTED_SIGNERS: Record<string, string> = {
  "rapterbox-capsule-demo-2026-6":
    "oRUSKRjVNTTEHmD_impFkdYcW_vNXuCmUcBgiL2SCRo",
};
const TRUSTED_CREDIT_ISSUERS: Record<string, string> = {
  "rapterbox-credit-registry-demo-2026-3":
    "wJ-BRlj2vbYdAGS8u88uQ_-jChsm6PNAo-b6K3Dnf1g",
};
const HEX64 = /^[0-9a-f]{64}$/;
const RAPPID =
  /^rappid:@[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*:[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class CapsuleValidationError extends Error {
  constructor(message: string) {
    super(`Rolling Core Capsule refused: ${message}`);
    this.name = "CapsuleValidationError";
  }
}

export function validateCapsuleRaw(raw: string): ValidatedCapsule {
  const root = asObject(strictParse(raw), "capsule");
  exactKeys(root, CAPSULE_KEYS, "capsule");
  require(root.schema === "rolling-core-capsule/1", "schema is unsupported");
  const capsuleId = string(root.capsule_id, "capsule.capsule_id");
  require(HEX64.test(capsuleId), "capsule_id must be 64 lowercase hex");
  require(UTC.test(string(root.issued_utc, "capsule.issued_utc")), "issued_utc is invalid");
  const organismValue = exactObject(
    root.organism,
    ["id", "rappid", "display_name", "description"],
    "capsule.organism",
  );
  const organism: CapsuleOrganism = {
    id: string(organismValue.id, "capsule.organism.id"),
    rappid: string(organismValue.rappid, "capsule.organism.rappid"),
    displayName: string(
      organismValue.display_name,
      "capsule.organism.display_name",
    ),
    description: string(
      organismValue.description,
      "capsule.organism.description",
    ),
  };
  require(RAPPID.test(organism.rappid), "organism.rappid is invalid");
  const signer = exactObject(
    root.signer,
    ["algorithm", "key_id", "public_key"],
    "capsule.signer",
  );
  require(signer.algorithm === "Ed25519", "signer algorithm must be Ed25519");
  const keyId = string(signer.key_id, "capsule.signer.key_id");
  const publicKey = string(signer.public_key, "capsule.signer.public_key");
  require(
    TRUSTED_SIGNERS[keyId] === publicKey,
    `signer ${keyId} is not trusted by this build`,
  );
  const signedPayload: JsonObject = {};
  for (const key of SIGNED_KEYS) signedPayload[key] = root[key]!;
  require(
    domainHash("rolling-core-capsule/1:id", signedPayload) === capsuleId,
    "capsule_id mismatch",
  );
  const signedWithId: JsonObject = { capsule_id: capsuleId, ...signedPayload };
  const signature = decodeBase64Url(string(root.signature, "capsule.signature"));
  const key = decodeBase64Url(publicKey);
  require(signature.length === 64, "signature must be 64 bytes");
  require(key.length === 32, "public key must be 32 bytes");
  require(
    nacl.sign.detached.verify(
      new TextEncoder().encode(canonicalize(signedWithId)),
      signature,
      key,
    ),
    "Ed25519 signature verification failed",
  );
  const sourceFrames = array(root.source_frames, "capsule.source_frames").map(
    (value) => asObject(value, "capsule.source_frame"),
  );
  const sourceByHash = new Map(
    sourceFrames.map((source) => {
      return [string(source.frame_hash, "source.frame_hash"), source] as const;
    }),
  );
  const frames = array(root.frames, "capsule.frames").map((value) => {
    const frame = validateHoloValue(value);
    require(
      frame.subjectRappid === organism.rappid,
      "frame subject differs from capsule organism",
    );
    const source = sourceByHash.get(frame.sourceFrameHash);
    require(source !== undefined, "bound source frame is missing");
    verifySourceFrame(source, frame);
    return frame;
  });
  require(frames.length > 0, "capsule must contain at least one Holo frame");
  const genesis = frames.find((frame) => frame.holoSequence === 0);
  require(genesis !== undefined, "capsule has no genesis Rolling Core frame");
  const credit =
    root.credit === null
      ? null
      : validateCredit(root.credit, organism.rappid, genesis.id);
  return {
    capsuleId,
    raw,
    root,
    organism,
    frames: frames.sort(
      (left, right) => right.holoSequence - left.holoSequence,
    ),
    sourceFrames,
    credit,
    trustedSigner: keyId,
  };
}

export function assertOneToOneCreditBindings(
  entries: CapsuleLibraryEntry[],
): void {
  const organismCredits = new Map<string, string>();
  const uniquenessCredits = new Map<string, string>();
  for (const entry of entries) {
    const credit = entry.capsule.credit;
    if (!credit) continue;
    const existing = organismCredits.get(credit.organismRappid);
    require(
      existing === undefined || existing === credit.creditId,
      `organism ${credit.organismRappid} has more than one Rapter Credit`,
    );
    organismCredits.set(credit.organismRappid, credit.creditId);
    const uniquenessKey =
      credit.uniqueness.kind === "bitcoin-utxo"
        ? `utxo:${credit.uniqueness.txid}:${credit.uniqueness.vout}`
        : `ledger:${credit.uniqueness.ledgerId}:${credit.uniqueness.sequence}`;
    const existingUnique = uniquenessCredits.get(uniquenessKey);
    require(
      existingUnique === undefined || existingUnique === credit.creditId,
      `global uniqueness proof ${uniquenessKey} is reused by another credit`,
    );
    uniquenessCredits.set(uniquenessKey, credit.creditId);
  }
}

function validateCredit(
  value: JsonValue | undefined,
  organismRappid: string,
  genesisCoreId: string,
): RapterCreditBinding {
  const record = exactObject(
    value,
    [
      "credit_id",
      "schema",
      "organism_rappid",
      "genesis_core_id",
      "price_sats",
      "mint_channel",
      "issued_utc",
      "valuation",
      "uniqueness",
      "issuer",
      "signature",
    ],
    "capsule.credit",
  );
  require(record.schema === "rapp-rapter-credit/1", "credit schema is unsupported");
  const creditId = string(record.credit_id, "credit.credit_id");
  require(HEX64.test(creditId), "credit_id must be 64 lowercase hex");
  require(
    record.organism_rappid === organismRappid,
    "credit organism_rappid does not match capsule organism",
  );
  require(
    record.genesis_core_id === genesisCoreId,
    "credit genesis_core_id does not match the stable genesis frame",
  );
  const priceSats = integer(
    record.price_sats,
    "credit.price_sats",
    0,
    2_100_000_000_000_000,
  );
  const mintChannel = string(record.mint_channel, "credit.mint_channel");
  require(
    mintChannel === "store_iap" || mintChannel === "rapterbox_btc",
    "credit mint_channel is unsupported",
  );
  const issuedUtc = string(record.issued_utc, "credit.issued_utc");
  require(UTC.test(issuedUtc), "credit issued_utc is invalid");
  const valuation = validateBirthValuation(record.valuation, priceSats);
  const uniqueness = validateCreditUniqueness(record.uniqueness);
  const issuer = exactObject(
    record.issuer,
    ["algorithm", "key_id", "public_key"],
    "credit.issuer",
  );
  require(issuer.algorithm === "Ed25519", "credit issuer must use Ed25519");
  const issuerKeyId = string(issuer.key_id, "credit.issuer.key_id");
  const publicKey = string(issuer.public_key, "credit.issuer.public_key");
  require(
    TRUSTED_CREDIT_ISSUERS[issuerKeyId] === publicKey,
    `credit issuer ${issuerKeyId} is not trusted by this build`,
  );
  const unsigned: JsonObject = {};
  for (const key of [
    "schema",
    "organism_rappid",
    "genesis_core_id",
    "price_sats",
    "mint_channel",
    "issued_utc",
    "valuation",
    "uniqueness",
    "issuer",
  ]) {
    unsigned[key] = record[key]!;
  }
  require(
    domainHash("rapp-rapter-credit/1:id", unsigned) === creditId,
    "credit_id mismatch",
  );
  const signed: JsonObject = { credit_id: creditId, ...unsigned };
  const creditSignature = decodeBase64Url(
    string(record.signature, "credit.signature"),
  );
  const creditPublicKey = decodeBase64Url(publicKey);
  require(creditSignature.length === 64, "credit signature must be 64 bytes");
  require(creditPublicKey.length === 32, "credit public key must be 32 bytes");
  require(
    nacl.sign.detached.verify(
      new TextEncoder().encode(canonicalize(signed)),
      creditSignature,
      creditPublicKey,
    ),
    "credit signature verification failed",
  );
  return {
    creditId,
    organismRappid,
    genesisCoreId,
    priceSats,
    mintChannel,
    issuedUtc,
    valuation,
    uniqueness,
    issuerKeyId,
  };
}

function validateBirthValuation(
  value: JsonValue | undefined,
  creditPriceSats: number,
): BirthValuationProof {
  const proof = exactObject(
    value,
    [
      "schema",
      "schedule_id",
      "schedule_version",
      "set_id",
      "tier",
      "price_sats",
      "btc_usd_cents_per_btc",
      "quote_utc",
      "quote_source",
      "fiat_currency",
      "birth_fiat_cents",
    ],
    "credit.valuation",
  );
  require(
    proof.schema === "rapp-rapter-birth-valuation/1",
    "valuation schema is unsupported",
  );
  const priceSats = integer(
    proof.price_sats,
    "valuation.price_sats",
    0,
    2_100_000_000_000_000,
  );
  require(
    priceSats === creditPriceSats,
    "valuation price_sats differs from credit birth record",
  );
  const btcUsdCentsPerBtc = integer(
    proof.btc_usd_cents_per_btc,
    "valuation.btc_usd_cents_per_btc",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const birthFiatCents = integer(
    proof.birth_fiat_cents,
    "valuation.birth_fiat_cents",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const expectedFiatCentsBigInt =
    (BigInt(priceSats) * BigInt(btcUsdCentsPerBtc) + 50_000_000n) /
    100_000_000n;
  require(
    expectedFiatCentsBigInt <= BigInt(Number.MAX_SAFE_INTEGER),
    "birth fiat reference exceeds safe integer range",
  );
  const expectedFiatCents = Number(expectedFiatCentsBigInt);
  require(
    birthFiatCents === expectedFiatCents,
    "birth fiat reference does not match fixed sats and conception quote",
  );
  const quoteUtc = string(proof.quote_utc, "valuation.quote_utc");
  require(UTC.test(quoteUtc), "valuation quote_utc is invalid");
  require(proof.fiat_currency === "USD", "valuation fiat currency must be USD");
  return {
    schema: "rapp-rapter-birth-valuation/1",
    scheduleId: boundedText(proof.schedule_id, "valuation.schedule_id"),
    scheduleVersion: integer(
      proof.schedule_version,
      "valuation.schedule_version",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    setId: boundedText(proof.set_id, "valuation.set_id"),
    tier: boundedText(proof.tier, "valuation.tier"),
    priceSats,
    btcUsdCentsPerBtc,
    quoteUtc,
    quoteSource: boundedText(proof.quote_source, "valuation.quote_source"),
    fiatCurrency: "USD",
    birthFiatCents,
  };
}

function validateCreditUniqueness(
  value: JsonValue | undefined,
): RapterCreditUniqueness {
  const proof = asObject(value, "credit.uniqueness");
  if (proof.kind === "signed-ledger") {
    exactKeys(
      proof,
      new Set(["kind", "ledger_id", "sequence", "previous_credit_id"]),
      "credit.uniqueness",
    );
    const previous =
      proof.previous_credit_id === null
        ? null
        : string(proof.previous_credit_id, "credit.uniqueness.previous_credit_id");
    if (previous !== null) {
      require(HEX64.test(previous), "previous_credit_id must be 64 lowercase hex");
    }
    return {
      kind: "signed-ledger",
      ledgerId: string(proof.ledger_id, "credit.uniqueness.ledger_id"),
      sequence: integer(
        proof.sequence,
        "credit.uniqueness.sequence",
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      previousCreditId: previous,
    };
  }
  if (proof.kind === "bitcoin-utxo") {
    exactKeys(
      proof,
      new Set(["kind", "txid", "vout"]),
      "credit.uniqueness",
    );
    const txid = string(proof.txid, "credit.uniqueness.txid");
    require(HEX64.test(txid), "credit UTXO txid must be 64 lowercase hex");
    return {
      kind: "bitcoin-utxo",
      txid,
      vout: integer(
        proof.vout,
        "credit.uniqueness.vout",
        0,
        4_294_967_295,
      ),
    };
  }
  throw new CapsuleValidationError("credit uniqueness proof is unsupported");
}

function decodeBase64Url(value: string): Uint8Array {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let buffer = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const character of value) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new CapsuleValidationError("invalid base64url value");
    buffer = (buffer << 6) | index;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >> bitCount) & 0xff);
      buffer &= (1 << bitCount) - 1;
    }
  }
  if (bitCount >= 6 || (buffer !== 0 && bitCount > 0)) {
    throw new CapsuleValidationError("invalid base64url padding");
  }
  return Uint8Array.from(bytes);
}

function exactObject(
  value: JsonValue | undefined,
  keys: string[],
  path: string,
): JsonObject {
  const object = asObject(value, path);
  exactKeys(object, new Set(keys), path);
  return object;
}

function exactKeys(value: JsonObject, keys: Set<string>, path: string): void {
  const actual = new Set(Object.keys(value));
  if (
    actual.size !== keys.size ||
    [...actual].some((key) => !keys.has(key))
  ) {
    throw new CapsuleValidationError(`${path} has missing or unknown members`);
  }
}

function asObject(value: JsonValue | undefined, path: string): JsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new CapsuleValidationError(`${path} must be an object`);
  }
  return value;
}

function array(value: JsonValue | undefined, path: string): JsonValue[] {
  if (!Array.isArray(value)) {
    throw new CapsuleValidationError(`${path} must be an array`);
  }
  return value;
}

function string(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string") {
    throw new CapsuleValidationError(`${path} must be a string`);
  }
  return value;
}

function boundedText(value: JsonValue | undefined, path: string): string {
  const result = string(value, path);
  if (result.length < 1 || result.length > 128) {
    throw new CapsuleValidationError(`${path} must contain 1-128 characters`);
  }
  return result;
}

function integer(
  value: JsonValue | undefined,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new CapsuleValidationError(
      `${path} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  return value;
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CapsuleValidationError(message);
}
