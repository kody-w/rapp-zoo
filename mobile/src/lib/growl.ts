import type { GrowlNote, GrowlState, JsonObject, JsonValue } from "./types";

const MAX_NOTES = 2_080;
const MAX_TICKS = 16_777_215;
const GROWL_KEYS = new Set([
  "schema",
  "representation",
  "seed",
  "model",
  "ticks_per_quarter",
  "tempo_milli_bpm",
  "program",
  "title",
  "subject_description",
  "prompt",
  "continuation",
  "complete",
  "context_policy",
]);

export function parseCompletedGrowl(value: JsonValue | undefined): GrowlState {
  if (value === undefined) {
    return {
      kind: "missing",
      message: "This frame has no required completed MIDI Growl.",
    };
  }
  if (!isObject(value) || !sameKeys(value, GROWL_KEYS)) {
    return unsupported("Growl has missing or unknown members.");
  }
  if (
    value.schema !== "rapp-holo-growl/1" ||
    value.representation !== "note-pitch-delta-duration-velocity/1" ||
    typeof value.seed !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.seed) ||
    value.complete !== true
  ) {
    return unsupported("Growl contract identity is invalid.");
  }
  const model = isObject(value.model) ? value.model : null;
  if (
    !model ||
    !sameKeys(model, new Set(["id", "revision"])) ||
    !boundedString(model.id, 1, 128) ||
    !boundedString(model.revision, 1, 64)
  ) {
    return unsupported("Growl model provenance is invalid.");
  }
  if (
    !integerIn(value.ticks_per_quarter, 24, 960) ||
    !integerIn(value.tempo_milli_bpm, 30_000, 300_000) ||
    !integerIn(value.program, 0, 127) ||
    !boundedString(value.title, 1, 128) ||
    !boundedString(value.subject_description, 1, 1_024)
  ) {
    return unsupported("Growl timing, program, or description is invalid.");
  }
  const policy = isObject(value.context_policy)
    ? value.context_policy
    : null;
  if (
    !policy ||
    !sameKeys(policy, new Set(["max_notes", "retain_latest"])) ||
    policy.max_notes !== 512 ||
    policy.retain_latest !== 384
  ) {
    return unsupported("Growl context policy is invalid.");
  }
  const prompt = parseNotes(value.prompt, 8, 32, "prompt");
  if (typeof prompt === "string") return unsupported(prompt);
  const continuation = parseNotes(
    value.continuation,
    1,
    2_048,
    "continuation",
  );
  if (typeof continuation === "string") return unsupported(continuation);
  const notes = [...prompt, ...continuation];
  if (notes.length > MAX_NOTES) {
    return unsupported(`Growl exceeds ${MAX_NOTES} aggregate NOTE events.`);
  }
  let onset = 0;
  let songEnd = 0;
  let previousPitch: number | null = null;
  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index]!;
    onset += note.delta_onset;
    songEnd = Math.max(songEnd, onset + note.duration);
    if (
      note.delta_onset === 0 &&
      previousPitch !== null &&
      note.pitch <= previousPitch
    ) {
      return unsupported(
        `Growl NOTE ${index} has an unsorted simultaneous pitch.`,
      );
    }
    previousPitch = note.pitch;
  }
  if (songEnd > MAX_TICKS) {
    return unsupported(`Growl exceeds ${MAX_TICKS} aggregate ticks.`);
  }
  return {
    kind: "playable",
    message: `${notes.length} completed NOTE event${notes.length === 1 ? "" : "s"} ready. Playback requires a tap.`,
    notes,
    ticksPerQuarter: value.ticks_per_quarter,
    tempoMilliBpm: value.tempo_milli_bpm,
    program: value.program,
    title: value.title,
    value,
  };
}

export function scheduleGrowl(
  notes: GrowlNote[],
  schedule: (note: GrowlNote, onsetMs: number, durationMs: number) => void,
  ticksPerQuarter = 1_000,
  tempoMilliBpm = 60_000,
): number {
  const stepMs = 60_000_000 / (tempoMilliBpm * ticksPerQuarter);
  let onsetTicks = 0;
  let endMs = 0;
  for (const note of notes) {
    onsetTicks += note.delta_onset;
    const onsetMs = onsetTicks * stepMs;
    const durationMs = note.duration * stepMs;
    schedule(note, onsetMs, durationMs);
    endMs = Math.max(endMs, onsetMs + durationMs);
  }
  return endMs;
}

function parseNotes(
  value: JsonValue | undefined,
  minimum: number,
  maximum: number,
  label: string,
): GrowlNote[] | string {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    return `Growl ${label} must contain ${minimum}-${maximum} NOTE events.`;
  }
  const notes: GrowlNote[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const note = value[index];
    if (
      !isObject(note) ||
      !sameKeys(
        note,
        new Set(["pitch", "delta_onset", "duration", "velocity"]),
      ) ||
      !integerIn(note.pitch, 0, 127) ||
      !integerIn(note.delta_onset, 0, 65_535) ||
      !integerIn(note.duration, 1, 65_535) ||
      !integerIn(note.velocity, 1, 127)
    ) {
      return `Growl ${label} NOTE ${index} is invalid.`;
    }
    notes.push({
      pitch: note.pitch,
      delta_onset: note.delta_onset,
      duration: note.duration,
      velocity: note.velocity,
    });
  }
  return notes;
}

function unsupported(message: string): GrowlState {
  return { kind: "unsupported", message };
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(value: JsonObject, expected: Set<string>): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.size && keys.every((key) => expected.has(key))
  );
}

function boundedString(
  value: JsonValue | undefined,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.normalize("NFC") === value
  );
}

function integerIn(
  value: JsonValue | undefined,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}
