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
});
