import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  lumenDriftCapsuleRaw,
  meshBloomCapsuleRaw,
  meshBloomRegistryRaw,
  orbitalGardenCapsuleRaw,
} from "@/generated/capsule-fixtures";
import {
  assertOneToOneCreditBindings,
  validateCapsuleRaw,
} from "@/capsules/capsule";
import {
  fiatCentsForSats,
  formatBtc,
  formatSats,
  formatUsdCents,
} from "@/capsules/credit";
import { loadBundledGallery } from "@/capsules/gallery";
import {
  createCapsuleRedemptionClient,
  createPreviewRedemptionClient,
} from "@/capsules/redemption";
import {
  ownershipStatusLabel,
  validateRegistryRecordRaw,
} from "@/capsules/registry";
import { createCreditRegistryClient } from "@/capsules/registry-client";
import type { JsonObject } from "@/lib/types";

describe("signed Rolling Core Capsules", () => {
  it("verifies trusted Ed25519 signatures and bound Holo/source frames", () => {
    for (const raw of [
      lumenDriftCapsuleRaw,
      meshBloomCapsuleRaw,
      orbitalGardenCapsuleRaw,
    ]) {
      const capsule = validateCapsuleRaw(raw);
      assert.equal(capsule.trustedSigner, "rapterbox-capsule-demo-2026-6");
      assert.ok(capsule.frames.length > 0);
      assert.equal(capsule.frames[0]!.subjectRappid, capsule.organism.rappid);
    }
  });

  it("refuses modified capsule content", () => {
    const value = JSON.parse(lumenDriftCapsuleRaw);
    value.organism.description = "mutated after signing";
    assert.throws(
      () => validateCapsuleRaw(JSON.stringify(value)),
      /capsule_id mismatch|signature verification failed/,
    );
  });

  it("binds one public Rapter Credit to stable organism and genesis IDs", () => {
    const mesh = validateCapsuleRaw(meshBloomCapsuleRaw);
    const orbital = validateCapsuleRaw(orbitalGardenCapsuleRaw);
    assert.ok(mesh.credit);
    assert.ok(orbital.credit);
    assert.equal(mesh.credit.organismRappid, mesh.organism.rappid);
    assert.equal(
      mesh.credit.genesisCoreId,
      mesh.frames.find((frame) => frame.holoSequence === 0)!.id,
    );
    assert.equal(mesh.credit.priceSats, orbital.credit.priceSats);
    assert.notEqual(mesh.credit.creditId, orbital.credit.creditId);
    assert.equal(mesh.credit.uniqueness.kind, "signed-ledger");
    assert.equal(orbital.credit.uniqueness.kind, "bitcoin-utxo");
    assert.equal(mesh.credit.valuation.tier, "core");
    assert.equal(orbital.credit.valuation.tier, "radiant");
    assert.equal(mesh.credit.valuation.scheduleId, "rapterbox-birth-2026-08");
    assert.equal(
      mesh.credit.valuation.birthFiatCents,
      fiatCentsForSats(
        mesh.credit.valuation.priceSats,
        mesh.credit.valuation.btcUsdCentsPerBtc,
      ),
    );
    assert.doesNotMatch(mesh.raw, /private_key|raw_receipt|wallet_seed/i);
  });

  it("refuses a second credit binding for the same organism", () => {
    const mesh = validateCapsuleRaw(meshBloomCapsuleRaw);
    const orbital = validateCapsuleRaw(orbitalGardenCapsuleRaw);
    const collision = {
      ...orbital,
      credit: {
        ...orbital.credit!,
        organismRappid: mesh.organism.rappid,
      },
    };
    assert.throws(
      () =>
        assertOneToOneCreditBindings([
          { id: mesh.capsuleId, importedAt: "", capsule: mesh },
          { id: collision.capsuleId, importedAt: "", capsule: collision },
        ]),
      /more than one Rapter Credit/,
    );
  });

  it("formats integer satoshi value as sats and BTC without using it as identity", () => {
    assert.equal(formatSats(21_000), "21,000 sats");
    assert.equal(formatBtc(21_000), "0.00021000 BTC");
    assert.equal(formatUsdCents(1_344), "$13.44");
  });

  it("refuses a changed birth tier or quote after issuance", () => {
    const value = JSON.parse(meshBloomCapsuleRaw);
    value.credit.valuation.birth_fiat_cents += 1;
    assert.throws(
      () => validateCapsuleRaw(JSON.stringify(value)),
      /capsule_id mismatch|birth fiat reference does not match/,
    );
    value.credit.valuation.birth_fiat_cents -= 1;
    value.credit.valuation.tier = "invented";
    assert.throws(
      () => validateCapsuleRaw(JSON.stringify(value)),
      /capsule_id mismatch|signature verification failed/,
    );
  });

  it("keeps gallery preview separate from idempotent capsule redemption", async () => {
    const organism = loadBundledGallery()[1]!;
    const redemption = createPreviewRedemptionClient();
    const first = await redemption.redeem({
      organismId: organism.id,
      capsuleAsset: organism.capsuleAsset,
      registryAsset: organism.registryAsset,
      redemptionId: "redemption-1",
    });
    const replay = await redemption.redeem({
      organismId: organism.id,
      capsuleAsset: organism.capsuleAsset,
      registryAsset: organism.registryAsset,
      redemptionId: "redemption-1",
    });
    assert.equal(first.capsule.capsuleId, organism.capsuleId);
    assert.equal(replay.capsule.capsuleId, first.capsule.capsuleId);
    assert.equal(first.registryRecord.status, "official");
    assert.equal(
      (await redemption.redownload(first.capsule.capsuleId)).capsule.capsuleId,
      first.capsule.capsuleId,
    );
  });

  it("sends a stable redemption ID to the capsule service", async () => {
    const calls: { key: string | null; body: string | null }[] = [];
    const fetchMock: typeof fetch = async (_input, init) => {
      calls.push({
        key: new Headers(init?.headers).get("Idempotency-Key"),
        body: typeof init?.body === "string" ? init.body : null,
      });
      return new Response(
        JSON.stringify({
          capsule: meshBloomCapsuleRaw,
          registry_record: meshBloomRegistryRaw,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const client = createCapsuleRedemptionClient(
      "https://capsules.example.test/v1",
      fetchMock,
    );
    await client.redeem({
      organismId: "mesh-bloom",
      redemptionId: "redeem-123",
    });
    assert.deepEqual(calls, [
      {
        key: "redeem-123",
        body: JSON.stringify({ organism_id: "mesh-bloom" }),
      },
    ]);
  });

  it("requires authoritative signed registry proof for official ownership", () => {
    const capsule = validateCapsuleRaw(meshBloomCapsuleRaw);
    assert.equal(
      ownershipStatusLabel(capsule, null),
      "UNVERIFIED COPY / PREVIEW",
    );
    const record = validateRegistryRecordRaw(meshBloomRegistryRaw, capsule);
    assert.match(ownershipStatusLabel(capsule, record), /^OFFICIAL/);

    const mutated = JSON.parse(meshBloomRegistryRaw);
    mutated.status = "revoked";
    assert.throws(
      () => validateRegistryRecordRaw(JSON.stringify(mutated), capsule),
      /record_hash mismatch|signature verification failed/,
    );
  });

  it("uses the deployed Azure lookup route and direct signed-credit shape", async () => {
    const capsule = validateCapsuleRaw(meshBloomCapsuleRaw);
    const creditId = `rcredit:${"a".repeat(64)}`;
    const cloudCapsule = {
      ...capsule,
      credit: {
        ...capsule.credit!,
        creditId,
      },
    };
    const credit: JsonObject = {
      schema: "rappter-credit-registry-entry/1",
      issuer: "rappterbox",
      credit_id: creditId,
      issuance_index: 7,
      issuance_cap: 100,
      issued_at: "2026-08-30T02:00:00+00:00",
      payment_provider: "app-store",
      payment_rail: "app-store",
      payment_reference_hash: "b".repeat(64),
      owner_reference_hash: "c".repeat(64),
      purchase_utc: "2026-08-30T02:00:00+00:00",
      product_id: "rolling-core",
      set_id: "genesis-2026",
      tier: "common",
      btc_fraction: { numerator: 1, denominator: 1_000_000 },
      price_sats: 100,
      birth_value_usd_micros: 60_000,
      valuation_schedule_id: `rvs_${"d".repeat(32)}`,
      valuation_schedule_hash: "e".repeat(64),
      btc_quote: {
        source: "test",
        observed_utc: "2026-08-30T02:00:00+00:00",
        raw_response_hash: "f".repeat(64),
        btc_usd_micros: 60_000_000_000,
      },
      conception_utc: "2026-08-30T02:00:00+00:00",
      organism_rappid: cloudCapsule.credit.organismRappid,
      genesis_core_id: cloudCapsule.credit.genesisCoreId,
      core_manifest_hash: "1".repeat(64),
      bitcoin_outpoint: null,
      status: "active",
      signature: {
        algorithm: "ES256",
        key_id: "https://issuer.example/keys/credits/version-1",
        value: "A".repeat(86),
      },
    };
    const requests: { url: string; method: string; body: string | null }[] = [];
    const client = createCreditRegistryClient(
      "https://registry.example.test/v1/",
      async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        });
        if ((init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify(credit), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            valid: true,
            credit_id: creditId,
            issuer: "rappterbox",
          }),
          { status: 200 },
        );
      },
    );
    const record = await client.fetchStatus(creditId, cloudCapsule);
    assert.deepEqual(requests, [
      {
        url:
          `https://registry.example.test/v1/credit-registry/lookup?credit_id=${encodeURIComponent(creditId)}`,
        method: "GET",
        body: null,
      },
      {
        url: "https://registry.example.test/v1/credit-registry/verify",
        method: "POST",
        body: JSON.stringify(credit),
      },
    ]);
    assert.equal(record.status, "official");
    assert.equal(record.creditId, creditId);

    const inactiveClient = createCreditRegistryClient(
      "https://registry.example.test/v1",
      async () =>
        new Response(JSON.stringify({ ...credit, status: "revoked" }), {
          status: 200,
        }),
    );
    await assert.rejects(
      inactiveClient.fetchStatus(creditId, cloudCapsule),
      /status is not active/,
    );

    const unverifiedClient = createCreditRegistryClient(
      "https://registry.example.test/v1",
      async (_input, init) =>
        new Response(
          JSON.stringify(
            (init?.method ?? "GET") === "GET"
              ? credit
              : {
                  valid: false,
                  credit_id: creditId,
                  issuer: "rappterbox",
                },
          ),
          { status: 200 },
        ),
    );
    await assert.rejects(
      unverifiedClient.fetchStatus(creditId, cloudCapsule),
      /did not verify/,
    );
  });

  it("refuses the obsolete wrapped Azure response shape", async () => {
    const capsule = validateCapsuleRaw(meshBloomCapsuleRaw);
    const creditId = `rcredit:${"a".repeat(64)}`;
    const cloudCapsule = {
      ...capsule,
      credit: { ...capsule.credit!, creditId },
    };
    const client = createCreditRegistryClient(
      "https://registry.example.test/v1",
      async () =>
        new Response(JSON.stringify({ record: meshBloomRegistryRaw }), {
          status: 200,
        }),
    );
    await assert.rejects(
      client.fetchStatus(creditId, cloudCapsule),
      /missing or unknown members/,
    );
  });
});
