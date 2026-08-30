import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fiatCentsForSats,
  formatUsdCents,
} from "@/capsules/credit";
import { parseCurrentBtcQuotePayload } from "@/capsules/current-btc";

describe("non-authoritative current BTC conversion", () => {
  it("accepts integer-cents quotes for a separate live conversion", () => {
    const quote = parseCurrentBtcQuotePayload({
      btc_usd_cents_per_btc: 7_000_000,
      as_of_utc: "2026-08-30T12:00:00.000Z",
      source: "rapterbox-current-btc",
    });
    assert.ok(quote);
    assert.equal(
      formatUsdCents(fiatCentsForSats(21_000, quote.btcUsdCentsPerBtc)),
      "$14.70",
    );
  });

  it("refuses floats, unknown fields, and malformed timestamps", () => {
    assert.equal(
      parseCurrentBtcQuotePayload({
        btc_usd_cents_per_btc: 7_000_000.5,
        as_of_utc: "2026-08-30T12:00:00.000Z",
        source: "test",
      }),
      null,
    );
    assert.equal(
      parseCurrentBtcQuotePayload({
        btc_usd_cents_per_btc: 7_000_000,
        as_of_utc: "today",
        source: "test",
      }),
      null,
    );
    assert.equal(
      parseCurrentBtcQuotePayload({
        btc_usd_cents_per_btc: 7_000_000,
        as_of_utc: "2026-08-30T12:00:00.000Z",
        source: "test",
        official: true,
      }),
      null,
    );
  });
});
