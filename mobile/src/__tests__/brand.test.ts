import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { brand } from "@/config/brand";

describe("Rapterbox consumer branding", () => {
  it("keeps every consumer URL on rapterbox.com", () => {
    for (const value of [
      brand.marketingUrl,
      brand.privacyUrl,
      brand.supportUrl,
    ]) {
      assert.equal(new URL(value).hostname, "rapterbox.com");
    }
  });

  it("locks the Holo Zoo app and Rolling Cores system hierarchy", () => {
    assert.equal(brand.consumer, "Rapterbox");
    assert.equal(brand.product, "Rolling Cores");
    assert.equal(brand.displayName, "Holo Zoo");
    assert.equal(brand.storeTitle, "Holo Zoo: Rolling Cores");
    assert.equal(brand.tagline, "Everything autocomplete on an organism.");
    assert.equal(
      brand.rapterPositioning,
      "A Rapter is a living digital organism.",
    );
    assert.equal(brand.lockup, "Holo Zoo: Rolling Cores");
  });

  it("defines Rappter only as the collective flock term", () => {
    assert.equal(brand.vocabulary.rapter, "One organism");
    assert.equal(brand.vocabulary.rappter, "A flock of Rapters");
    assert.equal(brand.vocabulary.protocol, "RAPP/1");
    assert.equal(brand.vocabulary.core, "Rolling Core");
    assert.equal(brand.vocabulary.habitat, "Holo Zoo");
  });

  it("locks Expo and store identifiers to Holo Zoo", () => {
    const config = JSON.parse(
      readFileSync(new URL("../../app.json", import.meta.url), "utf8"),
    ).expo;
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    assert.equal(packageJson.name, "rapterbox-holo-zoo");
    assert.equal(config.name, "Holo Zoo");
    assert.equal(config.slug, "holo-zoo");
    assert.equal(config.scheme, "holo-zoo");
    assert.equal(config.ios.bundleIdentifier, "com.rapterbox.holozoo");
    assert.equal(config.android.package, "com.rapterbox.holozoo");
    assert.equal(config.ios.infoPlist.UIBackgroundModes, undefined);
    assert.ok(
      config.ios.infoPlist.CFBundleDocumentTypes[0].LSItemContentTypes.includes(
        "com.rapterbox.rollingcore",
      ),
    );
    assert.equal(
      config.extra.brand.marketingUrl,
      "https://rapterbox.com/holo",
    );
    assert.equal(config.extra.brand.product, "Rolling Cores");
    assert.equal(config.extra.brand.displayName, "Holo Zoo");
    assert.equal(config.extra.brand.storeTitle, "Holo Zoo: Rolling Cores");
    assert.equal(
      config.extra.brand.rapterPositioning,
      "A Rapter is a living digital organism.",
    );
    assert.match(config.extra.brand.holoZooFeature, /Consumer.*library/);
    assert.deepEqual(config.extra.brand.sigil, {
      schema: "shapee",
      seed: "005db34e1c471e94ac4c2b286efb46a9aa328ec7fcd2b9762fa20cc961eef3f7",
      width: 2400,
      height: 1800,
      depth: 180,
      teeth: 16,
      relief: 420,
    });
  });
});
