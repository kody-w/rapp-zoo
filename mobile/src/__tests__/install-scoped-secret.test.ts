import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enforceInstallScopedSecret } from "@/providers/install-scoped-secret";

describe("install-scoped provider secret", () => {
  it("preserves a key only when the current app sandbox marker exists", async () => {
    const calls: string[] = [];
    const reset = await enforceInstallScopedSecret(
      {
        readMarker: async () => "installed",
        clearSecret: async () => {
          calls.push("clear");
        },
        writeMarker: async () => {
          calls.push("write");
        },
      },
      "installed",
    );

    assert.equal(reset, false);
    assert.deepEqual(calls, []);
  });

  for (const priorMarker of [null, "stale"]) {
    it(`clears a residual key before recording a ${priorMarker === null ? "new" : "changed"} installation`, async () => {
      const calls: string[] = [];
      const reset = await enforceInstallScopedSecret(
        {
          readMarker: async () => priorMarker,
          clearSecret: async () => {
            calls.push("clear");
          },
          writeMarker: async (value) => {
            calls.push(`write:${value}`);
          },
        },
        "installed",
      );

      assert.equal(reset, true);
      assert.deepEqual(calls, ["clear", "write:installed"]);
    });
  }

  it("does not bless an installation when secure deletion fails", async () => {
    let markerWritten = false;
    await assert.rejects(
      enforceInstallScopedSecret(
        {
          readMarker: async () => null,
          clearSecret: async () => {
            throw new Error("secure store unavailable");
          },
          writeMarker: async () => {
            markerWritten = true;
          },
        },
        "installed",
      ),
      /secure store unavailable/,
    );
    assert.equal(markerWritten, false);
  });
});
