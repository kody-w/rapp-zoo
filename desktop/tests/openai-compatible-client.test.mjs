import assert from "node:assert/strict";
import test from "node:test";

import { OpenAICompatibleClient } from "../openai-compatible-client.mjs";

const profile = {
  id: "wild",
  base_url: "https://rolling.example.test",
  model: "gpt-5.4",
  auth_kind: "x-functions-key",
  headers: {},
  timeouts: { connect_ms: 1_000, request_ms: 5_000 },
};

function store() {
  return {
    credentials: { get: async () => "private-value" },
    get: () => profile,
    active: () => profile,
  };
}

test("provider test authenticates without exposing credentials", async () => {
  let request;
  const client = new OpenAICompatibleClient({
    store: store(),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ object: "list", data: [{ id: "gpt-5.4" }] }),
      };
    },
  });
  const result = await client.test({ id: "wild" });
  assert.equal(request.url, "https://rolling.example.test/v1/models");
  assert.equal(request.options.headers["x-functions-key"], "private-value");
  assert.equal(result.model_available, true);
  assert.doesNotMatch(JSON.stringify(result), /private-value/);
});

test("credentialed profiles cannot bypass HTTPS validation", async () => {
  let called = false;
  const insecureProfile = {
    ...profile,
    base_url: "http://127.0.0.1:11434/v1",
    auth_kind: "bearer",
  };
  const client = new OpenAICompatibleClient({
    store: {
      credentials: { get: async () => "private-value" },
      get: () => insecureProfile,
      active: () => insecureProfile,
    },
    fetchImpl: async () => {
      called = true;
      throw new Error("must not send");
    },
  });
  await assert.rejects(client.test({ id: "wild" }), /require HTTPS/);
  assert.equal(called, false);
});

test("active provider chat forces the configured model and bounded schema", async () => {
  let outbound;
  const client = new OpenAICompatibleClient({
    store: store(),
    fetchImpl: async (_url, options) => {
      outbound = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          id: "completion-1",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
        }),
      };
    },
  });
  const result = await client.chat(null, {
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 32,
  });
  assert.equal(outbound.model, "gpt-5.4");
  assert.equal(outbound.stream, false);
  assert.equal(result.choices[0].message.content, "ok");
  await assert.rejects(client.chat(null, {
    messages: [{ role: "user", content: "hello" }],
    upstream_url: "https://attacker.invalid",
  }), /unknown key/);
});
