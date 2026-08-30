import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDirectProvider,
  createWildProvider,
  normalizeOpenAIEndpoint,
  testDirectProvider,
} from "@/providers/openai-compatible";
import {
  materializeDirectSuccessor,
  requestDirectSuccessorTick,
} from "@/providers/direct-tick";
import {
  DEFAULT_BREATHING_LIMITS,
  HELD_BREATHING_STATUS,
  nextBreathingHoldReason,
  validateBreathingLimits,
  wakeLeaseMs,
} from "@/providers/breathing";
import { demoHoloRaw, demoSourceRaw } from "@/generated/holo-fixtures";
import { validateHoloRaw, verifySourceFrame } from "@/lib/holo";
import { strictParse } from "@/lib/strict-json";
import type { JsonObject } from "@/lib/types";

describe("shared OpenAI-compatible provider interface", () => {
  it("uses the same chat completions contract for Direct and Wild", async () => {
    const requests: { url: string; authorization: string | undefined }[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        authorization: (init?.headers as Record<string, string>)?.Authorization,
      });
      return new Response(
        JSON.stringify({
          id: "completion",
          choices: [{ message: { role: "assistant", content: "ok" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const direct = createDirectProvider(
      {
        endpoint: "https://api.example.test/v1/",
        model: "direct-model",
        apiKey: "user-key",
      },
      fetchMock,
    );
    const wild = createWildProvider(
      {
        endpoint: "https://brainstem.example.test/v1",
        model: "managed-model",
        sessionToken: "session-token",
      },
      fetchMock,
    );
    await direct.complete({ model: direct.model, messages: [] });
    await wild.complete({ model: wild.model, messages: [] });
    assert.deepEqual(requests, [
      {
        url: "https://api.example.test/v1/chat/completions",
        authorization: "Bearer user-key",
      },
      {
        url: "https://brainstem.example.test/v1/chat/completions",
        authorization: "Bearer session-token",
      },
    ]);
  });

  it("requires BYOK for Direct and never invents a Wild shared credential", () => {
    assert.throws(
      () =>
        createDirectProvider({
          endpoint: "https://api.example.test/v1",
          model: "model",
          apiKey: "",
        }),
      /user's OpenAI-compatible API key/,
    );
    const wild = createWildProvider({
      endpoint: "https://brainstem.example.test/v1",
      model: "managed",
    });
    assert.equal(wild.mode, "wild");
  });

  it("refuses provider credentials embedded in endpoint URLs", () => {
    assert.throws(
      () => normalizeOpenAIEndpoint("https://token@example.test/v1"),
      /cannot contain credentials/,
    );
    assert.throws(
      () => normalizeOpenAIEndpoint("http://api.example.test/v1"),
      /require HTTPS/,
    );
    assert.throws(
      () => normalizeOpenAIEndpoint("http://192.168.1.4:11434/v1"),
      /HTTP is allowed only for unauthenticated loopback/,
    );
    assert.throws(
      () => normalizeOpenAIEndpoint("http://127.0.0.1:11434/v1"),
      /HTTP is allowed only for unauthenticated loopback/,
    );
    assert.equal(
      normalizeOpenAIEndpoint(
        "http://127.0.0.1:11434/v1",
        false,
      ),
      "http://127.0.0.1:11434/v1",
    );
  });

  it("tests a breath key without requesting a paid completion", async () => {
    const requests: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({ data: [{ id: "direct-model" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    await testDirectProvider(
      {
        endpoint: "https://api.example.test/v1",
        model: "direct-model",
        apiKey: "user-key",
      },
      fetchMock,
    );
    assert.deepEqual(requests, ["https://api.example.test/v1/models"]);
  });

  it("materializes and verifies a bounded local successor tick", () => {
    const current = validateHoloRaw(demoHoloRaw);
    const authored = strictParse(JSON.stringify(current.authored)) as JsonObject;
    authored.base_holo_id = current.id;
    const accessibility = authored.accessibility as JsonObject;
    accessibility.description = "The signal field advances by one verified tick.";
    const result = materializeDirectSuccessor({
      current,
      previousSourceFrame: strictParse(demoSourceRaw) as JsonObject,
      previousBodyFrame: strictParse(demoHoloRaw) as JsonObject,
      text: "One bounded local breath.",
      authored,
      wakeLeaseMs: 300_000,
      turnLatencyMs: 120,
      utc: "2026-08-30T03:30:00.000Z",
    });
    assert.equal(result.holo.visualParent, current.id);
    assert.equal(result.holo.holoSequence, current.holoSequence + 1);
    assert.equal(result.holo.sourceSequence, current.sourceSequence + 1);
    assert.equal(
      result.source.prev,
      (strictParse(demoSourceRaw) as JsonObject).payload_hash,
    );
    assert.equal(
      result.holo.outerFrame!.prev,
      (strictParse(demoHoloRaw) as JsonObject).payload_hash,
    );
    assert.notEqual(result.source.prev, current.sourceFrameHash);
    assert.notEqual(result.holo.outerFrame!.prev, current.id);
    assert.equal(verifySourceFrame(result.source, result.holo), result.source);
  });

  it("refuses unverified previous source and body continuity inputs", () => {
    const current = validateHoloRaw(demoHoloRaw);
    const authored = strictParse(JSON.stringify(current.authored)) as JsonObject;
    authored.base_holo_id = current.id;
    const accessibility = authored.accessibility as JsonObject;
    accessibility.description = "A continuity refusal test.";
    const wrongBody = strictParse(demoHoloRaw) as JsonObject;
    wrongBody.frame_hash = "0".repeat(64);
    assert.throws(
      () =>
        materializeDirectSuccessor({
          current,
          previousSourceFrame: strictParse(demoSourceRaw) as JsonObject,
          previousBodyFrame: wrongBody,
          text: "Refuse the invalid prior body.",
          authored,
          wakeLeaseMs: 300_000,
          turnLatencyMs: 120,
          utc: "2026-08-30T03:30:00.000Z",
        }),
      /frame_hash mismatch/,
    );
  });

  it("requests one bounded successor and rejects no-op output", async () => {
    const current = validateHoloRaw(demoHoloRaw);
    const authored = strictParse(JSON.stringify(current.authored)) as JsonObject;
    authored.base_holo_id = current.id;
    const accessibility = authored.accessibility as JsonObject;
    accessibility.description = "A verified bounded breath shifts the field.";
    const fetchMock: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.max_tokens, 512);
      return new Response(
        JSON.stringify({
          id: "direct-tick",
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  text: "One bounded local breath.",
                  authored,
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const result = await requestDirectSuccessorTick({
      settings: {
        endpoint: "https://api.example.test/v1",
        model: "direct-model",
        apiKey: "user-key",
      },
      current,
      previousSourceFrame: strictParse(demoSourceRaw) as JsonObject,
      previousBodyFrame: strictParse(demoHoloRaw) as JsonObject,
      maxContextBytes: 32_768,
      maxOutputTokens: 512,
      wakeLeaseMs: 600_000,
      fetchImpl: fetchMock,
      now: () => new Date("2026-08-30T03:30:00.000Z"),
    });
    assert.equal(result.holo.visualParent, current.id);

    const unchanged = strictParse(
      JSON.stringify(current.authored),
    ) as JsonObject;
    unchanged.base_holo_id = current.id;
    await assert.rejects(
      requestDirectSuccessorTick({
        settings: {
          endpoint: "https://api.example.test/v1",
          model: "direct-model",
          apiKey: "user-key",
        },
        current,
        previousSourceFrame: strictParse(demoSourceRaw) as JsonObject,
        previousBodyFrame: strictParse(demoHoloRaw) as JsonObject,
        maxContextBytes: 32_768,
        maxOutputTokens: 512,
        wakeLeaseMs: 600_000,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      text: "No mutation.",
                      authored: unchanged,
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
      }),
      /did not mutate/,
    );
  });

  it("requires finite local cadence, tick, token, and session budgets", () => {
    const limits = validateBreathingLimits({});
    assert.deepEqual(limits, DEFAULT_BREATHING_LIMITS);
    assert.equal(wakeLeaseMs(limits), 600_000);
    assert.throws(
      () => validateBreathingLimits({ maxTicks: Number.MAX_SAFE_INTEGER }),
      /Tick budget/,
    );
    assert.throws(
      () => validateBreathingLimits({ maxContextBytes: 1_000_000 }),
      /Context byte budget/,
    );
    assert.throws(
      () =>
        validateBreathingLimits({
          maxTicks: 2,
          maxOutputTokensPerTick: 128,
          maxTotalOutputTokens: 300,
        }),
      /cannot exceed/,
    );
    assert.equal(
      nextBreathingHoldReason(
        {
          ...HELD_BREATHING_STATUS,
          attemptedTicks: limits.maxTicks,
        },
        limits,
        0,
        1,
      ),
      "tick-budget-exhausted",
    );
  });
});
