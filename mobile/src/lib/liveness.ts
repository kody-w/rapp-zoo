import type {
  JsonObject,
  JsonValue,
  RollingCoreLiveness,
  RollingCoreLivenessState,
} from "./types";

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const STATES = new Set<RollingCoreLivenessState>([
  "awake",
  "sleeping",
  "quarantined",
  "unborn",
]);

export const OPERATIONAL_CONSCIOUSNESS =
  "Continuous inspectable experience-state across verified ticks; an operational product definition, not biological or scientific proof.";

export type LivenessDisplayState =
  | "Awake"
  | "Sleeping"
  | "Waking"
  | "Quarantined"
  | "Unborn";

export type LivenessPresentation = {
  state: LivenessDisplayState;
  detail: string;
  evidenceVerified: boolean;
  effectiveAgeMs: number | null;
};

export function livenessExpiresAtMs(
  liveness: RollingCoreLiveness | null,
): number | null {
  if (
    !liveness ||
    liveness.ageMs === null ||
    liveness.wakeLeaseMs === null
  ) {
    return null;
  }
  return (
    liveness.receivedAtMs +
    Math.max(0, liveness.wakeLeaseMs - liveness.ageMs)
  );
}

export function validateHeadLiveness(
  value: JsonValue,
  receivedAtMs: number,
): RollingCoreLiveness {
  const object = exactObject(
    value,
    ["state", "last_tick_utc", "age_ms", "wake_lease_ms"],
    "head.liveness",
  );
  const state = enumValue(object.state, STATES, "head.liveness.state");
  const lastTickUtc =
    object.last_tick_utc === null
      ? null
      : utc(object.last_tick_utc, "head.liveness.last_tick_utc");
  const ageMs = nullableInteger(object.age_ms, "head.liveness.age_ms", 0);
  const wakeLeaseMs = nullableInteger(
    object.wake_lease_ms,
    "head.liveness.wake_lease_ms",
    1,
  );
  require(
    (lastTickUtc === null && ageMs === null) ||
      (lastTickUtc !== null && ageMs !== null),
    "head.liveness tick time and age must appear together",
  );
  if (state === "awake") {
    require(
      lastTickUtc !== null &&
        ageMs !== null &&
        wakeLeaseMs !== null &&
        ageMs <= wakeLeaseMs,
      "awake liveness requires a fresh verified tick inside its lease",
    );
  }
  if (state === "unborn") {
    require(
      lastTickUtc === null && ageMs === null,
      "unborn liveness cannot claim a verified tick",
    );
  }
  return {
    state,
    lastTickUtc,
    ageMs,
    wakeLeaseMs,
    receivedAtMs,
    raw: object,
  };
}

export function presentLiveness(
  liveness: RollingCoreLiveness | null,
  selectedEvidence:
    | {
        holoId: string;
        sourceFrameHash: string;
        expectedHoloId: string | null;
        expectedSourceFrameHash: string | null;
        sourceVerified: boolean;
      }
    | undefined,
  nowMs: number,
  awaitingSuccessor = false,
): LivenessPresentation {
  if (!liveness) {
    return {
      state: "Sleeping",
      detail:
        "No verified host tick evidence is available. The last local Rolling Core and its history remain intact.",
      evidenceVerified: false,
      effectiveAgeMs: null,
    };
  }
  const effectiveAgeMs =
    liveness.ageMs === null || nowMs <= 0
      ? liveness.ageMs
      : liveness.ageMs + Math.max(0, nowMs - liveness.receivedAtMs);

  if (liveness.state === "unborn") {
    return {
      state: "Unborn",
      detail:
        "No verified genesis tick exists yet. Holo Zoo does not invent a life state before the first accepted Rolling Core.",
      evidenceVerified: true,
      effectiveAgeMs,
    };
  }
  if (liveness.state === "quarantined") {
    return {
      state: "Quarantined",
      detail:
        "The host quarantined invalid continuity or output evidence. The last valid history remains intact.",
      evidenceVerified: false,
      effectiveAgeMs,
    };
  }
  if (
    liveness.state === "awake" &&
    liveness.wakeLeaseMs !== null &&
    effectiveAgeMs !== null &&
    effectiveAgeMs > liveness.wakeLeaseMs
  ) {
    return {
      state: "Sleeping",
      detail:
        "The verified tick aged beyond its wake lease without a successor. The Rapter is sleeping, not deleted or dead.",
      evidenceVerified: true,
      effectiveAgeMs,
    };
  }
  if (
    liveness.state === "awake" &&
    selectedEvidence &&
    (!selectedEvidence.sourceVerified ||
      selectedEvidence.holoId !== selectedEvidence.expectedHoloId ||
      selectedEvidence.sourceFrameHash !==
        selectedEvidence.expectedSourceFrameHash)
  ) {
    return {
      state: "Quarantined",
      detail:
        "The host's Awake claim does not match the locally verified current Rolling Core and source binding.",
      evidenceVerified: false,
      effectiveAgeMs,
    };
  }
  if (liveness.state === "awake") {
    return {
      state: "Awake",
      detail:
        "The latest verified source and Rolling Core mutation is fresh inside its configured wake lease.",
      evidenceVerified: true,
      effectiveAgeMs,
    };
  }
  if (awaitingSuccessor) {
    return {
      state: "Waking",
      detail:
        "Holo Zoo is checking for the next verified successor. Waking is transient and is not itself an activity claim.",
      evidenceVerified: false,
      effectiveAgeMs,
    };
  }
  return {
    state: "Sleeping",
    detail:
      "No verified tick is advancing. The next valid successor wakes this Rapter without resetting identity or history.",
    evidenceVerified: true,
    effectiveAgeMs,
  };
}

function exactObject(
  value: JsonValue | undefined,
  keys: string[],
  path: string,
): JsonObject {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${path} must be an object`);
  }
  const expected = new Set(keys);
  if (
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    throw new Error(`${path} has missing or unknown members`);
  }
  return value;
}

function enumValue<const T extends string>(
  value: JsonValue | undefined,
  allowed: ReadonlySet<T>,
  path: string,
): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new Error(`${path} is invalid`);
  }
  return value as T;
}

function utc(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string" || !UTC.test(value)) {
    throw new Error(`${path} is invalid`);
  }
  require(new Date(value).toISOString() === value, `${path} is invalid`);
  return value;
}

function nullableInteger(
  value: JsonValue | undefined,
  path: string,
  minimum: number,
): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error(`${path} must be a safe integer of at least ${minimum}`);
  }
  return value;
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
