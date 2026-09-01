import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const appPath = resolve(process.argv[2] ?? "");

assert.ok(process.argv[2], "usage: testflight-artifact-gate.mjs <HoloZoo.app>");
assert.ok(appPath.endsWith(".app"), "artifact must be an extracted .app bundle");

const plist = `${appPath}/Info.plist`;
const bundle = `${appPath}/main.jsbundle`;
const profile = `${appPath}/embedded.mobileprovision`;
for (const path of [plist, bundle, profile]) {
  assert.ok(existsSync(path), `TestFlight artifact is missing ${path}`);
}

const plutil = (key, format = "raw") =>
  execFileSync(
    "plutil",
    ["-extract", key, format, "-o", "-", plist],
    { encoding: "utf8" },
  ).trim();

assert.equal(plutil("CFBundleIdentifier"), "com.rapterbox.holozoo");
assert.equal(plutil("DTPlatformName"), "iphoneos");
const platforms = JSON.parse(
  plutil("CFBundleSupportedPlatforms", "json"),
);
assert.deepEqual(platforms, ["iPhoneOS"]);

execFileSync("codesign", ["--verify", "--deep", "--strict", appPath]);
const signature = spawnSync(
  "codesign",
  ["-dv", "--verbose=4", appPath],
  { encoding: "utf8" },
);
assert.equal(signature.status, 0, signature.stderr || signature.stdout);
const signatureText = `${signature.stdout}\n${signature.stderr}`;
assert.match(signatureText, /TeamIdentifier=(?!not set)\S+/);
assert.match(
  signatureText,
  /Authority=(?:Apple Distribution|iPhone Distribution):/,
);

const entitlements = spawnSync(
  "codesign",
  ["-d", "--entitlements", ":-", appPath],
  { encoding: "utf8" },
);
assert.equal(entitlements.status, 0, entitlements.stderr || entitlements.stdout);
const entitlementText = `${entitlements.stdout}\n${entitlements.stderr}`;
assert.match(entitlementText, /application-identifier/);
assert.match(entitlementText, /com\.apple\.developer\.team-identifier/);

execFileSync(
  process.execPath,
  [
    `${HERE}release-gate.mjs`,
    "--native-bundle",
    bundle,
  ],
  { stdio: "inherit" },
);

console.log("PASS signed iPhoneOS TestFlight artifact gate");
