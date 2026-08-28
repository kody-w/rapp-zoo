import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CopilotBridge,
  boundedEnvironment,
  intelligencePrompt,
} from "../copilot-bridge.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(dirname, "fixtures", "fake-copilot.mjs");

function bridge(options = {}) {
  return new CopilotBridge({
    command: process.execPath,
    commandPrefix: [fixture],
    model: "gpt-5.6-sol",
    cwd: dirname,
    ...options,
  });
}

test("environment strips application secrets", () => {
  const env = boundedEnvironment({
    HOME: "/home/test",
    PATH: "/bin",
    GITHUB_TOKEN: "secret",
    RAPP_PRIVATE_KEY: "secret",
  });
  assert.deepEqual(env, { HOME: "/home/test", PATH: "/bin" });
});

test("prompt binds Copilot to a semantic read-only snapshot", () => {
  const prompt = intelligencePrompt("What next?", { health: { egg_count: 3 } });
  assert.match(prompt, /Do not invoke tools/);
  assert.match(prompt, /"egg_count":3/);
  assert.match(prompt, /USER_REQUEST=What next\?/);
});

test("bridge streams and returns Copilot CLI output", async () => {
  let invocation = null;
  const client = bridge({
    spawnImpl(command, args, options) {
      invocation = { command, args, options };
      return spawn(command, args, options);
    },
  });
  const chunks = [];
  client.on("chunk", ({ text }) => chunks.push(text));
  const status = await client.version();
  assert.equal(status.available, true);
  const result = await client.ask("hello", { health: { egg_count: 0 } });
  assert.equal(result.response, "first second");
  assert.equal(chunks.join(""), "first second");
  assert.equal(client.state().busy, false);
  assert.ok(invocation.args.includes("--available-tools="));
  assert.ok(invocation.args.includes("--no-experimental"));
});

test("bridge is single-flight and cancellation is bounded", async () => {
  const client = bridge();
  const first = client.ask("SLOW_REQUEST", { health: {} });
  await new Promise((resolve) => setTimeout(resolve, 25));
  await assert.rejects(() => client.ask("second", { health: {} }), /already answering/);
  assert.equal(client.cancel(), true);
  await assert.rejects(first, /exited|signal/);
});

test("bridge surfaces CLI failure and timeout", async () => {
  await assert.rejects(
    bridge().ask("FAIL_REQUEST", { health: {} }),
    /synthetic failure/,
  );
  await assert.rejects(
    bridge({ timeoutMs: 20 }).ask("SLOW_REQUEST", { health: {} }),
    /timed out/,
  );
});
