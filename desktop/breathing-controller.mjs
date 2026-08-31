import { EventEmitter } from "node:events";

const START_KEYS = new Set([
  "interval_seconds",
  "max_ticks",
  "max_output_tokens_per_tick",
  "max_total_output_tokens",
  "max_session_seconds",
]);

function exactObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!START_KEYS.has(key)) throw new TypeError(`${label} contains unknown key: ${key}.`);
  }
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new TypeError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return result;
}

export function validateBreathingLimits(value = {}) {
  exactObject(value, "breathing limits");
  const intervalSeconds = boundedInteger(
    value.interval_seconds,
    300,
    60,
    3_600,
    "interval_seconds",
  );
  const maxTicks = boundedInteger(value.max_ticks, 6, 1, 24, "max_ticks");
  const maxOutputTokensPerTick = boundedInteger(
    value.max_output_tokens_per_tick,
    512,
    64,
    4_096,
    "max_output_tokens_per_tick",
  );
  const limits = {
    interval_seconds: intervalSeconds,
    max_ticks: maxTicks,
    max_output_tokens_per_tick: maxOutputTokensPerTick,
    max_total_output_tokens: boundedInteger(
      value.max_total_output_tokens,
      Math.min(3_072, maxTicks * maxOutputTokensPerTick),
      64,
      32_768,
      "max_total_output_tokens",
    ),
    max_session_seconds: boundedInteger(
      value.max_session_seconds,
      3_600,
      60,
      86_400,
      "max_session_seconds",
    ),
  };
  if (
    limits.max_total_output_tokens
    > limits.max_ticks * limits.max_output_tokens_per_tick
  ) {
    throw new TypeError(
      "max_total_output_tokens cannot exceed the per-tick maximum times max_ticks.",
    );
  }
  return Object.freeze(limits);
}

export class BreathingController extends EventEmitter {
  constructor({
    store,
    tick,
    now = () => Date.now(),
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
  }) {
    super();
    if (!store || typeof tick !== "function") {
      throw new TypeError("Breathing requires a provider store and tick function.");
    }
    this.store = store;
    this.tick = tick;
    this.now = now;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.verifiedProfiles = new Set();
    this.timer = null;
    this.activeAbortController = null;
    this.generation = 0;
    this.current = this.emptyState();
  }

  emptyState() {
    return {
      state: "paused",
      mode: "direct",
      profile_id: null,
      started_at: null,
      deadline_at: null,
      next_tick_at: null,
      attempted_ticks: 0,
      successful_ticks: 0,
      reserved_output_tokens: 0,
      limits: null,
      last_tick_at: null,
      last_error_code: null,
      pause_reason: "opt-in-required",
    };
  }

  markVerified(profileId, result) {
    if (result?.ok && result?.model_available) this.verifiedProfiles.add(profileId);
    else this.verifiedProfiles.delete(profileId);
    this.emit("state");
  }

  invalidate(profileId = null) {
    if (profileId) this.verifiedProfiles.delete(profileId);
    else this.verifiedProfiles.clear();
    if (!profileId || this.current.profile_id === profileId) {
      this.pause("provider-configuration-changed");
    }
  }

  async eligibility() {
    let profile;
    try {
      profile = this.store.active();
    } catch {
      return {
        eligible: false,
        mode: "direct",
        profile_id: null,
        credential_status: "missing",
        verified: false,
        reason_codes: ["no-active-provider"],
      };
    }
    const credentialAvailable = (
      profile.auth_kind === "none"
      || await this.store.credentials.has(profile.id)
    );
    const verified = this.verifiedProfiles.has(profile.id);
    const reasons = [];
    if (!credentialAvailable) reasons.push("breath-key-unavailable");
    if (!verified) reasons.push("provider-not-verified");
    return {
      eligible: credentialAvailable && verified,
      mode: "direct",
      profile_id: profile.id,
      credential_status: (
        profile.auth_kind === "none"
          ? "not-required"
          : credentialAvailable ? "available" : "missing"
      ),
      verified,
      reason_codes: reasons,
    };
  }

  async status() {
    return {
      schema: "rappter-breath-status/1",
      opt_in_required: true,
      spend_is_bounded: true,
      eligibility: await this.eligibility(),
      breathing: { ...this.current },
    };
  }

  async start(value = {}) {
    if (this.current.state === "running") {
      throw new Error("Breathing is already running.");
    }
    const eligibility = await this.eligibility();
    if (!eligibility.eligible) {
      throw new Error(`Breathing is not eligible: ${eligibility.reason_codes.join(", ")}.`);
    }
    const limits = validateBreathingLimits(value);
    const startedAt = this.now();
    this.current = {
      ...this.emptyState(),
      state: "running",
      profile_id: eligibility.profile_id,
      started_at: new Date(startedAt).toISOString(),
      deadline_at: new Date(startedAt + limits.max_session_seconds * 1_000).toISOString(),
      limits,
      pause_reason: null,
    };
    this.generation += 1;
    this.schedule(0, this.generation);
    this.emit("state");
    return this.status();
  }

  pause(reason = "user-paused") {
    this.generation += 1;
    if (this.timer !== null) this.clearTimeoutImpl(this.timer);
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.timer = null;
    this.current = {
      ...this.current,
      state: "paused",
      next_tick_at: null,
      pause_reason: reason,
    };
    this.emit("state");
    return { ...this.current };
  }

  schedule(delaySeconds, generation) {
    const nextAt = this.now() + delaySeconds * 1_000;
    this.current.next_tick_at = new Date(nextAt).toISOString();
    this.timer = this.setTimeoutImpl(
      () => this.runTick(generation),
      delaySeconds * 1_000,
    );
  }

  exhausted(reason) {
    this.current = {
      ...this.current,
      state: "exhausted",
      next_tick_at: null,
      pause_reason: reason,
    };
    this.timer = null;
    this.emit("state");
  }

  async runTick(generation) {
    if (generation !== this.generation || this.current.state !== "running") return;
    this.timer = null;
    const deadline = Date.parse(this.current.deadline_at);
    const limits = this.current.limits;
    if (this.now() >= deadline) return this.exhausted("session-time-budget-exhausted");
    if (this.current.attempted_ticks >= limits.max_ticks) {
      return this.exhausted("tick-budget-exhausted");
    }
    if (
      this.current.reserved_output_tokens + limits.max_output_tokens_per_tick
      > limits.max_total_output_tokens
    ) {
      return this.exhausted("token-budget-exhausted");
    }
    this.current.attempted_ticks += 1;
    this.current.reserved_output_tokens += limits.max_output_tokens_per_tick;
    this.current.last_error_code = null;
    this.emit("state");
    const abortController = new AbortController();
    this.activeAbortController = abortController;
    try {
      const result = await this.tick({
        profileId: this.current.profile_id,
        maxOutputTokens: limits.max_output_tokens_per_tick,
        signal: abortController.signal,
      });
      if (generation !== this.generation || this.current.state !== "running") return;
      this.current.last_tick_at = new Date(this.now()).toISOString();
      if (result?.advanced) this.current.successful_ticks += 1;
      else this.current.last_error_code = "no-verified-successor";
    } catch {
      if (generation !== this.generation || this.current.state !== "running") return;
      this.verifiedProfiles.delete(this.current.profile_id);
      this.current = {
        ...this.current,
        state: "blocked",
        next_tick_at: null,
        last_error_code: "breath-key-or-provider-unavailable",
        pause_reason: "breathing-stopped",
      };
      this.emit("state");
      return;
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
    if (this.current.attempted_ticks >= limits.max_ticks) {
      return this.exhausted("tick-budget-exhausted");
    }
    if (
      this.current.reserved_output_tokens + limits.max_output_tokens_per_tick
      > limits.max_total_output_tokens
    ) {
      return this.exhausted("token-budget-exhausted");
    }
    if (this.now() + limits.interval_seconds * 1_000 >= deadline) {
      return this.exhausted("session-time-budget-exhausted");
    }
    this.schedule(limits.interval_seconds, generation);
    this.emit("state");
  }
}
