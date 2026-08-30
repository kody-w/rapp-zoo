import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONSUMABLE_PRODUCTS } from "@/billing/catalog";
import { createPreviewBillingAdapter } from "@/billing/preview-adapter";

describe("Expo preview billing adapter", () => {
  it("simulates one-time consumable receipts without granting client ownership", async () => {
    const adapter = createPreviewBillingAdapter("Expo Go preview");
    const receiptCounts: number[] = [];
    const initialized = await adapter.initialize((snapshot) =>
      receiptCounts.push(snapshot.receipts.length),
    );
    assert.equal(initialized.snapshot.billingEnvironment, "preview");
    assert.equal(initialized.snapshot.receipts.length, 0);
    assert.match(initialized.snapshot.error ?? "", /simulated/);

    const packageId = initialized.snapshot.offerings.find(
      (offering) =>
        offering.productIdentifier === CONSUMABLE_PRODUCTS.flockThree,
    )!.packageId;
    const purchased = await adapter.purchase(packageId);
    assert.equal(
      purchased.purchasedReceipt?.productIdentifier,
      CONSUMABLE_PRODUCTS.flockThree,
    );
    assert.equal(purchased.snapshot.receipts.length, 1);
    assert.deepEqual(receiptCounts, [1]);

    const synced = await adapter.syncPurchaseHistory();
    assert.equal(synced.receipts.length, 1);
    initialized.cleanup();
  });

  it("refuses unknown mock packages instead of fabricating receipts", async () => {
    const adapter = createPreviewBillingAdapter("Web billing preview");
    await adapter.initialize(() => undefined);
    await assert.rejects(adapter.purchase("not-an-offering"), /Unknown preview/);
  });
});
