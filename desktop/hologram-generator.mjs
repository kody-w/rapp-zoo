import { readFileSync } from "node:fs";
import vm from "node:vm";

const HOLO_OUTPUT_SCHEMA = JSON.parse(readFileSync(
  new URL(
    "../holograms/protocol/rapp-holo-output.schema.json",
    import.meta.url,
  ),
  "utf8",
));
const protocolSource = readFileSync(
  new URL("../static/holo-protocol.js", import.meta.url),
  "utf8",
);
const protocolContext = {};
vm.createContext(protocolContext);
vm.runInContext(protocolSource, protocolContext, {
  filename: "static/holo-protocol.js",
});
const HoloProtocol = protocolContext.RappHoloProtocol;
if (
  !HoloProtocol
  || typeof HoloProtocol.validateOutput !== "function"
  || typeof HoloProtocol.authoredHash !== "function"
  || typeof HoloProtocol.growlEvents !== "function"
) {
  throw new Error("The shared Holo/1 validator did not expose its stable API.");
}

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_CONTEXT_BYTES = 512 * 1024;
const MAX_HOLO_BYTES = 256 * 1024;
const OUTPUT_SCHEMA_MARKER = /"schema"\s*:\s*"rapp-holo-output\/1"/g;

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

export function canonicalJson(value) {
  return HoloProtocol.canonical(value);
}

export function canonicalHoloHash(value) {
  return HoloProtocol.authoredHash(value);
}

export function validateHoloOutput(value, options = {}) {
  const accepted = HoloProtocol.validateOutput(value, options);
  HoloProtocol.growlEvents(accepted.growl);
  return accepted;
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

export function holoValidationOptions(contextValue) {
  const context = validateHoloTurnContext(contextValue);
  const ancestors = Object.create(null);
  let base = null;
  for (const entry of context.history) {
    const id = entry.holo_id || entry.frame_hash || entry.id;
    if (typeof id !== "string" || !HEX64.test(id)) continue;
    const authored = (
      entry.schema === "rapp-holo-output/1"
        ? entry
        : entry.authored || entry.payload?.authored
    );
    ancestors[id] = authored?.schema === "rapp-holo-output/1"
      ? authored
      : true;
    if (
      id === context.base_holo_id
      && authored?.schema === "rapp-holo-output/1"
    ) {
      base = authored;
    }
  }
  return {
    base,
    ancestorIds: ancestors,
  };
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
    "That object must contain one AI-authored rapp-holo-growl/1 and one complete visual state.",
    "The growl uses one-note events {pitch,delta_onset,duration,velocity}: you, or a configured local completion model participating in this same turn, must author an 8-32 note prompt and a completed original piano continuation before commit.",
    "The completion context is at most 512 notes; when longer context exists, retain the latest 384 notes.",
    "The growl must be an original piece about this organism. Do not imitate or reproduce copyrighted Pokémon music.",
    "SHAPEE is the smallest identity tile, not a required final form.",
    "You may autocomplete and grow the Holo through silhouette, motion, aura, habitat, and the entire full frame.",
    "The result does not have to remain a tile and is not required to take humanoid form.",
    "Treat this exact output as one immutable frame in the locally owned Rolling Core's continuing growth.",
    "RAPP/1 carries the frame; Rapterbox storefront and optional cloud compute do not author or alter it.",
    "Call HologramForge once with that exact authored_holo_output and, when applicable, base_holo_output and ancestor_holo_outputs copied from the supplied history.",
    "HologramForge and the shared Holo validator only accept or refuse the already-authored prompt, continuation, and visual state.",
    "Do not request a separate MIDI-generation pass or a second creative model call.",
    "After acceptance, include that exact object once between RAPP_HOLO_OUTPUT_BEGIN and RAPP_HOLO_OUTPUT_END.",
    "Never request a later creative pass.",
    "Choose any visual form representable by the declared IR. The application supplies no visual form.",
    `CURRENT_BASE_HOLO_ID=${JSON.stringify(context.base_holo_id)}`,
    `VERIFIED_HOLO_HISTORY=${JSON.stringify(context.history)}`,
    `HOLO_OUTPUT_JSON_SCHEMA=${JSON.stringify(HOLO_OUTPUT_SCHEMA)}`,
  ].join("\n");
}

export function stageHoloOutput(authored, currentBaseHoloId, options = {}) {
  validateBaseHoloId(currentBaseHoloId, "current base_holo_id");
  validateHoloOutput(authored, options);
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
  if (!candidates.length) {
    if (context.enabled) {
      throw new Error(
        "An enabled Holo turn must contain exactly one Holo/1 output.",
      );
    }
    return null;
  }
  return stageHoloOutput(
    candidates[0],
    context.base_holo_id,
    holoValidationOptions(context),
  );
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

export function validateCommitRequest(value, options = {}) {
  exactKeys(
    value,
    new Set(["subject_rappid", "session_id", "text", "holo", "evidence"]),
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
  if (value.holo !== null) validateHoloOutput(value.holo, options);
  exactKeys(
    value.evidence,
    new Set([
      "channel_enabled",
      "turn_latency_ms",
      "deadline_ms",
      "wake_lease_ms",
    ]),
    "Holo turn evidence",
  );
  if (typeof value.evidence.channel_enabled !== "boolean") {
    throw new Error("Holo turn evidence channel_enabled must be boolean.");
  }
  for (const key of ["turn_latency_ms", "deadline_ms", "wake_lease_ms"]) {
    const item = value.evidence[key];
    if (
      item !== null
      && (
        !Number.isSafeInteger(item)
        || item < 0
        || (key !== "turn_latency_ms" && item === 0)
      )
    ) {
      throw new Error(
        `Holo turn evidence ${key} must be null or a valid duration.`,
      );
    }
  }
  const timing = [
    value.evidence.turn_latency_ms,
    value.evidence.deadline_ms,
    value.evidence.wake_lease_ms,
  ];
  if (!value.evidence.channel_enabled && timing.some((item) => item !== null)) {
    throw new Error("Disabled Holo channels cannot claim liveness evidence.");
  }
  if (value.evidence.channel_enabled && timing.some((item) => item === null)) {
    throw new Error("Enabled Holo channels require complete liveness evidence.");
  }
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
