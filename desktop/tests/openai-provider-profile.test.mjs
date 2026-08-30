import assert from "node:assert/strict";
import test from "node:test";

import {
  providerEndpoint,
  validateProviderMetadata,
  validateProviderProfile,
} from "../openai-provider-profile.mjs";

const valid = {
  id: "private-wild",
  base_url: "https://rolling.example.test/",
  model: "gpt-5.4",
  auth_kind: "x-functions-key",
  headers: { Accept: "application/json" },
  timeouts: { connect_ms: 2_000, request_ms: 30_000 },
};

test("provider profiles are strict, normalized, and provider-neutral", () => {
  const profile = validateProviderProfile(valid);
  assert.equal(profile.base_url, "https://rolling.example.test");
  assert.equal(profile.headers.accept, "application/json");
  assert.equal(
    providerEndpoint(profile, "chat/completions"),
    "https://rolling.example.test/v1/chat/completions",
  );
  assert.throws(() => validateProviderProfile({ ...valid, secret: "not-metadata" }), /unknown key/);
  assert.throws(() => validateProviderProfile({ ...valid, base_url: "file:///etc/passwd" }), /http/);
  assert.throws(() => validateProviderProfile({
    ...valid,
    base_url: "https://example.test/v1?api_key=not-allowed",
  }), /query parameters/);
  assert.throws(() => validateProviderProfile({
    ...valid,
    headers: { Authorization: "Bearer should-not-be-here" },
  }), /allowlisted/);
  assert.throws(() => validateProviderProfile({
    ...valid,
    headers: { Accept: "ok\r\nInjected: yes" },
  }), /invalid/);
  assert.throws(() => validateProviderProfile({
    ...valid,
    base_url: "http://127.0.0.1:11434/v1",
  }), /HTTP is allowed only for unauthenticated loopback/);
  assert.equal(
    validateProviderProfile({
      ...valid,
      base_url: "http://127.0.0.1:11434/v1",
      auth_kind: "none",
    }).base_url,
    "http://127.0.0.1:11434/v1",
  );
  assert.throws(() => validateProviderProfile({
    ...valid,
    base_url: "http://192.168.1.4:11434/v1",
    auth_kind: "none",
  }), /HTTP is allowed only for unauthenticated loopback/);
});

test("Azure deployment metadata produces a fixed deployment URL", () => {
  const profile = validateProviderProfile({
    ...valid,
    base_url: "https://rappter.cognitiveservices.azure.com/",
    auth_kind: "bearer",
    azure: {
      api_version: "2025-04-01-preview",
      deployment: "gpt-5.4",
    },
  });
  assert.equal(
    providerEndpoint(profile, "chat/completions"),
    "https://rappter.cognitiveservices.azure.com/openai/deployments/gpt-5.4/chat/completions?api-version=2025-04-01-preview",
  );
});

test("metadata exports cannot contain credentials or dangling active profiles", () => {
  assert.throws(() => validateProviderMetadata({
    version: 1,
    active_profile_id: "private-wild",
    profiles: [{ ...valid, api_key: "secret" }],
  }), /unknown key/);
  assert.throws(() => validateProviderMetadata({
    version: 1,
    active_profile_id: "missing",
    profiles: [valid],
  }), /existing profile/);
});
