import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const runtimeSource = fs.readFileSync(
  path.join(root, "static/hologram-runtime.js"),
  "utf8",
);
const protocolSource = fs.readFileSync(
  path.join(root, "static/holo-protocol.js"),
  "utf8",
);
const viewerSource = fs.readFileSync(
  path.join(root, "holograms/viewer.html"),
  "utf8",
);
const serviceWorkerSource = fs.readFileSync(
  path.join(root, "static/sw.js"),
  "utf8",
);
const blankFixture = JSON.parse(fs.readFileSync(
  path.join(root, "holograms/protocol/examples/minimal-blank-output.json"),
  "utf8",
));

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const SCALE = 1000000;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonical(value[key])}`,
  ).join(",")}}`;
}

function material(
  presentation,
  color,
  blend = "normal",
  metallic = presentation === "solid" ? 250 : 0,
  roughness = presentation === "solid" ? 750 : 1000,
) {
  return {
    color,
    emissive: "#000000",
    emissive_strength: 0,
    opacity: 1000,
    presentation,
    blend,
    side: "double",
    metallic,
    roughness,
  };
}

function transform(position = [0, 0, 0]) {
  return {
    position,
    rotation: [0, 0, 0],
    scale: [1000, 1000, 1000],
  };
}

function output({
  base = null,
  nodes = [],
  transition = null,
  sustain = null,
  description = "Exact authored scene.",
} = {}) {
  return {
    ...plain(blankFixture),
    base_holo_id: base,
    state: {
      ...plain(blankFixture.state),
      nodes,
    },
    transition: transition || plain(blankFixture.transition),
    performance: {
      clock: "rapp-holo-logical-ms/1",
      sustain: sustain || plain(blankFixture.performance.sustain),
    },
    accessibility: {
      description,
      reduced_motion: "hold",
    },
  };
}

function manifest(authored) {
  const compiledGeometry = (node) => {
    if (node.type === "group") return null;
    if (node.type === "primitive") {
      return { kind: "primitive", authored: plain(node.geometry), derived: {} };
    }
    if (node.type === "mesh") {
      return {
        kind: "mesh",
        vertices: plain(node.geometry.vertices),
        triangles: plain(node.geometry.triangles),
        normals: [],
      };
    }
    if (node.type === "polyline" || node.type === "points") {
      return { kind: node.type, authored: plain(node.geometry) };
    }
    return { kind: "light", authored: plain(node.geometry) };
  };
  return {
    schema: "rapp-holo-compiled/1",
    camera: plain(authored.state.camera),
    environment: plain(authored.state.environment),
    nodes: authored.state.nodes.map((node) => ({
      node_id: node.id,
      parent: node.parent,
      type: node.type,
      visible: node.visible,
      transform: plain(node.transform),
      geometry: compiledGeometry(node),
      material: plain(node.material),
    })),
    draws: authored.state.nodes
      .filter((node) => !["group", "light"].includes(node.type))
      .map((node) => node.id),
    lights: authored.state.nodes
      .filter((node) => node.type === "light" && node.visible)
      .map((node) => node.id),
  };
}

function setProperty(node, property, value) {
  if (property === "visible") {
    node.visible = value;
    return;
  }
  const [group, field] = property.split(".");
  node[group][field] = plain(value);
}

function trackedManifest(compiled, logicalMs) {
  const result = plain(compiled.manifest);
  const sustain = compiled.input.authored.performance.sustain;
  if (!sustain.duration_ms || sustain.repeat === "hold") return result;
  const local = sustain.repeat === "once"
    ? Math.min(logicalMs, sustain.duration_ms)
    : logicalMs % sustain.duration_ms;
  for (const track of sustain.tracks) {
    const node = result.nodes.find((entry) => entry.node_id === track.node_id);
    let left = track.keyframes[0];
    let right = left;
    for (const keyframe of track.keyframes) {
      if (keyframe.at_ms <= local) left = keyframe;
      if (keyframe.at_ms >= local) {
        right = keyframe;
        break;
      }
    }
    if (
      left === right
      || track.interpolation === "step"
      || typeof left.value === "boolean"
    ) {
      setProperty(node, track.property, left.value);
      continue;
    }
    const progress = Math.round(
      (local - left.at_ms) * SCALE / (right.at_ms - left.at_ms),
    );
    const interpolate = (start, end) => (
      start + Math.round((end - start) * progress / SCALE)
    );
    const value = Array.isArray(left.value)
      ? left.value.map((entry, index) => interpolate(entry, right.value[index]))
      : interpolate(left.value, right.value);
    setProperty(node, track.property, value);
  }
  return result;
}

function fakeProtocol() {
  const calls = [];
  return {
    calls,
    canonical,
    compilePlayerUpdate(input) {
      calls.push(["compile", plain(input)]);
      if (input.authored.accessibility.description === "INVALID") {
        return { ok: false, errors: ["authored output refused"] };
      }
      const compileSnapshot = (snapshot) => (
        snapshot.manifest || manifest(snapshot.authored || { state: snapshot.state })
      );
      const history = Object.fromEntries(input.history.map((snapshot) => [
        snapshot.holo_id,
        compileSnapshot(snapshot),
      ]));
      if (input.base) history[input.base.holo_id] = compileSnapshot(input.base);
      return {
        input: plain(input),
        manifest: manifest(input.authored),
        history,
      };
    },
    evaluatePlayerUpdate(compiled, options) {
      calls.push(["evaluate", plain(options)]);
      const logicalMs = options.logical_ms;
      const authored = compiled.input.authored;
      const current = trackedManifest(compiled, logicalMs);
      const transitionDuration = authored.transition.duration_ms;
      if (options.departure && logicalMs < transitionDuration) {
        const progress = Math.round(logicalMs * SCALE / transitionDuration);
        return {
          logical_ms: logicalMs,
          camera: current.camera,
          environment: current.environment,
          layers: [
            {
              holo_id: options.departure.layers[0].holo_id,
              weight: SCALE - progress,
              manifest: options.departure.layers[0].manifest,
            },
            {
              holo_id: compiled.input.holo_id,
              weight: progress,
              manifest: current,
            },
          ],
        };
      }
      const flipbook = authored.performance.sustain.flipbook;
      if (flipbook.length) {
        const duration = authored.performance.sustain.duration_ms;
        const local = logicalMs % duration;
        let selected = flipbook[0];
        for (const entry of flipbook) {
          if (entry.at_ms <= local) selected = entry;
        }
        const selectedManifest = selected.holo_id === "self"
          ? current
          : compiled.history[selected.holo_id];
        return {
          logical_ms: logicalMs,
          camera: selectedManifest.camera,
          environment: selectedManifest.environment,
          layers: [{
            holo_id: selected.holo_id === "self"
              ? compiled.input.holo_id
              : selected.holo_id,
            weight: SCALE,
            manifest: selectedManifest,
          }],
        };
      }
      return {
        logical_ms: logicalMs,
        camera: current.camera,
        environment: current.environment,
        layers: [{
          holo_id: compiled.input.holo_id,
          weight: SCALE,
          manifest: current,
        }],
      };
    },
  };
}

function loadHooks(protocol) {
  const context = vm.createContext({
    console,
    RappHoloProtocol: protocol,
    TextEncoder,
  });
  context.window = context;
  context.globalThis = context;
  vm.runInContext(runtimeSource, context, {
    filename: "static/hologram-runtime.js",
  });
  return context.RappHoloPlayerTest;
}

function loadActualHooks() {
  const context = vm.createContext({
    console,
    RappHoloProtocol: null,
    TextEncoder,
  });
  context.window = context;
  context.globalThis = context;
  vm.runInContext(protocolSource, context, {
    filename: "static/holo-protocol.js",
  });
  vm.runInContext(runtimeSource, context, {
    filename: "static/hologram-runtime.js",
  });
  return {
    hooks: context.RappHoloPlayerTest,
    protocol: context.RappHoloProtocol,
  };
}

function update(holoId, authored, extra = {}) {
  return {
    schema: "rapp-holo-player-update/1",
    authoritative_holo_id: holoId,
    holo_id: holoId,
    authored,
    history: [],
    ...extra,
  };
}

test("blank Holo/1 state remains a genuinely blank raster plan", () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => 100 });

  assert.equal(controller.acceptUpdate(update(A, output())), true);
  const state = plain(controller.snapshot(0));
  const plan = plain(hooks.rasterPlan(state.evaluated_manifest));

  assert.equal(state.player_active_holo_id, A);
  assert.deepEqual(state.compiled_manifest.nodes, []);
  assert.deepEqual(plan.layers[0].nodes, []);
  assert.equal(plan.environment.clear_color, "#00000000");
});

test("verified materialized records are accepted without changing authored data", () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => 0 });
  const authored = output();
  const record = {
    schema: "rapp-holo-record/1",
    holo_seq: 0,
    visual_parent: null,
    source: {
      stream_id: `rappid:@test/subject:${C}:memory`,
      seq: 0,
      frame_hash: C,
    },
    authored_hash: B,
    producer_provenance: null,
    authored,
  };

  assert.equal(controller.acceptUpdate({
    schema: "rapp-holo-player-update/1",
    holo_id: A,
    authoritative_holo_id: A,
    record,
    history: [],
  }), true);
  assert.deepEqual(
    protocol.calls.find(([name]) => name === "compile")[1].authored,
    authored,
  );
});

test("renderer orchestration calls the shared low-level protocol helpers", () => {
  const calls = [];
  const protocol = {
    validateOutput(authored) {
      calls.push("validateOutput");
      return authored;
    },
    compileSceneManifest(authored) {
      calls.push("compileSceneManifest");
      return manifest(authored);
    },
    localSustainTime() {
      calls.push("localSustainTime");
      return 0;
    },
    evaluatePropertyTrack() {
      calls.push("evaluatePropertyTrack");
      return null;
    },
    selectFlipbook() {
      calls.push("selectFlipbook");
      return [{ holo_id: "self", weight: SCALE }];
    },
    easing(_name, progress) {
      calls.push("easing");
      return progress;
    },
    roundDiv(numerator, denominator) {
      calls.push("roundDiv");
      return Math.round(numerator / denominator);
    },
  };
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => 0 });

  assert.equal(controller.acceptUpdate(update(A, output())), true);
  controller.evaluateAt(0);
  assert.ok(calls.includes("validateOutput"));
  assert.ok(calls.includes("compileSceneManifest"));
  assert.ok(calls.includes("localSustainTime"));
  assert.ok(calls.includes("selectFlipbook"));
});

test("real validator output is compiled before raster planning", () => {
  const { hooks, protocol } = loadActualHooks();
  const controller = hooks.createController({ protocol, now: () => 0 });
  const authored = output({
    nodes: [{
      id: "nonhuman-fold",
      parent: null,
      type: "primitive",
      visible: true,
      transform: transform(),
      geometry: {
        shape: "icosahedron",
        radius: 1200,
        detail: 1,
      },
      material: material("solid", "#36D9C8DD"),
    }],
  });

  assert.equal(controller.acceptUpdate(update(A, authored)), true);
  const state = plain(controller.snapshot(0));
  const plan = plain(hooks.rasterPlan(state.evaluated_manifest));

  assert.equal(state.compiled_manifest.schema, "rapp-holo-compiled/1");
  assert.equal(plan.environment.clear_color, authored.state.environment.clear_color);
  assert.equal(plan.layers[0].nodes[0].id, "nonhuman-fold");
});

test("arbitrary non-humanoid IR is preserved without renderer-authored nodes", () => {
  const nodes = [
    {
      id: "root-field",
      parent: null,
      type: "group",
      visible: true,
      transform: transform(),
      geometry: null,
      material: null,
    },
    {
      id: "orbital-ring",
      parent: "root-field",
      type: "primitive",
      visible: true,
      transform: transform([100, 200, 300]),
      geometry: {
        shape: "torus",
        major_radius: 1200,
        minor_radius: 200,
        detail: 12,
      },
      material: material("wire", "#12AB34CC", "additive"),
    },
    {
      id: "open-sail",
      parent: "root-field",
      type: "mesh",
      visible: true,
      transform: transform(),
      geometry: {
        vertices: [[0, 0, 0], [1000, 0, 0], [0, 1000, 0]],
        triangles: [[0, 1, 2]],
      },
      material: material("solid", "#804020", "multiply"),
    },
    {
      id: "signal-path",
      parent: null,
      type: "polyline",
      visible: true,
      transform: transform(),
      geometry: {
        points: [[-1000, 0, 0], [0, 800, 0], [1000, 0, 0]],
        closed: false,
        width: 40,
      },
      material: material("line", "#3355FF"),
    },
    {
      id: "dust-samples",
      parent: null,
      type: "points",
      visible: true,
      transform: transform(),
      geometry: {
        points: [
          { position: [0, 0, 0], size: 80 },
          { position: [400, 500, 600], size: 120 },
        ],
      },
      material: material("points", "#F0E010"),
    },
    {
      id: "cold-light",
      parent: null,
      type: "light",
      visible: true,
      transform: transform(),
      geometry: {
        kind: "ambient",
        color: "#102030",
        intensity: 3500,
        range: null,
        angle_mdeg: null,
        direction: null,
      },
      material: null,
    },
  ];
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => 0 });
  assert.equal(controller.acceptUpdate(update(A, output({ nodes }))), true);

  const plan = plain(hooks.rasterPlan(controller.evaluateAt(0)));
  assert.deepEqual(
    plan.layers[0].nodes.map((node) => [node.id, node.type]),
    nodes.map((node) => [node.id, node.type]),
  );
  assert.equal(plan.layers[0].nodes[1].material.color, "#12AB34CC");
  assert.equal(plan.layers[0].nodes[2].geometry.vertices[2][1], 1000);
  assert.doesNotMatch(JSON.stringify(plan), /humanoid|species|emotion|fallback/i);
});

test("a successor transition freezes and weights the prior active composition", () => {
  let clock = 0;
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => clock });
  const first = output();
  assert.equal(controller.acceptUpdate(update(A, first)), true);

  clock = 250;
  const second = output({
    base: A,
    transition: {
      duration_ms: 1000,
      easing: "linear",
      default: "crossfade",
      nodes: [],
    },
  });
  assert.equal(controller.acceptUpdate(update(B, second, {
    base: { holo_id: A, authored: first },
  })), true);

  const halfway = plain(controller.evaluateAt(500));
  assert.equal(halfway.layers[0].holo_id, A);
  assert.equal(halfway.layers[0].weight, 500000);
  assert.equal(halfway.layers[1].holo_id, B);
  assert.equal(halfway.layers[1].weight, 500000);
  assert.equal(controller.snapshot(500).player_active_holo_id, B);
});

test("activation evidence hashes the exact frozen departure manifest", async () => {
  let clock = 0;
  const accepted = [];
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({
    protocol,
    now: () => clock,
    onAccepted: (evidence) => accepted.push(plain(evidence)),
  });
  const first = output();
  assert.equal(controller.acceptUpdate(update(A, first)), true);
  assert.equal(accepted[0].previous_active_holo_id, null);
  assert.equal(accepted[0].departure_logical_ms, null);
  assert.equal(accepted[0].departure_manifest, null);
  assert.deepEqual(plain(hooks.activeMessage(accepted[0], null)), {
    schema: "rapp-holo-active/1",
    holo_id: A,
    previous_active_holo_id: null,
    departure_logical_ms: null,
    departure_manifest_hash: null,
    authoritative: true,
  });

  clock = 250;
  const second = output({ base: A });
  assert.equal(controller.acceptUpdate(update(B, second, {
    base: { holo_id: A, authored: first },
  })), true);
  const evidence = accepted[1];
  const hash = await hooks.departureManifestHash(
    evidence.departure_manifest,
    protocol,
    webcrypto,
  );
  const expected = createHash("sha256").update(
    `rapp-holo/1:departure\n${canonical(evidence.departure_manifest)}`,
  ).digest("hex");
  assert.equal(hash, expected);
  assert.deepEqual(plain(hooks.activeMessage(evidence, hash)), {
    schema: "rapp-holo-active/1",
    holo_id: B,
    previous_active_holo_id: A,
    departure_logical_ms: 250,
    departure_manifest_hash: expected,
    authoritative: true,
  });
});

test("historical flipbook renders only the explicitly selected ancestor", () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => 0 });
  const prior = output();
  const current = output({
    base: A,
    sustain: {
      duration_ms: 2000,
      repeat: "loop",
      tracks: [],
      flipbook: [
        { at_ms: 0, holo_id: "self", blend: "cut", blend_ms: 0 },
        { at_ms: 1000, holo_id: A, blend: "cut", blend_ms: 0 },
      ],
    },
  });

  assert.equal(controller.acceptUpdate(update(B, current, {
    base: { holo_id: A, state: prior.state },
    history: [{ holo_id: A, state: prior.state }],
  })), true);
  assert.equal(controller.evaluateAt(500).layers[0].holo_id, B);
  assert.equal(controller.evaluateAt(1500).layers[0].holo_id, A);
  assert.equal(controller.evaluateAt(2500).layers[0].holo_id, B);
});

test("invalid update advances announced authority but holds prior player-active holo", () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => 0 });
  const first = output();
  assert.equal(controller.acceptUpdate(update(A, first)), true);

  const invalid = output({ base: A, description: "INVALID" });
  assert.equal(controller.acceptUpdate(update(B, invalid, {
    base: { holo_id: A, authored: first },
  })), false);
  const state = plain(controller.snapshot(0));
  assert.equal(state.authoritative_holo_id, B);
  assert.equal(state.player_active_holo_id, A);
  assert.match(state.errors.at(-1).message, /authored output refused/);
});

test("fixed logical times produce deterministic evaluated manifests", () => {
  const animatedNode = {
    id: "turning-plane",
    parent: null,
    type: "primitive",
    visible: true,
    transform: transform(),
    geometry: { shape: "plane", width: 1000, height: 600 },
    material: material("solid", "#224466"),
  };
  const animated = output({
    nodes: [animatedNode],
    sustain: {
      duration_ms: 1000,
      repeat: "loop",
      tracks: [{
        node_id: "turning-plane",
        property: "transform.rotation",
        interpolation: "linear",
        keyframes: [
          { at_ms: 0, value: [0, 0, 0] },
          { at_ms: 1000, value: [0, 180000, 0] },
        ],
      }],
      flipbook: [],
    },
  });
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => 0 });
  assert.equal(controller.acceptUpdate(update(A, animated)), true);

  const first = plain(controller.evaluateAt(500));
  const second = plain(controller.evaluateAt(500));
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.layers[0].manifest.nodes[0].transform.rotation,
    [0, 90000, 0],
  );
  assert.ok(protocol.calls.some(([name]) => name === "evaluate"));
});

test("Holo/1 mode fails closed without shared helpers and legacy is quarantined", () => {
  const controller = loadHooks({}).createController({ protocol: {}, now: () => 0 });
  assert.equal(controller.acceptUpdate(update(A, output())), false);
  assert.equal(controller.snapshot(0).player_active_holo_id, null);
  assert.match(
    controller.snapshot(0).errors.at(-1).message,
    /does not provide the pinned player helpers/,
  );
  assert.match(runtimeSource, /canvas\.dataset\.mode = "legacy"/);
  assert.match(runtimeSource, /LEGACY CHARACTER BOTTLE — NOT HOLO\/1/);
  assert.match(runtimeSource, /LEGACY DATA BOTTLE — NOT HOLO\/1/);
});

test("viewer loads the nonce-bound protocol before runtime and caches both", () => {
  const protocolIndex = viewerSource.indexOf("/static/holo-protocol.js");
  const runtimeIndex = viewerSource.indexOf("/static/hologram-runtime.js");
  assert.notEqual(protocolIndex, -1);
  assert.ok(protocolIndex < runtimeIndex);
  assert.match(
    viewerSource,
    /holo-protocol\.js" nonce="__HOLOGRAM_NONCE__"/,
  );
  assert.match(serviceWorkerSource, /"\/static\/holo-protocol\.js"/);
  assert.match(serviceWorkerSource, /"\/static\/hologram-runtime\.js"/);
  const hooks = loadHooks(fakeProtocol());
  assert.deepEqual(
    plain(hooks.readyMessage("zoo-player", {
      authoritative_holo_id: B,
      player_active_holo_id: A,
    })),
    {
      schema: "rapp-holo-ready/1",
      player_id: "zoo-player",
      authoritative_holo_id: B,
      player_active_holo_id: A,
    },
  );
  assert.deepEqual(
    plain(hooks.errorMessage("activation refused", {
      authoritative_holo_id: B,
      player_active_holo_id: A,
    })),
    {
      schema: "rapp-holo-error/1",
      holo_id: B,
      player_active_holo_id: A,
      authoritative: false,
      error: "activation refused",
    },
  );
});
