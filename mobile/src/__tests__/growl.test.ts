import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCompletedGrowl, scheduleGrowl } from "@/lib/growl";

const prompt = [
  { pitch: 41, delta_onset: 0, duration: 48, velocity: 72 },
  { pitch: 48, delta_onset: 0, duration: 48, velocity: 68 },
  { pitch: 55, delta_onset: 0, duration: 48, velocity: 74 },
  { pitch: 46, delta_onset: 24, duration: 36, velocity: 70 },
  { pitch: 53, delta_onset: 0, duration: 36, velocity: 66 },
  { pitch: 59, delta_onset: 0, duration: 36, velocity: 73 },
  { pitch: 44, delta_onset: 48, duration: 24, velocity: 64 },
  { pitch: 57, delta_onset: 24, duration: 72, velocity: 78 },
];
const continuation = [
  { pitch: 45, delta_onset: 24, duration: 48, velocity: 76 },
];

function completedGrowl() {
  return {
    schema: "rapp-holo-growl/1",
    representation: "note-pitch-delta-duration-velocity/1",
    seed: "89abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567",
    model: { id: "local-piano-continuation", revision: "r1" },
    ticks_per_quarter: 96,
    tempo_milli_bpm: 120_000,
    program: 0,
    title: "Original bounded study",
    subject_description: "An original local piano continuation.",
    prompt,
    continuation,
    complete: true,
    context_policy: { max_notes: 512, retain_latest: 384 },
  };
}

describe("completed MIDI Growl", () => {
  it("accepts the exact prompt-plus-continuation contract", () => {
    const result = parseCompletedGrowl(completedGrowl());
    assert.equal(result.kind, "playable");
    if (result.kind === "playable") {
      assert.deepEqual(result.notes, [...prompt, ...continuation]);
      assert.equal(result.ticksPerQuarter, 96);
      assert.equal(result.tempoMilliBpm, 120_000);
    }
  });

  it("converts MIDI ticks to deterministic WebAudio milliseconds", () => {
    const notes = [
      { pitch: 48, delta_onset: 0, duration: 96, velocity: 96 },
      { pitch: 55, delta_onset: 96, duration: 96, velocity: 84 },
    ];
    const scheduled: { pitch: number; onset: number; duration: number }[] = [];
    const total = scheduleGrowl(
      notes,
      (note, onset, duration) =>
        scheduled.push({ pitch: note.pitch, onset, duration }),
      96,
      120_000,
    );
    assert.deepEqual(scheduled, [
      { pitch: 48, onset: 0, duration: 500 },
      { pitch: 55, onset: 500, duration: 500 },
    ]);
    assert.equal(total, 1_000);
  });

  it("disables incomplete or reordered Growl data", () => {
    assert.equal(
      parseCompletedGrowl({ ...completedGrowl(), continuation: [] }).kind,
      "unsupported",
    );
    const reordered = completedGrowl();
    reordered.prompt[1] = {
      pitch: 40,
      delta_onset: 0,
      duration: 48,
      velocity: 68,
    };
    assert.equal(parseCompletedGrowl(reordered).kind, "unsupported");
  });
});
