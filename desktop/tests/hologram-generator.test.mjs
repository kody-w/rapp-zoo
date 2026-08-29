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
  originalTurnHoloContract,
  parseBrainstemDesign,
  stageHoloOutput,
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
  assert.match(prompt, /exactly zero or one/);
  assert.match(prompt, new RegExp(`CURRENT_BASE_HOLO_ID="${base}"`));
  assert.match(prompt, /VERIFIED_HOLO_HISTORY=/);
  assert.doesNotMatch(prompt, /\b(?:humanoid|character|species)\b/i);
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
    "094b34e413cefe471c624b06572568e529b30f75645338f65931325a0e102207",
  );
});

test("staging adds no visual defaults and refuses malformed or unsafe output", () => {
  const missing = clone(blank);
  delete missing.accessibility;
  const before = clone(missing);
  assert.throws(() => stageHoloOutput(missing, null), /accessibility is required/);
  assert.deepEqual(missing, before);

  const executable = clone(blank);
  executable.accessibility.description = "Run javascript:alert(1)";
  assert.throws(
    () => stageHoloOutput(executable, null),
    /executable, remote, or shell content/,
  );

  const stale = clone(blank);
  stale.base_holo_id = base;
  assert.throws(
    () => stageHoloOutput(stale, "b".repeat(64)),
    /stale base_holo_id/,
  );
});

test("same-turn extraction accepts zero or one exact object", () => {
  assert.equal(extractHoloOutput("Text-only response.", enabled), null);
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
    "4a37cce65057ee3c8a2f4c133c28a08b2d26f8f7779143ac62c2beeeff5968b9",
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

test("turn commit validation preserves the exact backend request", () => {
  const request = {
    subject_rappid: `rappid:@kody-w/hologram-generator:${"c".repeat(64)}`,
    session_id: "session-1",
    text: "The original assistant response.",
    holo: blank,
  };
  assert.strictEqual(validateCommitRequest(request), request);
  assert.deepEqual(request.holo, blank);
  assert.throws(
    () => validateCommitRequest({ ...request, unexpected: true }),
    /unknown or missing members/,
  );
  const malformed = clone(request);
  delete malformed.holo.accessibility;
  assert.throws(() => validateCommitRequest(malformed), /accessibility is required/);
  assert.equal(canonicalHoloHash(blank), stageHoloOutput(blank, null).authored_hash);
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
  assert.match(
    main,
    /subject_rappid: holoSubjectRappid,[\s\S]*session_id: turn\.session_id,[\s\S]*text: turn\.response,[\s\S]*holo: turn\.holo\?\.authored \|\| null/,
  );
  assert.match(main, /"X-RAPP-Zoo-Desktop": zoo\.desktopToken/);
  assert.equal(main.match(/brainstem\.chat\(/g)?.length, 1);
  assert.doesNotMatch(
    main,
    /generationPrompt|parseBrainstemDesign|holograms\/match|holograms\/commit|randomize/,
  );
  assert.match(preload, /stageHologramOutput: invoke\("hologram:stage"\)/);
  assert.match(preload, /commitHologramOutput: invoke\("hologram:commit"\)/);
  assert.match(preload, /generateHologram: invoke\("hologram:generate"\)/);
});
