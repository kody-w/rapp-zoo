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
  const body = functionBody("openHologram");
  assert.match(
    body,
    /if \(!\$\('hologram-dialog'\)\.open\) \$\('hologram-dialog'\)\.showModal\(\);/,
  );

  const generationStart = source.indexOf(
    "const result = await desktopBridge.generateHologram",
  );
  const transitionStart = source.indexOf("await loadHolograms();", generationStart);
  const caughtTransition = source.slice(
    transitionStart,
    source.indexOf("toast(`Caught", transitionStart),
  );
  assert.doesNotMatch(caughtTransition, /hologram-dialog'\)\.close\(\)/);
  assert.match(caughtTransition, /openHologram\(result\.hologram\.id\)/);
});

test("polishing and caught states survive iframe bound messages", () => {
  assert.match(source, /hologramPolishing[\s\S]*matched \$\{activeHologram\.name\} · polishing/);
  assert.match(source, /justCaughtHologramId === activeHologram\.id[\s\S]*new bottle caught/);
});

test("remote mobile viewers use an opaque same-host hologram sandbox", () => {
  const body = functionBody("openHologram");
  assert.match(body, /loopback \? 'allow-scripts allow-same-origin' : 'allow-scripts'/);
  assert.match(body, /: location\.origin/);
  assert.doesNotMatch(body, /allow-downloads/);
});
