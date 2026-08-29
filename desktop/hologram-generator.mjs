import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const HOLO_OUTPUT_SCHEMA = JSON.parse(readFileSync(
  new URL(
    "../holograms/protocol/rapp-holo-output.schema.json",
    import.meta.url,
  ),
  "utf8",
));

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_CONTEXT_BYTES = 512 * 1024;
const MAX_HOLO_BYTES = 256 * 1024;
const OUTPUT_SCHEMA_MARKER = /"schema"\s*:\s*"rapp-holo-output\/1"/g;
const FORBIDDEN_CONTENT = [
  /<\s*\/?\s*[a-z][^>]*>/i,
  /\bjavascript\s*:/i,
  /\bdata\s*:\s*text\/html/i,
  /\b(?:https?|file)\s*:\/\//i,
  /\beval\s*\(/i,
  /\bnew\s+Function\s*\(/i,
  /\brequire\s*\(/i,
  /\bimport\s*\(/i,
];

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} has unknown or missing members.`);
  }
}

function resolveReference(reference) {
  if (!reference.startsWith("#/")) {
    throw new Error(`Unsupported Holo schema reference: ${reference}`);
  }
  return reference
    .slice(2)
    .split("/")
    .reduce(
      (value, key) => value[key.replaceAll("~1", "/").replaceAll("~0", "~")],
      HOLO_OUTPUT_SCHEMA,
    );
}

function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
  if (type === "integer") {
    return Number.isSafeInteger(value) && !Object.is(value, -0);
  }
  return typeof value === type;
}

function assertSchema(value, schema, path = "Holo output") {
  if (schema.$ref) {
    assertSchema(value, resolveReference(schema.$ref), path);
    return;
  }
  if (schema.oneOf) {
    let matches = 0;
    for (const choice of schema.oneOf) {
      try {
        assertSchema(value, choice, path);
        matches += 1;
      } catch {
        // A oneOf branch that refuses is not a match.
      }
    }
    if (matches !== 1) {
      throw new Error(`${path} must match exactly one allowed Holo shape.`);
    }
  }
  if (schema.type && !typeMatches(value, schema.type)) {
    throw new Error(`${path} must be ${schema.type}.`);
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    throw new Error(`${path} must equal ${JSON.stringify(schema.const)}.`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    throw new Error(`${path} has an unsupported value.`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new Error(`${path} is shorter than the Holo limit.`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw new Error(`${path} exceeds the Holo limit.`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
      throw new Error(`${path} has an invalid format.`);
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw new Error(`${path} is below the Holo limit.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw new Error(`${path} exceeds the Holo limit.`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw new Error(`${path} has too few items.`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      throw new Error(`${path} has too many items.`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        assertSchema(item, schema.items, `${path}[${index}]`);
      });
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) {
        throw new Error(`${path}.${required} is required.`);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          throw new Error(`${path}.${key} is not part of Holo/1.`);
        }
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) {
        assertSchema(value[key], propertySchema, `${path}.${key}`);
      }
    }
  }
  for (const item of schema.allOf || []) {
    assertSchema(value, item, path);
  }
  if (schema.if) {
    let conditionMatches = true;
    try {
      assertSchema(value, schema.if, path);
    } catch {
      conditionMatches = false;
    }
    if (conditionMatches && schema.then) assertSchema(value, schema.then, path);
    if (!conditionMatches && schema.else) assertSchema(value, schema.else, path);
  }
}

function assertDataOnly(value, path = "Holo output") {
  if (typeof value === "string") {
    if (FORBIDDEN_CONTENT.some((pattern) => pattern.test(value))) {
      throw new Error(`${path} contains executable or remote content.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertDataOnly(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertDataOnly(item, `${path}.${key}`);
    }
  }
}

function assertJsonValue(value, depth = 1) {
  if (depth > 64) throw new Error("Holo output exceeds the JSON depth limit.");
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new Error("Holo output numbers must be interoperable integers.");
    }
    return;
  }
  if (typeof value === "string") {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next < 0xdc00 || next > 0xdfff) {
          throw new Error("Holo output contains an unpaired UTF-16 surrogate.");
        }
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw new Error("Holo output contains an unpaired UTF-16 surrogate.");
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertJsonValue(item, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      assertJsonValue(key, depth + 1);
      assertJsonValue(item, depth + 1);
    });
    return;
  }
  throw new Error(`Holo output contains non-JSON data: ${typeof value}.`);
}

export function canonicalJson(value) {
  assertJsonValue(value);
  function encode(item) {
    if (item === null || typeof item === "boolean" || typeof item === "number") {
      return JSON.stringify(item);
    }
    if (typeof item === "string") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(encode).join(",")}]`;
    return `{${Object.keys(item).sort().map(
      (key) => `${JSON.stringify(key)}:${encode(item[key])}`,
    ).join(",")}}`;
  }
  const canonical = encode(value);
  if (Buffer.byteLength(canonical) > MAX_HOLO_BYTES) {
    throw new Error("Holo output exceeds the canonical byte limit.");
  }
  return canonical;
}

export function canonicalHoloHash(value) {
  return createHash("sha256")
    .update("rapp-holo/1:authored\n", "ascii")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

export function validateHoloOutput(value) {
  assertJsonValue(value);
  assertSchema(value, HOLO_OUTPUT_SCHEMA);
  assertDataOnly(value);
  canonicalJson(value);
  return value;
}

function validateBaseHoloId(value, label = "base_holo_id") {
  if (value !== null && (typeof value !== "string" || !HEX64.test(value))) {
    throw new Error(`${label} must be null or 64 lowercase hexadecimal characters.`);
  }
  return value;
}

export function validateHoloTurnContext(value) {
  if (value === undefined || value === null) {
    return Object.freeze({
      enabled: false,
      base_holo_id: null,
      history: Object.freeze([]),
    });
  }
  exactKeys(
    value,
    new Set(["enabled", "base_holo_id", "history"]),
    "Holo channel context",
  );
  if (typeof value.enabled !== "boolean") {
    throw new Error("Holo channel enabled must be boolean.");
  }
  validateBaseHoloId(value.base_holo_id);
  if (!Array.isArray(value.history) || value.history.length > 32) {
    throw new Error("Holo history must be an array of at most 32 verified entries.");
  }
  value.history.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Holo history entry ${index} must be an object.`);
    }
  });
  if (Buffer.byteLength(canonicalJson(value)) > MAX_CONTEXT_BYTES) {
    throw new Error("Holo channel context exceeds its byte limit.");
  }
  return value;
}

export function originalTurnHoloContract(contextValue) {
  const context = validateHoloTurnContext(contextValue);
  if (!context.enabled) {
    return [
      "HOLO_OUTPUT_CHANNEL=disabled",
      "Do not emit a rapp-holo-output/1 object for this response.",
    ].join("\n");
  }
  return [
    "HOLO_OUTPUT_CHANNEL=enabled",
    "Hologram is a first-class output beside text and voice.",
    "During this original response, author exactly one complete rapp-holo-output/1 object.",
    "If the expression should visually hold, emit a new complete hold state against the current base.",
    "Call HologramForge once with that exact authored_holo_output.",
    "HologramForge validates only. It cannot design, adapt, repair, clamp, default, or polish.",
    "After acceptance, include that exact object once between RAPP_HOLO_OUTPUT_BEGIN and RAPP_HOLO_OUTPUT_END.",
    "Never request a later creative pass.",
    "Choose any visual form representable by the declared IR. The application supplies no visual form.",
    `CURRENT_BASE_HOLO_ID=${JSON.stringify(context.base_holo_id)}`,
    `VERIFIED_HOLO_HISTORY=${JSON.stringify(context.history)}`,
    `HOLO_OUTPUT_JSON_SCHEMA=${JSON.stringify(HOLO_OUTPUT_SCHEMA)}`,
  ].join("\n");
}

export function stageHoloOutput(authored, currentBaseHoloId) {
  validateBaseHoloId(currentBaseHoloId, "current base_holo_id");
  validateHoloOutput(authored);
  if (authored.base_holo_id !== currentBaseHoloId) {
    throw new Error("Holo output was authored against a stale base_holo_id.");
  }
  return {
    schema: "rapp-holo-stage/1",
    authored,
    base_holo_id: authored.base_holo_id,
    authored_hash: canonicalHoloHash(authored),
  };
}

function objectSlices(response) {
  const stack = [];
  const slices = [];
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < response.length; index += 1) {
    const char = response[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quoted = false;
      continue;
    }
    if (char === "\"") quoted = true;
    else if (char === "{") stack.push(index);
    else if (char === "}" && stack.length) {
      const start = stack.pop();
      slices.push(response.slice(start, index + 1));
    }
  }
  return slices;
}

export function extractHoloOutput(responseValue, contextValue) {
  const response = String(responseValue || "");
  const context = validateHoloTurnContext(contextValue);
  const beginMarker = "RAPP_HOLO_OUTPUT_BEGIN";
  const endMarker = "RAPP_HOLO_OUTPUT_END";
  const beginCount = response.split(beginMarker).length - 1;
  const endCount = response.split(endMarker).length - 1;
  if (
    beginCount !== endCount
    || beginCount > 1
    || (
      beginCount === 1
      && response.indexOf(beginMarker) > response.indexOf(endMarker)
    )
  ) {
    throw new Error("Malformed Holo output markers were refused.");
  }
  const markerCount = [...response.matchAll(OUTPUT_SCHEMA_MARKER)].length;
  const candidates = [];
  for (const slice of objectSlices(response)) {
    try {
      const parsed = JSON.parse(slice);
      if (parsed?.schema === "rapp-holo-output/1") candidates.push(parsed);
    } catch {
      // Schema-marker accounting below turns malformed authored JSON into refusal.
    }
  }
  if (markerCount !== candidates.length) {
    throw new Error("Malformed rapp-holo-output/1 JSON was refused.");
  }
  if (beginCount === 1 && candidates.length !== 1) {
    throw new Error("Marked Holo output must contain one rapp-holo-output/1 object.");
  }
  if (candidates.length > 1) {
    throw new Error("An assistant turn may contain at most one Holo/1 output.");
  }
  if (!context.enabled && candidates.length) {
    throw new Error("Holo output was emitted while the channel was disabled.");
  }
  if (!candidates.length) return null;
  return stageHoloOutput(candidates[0], context.base_holo_id);
}

export function stripMarkedHoloOutput(responseValue) {
  const response = String(responseValue || "");
  const beginMarker = "RAPP_HOLO_OUTPUT_BEGIN";
  const endMarker = "RAPP_HOLO_OUTPUT_END";
  const begin = response.indexOf(beginMarker);
  const end = response.indexOf(endMarker);
  if (begin < 0 || end < begin) return response;
  return (
    response.slice(0, begin)
    + response.slice(end + endMarker.length)
  ).trim();
}

export async function captureOriginalTurn({
  chat,
  input,
  holoContext,
}) {
  if (typeof chat !== "function") throw new Error("chat must be callable.");
  const result = await chat(input);
  if (!result || typeof result.response !== "string") {
    throw new Error("Brainstem response must contain text.");
  }
  let holo = null;
  let holoError = null;
  try {
    holo = extractHoloOutput(result.response, holoContext);
  } catch (error) {
    holoError = error.message;
  }
  return {
    ...result,
    response: stripMarkedHoloOutput(result.response),
    holo,
    holo_error: holoError,
  };
}

export function validateCommitRequest(value) {
  exactKeys(
    value,
    new Set(["subject_rappid", "session_id", "text", "holo"]),
    "Holo turn request",
  );
  if (
    typeof value.subject_rappid !== "string"
    || !/^rappid:@[^/:]+\/[^/:]+:[0-9a-f]{64}$/.test(value.subject_rappid)
  ) {
    throw new Error("Holo turn subject_rappid is invalid.");
  }
  if (
    typeof value.session_id !== "string"
    || !value.session_id
    || value.session_id.length > 256
  ) {
    throw new Error("Holo turn session_id must be bounded text.");
  }
  if (
    typeof value.text !== "string"
    || Buffer.byteLength(value.text) > MAX_HOLO_BYTES
  ) {
    throw new Error("Holo turn text exceeds its byte limit.");
  }
  if (value.holo !== null) validateHoloOutput(value.holo);
  return value;
}

function legacyRefusal() {
  throw new Error(
    "Legacy post-hoc hologram generation is refused. "
    + "Enable Holo/1 on the original Brainstem turn and stage its exact output.",
  );
}

export const validateGenerationRequest = legacyRefusal;
export const validateDesign = legacyRefusal;
export const parseBrainstemDesign = legacyRefusal;
export const generationPrompt = legacyRefusal;
