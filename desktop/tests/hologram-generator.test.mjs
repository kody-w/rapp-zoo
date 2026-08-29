import assert from "node:assert/strict";
import test from "node:test";

import {
  generationPrompt,
  parseBrainstemDesign,
  validateGenerationRequest,
} from "../hologram-generator.mjs";

const frame = {
  spec: "rapp/1",
  kind: "body.pulse",
  stream_id: `rappid:@kody-w/test:${"a".repeat(64)}`,
  seq: 0,
  utc: "2026-08-28T20:00:00.000Z",
  payload: { query: "brief me", dimensions: ["briefing"] },
  payload_hash: "b".repeat(64),
  frame_hash: "c".repeat(64),
  prev: null,
  prev_wave: null,
  sig: null,
};

const design = {
  name: "Ghost Cartographer",
  kind: "character",
  accent: "violet",
  description: "A quiet mapper shaped by the current briefing frame.",
  scene: {
    title: "The map remembers",
    subtitle: "Fresh data slosh changes the route, not the bottle.",
  },
};

test("generation request is bounded to an exact frame", () => {
  assert.deepEqual(
    validateGenerationRequest({ frame, randomize: true }),
    { frame, randomize: true },
  );
  assert.throws(() => validateGenerationRequest({
    frame: { ...frame, extra: true },
    randomize: true,
  }));
});

test("Brainstem design parser accepts plain, fenced, and tool wrappers", () => {
  assert.deepEqual(parseBrainstemDesign(JSON.stringify(design)), design);
  assert.deepEqual(
    parseBrainstemDesign(`\`\`\`json\n${JSON.stringify(design)}\n\`\`\``),
    design,
  );
  assert.deepEqual(
    parseBrainstemDesign(JSON.stringify({ status: "ok", design })),
    design,
  );
});

test("design parser refuses executable content", () => {
  assert.throws(() => parseBrainstemDesign(JSON.stringify({
    ...design,
    description: "Load https://example.test/model.js",
  })));
});

test("generation prompt encodes bottle plus per-call data slosh", () => {
  const prompt = generationPrompt({
    frame,
    randomize: true,
    match: {
      mode: "dimensional",
      matched_dimensions: ["briefing"],
      hologram: { id: "holo-briefing" },
    },
  });
  assert.match(prompt, /cached static intelligence—the bottle/);
  assert.match(prompt, /fresh data_slosh/);
  assert.match(prompt, /HologramForge/);
});
