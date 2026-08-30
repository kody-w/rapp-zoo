import { createHash, webcrypto } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const imageDirectory = fileURLToPath(new URL("../assets/images/", import.meta.url));
const master = Object.freeze({
  shape: "shapee",
  seed: "005db34e1c471e94ac4c2b286efb46a9aa328ec7fcd2b9762fa20cc961eef3f7",
  width: 2400,
  height: 1800,
  depth: 180,
  teeth: 16,
  relief: 420,
});

function roundDiv(numerator, denominator) {
  const absolute = Math.abs(numerator);
  let quotient = Math.trunc(absolute / denominator);
  if (2 * (absolute % denominator) >= denominator) quotient += 1;
  return numerator < 0 ? -quotient : quotient;
}

// Exact fallback for the shared RappHoloProtocol.shapeeOutline contract.
function pinnedShapeeOutline(item) {
  const left = -Math.trunc(item.width / 2);
  const bottom = -Math.trunc(item.height / 2);
  const top = bottom + item.height;
  const boundaries = [];
  for (let index = 0; index <= item.teeth; index += 1) {
    boundaries.push(left + roundDiv(index * item.width, item.teeth));
  }
  const points = [];
  const append = (point) => {
    const previous = points.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) {
      points.push(point);
    }
  };
  for (let index = 0; index < item.teeth; index += 1) {
    const nibble = Number.parseInt(item.seed[item.teeth + index], 16);
    const y = bottom - roundDiv(item.relief * nibble, 15);
    append([boundaries[index], y]);
    append([boundaries[index + 1], y]);
  }
  for (let index = item.teeth - 1; index >= 0; index -= 1) {
    const nibble = Number.parseInt(item.seed[index], 16);
    const y = top + roundDiv(item.relief * nibble, 15);
    append([boundaries[index + 1], y]);
    append([boundaries[index], y]);
  }
  append([...points[0]]);
  return points;
}

function sharedShapeeOutline() {
  const candidates = [
    new URL("../assets/holo/holo-protocol.js", import.meta.url),
    new URL("../../static/holo-protocol.js", import.meta.url),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (!existsSync(path)) continue;
    const context = {
      TextDecoder,
      TextEncoder,
      URL,
      console,
      crypto: webcrypto,
      structuredClone,
    };
    context.globalThis = context;
    vm.runInNewContext(readFileSync(path, "utf8"), context, {
      filename: path,
    });
    const helper = context.RappHoloProtocol?.shapeeOutline;
    if (typeof helper === "function") return helper;
  }
  return null;
}

function normalizedOutline() {
  const helper = sharedShapeeOutline();
  const points = (helper ?? pinnedShapeeOutline)({ ...master }).map((point) => [
    Number(point[0]),
    Number(point[1]),
  ]);
  if (
    points.length < 5 ||
    points.some(
      (point) =>
        point.length !== 2 ||
        !Number.isSafeInteger(point[0]) ||
        !Number.isSafeInteger(point[1]),
    ) ||
    points[0][0] !== points.at(-1)[0] ||
    points[0][1] !== points.at(-1)[1]
  ) {
    throw new Error("The shared SHAPEE helper returned an invalid outline.");
  }
  return { points, source: helper ? "shared-helper" : "pinned-helper-parity" };
}

function pathData(points, offsetX = 0, offsetY = 0) {
  return points
    .map(([x, y], index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${x + offsetX} ${-y + offsetY}`;
    })
    .join(" ")
    .concat(" Z");
}

function sideFaces(points) {
  const offset = master.depth / 2;
  return points
    .slice(0, -1)
    .map((point, index) => {
      const next = points[index + 1];
      const face = [point, next, [next[0] + offset, next[1] - offset], [
        point[0] + offset,
        point[1] - offset,
      ]];
      const fill = index % 2 === 0 ? "#123A4A" : "#0C2A3A";
      return `<path d="${pathData(face)}" fill="${fill}"/>`;
    })
    .join("");
}

function svgDocument(points, transparent) {
  const backOffset = master.depth / 2;
  const background = transparent
    ? ""
    : `<rect x="-1700" y="-1700" width="3400" height="3400" fill="url(#bg)"/>
  <path d="M-1500 1120 L-820 1500 L1500 620 L1500 920 L-820 1700 L-1500 1320 Z" fill="#0A2033"/>`;
  const viewBox = transparent ? "-2200 -2200 4400 4400" : "-1700 -1700 3400 3400";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="title description">
  <title id="title">Rolling Cores master SHAPEE sigil</title>
  <desc id="description">A deterministic toothed geometric Rolling Core, rendered without circular or egg-shaped motifs.</desc>
  <metadata>${JSON.stringify(master)}</metadata>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#07111F"/>
      <stop offset="1" stop-color="#02070D"/>
    </linearGradient>
    <linearGradient id="face" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#74F7D4"/>
      <stop offset="0.55" stop-color="#27D4C5"/>
      <stop offset="1" stop-color="#36A7FF"/>
    </linearGradient>
  </defs>
${background}
  <path d="${pathData(points, backOffset, backOffset)}" fill="#0B2636"/>
  ${sideFaces(points)}
  <path d="${pathData(points)}" fill="url(#face)" stroke="#C9FFF2" stroke-width="36" stroke-linejoin="bevel"/>
  <path d="M-720 420 L-120 -220 L640 260 M-520 650 L40 70 L560 390" fill="none" stroke="#07111F" stroke-width="92" stroke-linecap="square" stroke-linejoin="bevel" opacity="0.88"/>
</svg>
`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rasterize(source, output, size) {
  const result = spawnSync(
    process.env.RSVG_CONVERT ?? "rsvg-convert",
    ["-w", String(size), "-h", String(size), "-o", output, source],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `rsvg-convert failed for ${output}: ${result.stderr || result.error}`,
    );
  }
}

function pngDimensions(bytes) {
  if (bytes.subarray(1, 4).toString("ascii") !== "PNG") return null;
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function generate() {
  mkdirSync(imageDirectory, { recursive: true });
  const { points, source } = normalizedOutline();
  const sigil = svgDocument(points, false);
  const mark = svgDocument(points, true);
  const sigilPath = `${imageDirectory}/master-shapee-sigil.svg`;
  const markPath = `${imageDirectory}/master-shapee-mark.svg`;
  writeFileSync(sigilPath, sigil);
  writeFileSync(markPath, mark);
  rasterize(sigilPath, `${imageDirectory}/icon.png`, 1024);
  rasterize(markPath, `${imageDirectory}/adaptive-foreground.png`, 1024);
  rasterize(markPath, `${imageDirectory}/splash.png`, 1024);
  rasterize(sigilPath, `${imageDirectory}/favicon.png`, 64);
  const assets = [
    "icon.png",
    "adaptive-foreground.png",
    "splash.png",
    "favicon.png",
  ];
  const manifest = {
    schema: "rapterbox-shapee-sigil/1",
    source,
    geometry: master,
    outline_sha256: sha256(JSON.stringify(points)),
    assets: Object.fromEntries(
      assets.map((name) => [
        name,
        sha256(readFileSync(`${imageDirectory}/${name}`)),
      ]),
    ),
  };
  writeFileSync(
    `${imageDirectory}/master-shapee.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function check() {
  const { points, source } = normalizedOutline();
  const expectedSigil = svgDocument(points, false);
  const expectedMark = svgDocument(points, true);
  const sigil = readFileSync(`${imageDirectory}/master-shapee-sigil.svg`, "utf8");
  const mark = readFileSync(`${imageDirectory}/master-shapee-mark.svg`, "utf8");
  if (sigil !== expectedSigil || mark !== expectedMark) {
    throw new Error("Checked-in SHAPEE vectors are stale.");
  }
  if (/<(?:circle|ellipse)\b/i.test(`${sigil}${mark}`)) {
    throw new Error("SHAPEE sigil must not use egg or ball primitives.");
  }
  const manifest = JSON.parse(
    readFileSync(`${imageDirectory}/master-shapee.json`, "utf8"),
  );
  if (
    JSON.stringify(manifest.geometry) !== JSON.stringify(master) ||
    manifest.source !== source ||
    manifest.outline_sha256 !== sha256(JSON.stringify(points))
  ) {
    throw new Error("SHAPEE sigil manifest does not match the master geometry.");
  }
  for (const [name, expectedHash] of Object.entries(manifest.assets)) {
    const bytes = readFileSync(`${imageDirectory}/${name}`);
    const dimensions = pngDimensions(bytes);
    const expectedSize = name === "favicon.png" ? 64 : 1024;
    if (
      dimensions?.[0] !== expectedSize ||
      dimensions?.[1] !== expectedSize ||
      sha256(bytes) !== expectedHash
    ) {
      throw new Error(`${name} does not match the SHAPEE asset manifest.`);
    }
  }
}

if (process.argv.includes("--check")) check();
else generate();
