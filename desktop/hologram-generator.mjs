const FRAME_KEYS = new Set([
  "spec",
  "kind",
  "stream_id",
  "seq",
  "utc",
  "payload",
  "payload_hash",
  "frame_hash",
  "prev",
  "prev_wave",
  "sig",
]);
const DESIGN_KEYS = new Set(["name", "kind", "accent", "description", "scene"]);
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_FRAME_BYTES = 64 * 1024;

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

function text(value, label, max) {
  if (
    typeof value !== "string"
    || !value.trim()
    || value.length > max
    || value !== value.normalize("NFC")
  ) {
    throw new Error(`${label} must be bounded NFC text.`);
  }
  return value;
}

export function validateGenerationRequest(value) {
  exactKeys(value, new Set(["frame", "randomize"]), "Generation request");
  if (typeof value.randomize !== "boolean") {
    throw new Error("randomize must be boolean.");
  }
  exactKeys(value.frame, FRAME_KEYS, "RAPP frame");
  if (
    value.frame.spec !== "rapp/1"
    || typeof value.frame.payload !== "object"
    || !value.frame.payload
    || Array.isArray(value.frame.payload)
    || !HEX64.test(value.frame.payload_hash)
    || !HEX64.test(value.frame.frame_hash)
  ) {
    throw new Error("RAPP frame shape is invalid.");
  }
  if (Buffer.byteLength(JSON.stringify(value.frame)) > MAX_FRAME_BYTES) {
    throw new Error("RAPP frame exceeds the hologram generation limit.");
  }
  return value;
}

export function validateDesign(value) {
  exactKeys(value, DESIGN_KEYS, "Hologram design");
  text(value.name, "name", 60);
  text(value.description, "description", 500);
  if (!["character", "data-projection"].includes(value.kind)) {
    throw new Error("kind must be character or data-projection.");
  }
  if (!["violet", "cyan", "ice"].includes(value.accent)) {
    throw new Error("accent must be violet, cyan, or ice.");
  }
  if (value.kind === "character") {
    exactKeys(value.scene, new Set(["title", "subtitle"]), "Character scene");
    text(value.scene.title, "scene.title", 120);
    text(value.scene.subtitle, "scene.subtitle", 240);
  } else {
    exactKeys(value.scene, new Set(["prompt", "options"]), "Projection scene");
    text(value.scene.prompt, "scene.prompt", 300);
    if (!Array.isArray(value.scene.options) || value.scene.options.length !== 3) {
      throw new Error("Projection scene must contain exactly three options.");
    }
    for (const option of value.scene.options) {
      exactKeys(option, new Set(["label", "value"]), "Projection option");
      text(option.label, "option.label", 100);
      text(option.value, "option.value", 240);
    }
  }
  const encoded = JSON.stringify(value).toLowerCase();
  if (
    ["<script", "javascript:", "http://", "https://", "shader", "eval(", "subprocess", "shell"]
      .some((token) => encoded.includes(token))
  ) {
    throw new Error("Hologram design contains executable, remote, or shell content.");
  }
  return value;
}

function jsonCandidates(response) {
  const candidates = [];
  const fence = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1]);
  candidates.push(response);
  for (let start = response.indexOf("{"); start >= 0; start = response.indexOf("{", start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < response.length; index += 1) {
      const char = response[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(response.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

export function parseBrainstemDesign(response) {
  for (const candidate of jsonCandidates(String(response || ""))) {
    try {
      const parsed = JSON.parse(candidate.trim());
      const design = parsed?.design || parsed;
      return validateDesign(design);
    } catch {
      // Continue to the next complete JSON candidate.
    }
  }
  throw new Error("Brainstem did not return an accepted hologram design object.");
}

export function generationPrompt({ frame, match, randomize }) {
  return [
    "Generate one polished hologram from this verified RAPP frame.",
    "Use the supplied dimensional DOGG match as cached static intelligence—the bottle.",
    "Treat the frame payload as fresh data_slosh poured through that bottle.",
    randomize
      ? "Create a genuinely surprising new variant; do not merely rename the match."
      : "Keep the design closely shaped by the matched bottle.",
    "Use HologramForge to validate your proposed design.",
    "Return only the accepted design JSON object with exactly:",
    '{"name":string,"kind":"character"|"data-projection","accent":"violet"|"cyan"|"ice","description":string,"scene":object}',
    "Character scene is exactly {title,subtitle}.",
    "Data projection scene is exactly {prompt,options} with exactly three {label,value} objects.",
    "No code, HTML, URLs, shaders, shell instructions, or file paths.",
    "",
    `DIMENSIONAL_MATCH=${JSON.stringify(match)}`,
    `SOURCE_FRAME=${JSON.stringify(frame)}`,
  ].join("\n");
}
