import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

import { ProviderCredentialResolver } from "../provider-credentials.mjs";
import { ProviderStore } from "../provider-store.mjs";

const testRoot = path.resolve(".test-state/provider-store");

function profile(id = "direct-local", authKind = "bearer") {
  return {
    id,
    base_url: "http://127.0.0.1:11434/v1",
    model: "local-model",
    auth_kind: authKind,
    headers: {},
    timeouts: { connect_ms: 1_000, request_ms: 5_000 },
  };
}

test("provider metadata is global-safe and credentials remain separate", async () => {
  rmSync(testRoot, { recursive: true, force: true });
  mkdirSync(testRoot, { recursive: true });
  const calls = [];
  const credentials = new ProviderCredentialResolver({
    platform: "darwin",
    env: {},
    execFileImpl: async (command, args) => {
      calls.push([command, args]);
      if (args[0] === "find-generic-password") return { stdout: "top-secret\n" };
      return { stdout: "" };
    },
  });
  const configPath = path.join(testRoot, "openai-providers.json");
  const store = new ProviderStore({ configPath, credentials });
  try {
    const result = await store.save({ profile: profile(), secret: "top-secret" });
    assert.equal(result.active_profile_id, "direct-local");
    assert.equal(result.profiles[0].credential_available, true);
    const metadata = readFileSync(configPath, "utf8");
    assert.doesNotMatch(metadata, /top-secret/);
    assert.equal(statSync(configPath).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(configPath)).mode & 0o777, 0o700);
    assert.equal(calls[0][0], "security");
    assert.deepEqual(calls[0][1].slice(0, 6), [
      "add-generic-password",
      "-U",
      "-s",
      "com.rapterbox.rollingcores.openai-compatible",
      "-a",
      "direct-local",
    ]);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

test("environment credentials support CI and non-macOS without persistence", async () => {
  const resolver = new ProviderCredentialResolver({
    platform: "linux",
    env: { RAPP_OPENAI_PROVIDER_SECRET_CI_PROFILE: "ci-secret" },
    execFileImpl: async () => assert.fail("security must not run"),
  });
  assert.equal(await resolver.get("ci-profile"), "ci-secret");
  await assert.rejects(resolver.set("ci-profile", "new-secret"), /does not support/);
});
