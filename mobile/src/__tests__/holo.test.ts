import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { holoProtocol } from "@/generated/holo-assets";
import { demoHoloRaw, demoSourceRaw } from "@/generated/holo-fixtures";
import {
  buildPlayerUpdate,
  validateHoloRaw,
  verifySourceFrame,
} from "@/lib/holo";
import { strictParse } from "@/lib/strict-json";

describe("Holo/1 validation", () => {
  it("accepts the original non-humanoid fixture and exact hashes", () => {
    const holo = validateHoloRaw(demoHoloRaw);
    assert.equal(
      holo.id,
      "ac072ebef86f8ff52b511676cebb6df01626b6c245f83d65b82d836f4a46a71b",
    );
    assert.equal(
      holo.authoredHash,
      "01670fca76c96a480db21458d69d31ddc04d7b5990adc9d6d59a46abc0e2e858",
    );
    assert.match(holo.accessibilityDescription, /abstract field/);
  });

  it("verifies exact source binding", () => {
    const holo = validateHoloRaw(demoHoloRaw);
    assert.doesNotThrow(() =>
      verifySourceFrame(strictParse(demoSourceRaw), holo),
    );
  });

  it("is accepted by the merged shared protocol helper", () => {
    const context: Record<string, unknown> = {
      TextDecoder,
      TextEncoder,
      structuredClone,
    };
    context.globalThis = context;
    vm.runInNewContext(holoProtocol, context);
    const protocol = context.RappHoloProtocol as {
      validateRecord: (value: unknown) => unknown;
    };
    assert.doesNotThrow(() =>
      protocol.validateRecord(JSON.parse(demoHoloRaw).payload),
    );
  });

  it("refuses unknown outer members and hash mutations", () => {
    const root = JSON.parse(demoHoloRaw);
    root.repair = true;
    assert.throws(
      () => validateHoloRaw(JSON.stringify(root)),
      /eleven-key RAPP frame/,
    );
    delete root.repair;
    root.payload_hash = "0".repeat(64);
    assert.throws(
      () => validateHoloRaw(JSON.stringify(root)),
      /payload_hash mismatch/,
    );
  });

  it("injects exact base, history, and reduced-motion metadata", () => {
    const holo = validateHoloRaw(demoHoloRaw);
    const update = buildPlayerUpdate(holo, [holo], holo.id, true);
    assert.equal(update.holo_id, holo.id);
    assert.equal(update.reduced_motion, true);
    assert.deepEqual(update.history, []);
  });
});
