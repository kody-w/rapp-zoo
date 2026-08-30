import assert from "node:assert/strict";
import test from "node:test";

import {
  BreathingController,
  validateBreathingLimits,
} from "../breathing-controller.mjs";

function harness({ eligible = true, tick = async () => ({ advanced: true }) } = {}) {
  const scheduled = [];
  let now = Date.parse("2026-08-29T20:00:00Z");
  const store = {
    active: () => ({
      id: "direct",
      auth_kind: "bearer",
    }),
    credentials: {
      has: async () => eligible,
    },
  };
  const controller = new BreathingController({
    store,
    tick,
    now: () => now,
    setTimeoutImpl: (callback, delay) => {
      const handle = { callback, delay, cancelled: false };
      scheduled.push(handle);
      return handle;
    },
    clearTimeoutImpl: (handle) => { handle.cancelled = true; },
  });
  return {
    controller,
    scheduled,
    advance(milliseconds) { now += milliseconds; },
  };
}

test("breathing limits are finite and reject unlimited spend shapes", () => {
  assert.deepEqual(validateBreathingLimits({}), {
    interval_seconds: 300,
    max_ticks: 6,
    max_output_tokens_per_tick: 512,
    max_total_output_tokens: 3072,
    max_session_seconds: 3600,
  });
  assert.throws(() => validateBreathingLimits({ max_ticks: 0 }), /max_ticks/);
  assert.throws(() => validateBreathingLimits({
    max_ticks: 1,
    max_output_tokens_per_tick: 64,
    max_total_output_tokens: 65,
  }), /cannot exceed/);
  assert.throws(() => validateBreathingLimits({ unlimited: true }), /unknown key/);
});

test("direct breathing requires a verified breath key and explicit opt in", async () => {
  const { controller, scheduled } = harness();
  assert.equal((await controller.status()).breathing.state, "paused");
  await assert.rejects(controller.start(), /provider-not-verified/);
  controller.markVerified("direct", {
    ok: true,
    model_available: true,
  });
  const status = await controller.start({
    max_ticks: 2,
    max_output_tokens_per_tick: 64,
    max_total_output_tokens: 128,
  });
  assert.equal(status.breathing.state, "running");
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 0);
});

test("breathing reserves spend before calls and exhausts bounded budgets", async () => {
  const { controller, scheduled, advance } = harness();
  controller.markVerified("direct", { ok: true, model_available: true });
  await controller.start({
    interval_seconds: 60,
    max_ticks: 2,
    max_output_tokens_per_tick: 64,
    max_total_output_tokens: 128,
    max_session_seconds: 600,
  });
  await scheduled.shift().callback();
  assert.equal(controller.current.successful_ticks, 1);
  assert.equal(controller.current.reserved_output_tokens, 64);
  assert.equal(scheduled.length, 1);
  advance(60_000);
  await scheduled.shift().callback();
  assert.equal(controller.current.state, "exhausted");
  assert.equal(controller.current.successful_ticks, 2);
  assert.equal(controller.current.reserved_output_tokens, 128);
});

test("pause is explicit and provider failure stops breathing", async () => {
  const paused = harness();
  paused.controller.markVerified("direct", { ok: true, model_available: true });
  await paused.controller.start();
  paused.controller.pause();
  assert.equal(paused.controller.current.state, "paused");
  assert.equal(paused.controller.current.pause_reason, "user-paused");
  assert.equal(paused.scheduled[0].cancelled, true);

  const failed = harness({
    tick: async () => {
      throw new Error("secret provider detail");
    },
  });
  failed.controller.markVerified("direct", { ok: true, model_available: true });
  await failed.controller.start();
  await failed.scheduled.shift().callback();
  assert.equal(failed.controller.current.state, "blocked");
  assert.equal(
    failed.controller.current.last_error_code,
    "breath-key-or-provider-unavailable",
  );
  assert.doesNotMatch(JSON.stringify(await failed.controller.status()), /secret provider detail/);
});

test("pause aborts an in-flight provider call and schedules no successor", async () => {
  let observedSignal;
  const pending = harness({
    tick: async ({ signal }) => {
      observedSignal = signal;
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
    },
  });
  pending.controller.markVerified("direct", { ok: true, model_available: true });
  await pending.controller.start();
  const running = pending.scheduled.shift().callback();
  pending.controller.pause();
  await running;
  assert.equal(observedSignal.aborted, true);
  assert.equal(pending.controller.current.state, "paused");
  assert.equal(pending.scheduled.length, 0);
});
