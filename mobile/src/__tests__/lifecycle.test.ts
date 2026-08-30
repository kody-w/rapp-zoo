import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lifecycleFixturesRaw,
  meshBloomCapsuleRaw,
  meshBloomRegistryRaw,
} from "@/generated/capsule-fixtures";
import { validateCapsuleRaw } from "@/capsules/capsule";
import { validateRegistryRecordRaw } from "@/capsules/registry";
import {
  cancelListing,
  deriveLifecycleSnapshot,
  lifecycleStateLabel,
  loadLifecycleFixtures,
  markListed,
  markSold,
  performVerifiedReturn,
} from "@/capsules/lifecycle";
import type { CapsuleLifecycleSnapshot } from "@/capsules/types";
import { createLifecyclePublicClient } from "@/capsules/lifecycle-client";

describe("30-day return and resale lifecycle", () => {
  it("bundles every required deterministic UX state", () => {
    assert.ok(lifecycleFixturesRaw.includes("rolling-core-lifecycle-fixtures/1"));
    assert.deepEqual(
      loadLifecycleFixtures().states.map((item) => item.state),
      [
        "owned",
        "return-eligible",
        "return-pending",
        "returned",
        "listed",
        "sold",
        "unverified-copy",
      ],
    );
  });

  it("derives return eligibility without changing immutable capsule bytes", async () => {
    const capsule = validateCapsuleRaw(meshBloomCapsuleRaw);
    const registry = validateRegistryRecordRaw(meshBloomRegistryRaw, capsule);
    const originalRaw = capsule.raw;
    const eligible = deriveLifecycleSnapshot(
      capsule,
      registry,
      null,
      Date.parse("2026-08-30T03:00:00.000Z"),
    );
    assert.equal(eligible.state, "return-eligible");
    const pendingStates: CapsuleLifecycleSnapshot["state"][] = [];
    const returned = await performVerifiedReturn({
      current: eligible,
      operationId: "return-once",
      onPending: (value) => {
        pendingStates.push(value.state);
      },
      client: {
        async verifyEligibility() {
          return { eligible: true, reason: "eligible" };
        },
        async confirmReturn() {
          return {
            refundConfirmed: true,
            eventVerified: true,
            eventId: `rce_${"7".repeat(32)}`,
            updatedUtc: "2026-08-30T03:01:00.000Z",
          };
        },
      },
    });
    assert.deepEqual(pendingStates, ["return-pending"]);
    assert.equal(returned.state, "returned");
    assert.equal(returned.officialOwned, false);
    assert.equal(returned.localCopyStatus, "unowned-verifiable-copy");
    assert.equal(capsule.raw, originalRaw);
  });

  it("does not mark a return complete before refund and event verification", async () => {
    const capsule = validateCapsuleRaw(meshBloomCapsuleRaw);
    const registry = validateRegistryRecordRaw(meshBloomRegistryRaw, capsule);
    const eligible = deriveLifecycleSnapshot(
      capsule,
      registry,
      null,
      Date.parse("2026-08-30T03:00:00.000Z"),
    );
    await assert.rejects(
      performVerifiedReturn({
        current: eligible,
        operationId: "return-pending",
        onPending() {},
        client: {
          async verifyEligibility() {
            return { eligible: true, reason: "eligible" };
          },
          async confirmReturn() {
            return {
              refundConfirmed: false,
              eventVerified: false,
              eventId: `rce_${"7".repeat(32)}`,
              updatedUtc: "2026-08-30T03:01:00.000Z",
            };
          },
        },
      }),
      /remains pending/,
    );
  });

  it("keeps birth value separate from ask and last sale", () => {
    const capsule = validateCapsuleRaw(meshBloomCapsuleRaw);
    const registry = validateRegistryRecordRaw(meshBloomRegistryRaw, capsule);
    const owned = deriveLifecycleSnapshot(
      capsule,
      registry,
      null,
      Date.parse("2026-10-01T00:00:00.000Z"),
    );
    const listed = markListed(
      owned,
      `rce_${"8".repeat(32)}`,
      42_000,
      "2026-10-01T00:01:00.000Z",
    );
    assert.equal(capsule.credit?.valuation.priceSats, 21_000);
    assert.equal(listed.currentSellerAskSats, 42_000);
    const sold = markSold(
      listed,
      `rce_${"9".repeat(32)}`,
      33_000,
      "2026-10-02T00:00:00.000Z",
    );
    assert.equal(sold.lastVerifiedSaleSats, 33_000);
    assert.equal(sold.officialOwned, false);
    assert.match(lifecycleStateLabel(sold.state), /UNOWNED/);
  });

  it("returns a cancelled listing to owned without rewriting birth value", () => {
    const base: CapsuleLifecycleSnapshot = {
      creditId: "1".repeat(64),
      state: "owned",
      returnWindowEndsUtc: "2026-01-31T00:00:00.000Z",
      officialOwned: true,
      localCopyStatus: "official-owner-copy",
      currentSellerAskSats: null,
      lastVerifiedSaleSats: 30_000,
      activeListingId: null,
      lastEventId: null,
      eventVerified: true,
      updatedUtc: "2026-02-01T00:00:00.000Z",
    };
    const listed = markListed(
      base,
      `rce_${"2".repeat(32)}`,
      50_000,
      "2026-02-02T00:00:00.000Z",
    );
    const owned = cancelListing(
      listed,
      `rce_${"3".repeat(32)}`,
      "2026-02-03T00:00:00.000Z",
    );
    assert.equal(owned.state, "owned");
    assert.equal(owned.currentSellerAskSats, null);
    assert.equal(owned.lastVerifiedSaleSats, 30_000);
  });

  it("accepts lifecycle state only after public signed-event verification", async () => {
    const creditId = "1".repeat(64);
    const event = {
      schema: "rapp-rapter-credit-listing/1",
      event_id: `rce_${"2".repeat(32)}`,
      ask_price_sats: 42_000,
    };
    const calls: string[] = [];
    const client = createLifecyclePublicClient(
      "https://registry.example.test/v1",
      async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/credit-registry/lifecycle/status")) {
          return new Response(
            JSON.stringify({
              schema: "rapp-rapter-credit-lifecycle-status/1",
              return_window_days: 30,
              refund_rails: {
                "app-store": true,
                "play-store": true,
                bitcoin: true,
              },
              resale_settlement_configured: true,
            }),
            { status: 200 },
          );
        }
        if (url.includes("/credit-registry/ownership?")) {
          return new Response(
            JSON.stringify({
              schema: "rapp-rapter-credit-ownership/1",
              credit_id: creditId,
              state: "listed",
              current_event_id: event.event_id,
              active_listing_id: event.event_id,
              official_owned: true,
              local_copy_status: "official-owner-copy",
            }),
            { status: 200 },
          );
        }
        if (url.includes("/credit-registry/lifecycle?")) {
          return new Response(
            JSON.stringify({
              object: "list",
              credit_id: creditId,
              data: [event],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ valid: true, event_id: event.event_id }),
          { status: 200 },
        );
      },
    );
    assert.equal((await client.status()).returnWindowDays, 30);
    assert.equal((await client.ownership(creditId)).state, "listed");
    const events = await client.events(creditId);
    assert.equal(await client.verifyEvent(events.data[0]!), true);
    assert.equal(calls.length, 4);
  });
});
