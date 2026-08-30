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
    const setCall = calls.find(([, args]) => args[0] === "add-generic-password");
    assert.equal(setCall[0], "security");
    assert.deepEqual(setCall[1].slice(0, 6), [
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

class MemoryCredentials {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  async has(id) {
    return this.values.has(id);
  }

  async get(id) {
    if (!this.values.has(id)) throw new Error(`No credential for ${id}.`);
    return this.values.get(id);
  }

  async set(id, secret) {
    this.values.set(id, secret);
  }

  async delete(id) {
    this.values.delete(id);
  }
}

class FailAfterWriteStore extends ProviderStore {
  failWrites = false;

  write(value) {
    const result = super.write(value);
    if (this.failWrites) throw new Error("injected metadata failure");
    return result;
  }
}

test("save rolls back credential and metadata when persistence fails", async () => {
  rmSync(testRoot, { recursive: true, force: true });
  mkdirSync(testRoot, { recursive: true });
  const credentials = new MemoryCredentials([["direct-local", "old-secret"]]);
  const configPath = path.join(testRoot, "openai-providers.json");
  const store = new FailAfterWriteStore({ configPath, credentials });
  try {
    await store.save({ profile: profile(), secret: "old-secret" });
    const before = readFileSync(configPath, "utf8");
    store.failWrites = true;
    await assert.rejects(
      store.save({
        profile: { ...profile(), model: "replacement-model" },
        secret: "new-secret",
      }),
      /injected metadata failure/,
    );
    assert.equal(await credentials.get("direct-local"), "old-secret");
    assert.equal(readFileSync(configPath, "utf8"), before);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

test("delete rolls back credential and metadata when persistence fails", async () => {
  rmSync(testRoot, { recursive: true, force: true });
  mkdirSync(testRoot, { recursive: true });
  const credentials = new MemoryCredentials([["direct-local", "old-secret"]]);
  const configPath = path.join(testRoot, "openai-providers.json");
  const store = new FailAfterWriteStore({ configPath, credentials });
  try {
    await store.save({ profile: profile(), secret: "old-secret" });
    const before = readFileSync(configPath, "utf8");
    store.failWrites = true;
    await assert.rejects(
      store.delete({ id: "direct-local" }),
      /injected metadata failure/,
    );
    assert.equal(await credentials.get("direct-local"), "old-secret");
    assert.equal(readFileSync(configPath, "utf8"), before);
  } finally {
    rmSync(testRoot, { recursive: true, force: true });
  }
});
