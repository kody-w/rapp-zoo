import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  DirectBreathingLimits,
  DirectBreathingStatus,
} from "./types";

const LIMITS_KEY = "@holo-zoo/direct-breathing-limits";

export const DEFAULT_BREATHING_LIMITS: DirectBreathingLimits = Object.freeze({
  intervalSeconds: 300,
  maxTicks: 6,
  maxContextBytes: 32_768,
  maxOutputTokensPerTick: 512,
  maxTotalOutputTokens: 3_072,
  maxSessionSeconds: 3_600,
});

export const HELD_BREATHING_STATUS: DirectBreathingStatus = Object.freeze({
  state: "breath-held",
  attemptedTicks: 0,
  successfulTicks: 0,
  reservedOutputTokens: 0,
  wakeLeaseMs: null,
  nextTickUtc: null,
  lastTickUtc: null,
  holdReason: "opt-in-required",
});

export function validateBreathingLimits(
  value: Partial<DirectBreathingLimits>,
): DirectBreathingLimits {
  const intervalSeconds = bounded(
    value.intervalSeconds,
    DEFAULT_BREATHING_LIMITS.intervalSeconds,
    60,
    3_600,
    "Cadence",
  );
  const maxTicks = bounded(
    value.maxTicks,
    DEFAULT_BREATHING_LIMITS.maxTicks,
    1,
    24,
    "Tick budget",
  );
  const maxOutputTokensPerTick = bounded(
    value.maxOutputTokensPerTick,
    DEFAULT_BREATHING_LIMITS.maxOutputTokensPerTick,
    64,
    4_096,
    "Per-tick token budget",
  );
  const maxContextBytes = bounded(
    value.maxContextBytes,
    DEFAULT_BREATHING_LIMITS.maxContextBytes,
    4_096,
    131_072,
    "Context byte budget",
  );
  const maxTotalOutputTokens = bounded(
    value.maxTotalOutputTokens,
    Math.min(3_072, maxTicks * maxOutputTokensPerTick),
    64,
    32_768,
    "Total token budget",
  );
  const maxSessionSeconds = bounded(
    value.maxSessionSeconds,
    DEFAULT_BREATHING_LIMITS.maxSessionSeconds,
    60,
    86_400,
    "Session budget",
  );
  if (maxTotalOutputTokens > maxTicks * maxOutputTokensPerTick) {
    throw new Error(
      "Total token budget cannot exceed tick budget × per-tick tokens.",
    );
  }
  return {
    intervalSeconds,
    maxTicks,
    maxContextBytes,
    maxOutputTokensPerTick,
    maxTotalOutputTokens,
    maxSessionSeconds,
  };
}

export function wakeLeaseMs(limits: DirectBreathingLimits): number {
  return Math.min(
    limits.maxSessionSeconds,
    Math.max(60, limits.intervalSeconds * 2),
  ) * 1_000;
}

export async function loadBreathingLimits(): Promise<DirectBreathingLimits> {
  const raw = await AsyncStorage.getItem(LIMITS_KEY);
  if (!raw) return DEFAULT_BREATHING_LIMITS;
  try {
    return validateBreathingLimits(JSON.parse(raw));
  } catch {
    return DEFAULT_BREATHING_LIMITS;
  }
}

export async function saveBreathingLimits(
  limits: DirectBreathingLimits,
): Promise<void> {
  await AsyncStorage.setItem(
    LIMITS_KEY,
    JSON.stringify(validateBreathingLimits(limits)),
  );
}

export function nextBreathingHoldReason(
  status: DirectBreathingStatus,
  limits: DirectBreathingLimits,
  startedAtMs: number,
  nowMs: number,
): string | null {
  if (status.attemptedTicks >= limits.maxTicks) return "tick-budget-exhausted";
  if (
    status.reservedOutputTokens + limits.maxOutputTokensPerTick >
    limits.maxTotalOutputTokens
  ) {
    return "token-budget-exhausted";
  }
  if (nowMs - startedAtMs >= limits.maxSessionSeconds * 1_000) {
    return "session-budget-exhausted";
  }
  return null;
}

function bounded(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (
    !Number.isSafeInteger(result) ||
    result < minimum ||
    result > maximum
  ) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return result;
}
