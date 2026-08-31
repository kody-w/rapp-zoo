import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadBundledGallery } from "@/capsules/gallery";
import { buildFieldEncounters, nextFieldEncounter } from "@/field/field";
import {
  HOUSE_STORAGE_KEY,
  STARTING_HOUSES,
  isHouseCode,
} from "@/field/houses";
import {
  advanceLocalWorkPreview,
  assertLocalWorkPreview,
  createLocalWorkPreview,
  workPreviewStatus,
} from "@/field/work-preview";

describe("Holo Field domain", () => {
  it("defines four local-only Houses with no economic or power input", () => {
    assert.equal(HOUSE_STORAGE_KEY, "@holo-zoo/starting-house-v1");
    assert.deepEqual(
      STARTING_HOUSES.map((house) => house.code),
      ["overwatch", "scout", "forge", "sentinel"],
    );
    assert.equal(isHouseCode("overwatch"), true);
    assert.equal(isHouseCode("unknown"), false);
    for (const house of STARTING_HOUSES) {
      assert.equal("price" in house, false);
      assert.equal("power" in house, false);
      assert.equal("odds" in house, false);
    }
  });

  it("builds the same stable encounter field independently of House choice", () => {
    const gallery = loadBundledGallery();
    const freeCompanion = gallery.find(
      (organism) => organism.priceSats === null,
    );
    assert.equal(freeCompanion?.id, "lumen-drift");
    const first = buildFieldEncounters(gallery);
    const reordered = buildFieldEncounters([...gallery].reverse());
    assert.deepEqual(first, reordered);
    assert.equal(first.length, gallery.length);
    assert.equal(new Set(first.map((item) => item.id)).size, gallery.length);
    assert.ok(first.every((item) => item.signal >= 62 && item.signal <= 98));
    assert.equal(nextFieldEncounter(first, null)?.id, first[0]?.id);
    assert.equal(
      nextFieldEncounter(first, first.at(-1)?.id ?? null)?.id,
      first[0]?.id,
    );
  });

  it("keeps the work simulation visibly nonofficial and non-economic", () => {
    const organism = loadBundledGallery()[0]!;
    let preview = createLocalWorkPreview({
      organismId: organism.id,
      organismRappid: organism.previewFrame.subjectRappid,
      category: "research",
      requestedUtc: "2026-08-31T18:45:00.000Z",
    });
    assert.equal(
      workPreviewStatus(preview).label,
      "WORKFLOW PREVIEW · REQUEST SCREEN",
    );
    preview = advanceLocalWorkPreview(preview);
    assert.equal(preview.phase, "status_walkthrough");
    preview = advanceLocalWorkPreview(preview);
    assert.equal(preview.phase, "proof_walkthrough");
    preview = advanceLocalWorkPreview(preview);
    assert.equal(preview.phase, "delivery_walkthrough");
    assert.equal(preview.officialJobId, null);
    assert.equal(preview.economicsApplied, false);
    assert.equal(preview.tippingAvailable, false);
    assert.equal(preview.publicPublicationAvailable, false);
    assert.equal(preview.companionStateChanged, false);
    assert.doesNotThrow(() => assertLocalWorkPreview(preview));

    const invalidPhase = { ...preview };
    Reflect.set(invalidPhase, "phase", "requested");
    assert.throws(() => assertLocalWorkPreview(invalidPhase));
  });
});
