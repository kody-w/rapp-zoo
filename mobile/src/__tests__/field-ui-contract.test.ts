import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

describe("Holo Field UI contract", () => {
  it("keeps Companion mode free of commerce imports and actions", () => {
    const source = read("components/companion-field.tsx");
    assert.doesNotMatch(
      source,
      /billing|purchase|redeem|priceSats|tip|sponsor|coin/i,
    );
    assert.match(source, /COMPANION MODE · NO COMMERCE/);
    assert.match(source, /Meet on Holo Stage/);
  });

  it("keeps the work experience explicitly local and nonofficial", () => {
    const source = read("components/work-preview-panel.tsx");
    assert.match(source, /WORK MODE · UI WALKTHROUGH ONLY/);
    assert.match(source, /creates no\s+official RapterWorks job/);
    assert.match(source, /No job, work, proof, artifact, delivery/);
    assert.doesNotMatch(source, /useBilling|purchasePackage|Shopify/);
  });

  it("uses an offline radar with no location or map-provider dependency", () => {
    const panel = read("components/field-panel.tsx");
    const radar = read("components/field-radar.tsx");
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    assert.match(panel, /no GPS, map provider, or uploaded/);
    assert.match(radar, /LOCAL RADAR · NO LOCATION/);
    assert.equal(packageJson.dependencies["expo-location"], undefined);
    assert.equal(packageJson.dependencies["react-native-maps"], undefined);
    assert.doesNotMatch(panel + radar, /geolocation|MapView|latitude|longitude/);
  });

  it("makes Field the default while keeping Habitat available", () => {
    const source = read("components/main-screen.tsx");
    assert.match(source, /useState<PhonePane>\("field"\)/);
    assert.match(source, /useState<WideMode>\("field"\)/);
    assert.match(source, /"field", "library", "stage", "inspect"/);
    assert.match(source, /"field", "companion", "habitat"/);
    assert.match(source, /width >= 1180/);
    assert.match(source, /selectWideMode\("companion"\)/);
    assert.match(source, /selectPhonePane\("stage"\)/);
    assert.match(source, /<StagePanel reducedMotion=/);
    assert.doesNotMatch(source, /stageCommerce|commerce=/);
    assert.doesNotMatch(source, /useBilling|REVENUECAT KEY MISSING/);
  });
});
