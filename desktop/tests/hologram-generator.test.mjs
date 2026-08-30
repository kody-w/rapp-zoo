import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalHoloHash,
  captureOriginalTurn,
  extractHoloOutput,
  generationPrompt,
  holoValidationOptions,
  originalTurnHoloContract,
  parseBrainstemDesign,
  stageHoloOutput,
  stripMarkedHoloOutput,
  validateCommitRequest,
  validateDesign,
  validateGenerationRequest,
  validateHoloOutput,
} from "../hologram-generator.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const blank = JSON.parse(readFileSync(
  path.resolve(
    here,
    "../../holograms/protocol/examples/minimal-blank-output.json",
  ),
  "utf8",
));
const corpus = JSON.parse(readFileSync(
  path.resolve(here, "../../holograms/protocol/fixtures/corpus.json"),
  "utf8",
));
const base = "a".repeat(64);
const enabled = {
  enabled: true,
  base_holo_id: null,
  history: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("the original-turn contract supplies head and history without a visual form", () => {
  const context = {
    enabled: true,
    base_holo_id: base,
    history: [{ holo_seq: 3, holo_id: base }],
  };
  const prompt = originalTurnHoloContract(context);
  assert.match(prompt, /first-class output beside text and voice/);
  assert.match(prompt, /exactly one complete rapp-holo-output\/1/);
  assert.match(prompt, /one AI-authored rapp-holo-growl\/1/);
  assert.match(prompt, /\{pitch,delta_onset,duration,velocity\}/);
  assert.match(prompt, /8-32 note prompt/);
  assert.match(prompt, /at most 512 notes/);
  assert.match(prompt, /retain the latest 384 notes/);
  assert.match(prompt, /Do not imitate or reproduce copyrighted Pokémon music/);
  assert.match(prompt, /Do not request a separate MIDI-generation pass/);
  assert.match(prompt, /SHAPEE is the smallest identity tile/);
  assert.match(prompt, /silhouette, motion, aura, habitat, and the entire full frame/);
  assert.match(prompt, /does not have to remain a tile/);
  assert.match(prompt, /not required to take humanoid form/);
  assert.match(prompt, /one immutable frame in the locally owned Rolling Core/);
  assert.match(prompt, /RAPP\/1 carries the frame/);
  assert.match(prompt, /Rapterbox storefront and optional cloud compute do not author or alter it/);
  assert.match(prompt, new RegExp(`CURRENT_BASE_HOLO_ID="${base}"`));
  assert.match(prompt, /VERIFIED_HOLO_HISTORY=/);
  assert.doesNotMatch(prompt, /\b(?:character|species)\b/i);
  assert.doesNotMatch(prompt, /\b(?:bottle|randomize|dimensional match)\b/i);
});

test("Holo/1 validation accepts arbitrary IR and preserves exact authored data", () => {
  const authored = clone(blank);
  authored.state.nodes.push({
    id: "signal-orb",
    parent: null,
    type: "primitive",
    visible: true,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1000, 1000, 1000],
    },
    geometry: {
      shape: "sphere",
      radius: 1000,
      detail: 2,
    },
    material: {
      color: "#123456",
      emissive: "#000000",
      emissive_strength: 0,
      opacity: 1000,
      presentation: "solid",
      blend: "normal",
      side: "front",
      metallic: 0,
      roughness: 1000,
    },
  });
  const before = JSON.stringify(authored);
  assert.strictEqual(validateHoloOutput(authored), authored);
  const stage = stageHoloOutput(authored, null);
  assert.strictEqual(stage.authored, authored);
  assert.equal(JSON.stringify(authored), before);
  assert.equal(
    stage.authored_hash,
    "91658ac9cfc527e6057ec37b0ba3f0325619f58e12df52e521e18e4bf691da84",
  );
});

test("staging adds no visual defaults and refuses malformed output", () => {
  const missing = clone(blank);
  delete missing.accessibility;
  const before = clone(missing);
  assert.throws(() => stageHoloOutput(missing, null), /missing=\["accessibility"\]/);
  assert.deepEqual(missing, before);

  const unknown = clone(blank);
  unknown.state.nodes.push({
    id: "unknown-shape",
    parent: null,
    type: "group",
    visible: true,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1000, 1000, 1000],
    },
    geometry: null,
    material: null,
    executable: "not part of Holo/1",
  });
  assert.throws(
    () => stageHoloOutput(unknown, null),
    /extra=\["executable"\]/,
  );

  const stale = clone(blank);
  stale.base_holo_id = base;
  assert.throws(
    () => stageHoloOutput(stale, "b".repeat(64)),
    /stale base_holo_id/,
  );
});

test("same-turn extraction requires one exact object when enabled", () => {
  assert.equal(extractHoloOutput("Text-only response.", {
    enabled: false,
    base_holo_id: null,
    history: [],
  }), null);
  assert.throws(
    () => extractHoloOutput("Text-only response.", enabled),
    /enabled Holo turn must contain exactly one/,
  );
  const response = [
    "Ordinary text.",
    "RAPP_HOLO_OUTPUT_BEGIN",
    JSON.stringify(blank),
    "RAPP_HOLO_OUTPUT_END",
  ].join("\n");
  const stage = extractHoloOutput(response, enabled);
  assert.deepEqual(stage.authored, blank);
  assert.equal(
    stage.authored_hash,
    "cd93fe4410bb59439333b3ab9dbb4376831ece2b3bb06c02447ca33e6ac8df0d",
  );
  assert.equal(stage.base_holo_id, null);
});

test("same-turn extraction refuses malformed and multiple Holo outputs", () => {
  assert.throws(
    () => extractHoloOutput(
      'RAPP_HOLO_OUTPUT_BEGIN\n{"schema":"rapp-holo-output/1",',
      enabled,
    ),
    /Malformed Holo output/,
  );
  assert.throws(
    () => extractHoloOutput(
      'RAPP_HOLO_OUTPUT_BEGIN\n{"schema":"wrong"}\nRAPP_HOLO_OUTPUT_END',
      enabled,
    ),
    /must contain one rapp-holo-output\/1 object/,
  );
  assert.throws(
    () => extractHoloOutput(
      `${JSON.stringify(blank)}\n${JSON.stringify(blank)}`,
      enabled,
    ),
    /at most one Holo\/1 output/,
  );
  assert.throws(
    () => extractHoloOutput(JSON.stringify(blank), {
      enabled: false,
      base_holo_id: null,
      history: [],
    }),
    /channel was disabled/,
  );
});

test("original-turn capture makes exactly one Brainstem chat call", async () => {
  let calls = 0;
  const result = await captureOriginalTurn({
    chat: async (input) => {
      calls += 1;
      assert.equal(input, "original-turn prompt");
      return {
        response: `answer\n${JSON.stringify(blank)}`,
        session_id: "session-1",
      };
    },
    input: "original-turn prompt",
    holoContext: enabled,
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.holo.authored, blank);
  assert.equal(result.session_id, "session-1");
});

test("marked Holo output is removed from visible text without changing the candidate", async () => {
  const marked = [
    "Visible answer.",
    "RAPP_HOLO_OUTPUT_BEGIN",
    JSON.stringify(blank),
    "RAPP_HOLO_OUTPUT_END",
  ].join("\n");
  assert.equal(stripMarkedHoloOutput(marked), "Visible answer.");
  const result = await captureOriginalTurn({
    chat: async () => ({ response: marked, session_id: "session-2" }),
    input: "original-turn prompt",
    holoContext: enabled,
  });
  assert.equal(result.response, "Visible answer.");
  assert.deepEqual(result.holo.authored, blank);
  assert.equal(result.holo_error, null);
});

test("invalid Holo output preserves the original text turn for source commit", async () => {
  const malformed = [
    "Visible answer survives.",
    "RAPP_HOLO_OUTPUT_BEGIN",
    '{"schema":"rapp-holo-output/1"}',
    "RAPP_HOLO_OUTPUT_END",
  ].join("\n");
  const result = await captureOriginalTurn({
    chat: async () => ({ response: malformed, session_id: "session-3" }),
    input: "original-turn prompt",
    holoContext: enabled,
  });
  assert.equal(result.response, "Visible answer survives.");
  assert.equal(result.holo, null);
  assert.match(result.holo_error, /must contain exact keys|missing|Holo/i);
});

test("turn commit validation preserves the exact backend request", () => {
  const request = {
    subject_rappid: `rappid:@kody-w/hologram-generator:${"c".repeat(64)}`,
    session_id: "session-1",
    text: "The original assistant response.",
    holo: blank,
    evidence: {
      channel_enabled: true,
      turn_latency_ms: 120,
      deadline_ms: 30_000,
      wake_lease_ms: 300_000,
    },
  };
  assert.strictEqual(validateCommitRequest(request), request);
  assert.deepEqual(request.holo, blank);
  assert.throws(
    () => validateCommitRequest({ ...request, unexpected: true }),
    /unknown or missing members/,
  );
  const malformed = clone(request);
  delete malformed.holo.accessibility;
  assert.throws(
    () => validateCommitRequest(malformed),
    /missing=\["accessibility"\]/,
  );
  const missingLease = clone(request);
  missingLease.evidence.wake_lease_ms = null;
  assert.throws(
    () => validateCommitRequest(missingLease),
    /require complete liveness evidence/,
  );
  const disabled = {
    ...clone(request),
    holo: null,
    evidence: {
      channel_enabled: false,
      turn_latency_ms: null,
      deadline_ms: null,
      wake_lease_ms: null,
    },
  };
  assert.strictEqual(validateCommitRequest(disabled), disabled);
  disabled.evidence.wake_lease_ms = 300_000;
  assert.throws(
    () => validateCommitRequest(disabled),
    /cannot claim liveness evidence/,
  );
  assert.equal(canonicalHoloHash(blank), stageHoloOutput(blank, null).authored_hash);
});

test("history-aware validation permits verified flipbook references", () => {
  const authored = clone(corpus.documents["historical-flipbook"]);
  const context = {
    enabled: true,
    base_holo_id: "b".repeat(64),
    history: [
      {
        holo_id: "a".repeat(64),
        authored: clone(corpus.documents["blank-valid-output"]),
      },
      {
        holo_id: "b".repeat(64),
        authored: clone(corpus.documents["multi-node-non-humanoid-scene"]),
      },
    ],
  };
  const stage = stageHoloOutput(
    authored,
    context.base_holo_id,
    holoValidationOptions(context),
  );
  assert.strictEqual(stage.authored, authored);
  const request = {
    subject_rappid: `rappid:@kody-w/hologram-generator:${"c".repeat(64)}`,
    session_id: "session-history",
    text: "Original response with history.",
    holo: authored,
    evidence: {
      channel_enabled: true,
      turn_latency_ms: 140,
      deadline_ms: 30_000,
      wake_lease_ms: 300_000,
    },
  };
  assert.strictEqual(
    validateCommitRequest(request, holoValidationOptions(context)),
    request,
  );
});

test("required authored growl prompt and continuation are preserved exactly", () => {
  const authored = clone(blank);
  const before = clone(authored.growl);
  const stage = stageHoloOutput(authored, null);
  assert.deepEqual(stage.authored.growl, before);
  assert.deepEqual(authored.growl, before);
  assert.equal(stage.authored.growl.prompt.length, 8);
  assert.ok(stage.authored.growl.continuation.length > 0);
  for (const event of [
    ...stage.authored.growl.prompt,
    ...stage.authored.growl.continuation,
  ]) {
    assert.deepEqual(
      Object.keys(event).sort(),
      ["delta_onset", "duration", "pitch", "velocity"],
    );
  }

  const missingGrowl = clone(blank);
  delete missingGrowl.growl;
  assert.throws(
    () => stageHoloOutput(missingGrowl, null),
    /missing=\["growl"\]/,
  );
  const invalidGrowl = clone(blank);
  invalidGrowl.growl.prompt = invalidGrowl.growl.prompt.slice(0, 7);
  assert.throws(
    () => stageHoloOutput(invalidGrowl, null),
    /length must be between 8 and 32/,
  );
});

test("desktop staging uses shared semantic validation and emoji boundaries", () => {
  const nonexistentParent = clone(blank);
  nonexistentParent.state.nodes.push({
    id: "orphan",
    parent: "missing",
    type: "group",
    visible: true,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1000, 1000, 1000],
    },
    geometry: null,
    material: null,
  });
  assert.throws(
    () => stageHoloOutput(nonexistentParent, null),
    /parent must exist earlier in authored order/,
  );

  const transitionMismatch = clone(blank);
  transitionMismatch.state.nodes.push({
    id: "arrival",
    parent: null,
    type: "group",
    visible: true,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1000, 1000, 1000],
    },
    geometry: null,
    material: null,
  });
  transitionMismatch.transition.nodes.push({
    id: "arrival",
    mode: "crossfade",
  });
  assert.throws(
    () => stageHoloOutput(transitionMismatch, null),
    /crossfade node must exist in both states/,
  );

  const emojiBoundary = clone(blank);
  emojiBoundary.accessibility.description = "🧭".repeat(1024);
  assert.strictEqual(validateHoloOutput(emojiBoundary), emojiBoundary);
  emojiBoundary.accessibility.description += "🧭";
  assert.throws(
    () => validateHoloOutput(emojiBoundary),
    /length must be between 1 and 1024/,
  );
});

test("legacy post-hoc generation exports are compatibility refusals", () => {
  for (const legacy of [
    validateGenerationRequest,
    validateDesign,
    parseBrainstemDesign,
    generationPrompt,
  ]) {
    assert.throws(
      () => legacy({ randomize: true }),
      /Legacy post-hoc hologram generation is refused/,
    );
  }
});

test("Electron exposes stage and commit while legacy generation cannot call a model", () => {
  const main = readFileSync(path.resolve(here, "../main.mjs"), "utf8");
  const preload = readFileSync(path.resolve(here, "../preload.cjs"), "utf8");
  assert.match(main, /ipcMain\.handle\("hologram:stage"/);
  assert.match(main, /ipcMain\.handle\("hologram:commit"/);
  assert.match(main, /ipcMain\.handle\("hologram:generate"[\s\S]*validateGenerationRequest/);
  assert.match(main, /zooJson\("\/api\/holo\/turn"/);
  assert.match(main, /Rolling Cores are the primary product and business focus/);
  assert.match(main, /signed local Rolling Core Capsule/);
  assert.match(main, /own and use it offline/);
  assert.match(main, /RAPP\/1 is substrate, Rapterbox is the storefront/);
  assert.match(main, /cloud compute is optional and separate/);
  assert.match(
    main,
    /subject_rappid: holoSubjectRappid,[\s\S]*session_id: turn\.session_id \|\| turn\.requestId,[\s\S]*text: turn\.response,[\s\S]*holo: turn\.holo\?\.authored \|\| null,[\s\S]*evidence:/,
  );
  assert.match(main, /RAPP_ZOO_HOLO_DEADLINE_MS/);
  assert.match(main, /RAPP_ZOO_HOLO_WAKE_LEASE_MS/);
  assert.match(main, /300_000/);
  assert.match(main, /channel_enabled: holoContext\.enabled/);
  assert.match(main, /turn_latency_ms: holoContext\.enabled \? turnLatencyMs : null/);
  assert.match(main, /deadline_ms: holoContext\.enabled \? holoDeadlineMs : null/);
  assert.match(main, /wake_lease_ms: holoContext\.enabled \? holoWakeLeaseMs : null/);
  assert.match(main, /authoritativeHoloContext/);
  assert.match(main, /"X-RAPP-Zoo-Desktop": zoo\.desktopToken/);
  assert.match(main, /body: JSON\.stringify\(request\)/);
  assert.equal(main.match(/brainstem\.chat\(/g)?.length, 1);
  assert.doesNotMatch(
    main,
    /generationPrompt|parseBrainstemDesign|holograms\/match|holograms\/commit|randomize/,
  );
  assert.match(preload, /stageHologramOutput: invoke\("hologram:stage"\)/);
  assert.match(preload, /commitHologramOutput: invoke\("hologram:commit"\)/);
  assert.match(preload, /generateHologram: invoke\("hologram:generate"\)/);
});

test("Brainstem soul centers local Rolling Core ownership", () => {
  const soul = readFileSync(
    path.resolve(here, "../../holograms/brainstem-soul.md"),
    "utf8",
  );
  assert.match(soul, /Rolling Cores are the whole business and primary focus/);
  assert.match(soul, /purchase it once through Rapterbox/);
  assert.match(soul, /signed local Rolling Core Capsule/);
  assert.match(soul, /own and use it offline/);
  assert.match(soul, /import, export, or re-upload it to the Holo viewer/);
  assert.match(soul, /grow it frame by frame/);
  assert.match(soul, /Cloud compute is optional\s+and separate/);
  assert.match(soul, /artifact signature is not model-output attestation/);
});

test("desktop adapter loads the shared validator instead of interpreting schema", () => {
  const source = readFileSync(
    path.resolve(here, "../hologram-generator.mjs"),
    "utf8",
  );
  assert.match(source, /\.\.\/static\/holo-protocol\.js/);
  assert.match(source, /HoloProtocol\.validateOutput\(value, options\)/);
  assert.match(source, /HoloProtocol\.authoredHash\(value\)/);
  assert.match(source, /HoloProtocol\.growlEvents\(accepted\.growl\)/);
  assert.doesNotMatch(source, /function assertSchema|function resolveReference/);
  assert.doesNotMatch(source, /completeGrowl|nibble|deltas|MIDI generator/);
});
