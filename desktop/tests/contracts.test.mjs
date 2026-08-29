import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_SCHEMA,
  desktopState,
  validateContext,
  validatePrompt,
} from "../contracts.mjs";

test("prompt and context contracts are bounded", () => {
  assert.equal(validatePrompt("  hello  "), "hello");
  assert.throws(() => validatePrompt(""));
  assert.throws(() => validatePrompt("x".repeat(12_001)));
  assert.deepEqual(validateContext({ health: { egg_count: 1 } }), {
    health: { egg_count: 1 },
  });
  assert.throws(() => validateContext("not-an-object"));
});

test("desktop state declares the split desktop/mobile architecture", () => {
  const state = desktopState({
    zoo: { state: "ready" },
    brainstem: { state: "ready", tools: ["HologramForge"] },
  });
  assert.equal(state.schema, DESKTOP_SCHEMA);
  assert.equal(state.mobile.installable_pwa, true);
  assert.equal(state.mobile.intelligence_location, "app-owned-brainstem");
});
