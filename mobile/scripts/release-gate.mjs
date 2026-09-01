import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);

const read = (relative) =>
  readFileSync(new URL(relative, ROOT), "utf8");

const readJson = (relative) => JSON.parse(read(relative));

const PRIVATE_TERM_FINGERPRINTS = [
  [11, 0xcb5a47a4, "f140388eca53eed2b74e65e5df5b87fcb7dcf701ba24d971a0a7bc46a020e022"],
  [19, 0xbd8b6be2, "520d977b4b519faf24e75f3a27e17eeedca63e254aeee74e141deccf222b2e51"],
  [11, 0xd6ae2d91, "4ef194929467c6b3021f3cb079c41710a21d970cd863b1fc35e9e7048829755d"],
  [8, 0x7bd1f46e, "bb888695d1c398b062b58f9b9043e52c4219ab733d6f51e8ea08cee99704f1be"],
  [12, 0x3941b9e3, "e7d20694029efd12783fe2029dce63be9901e9607af5cbfe66232f1937e66365"],
  [6, 0xea112677, "7d797f86e45fe05da55a4ae95bb0338e2cabaac502c0d2133f58650e8e3d373e"],
  [14, 0xcb6591eb, "aa8cb11daff42a158805d65828fbff7c85b37e77333e0264d0e7702b791178ef"],
  [13, 0xee61684b, "f2d27baed24f28fa262f53506e42ffd31da2c6a857ae582e43bb60d7a182a9c3"],
  [13, 0xc2d64588, "acc707a95009a8d852b3cedc279cb952da39b107cb006f006a32915b9cccb31f"],
  [15, 0xe02ccf45, "8fc8b91cf3d96dce03db936aea92122c901cb393abda4e91d691ec44f1c3e576"],
  [9, 0xa8cb65de, "e1c8ace3f16043ae9fd51ba4f4660fc1af348ed71b4b733b2c06c4a2268ab3b9"],
  [13, 0x5dc7a494, "4763a7432ddf975781cb29b83a124bb8fd3d06998d4dd8e8ce344e7c35eb20ac"],
  [23, 0xefc02da2, "2632f006c5ca4d228d564c69a0e9903ba54dcbd2fba6c769a85f21f01093257b"],
  [22, 0x271b889d, "e4d4efe276046c34044260a7b00b85a29a37b2c7baa87800a5edad587709f5c0"],
  [14, 0xa468daef, "884c0b397dda76bb63d2aa9a4ffea631fcf43d14a6f189f87c3699bd3cafc59e"],
  [11, 0xa57592c7, "e6624df7b21c9a5f636dcd34af04bcce7a8caf6184e41ac47e5946331b2f0666"],
  [17, 0xc8b33644, "d34d020c0a5d14f6012d4af628441302f21f72c82af0e88d1ac2233b0488924b"],
  [22, 0xd6fe8a3e, "3f980333f7b05aed47e802b9a2e21ae8b142216f4957c549d0412e30fd91cfbe"],
];

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

const fingerprintCache = new Map();

function canonicalPrivateText(value) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function containsPrivateFingerprint(value) {
  if (fingerprintCache.has(value)) return fingerprintCache.get(value);
  const normalized = canonicalPrivateText(value);
  const base = 257;
  const prefix = new Uint32Array(normalized.length + 1);
  const powers = new Uint32Array(
    Math.max(...PRIVATE_TERM_FINGERPRINTS.map(([length]) => length)) + 1,
  );
  powers[0] = 1;
  for (let index = 0; index < normalized.length; index += 1) {
    prefix[index + 1] =
      (Math.imul(prefix[index], base) + normalized.charCodeAt(index)) >>> 0;
  }
  for (let index = 1; index < powers.length; index += 1) {
    powers[index] = Math.imul(powers[index - 1], base) >>> 0;
  }
  const found = PRIVATE_TERM_FINGERPRINTS.some(
    ([length, rollingFingerprint, fingerprint]) => {
      for (let index = 0; index <= normalized.length - length; index += 1) {
        const rolling =
          (prefix[index + length] -
            Math.imul(prefix[index], powers[length])) >>>
          0;
        if (
          rolling === rollingFingerprint &&
          sha256(normalized.slice(index, index + length)) === fingerprint
        ) {
          return true;
        }
      }
      return false;
    },
  );
  fingerprintCache.set(value, found);
  return found;
}

function containsNonAsciiLetterOrNumber(value) {
  return [...value].some(
    (character) =>
      character.codePointAt(0) > 0x7f &&
      /[\p{L}\p{N}]/u.test(character),
  );
}

function readTextTree(directory, excludedDirectories = new Set(["generated"])) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = new URL(
        `${entry.name}${entry.isDirectory() ? "/" : ""}`,
        directory,
      );
      if (entry.isDirectory()) {
        if (excludedDirectories.has(entry.name)) return [];
        return readTextTree(path, excludedDirectories);
      }
      return /\.(?:cjs|css|html|js|json|md|mjs|py|sh|toml|ts|tsx|txt|xml|ya?ml)$/.test(
        entry.name,
      )
        ? [readFileSync(path, "utf8")]
        : [];
    })
    .join("\n");
}

export function evaluateRelease(inputs) {
  const failures = [];
  const require = (condition, message) => {
    if (!condition) failures.push(message);
  };
  const { app, eas, packageJson, sources } = inputs;

  require(app.owner === "wildfeuer05", "Expo owner must be wildfeuer05");
  require(
    app.extra?.eas?.projectId ===
      "782a464a-a0d8-40e9-93e3-0cec01874101",
    "EAS project ID is not the Holo Zoo project",
  );
  require(app.ios?.buildNumber === "1", "iOS build number must begin at 1");
  require(app.android?.versionCode === 1, "Android version code must begin at 1");
  require(app.updates?.enabled === false, "OTA updates must be disabled");
  require(
    app.extra?.releasePolicy?.audience === "adult-internal-testers",
    "release audience must remain adult internal testers",
  );
  require(
    app.extra?.releasePolicy?.realCommerceEnabled === false,
    "real commerce must remain disabled",
  );
  require(
    app.extra?.releasePolicy?.productionRapterWorksEnabled === false,
    "production RapterWorks must remain disabled",
  );
  require(
    app.extra?.releasePolicy?.coinEconomicsEnabled === false,
    "Coin economics must remain disabled",
  );
  require(
    app.extra?.releasePolicy?.externalInteroperabilityEnabled === false &&
      app.extra?.releasePolicy?.irreversibleProtocolWritesEnabled === false &&
      app.extra?.releasePolicy?.currentRappMigrationRequired === true,
    "stale RAPP authority is not contained to internal read-only use",
  );
  require(eas.cli?.version === "22.3.0", "EAS CLI must be pinned");
  require(
    eas.cli?.appVersionSource === "remote",
    "EAS build versions must use the remote monotonic source",
  );
  require(
    eas.build?.production?.autoIncrement === true,
    "production build numbers must auto-increment",
  );
  require(
    [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.VIBRATE",
    ].every((permission) =>
      app.android?.blockedPermissions?.includes(permission),
    ),
    "unneeded Android permissions must be blocked",
  );
  require(
    packageJson.dependencies?.["expo-location"] === undefined &&
      packageJson.dependencies?.["react-native-maps"] === undefined,
    "the initial Field must remain permissionless and map-provider-free",
  );
  require(
    sources.billing.includes(
      "HOLO_ZOO_RELEASE_POLICY.realCommerceEnabled",
    ),
    "native billing is not bound to the release freeze",
  );
  require(
    sources.releasePolicy.includes(
      'channel: "internal-testflight"',
    ) &&
      sources.releasePolicy.includes("realCommerceEnabled: false") &&
      sources.releasePolicy.includes(
        "externalInteroperabilityEnabled: false",
      ),
    "tracked runtime release policy is missing or enables a frozen surface",
  );
  require(
    sources.store.includes(".rollingcore") &&
      !sources.store.includes(".rollingcore.json"),
    "capsule export extension is not the registered .rollingcore type",
  );
  require(
    sources.transfer.includes("MAX_IMPORT_BYTES = 16 * 1024 * 1024") &&
      sources.transfer.includes("deleteAsync(asset.uri") &&
      sources.transfer.includes("deleteAsync(url"),
    "native import limits or cache cleanup are missing",
  );
  require(
    sources.webStage.includes(
      "event.source !== iframe.current?.contentWindow",
    ),
    "web player messages are not bound to the stage iframe",
  );
  require(
    sources.api.includes("responseOrigin !== requestedOrigin") &&
      sources.api.includes("cross-origin redirect"),
    "native API redirect origin is not verified",
  );
  require(
    !/billing|purchase|redeem|priceSats|tip|sponsor|coin/i.test(
      sources.companion,
    ),
    "Companion component contains commerce language or imports",
  );
  require(
    sources.work.includes(
      "WORK MODE · UI WALKTHROUGH ONLY",
    ) &&
      sources.work.includes("Draft local work preview") &&
      sources.work.includes("official RapterWorks job") &&
      sources.work.includes("It creates no"),
    "work walkthrough can be mistaken for an official service",
  );
  require(
    !containsPrivateFingerprint(sources.publicSurface),
    "public release contains private product terms",
  );
  require(
    !containsNonAsciiLetterOrNumber(sources.runtimeSurface),
    "public release contains non-ASCII identifier-like text",
  );
  require(
    ![
      "Lifecycle Marketplace",
      "Get Rapter Credit",
      "Redeem 1 Credit",
      "Official Rapterbox birth value",
      "Current seller ask",
      "Credits →",
    ].some((phrase) => sources.sidebar.includes(phrase)) &&
      !/LifecyclePanel|fetchCurrentBtcQuote/.test(sources.inspector) &&
      !/LifecycleProvider|Wild Credits/.test(sources.layout) &&
      !/View Wild Credits|router\.push\("\/upgrade"\)/.test(
        sources.fantasy,
      ) &&
      !/Wild plan|Play Growl · Wild|Export · Wild/.test(sources.stage),
    "commerce or resale UI remains reachable",
  );
  require(
    sources.lifecycle.includes(
      "HOLO_ZOO_RELEASE_POLICY.realCommerceEnabled",
    ) &&
      sources.store.includes("Capsule redemption is disabled") &&
      sources.store.includes("Account recovery is disabled") &&
      sources.store.includes("Registry refresh is disabled") &&
      sources.inspector.includes("redactInspectionRecord") &&
      sources.inspector.includes(
        "HOLO_ZOO_RELEASE_POLICY.externalInteroperabilityEnabled",
      ),
    "commerce service paths are not bound to the release policy",
  );
  require(
    sources.provider.includes("Bounded local updates") &&
      sources.provider.includes("Managed processing unavailable") &&
      !/Test Breath Key|Start Bounded Breathing|Paid Wild mode/.test(
        sources.provider,
      ),
    "provider commerce uses prohibited vitality language",
  );
  require(
    sources.upgrade.includes("Commerce is disabled") &&
      sources.upgrade.includes(
        "HOLO_ZOO_RELEASE_POLICY.realCommerceEnabled",
      ),
    "internal TestFlight upgrade surface is not frozen",
  );
  return failures;
}

function currentInputs() {
  return {
    app: readJson("app.json").expo,
    eas: readJson("eas.json"),
    packageJson: readJson("package.json"),
    sources: {
      billing: read("src/billing/billing-adapter.native.ts"),
      releasePolicy: read("src/release-policy.ts"),
      api: read("src/lib/api.ts"),
      companion: read("src/components/companion-field.tsx"),
      store: read("src/state/holo-store.tsx"),
      transfer: read("src/lib/file-transfer.native.ts"),
      provider: read("src/components/provider-settings.tsx"),
      upgrade: read("src/app/upgrade.tsx"),
      webStage: read("src/components/holo-stage.web.tsx"),
      work: read("src/components/work-preview-panel.tsx"),
      sidebar: read("src/components/sidebar.tsx"),
      inspector: read("src/components/inspector-panel.tsx"),
      layout: read("src/app/_layout.tsx"),
      fantasy: read("src/app/fantasy.tsx"),
      stage: read("src/components/stage-panel.tsx"),
      lifecycle: read("src/capsules/lifecycle-context.tsx"),
      publicSurface: [
        readTextTree(
          new URL("../", ROOT),
          new Set([
            ".derived-data-release",
            ".expo",
            ".git",
            "__pycache__",
            "android",
            "dist",
            "ios",
            "node_modules",
            "release",
          ]),
        ),
      ].join("\n"),
      runtimeSurface: readTextTree(
        new URL("src/", ROOT),
        new Set(["generated", "__tests__"]),
      ),
    },
  };
}

function runGate() {
  const failures = evaluateRelease(currentInputs());
  for (const failure of failures) console.error(`FAIL ${failure}`);
  if (failures.length) process.exit(1);
  console.log("PASS Holo Zoo internal TestFlight release gate");
}

function runMutationSelfTest() {
  const baseline = currentInputs();
  assert.deepEqual(evaluateRelease(baseline), []);

  const commerce = structuredClone(baseline);
  commerce.app.extra.releasePolicy.realCommerceEnabled = true;
  assert.ok(
    evaluateRelease(commerce).some((item) =>
      item.includes("real commerce"),
    ),
  );

  const ota = structuredClone(baseline);
  ota.app.updates.enabled = true;
  assert.ok(
    evaluateRelease(ota).some((item) => item.includes("OTA updates")),
  );

  const extension = structuredClone(baseline);
  extension.sources.store = extension.sources.store.replace(
    ".rollingcore",
    ".rollingcore.json",
  );
  assert.ok(
    evaluateRelease(extension).some((item) =>
      item.includes("capsule export extension"),
    ),
  );

  const companion = structuredClone(baseline);
  companion.sources.companion += "\nconst purchase = true;\n";
  assert.ok(
    evaluateRelease(companion).some((item) =>
      item.includes("Companion component"),
    ),
  );

  const policy = structuredClone(baseline);
  policy.sources.releasePolicy = policy.sources.releasePolicy.replace(
    "realCommerceEnabled: false",
    "realCommerceEnabled: true",
  );
  assert.ok(
    evaluateRelease(policy).some((item) =>
      item.includes("tracked runtime release policy"),
    ),
  );

  const sentinel = String.fromCharCode(
    112, 114, 105, 118, 97, 116, 101, 45, 114, 101, 108, 101, 97, 115, 101,
    45, 115, 101, 110, 116, 105, 110, 101, 108,
  );
  const variants = [
    sentinel,
    sentinel.replaceAll("-", " "),
    sentinel.replaceAll("-", "_"),
    sentinel.replaceAll("-", "\u2013"),
    sentinel.replaceAll("-", "\u200d"),
    sentinel.replace("a", "a\u0301"),
  ];
  for (const variant of variants.slice(1)) {
    assert.equal(
      canonicalPrivateText(variant),
      canonicalPrivateText(variants[0]),
    );
  }
  const privateTerm = structuredClone(baseline);
  privateTerm.sources.publicSurface += `\n${variants.at(-1)}\n`;
  assert.ok(
    evaluateRelease(privateTerm).some((item) =>
      item.includes("private product terms"),
    ),
  );
  const confusable = structuredClone(baseline);
  confusable.sources.runtimeSurface += "\nprіvate-release-sentinel\n";
  assert.ok(
    evaluateRelease(confusable).some((item) =>
      item.includes("non-ASCII identifier-like text"),
    ),
  );

  const commerceUi = structuredClone(baseline);
  commerceUi.sources.sidebar += "\nGet Rapter Credit\n";
  assert.ok(
    evaluateRelease(commerceUi).some((item) =>
      item.includes("commerce or resale UI"),
    ),
  );

  const registry = structuredClone(baseline);
  registry.sources.store = registry.sources.store.replaceAll(
    "Registry refresh is disabled",
    "Registry refresh is enabled",
  );
  assert.ok(
    evaluateRelease(registry).some((item) =>
      item.includes("commerce service paths"),
    ),
  );

  console.log("PASS release gate mutation self-test");
}

function exportedJavaScript(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) return exportedJavaScript(path);
      return entry.name.endsWith(".js") ? [readFileSync(path, "utf8")] : [];
    })
    .join("\n");
}

const DISABLED_ARTIFACT_UI = [
  "Lifecycle Marketplace",
  "Get Rapter Credit",
  "Redeem 1 Credit",
  "Request 30-Day Return",
  "List Through Signed Registry",
  "Verify Sale & Transfer",
  "Current seller ask",
  "LIVE CONVERSION · NON-AUTHORITATIVE",
  "Refresh Official Registry",
  "View Wild Credits",
  "Wild plan",
  "Play Growl · Wild",
  "Export · Wild",
  "Inspect Holo JSON",
  "Inspect source JSON",
  "Only this non-secret host URL",
  "Uniqueness proof",
  "Mint channel",
];

function assertReleaseArtifact(bundle, label) {
  assert.equal(
    containsPrivateFingerprint(bundle),
    false,
    `${label} contains a private product fingerprint`,
  );
  for (const phrase of DISABLED_ARTIFACT_UI) {
    assert.equal(
      bundle.includes(phrase),
      false,
      `${label} contains disabled UI: ${phrase}`,
    );
  }
}

function runExportedGate() {
  const bundle = exportedJavaScript(new URL("dist/", ROOT));
  assertReleaseArtifact(bundle, "exported bundle");
  console.log("PASS exported Holo Zoo commerce-surface gate");
}

function runNativeBundleGate(path) {
  const bundle = readFileSync(path, "utf8");
  assertReleaseArtifact(bundle, "native bundle");
  console.log("PASS native Holo Zoo release-bundle gate");
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--self-test")) runMutationSelfTest();
  else if (process.argv.includes("--exported")) runExportedGate();
  else if (process.argv.includes("--native-bundle")) {
    const path = process.argv[process.argv.indexOf("--native-bundle") + 1];
    assert.ok(path, "--native-bundle requires a path");
    runNativeBundleGate(path);
  }
  else runGate();
}
