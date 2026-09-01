import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (relative: string) =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

describe("native release hardening", () => {
  it("exports capsules with the registered type and removes cache copies", () => {
    const store = read("state/holo-store.tsx");
    const transfer = read("lib/file-transfer.native.ts");
    assert.match(store, /\.rollingcore`/);
    assert.doesNotMatch(store, /\.rollingcore\.json/);
    assert.match(transfer, /MAX_IMPORT_BYTES = 16 \* 1024 \* 1024/);
    assert.match(transfer, /const size = info\.size/);
    assert.doesNotMatch(transfer, /knownSize \?\?/);
    assert.match(transfer, /deleteAsync\(asset\.uri/);
    assert.match(transfer, /deleteAsync\(url/);
    assert.match(transfer, /com\.rapterbox\.rollingcore/);
  });

  it("binds web player messages to the exact stage iframe", () => {
    const source = read("components/holo-stage.web.tsx");
    assert.match(
      source,
      /event\.source !== iframe\.current\?\.contentWindow/,
    );
  });

  it("rejects native cross-origin redirects after transport resolution", () => {
    const source = read("lib/api.ts");
    assert.match(source, /response\.url/);
    assert.match(source, /responseOrigin !== requestedOrigin/);
    assert.match(source, /cross-origin redirect/);
  });

  it("rejects authenticated provider redirects before reading responses", () => {
    const source = read("providers/openai-compatible.ts");
    assert.match(source, /redirect: "error"/);
    assert.match(source, /assertFinalResponseOrigin\(requestUrl, response\)/);
    assert.match(
      source,
      /assertFinalResponseOrigin\(`\$\{provider\.endpoint\}\/models`, response\)/,
    );
    assert.match(source, /Provider cross-origin redirect was refused/);
  });

  it("blocks legacy Android storage permissions", () => {
    const app = JSON.parse(
      readFileSync(new URL("../../app.json", import.meta.url), "utf8"),
    ).expo;
    assert.deepEqual(app.android.blockedPermissions, [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.VIBRATE",
    ]);
  });

  it("contains crashes locally without automatic telemetry", () => {
    const boundary = read("components/app-error-boundary.tsx");
    const layout = read("app/_layout.tsx");
    assert.match(boundary, /LOCAL ERROR · NO DATA UPLOADED/);
    assert.match(boundary, /Intentionally no automatic telemetry/);
    assert.match(layout, /<AppErrorBoundary>/);
  });

  it("purges a Keychain key when the app sandbox marks a fresh install", () => {
    const config = read("providers/direct-config.native.ts");
    const context = read("providers/breathing-context.tsx");
    const clearIndex = config.indexOf(
      "SecureStore.deleteItemAsync(API_KEY, SECURE_OPTIONS)",
    );
    const markIndex = config.indexOf(
      "AsyncStorage.setItem(INSTALL_MARKER_KEY, value)",
    );
    assert.match(config, /@rolling-cores\/direct-key-install\/1/);
    assert.match(config, /await initializeDirectProviderStorage\(\)/);
    assert.ok(clearIndex >= 0);
    assert.ok(markIndex > clearIndex);
    assert.match(context, /Provider settings could not be loaded/);
    assert.match(context, /Direct updates remain disabled/);
  });

  it("removes vitality language from disabled commerce surfaces", () => {
    const provider = read("components/provider-settings.tsx");
    const upgrade = read("app/upgrade.tsx");
    assert.match(provider, /Bounded local updates/);
    assert.match(provider, /Managed processing unavailable/);
    assert.doesNotMatch(provider, /Test Breath Key|Start Bounded Breathing/);
    assert.match(upgrade, /Commerce is disabled/);
    assert.match(
      upgrade,
      /HOLO_ZOO_RELEASE_POLICY\.realCommerceEnabled/,
    );
  });

  it("removes reachable valuation, redemption, and resale controls", () => {
    const sidebar = read("components/sidebar.tsx");
    const inspector = read("components/inspector-panel.tsx");
    const layout = read("app/_layout.tsx");
    const lifecycle = read("capsules/lifecycle-context.tsx");
    const store = read("state/holo-store.tsx");
    const fantasy = read("app/fantasy.tsx");
    const stage = read("components/stage-panel.tsx");
    for (const phrase of [
      "Lifecycle Marketplace",
      "Get Rapter Credit",
      "Redeem 1 Credit",
      "Official Rapterbox birth value",
      "Current seller ask",
      "Credits →",
    ]) {
      assert.doesNotMatch(sidebar, new RegExp(phrase));
    }
    assert.doesNotMatch(
      inspector,
      /LifecyclePanel|fetchCurrentBtcQuote|Uniqueness proof|Mint channel/,
    );
    assert.doesNotMatch(layout, /LifecycleProvider|Wild Credits/);
    assert.doesNotMatch(
      fantasy,
      /View Wild Credits|router\.push\("\/upgrade"\)/,
    );
    assert.doesNotMatch(stage, /Wild plan|Play Growl · Wild|Export · Wild/);
    assert.match(inspector, /redactInspectionRecord/);
    assert.doesNotMatch(inspector, /Inspect Holo JSON|Inspect source JSON/);
    assert.match(
      inspector,
      /HOLO_ZOO_RELEASE_POLICY\.externalInteroperabilityEnabled/,
    );
    assert.match(
      lifecycle,
      /HOLO_ZOO_RELEASE_POLICY\.realCommerceEnabled/,
    );
    assert.match(store, /Capsule redemption is disabled/);
    assert.match(store, /Account recovery is disabled/);
    assert.match(store, /Registry refresh is disabled/);
  });

  it("separates simulator proof from signed TestFlight certification", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    const gate = read("../scripts/testflight-artifact-gate.mjs");
    assert.match(packageJson.scripts["gate:simulator-bundle"], /iphonesimulator/);
    assert.doesNotMatch(
      packageJson.scripts["gate:testflight-app"],
      /iphonesimulator/,
    );
    assert.match(gate, /DTPlatformName/);
    assert.match(gate, /iPhoneOS/);
    assert.match(gate, /Apple Distribution/);
    assert.match(gate, /TeamIdentifier/);
    assert.match(gate, /embedded\.mobileprovision/);
    assert.match(gate, /application-identifier/);
  });

  it("clears stale capsule provenance after a Direct successor", () => {
    const store = read("state/holo-store.tsx");
    assert.match(store, /mergeSuccessorLineage/);
    assert.match(store, /setSelectedCapsule\(null\)/);
    assert.match(store, /setSelectedRegistryRecord\(null\)/);
    assert.match(store, /setAvailableFrames\(successorLineage\)/);
  });
});
