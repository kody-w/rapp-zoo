import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSUMABLE_PRODUCTS } from "@/billing/catalog";
import {
  createPreviewLedgerClient,
  createWildLedgerClient,
} from "@/billing/ledger";
import type { LedgerSnapshot, PurchaseReceipt } from "@/billing/types";

const receipt: PurchaseReceipt = {
  transactionIdentifier: "transaction-123",
  productIdentifier: CONSUMABLE_PRODUCTS.flockThree,
  purchaseDate: "2026-08-29T00:00:00.000Z",
  store: "APP_STORE",
  appUserId: "user-1",
};

describe("backend-owned consumable ledger", () => {
  it("makes preview grants idempotent by transaction identifier", async () => {
    const ledger = createPreviewLedgerClient();
    const first = await ledger.claimReceipt(receipt);
    const replay = await ledger.claimReceipt(receipt);
    assert.equal(first.availableRapterCredits, 3);
    assert.equal(replay.availableRapterCredits, 3);
    assert.equal(replay.processedTransactions, 1);
  });

  it("consumes one owned credit for capsule redemption idempotently", async () => {
    const ledger = createPreviewLedgerClient();
    await ledger.claimReceipt(receipt);
    const redeemed = await ledger.consumeRapterCredit("redemption-1");
    const replay = await ledger.consumeRapterCredit("redemption-1");
    assert.equal(redeemed.availableRapterCredits, 2);
    assert.equal(replay.availableRapterCredits, 2);
    assert.equal(replay.activeWildRapters, 0);
  });

  it("sends the store transaction ID as backend idempotency key", async () => {
    const calls: { url: string; key: string | null }[] = [];
    const response: LedgerSnapshot = {
      availableRapterCredits: 3,
      activeWildRapters: 0,
      smallComputePacks: 0,
      largeComputePacks: 0,
      processedTransactions: 1,
      status: "live",
      error: null,
    };
    const fetchMock: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        key: new Headers(init?.headers).get("Idempotency-Key"),
      });
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const ledger = createWildLedgerClient(
      { endpoint: "https://ledger.example.test/v1" },
      fetchMock,
    );
    await ledger.claimReceipt(receipt);
    assert.deepEqual(calls, [
      {
        url: "https://ledger.example.test/v1/grants",
        key: receipt.transactionIdentifier,
      },
    ]);
  });
});
