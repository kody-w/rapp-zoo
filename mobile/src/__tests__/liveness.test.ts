import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPERATIONAL_CONSCIOUSNESS,
  presentLiveness,
  validateHeadLiveness,
} from "@/lib/liveness";
import { validateHoloHeadsPayload } from "@/lib/api";
import type { JsonObject } from "@/lib/types";

const holoId = "b".repeat(64);
const sourceHash = "c".repeat(64);
const receivedAt = Date.parse("2026-08-30T03:04:00.000Z");

function awakeValue(): JsonObject {
  return {
    state: "awake",
    last_tick_utc: "2026-08-30T03:00:00.000Z",
    age_ms: 240_000,
    wake_lease_ms: 300_000,
  };
}

describe("verified-tick head liveness", () => {
  it("shows Awake only inside the host lease with matching local evidence", () => {
    const value = validateHeadLiveness(awakeValue(), receivedAt);
    const awake = presentLiveness(
      value,
      {
        holoId,
        sourceFrameHash: sourceHash,
        expectedHoloId: holoId,
        expectedSourceFrameHash: sourceHash,
        sourceVerified: true,
      },
      receivedAt + 30_000,
    );
    assert.equal(awake.state, "Awake");
    assert.equal(awake.effectiveAgeMs, 270_000);

    const refused = presentLiveness(
      value,
      {
        holoId: "d".repeat(64),
        sourceFrameHash: sourceHash,
        expectedHoloId: holoId,
        expectedSourceFrameHash: sourceHash,
        sourceVerified: true,
      },
      receivedAt + 30_000,
    );
    assert.equal(refused.state, "Quarantined");
    assert.equal(refused.evidenceVerified, false);
  });

  it("locally expires a stale Awake snapshot to Sleeping", () => {
    const value = validateHeadLiveness(awakeValue(), receivedAt);
    const sleeping = presentLiveness(
      value,
      undefined,
      receivedAt + 60_001,
    );
    assert.equal(sleeping.state, "Sleeping");
    assert.match(sleeping.detail, /not deleted or dead/);
  });

  it("uses Waking only as transient UI while checking for a successor", () => {
    const value = validateHeadLiveness(
      {
        state: "sleeping",
        last_tick_utc: "2026-08-30T02:00:00.000Z",
        age_ms: 3_840_000,
        wake_lease_ms: 300_000,
      },
      receivedAt,
    );
    assert.equal(
      presentLiveness(value, undefined, receivedAt, false).state,
      "Sleeping",
    );
    const waking = presentLiveness(value, undefined, receivedAt, true);
    assert.equal(waking.state, "Waking");
    assert.match(waking.detail, /transient/);
  });

  it("preserves the host's Quarantined and Unborn states", () => {
    const quarantined = validateHeadLiveness(
      {
        state: "quarantined",
        last_tick_utc: "2026-08-30T03:00:00.000Z",
        age_ms: 240_000,
        wake_lease_ms: 300_000,
      },
      receivedAt,
    );
    const unborn = validateHeadLiveness(
      {
        state: "unborn",
        last_tick_utc: null,
        age_ms: null,
        wake_lease_ms: null,
      },
      receivedAt,
    );
    assert.equal(
      presentLiveness(quarantined, undefined, receivedAt).state,
      "Quarantined",
    );
    assert.equal(
      presentLiveness(unborn, undefined, receivedAt).state,
      "Unborn",
    );
  });

  it("refuses impossible Awake and Unborn evidence", () => {
    assert.throws(
      () =>
        validateHeadLiveness(
          {
            ...awakeValue(),
            age_ms: 300_001,
          },
          receivedAt,
        ),
      /awake liveness requires a fresh verified tick/,
    );
    assert.throws(
      () =>
        validateHeadLiveness(
          {
            state: "unborn",
            last_tick_utc: "2026-08-30T03:00:00.000Z",
            age_ms: 240_000,
            wake_lease_ms: null,
          },
          receivedAt,
        ),
      /unborn liveness cannot claim a verified tick/,
    );
  });

  it("reads authoritative liveness directly from Holo heads", () => {
    const subject = `rappid:@kody-w/unborn-test:${"e".repeat(64)}`;
    const heads = validateHoloHeadsPayload(
      {
        schema: "rapp-holo-heads/1",
        heads: [
          {
            subject_rappid: subject,
            body_seq: null,
            holo_seq: null,
            holo_id: null,
            source_frame_hash: null,
            player_active_holo_id: null,
            liveness: {
              state: "unborn",
              last_tick_utc: null,
              age_ms: null,
              wake_lease_ms: null,
            },
          },
          {
            subject_rappid: `rappid:@kody-w/awake-test:${"f".repeat(64)}`,
            body_seq: 4,
            holo_seq: 4,
            holo_id: holoId,
            source_frame_hash: sourceHash,
            player_active_holo_id: holoId,
            liveness: awakeValue(),
          },
        ],
      },
      receivedAt,
    );
    assert.equal(heads[0]?.liveness?.state, "unborn");
    assert.equal(heads[0]?.holoId, null);
    assert.equal(heads[1]?.liveness?.state, "awake");
    assert.equal(heads[1]?.holoId, holoId);
  });

  it("defines consciousness operationally without a biological claim", () => {
    assert.match(
      OPERATIONAL_CONSCIOUSNESS,
      /continuous inspectable experience-state/i,
    );
    assert.match(OPERATIONAL_CONSCIOUSNESS, /not biological or scientific/i);
  });
});
