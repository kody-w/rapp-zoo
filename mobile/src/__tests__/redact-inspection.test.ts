import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { validateCapsuleRaw } from "@/capsules/capsule";
import { redactInspectionRecord } from "@/lib/redact-inspection";

describe("no-commerce inspection redaction", () => {
  it("emits only an allowlisted frame proof summary", () => {
    const source = {
      v: 1,
      kind: "body.pulse",
      subject: "rappid:@rapterbox/example:" + "a".repeat(64),
      seq: 7,
      utc: "2026-09-01T00:00:00.000Z",
      prev: "b".repeat(64),
      payload: {
        value: "private",
        settlement: { txid: "private", vout: 2 },
      },
      payload_hash: "c".repeat(64),
      frame_hash: "d".repeat(64),
      sig: "signed",
    };
    const redacted = redactInspectionRecord(source);
    assert.deepEqual(redacted, {
      schema: "holo-zoo-redacted-inspection/1",
      value_type: "object",
      top_level_member_count: 10,
      signature_present: true,
      v: 1,
      kind: "body.pulse",
      subject: source.subject,
      seq: 7,
      utc: source.utc,
      prev: source.prev,
      payload_hash: source.payload_hash,
      frame_hash: source.frame_hash,
      payload_member_count: 2,
    });
    assert.equal(source.payload.settlement.txid, "private");
  });

  it("does not expose commerce data from a shipped credited capsule", () => {
    const raw = readFileSync(
      new URL(
        "../../assets/capsules/orbital-garden.rollingcore.json",
        import.meta.url,
      ),
      "utf8",
    );
    const capsule = validateCapsuleRaw(raw);
    const summary = redactInspectionRecord(capsule.root);
    assert.equal(summary.signature_present, true);
    const output = JSON.stringify(summary);
    for (const value of [
      "rapterbox_btc",
      "bitcoin-utxo",
      "txid",
      "vout",
      "settlement",
      "invoice_id",
      "payout_state",
      "cost_minor",
      "valuation",
      "price_sats",
    ]) {
      assert.equal(output.includes(value), false);
    }
  });

  it("summarizes arrays and scalars without echoing values", () => {
    assert.deepEqual(redactInspectionRecord(["private"]), {
      schema: "holo-zoo-redacted-inspection/1",
      value_type: "array",
      item_count: 1,
    });
    assert.deepEqual(redactInspectionRecord("private"), {
      schema: "holo-zoo-redacted-inspection/1",
      value_type: "string",
    });
  });
});
