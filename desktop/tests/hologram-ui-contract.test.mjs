import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.resolve(here, "../../static/zoo.js"),
  "utf8",
).replace(/\r\n/g, "\n");
const indexSource = fs.readFileSync(
  path.resolve(here, "../../static/index.html"),
  "utf8",
);
const styleSource = fs.readFileSync(
  path.resolve(here, "../../static/zoo.css"),
  "utf8",
);

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, index);
    }
  }
  assert.fail(`could not find the end of ${name}`);
}

test("switching an open hologram never closes the modal first", () => {
  const body = functionBody("prepareHologramFrame");
  assert.match(
    body,
    /if \(!\$\('hologram-dialog'\)\.open\) \$\('hologram-dialog'\)\.showModal\(\);/,
  );
  assert.match(functionBody("openLegacyHologram"), /prepareHologramFrame/);
  assert.match(functionBody("openHoloFrame"), /prepareHologramFrame/);
  assert.doesNotMatch(functionBody("openHoloFrame"), /hologram-dialog'\)\.close/);
});

test("Holo Zoo exposes current heads and immutable flipbooks without generation", () => {
  assert.match(source, /api\('\/api\/holo\/heads'\)/);
  assert.match(source, /function openHoloFrame/);
  assert.match(source, /function showHoloHistory/);
  assert.match(source, /current AI holo/);
  assert.match(source, /player held prior holo/);
  assert.doesNotMatch(source, /generateHologram|hologramPolishing|justCaughtHologramId/);
});

test("remote mobile viewers use an opaque same-host hologram sandbox", () => {
  const body = functionBody("prepareHologramFrame");
  assert.match(body, /loopback \? 'allow-scripts allow-same-origin' : 'allow-scripts'/);
  assert.match(body, /: location\.origin/);
  assert.doesNotMatch(body, /allow-downloads/);
});

test("live Holo activation evidence is persisted outside the sandbox", () => {
  assert.match(source, /message\.schema === 'rapp-holo-active\/1'/);
  assert.match(source, /api\('\/api\/holo\/activate'/);
  assert.match(source, /departure_logical_ms/);
  assert.match(source, /departure_manifest_hash/);
});

test("desktop VC docks a Holo-specific Copilot panel without Studio deploy", () => {
  assert.match(source, /function setCopilotPanel/);
  assert.match(source, /document\.body\.classList\.add\('desktop-vc'\)/);
  assert.match(source, /setCopilotPanel\(true\)/);
  assert.match(styleSource, /body\.desktop-vc\.copilot-dock-open/);
  assert.match(indexSource, /HOLO\/1 AGENT MODE/);
  assert.match(indexSource, /Explain the current Holo Wake/);
  assert.match(indexSource, /Emit the next Holo\/1 state/);
  assert.doesNotMatch(indexSource, /Copilot Studio/i);
});
