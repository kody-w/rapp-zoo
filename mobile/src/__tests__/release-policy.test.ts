import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  HOLO_ZOO_RELEASE_POLICY,
  assertReleasePolicy,
} from "@/release-policy";

describe("internal TestFlight release policy", () => {
  it("fails every unfinished economic and executable surface closed", () => {
    assert.doesNotThrow(assertReleasePolicy);
    assert.equal(HOLO_ZOO_RELEASE_POLICY.realCommerceEnabled, false);
    assert.equal(HOLO_ZOO_RELEASE_POLICY.productionRapterWorksEnabled, false);
    assert.equal(HOLO_ZOO_RELEASE_POLICY.tipsEnabled, false);
    assert.equal(HOLO_ZOO_RELEASE_POLICY.sponsorshipEnabled, false);
    assert.equal(HOLO_ZOO_RELEASE_POLICY.rentalsEnabled, false);
    assert.equal(HOLO_ZOO_RELEASE_POLICY.resaleEnabled, false);
    assert.equal(HOLO_ZOO_RELEASE_POLICY.managedComputeSalesEnabled, false);
    assert.equal(HOLO_ZOO_RELEASE_POLICY.coinEconomicsEnabled, false);
    assert.equal(
      HOLO_ZOO_RELEASE_POLICY.externalInteroperabilityEnabled,
      false,
    );
    assert.equal(
      HOLO_ZOO_RELEASE_POLICY.irreversibleProtocolWritesEnabled,
      false,
    );
    assert.equal(
      HOLO_ZOO_RELEASE_POLICY.currentRappMigrationRequired,
      true,
    );
  });

  it("pins internal audience, native versions, EAS identity, and OTA posture", () => {
    const app = JSON.parse(
      readFileSync(new URL("../../app.json", import.meta.url), "utf8"),
    ).expo;
    const eas = JSON.parse(
      readFileSync(new URL("../../eas.json", import.meta.url), "utf8"),
    );
    assert.equal(app.owner, "wildfeuer05");
    assert.equal(
      app.extra.eas.projectId,
      "782a464a-a0d8-40e9-93e3-0cec01874101",
    );
    assert.equal(app.ios.buildNumber, "1");
    assert.equal(app.android.versionCode, 1);
    assert.equal(app.updates.enabled, false);
    assert.equal(app.extra.releasePolicy.realCommerceEnabled, false);
    assert.equal(
      app.extra.releasePolicy.externalInteroperabilityEnabled,
      false,
    );
    assert.equal(eas.cli.version, "22.3.0");
    assert.equal(eas.cli.appVersionSource, "remote");
    assert.equal(eas.build.production.autoIncrement, true);
    assert.deepEqual(app.android.blockedPermissions, [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.VIBRATE",
    ]);
  });

  it("prevents native RevenueCat activation even when a key is present", () => {
    const source = readFileSync(
      new URL("../billing/billing-adapter.native.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /HOLO_ZOO_RELEASE_POLICY\.realCommerceEnabled/);
    assert.match(source, /createReleaseDisabledAdapter/);
  });
});
