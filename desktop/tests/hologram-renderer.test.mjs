import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const threeSource = fs.readFileSync(
  path.join(root, "static/vendor/three-r128.min.js"),
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

function runtimeFunctionBody(name) {
  const start = runtimeSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing runtime function ${name}`);
  const bodyStart = runtimeSource.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < runtimeSource.length; index += 1) {
    if (runtimeSource[index] === "{") depth += 1;
    if (runtimeSource[index] === "}") {
      depth -= 1;
      if (depth === 0) return runtimeSource.slice(bodyStart + 1, index);
    }
  }
  assert.fail(`unterminated runtime function ${name}`);
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
  growl = null,
  nodes = [],
  transition = null,
  sustain = null,
  description = "Exact authored scene.",
} = {}) {
  return {
    ...plain(blankFixture),
    base_holo_id: base,
    growl: growl || {
      schema: "rapp-holo-growl/1",
      representation: "note-pitch-delta-duration-velocity/1",
      seed: C,
      model: {
        id: "test-piano",
        revision: "1",
      },
      tempo_milli_bpm: 120000,
      ticks_per_quarter: 100,
      program: 17,
      title: "Test growl",
      subject_description: "An authored piano continuation for renderer tests.",
      context_policy: {
        max_notes: 512,
        retain_latest: 384,
      },
      prompt: [
        { pitch: 60, delta_onset: 0, duration: 4, velocity: 96 },
        { pitch: 64, delta_onset: 0, duration: 4, velocity: 90 },
        { pitch: 67, delta_onset: 0, duration: 4, velocity: 88 },
        { pitch: 62, delta_onset: 4, duration: 4, velocity: 94 },
        { pitch: 65, delta_onset: 0, duration: 4, velocity: 89 },
        { pitch: 69, delta_onset: 0, duration: 4, velocity: 86 },
        { pitch: 64, delta_onset: 4, duration: 4, velocity: 92 },
        { pitch: 67, delta_onset: 0, duration: 4, velocity: 87 },
      ],
      continuation: [
        { pitch: 67, delta_onset: 4, duration: 8, velocity: 92 },
        { pitch: 69, delta_onset: 4, duration: 4, velocity: 88 },
      ],
      complete: true,
    },
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

function fakeProtocol() {
  const calls = [];
  const roundDiv = (numerator, denominator) => Math.round(numerator / denominator);
  const easing = (_name, progress) => progress;
  return {
    calls,
    canonical,
    growlEvents(growl) {
      calls.push(["growlEvents", plain(growl)]);
      return plain([...growl.prompt, ...growl.continuation]);
    },
    validateOutput(authored, options = {}) {
      calls.push(["validateOutput", plain(authored), plain(options)]);
      if (authored.accessibility.description === "INVALID") {
        throw new Error("authored output refused");
      }
      return authored;
    },
    compileSceneManifest(authored) {
      calls.push(["compileSceneManifest", plain(authored)]);
      return manifest(authored);
    },
    domainHash(space, value) {
      calls.push(["domainHash", space, plain(value)]);
      return createHash("sha256").update(
        `${space}\n${canonical(value)}`,
      ).digest("hex");
    },
    roundDiv,
    easing,
    localSustainTime(activeT, transitionDuration, duration, repeat) {
      calls.push(["localSustainTime", activeT]);
      const sustainT = Math.max(0, activeT - transitionDuration);
      if (repeat === "hold") return 0;
      if (repeat === "once") return Math.min(sustainT, duration);
      if (repeat === "loop") return sustainT % duration;
      const phase = sustainT % (2 * duration);
      return phase <= duration ? phase : 2 * duration - phase;
    },
    evaluatePropertyTrack(track, localT) {
      calls.push(["evaluatePropertyTrack", track.node_id, localT]);
      let left = track.keyframes[0];
      let right = left;
      for (const keyframe of track.keyframes) {
        if (keyframe.at_ms <= localT) left = keyframe;
        if (keyframe.at_ms >= localT) {
          right = keyframe;
          break;
        }
      }
      if (
        left === right
        || track.interpolation === "step"
        || typeof left.value === "boolean"
      ) {
        return plain(left.value);
      }
      const progress = roundDiv(
        (localT - left.at_ms) * SCALE,
        right.at_ms - left.at_ms,
      );
      const interpolate = (start, end) => (
        start + roundDiv((end - start) * easing(track.interpolation, progress), SCALE)
      );
      return Array.isArray(left.value)
        ? left.value.map((entry, index) => interpolate(entry, right.value[index]))
        : interpolate(left.value, right.value);
    },
    selectFlipbook(flipbook, localT) {
      calls.push(["selectFlipbook", localT]);
      if (!flipbook.length) return [{ holo_id: "self", weight: SCALE }];
      let selected = flipbook[0];
      for (const entry of flipbook) {
        if (entry.at_ms <= localT) selected = entry;
      }
      return [{ holo_id: selected.holo_id, weight: SCALE }];
    },
    shapeeOutline(geometry) {
      calls.push(["shapeeOutline", plain(geometry)]);
      const halfWidth = Math.trunc(geometry.width / 2);
      const halfHeight = Math.trunc(geometry.height / 2);
      return [
        [-halfWidth, -halfHeight],
        [halfWidth, -halfHeight],
        [halfWidth, halfHeight],
        [-halfWidth, halfHeight],
        [-halfWidth, -halfHeight],
      ];
    },
  };
}

function loadHooks(protocol, { three = false } = {}) {
  const context = vm.createContext({
    console,
    RappHoloProtocol: protocol,
    TextEncoder,
  });
  context.window = context;
  context.globalThis = context;
  if (three) {
    vm.runInContext(threeSource, context, {
      filename: "static/vendor/three-r128.min.js",
    });
  }
  vm.runInContext(runtimeSource, context, {
    filename: "static/hologram-runtime.js",
  });
  return context.RappHoloPlayerTest;
}

function loadActualHooks() {
  const context = vm.createContext({
    console,
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

function recordPayload(authored, holoSeq, visualParent) {
  return {
    schema: "rapp-holo-record/1",
    holo_seq: holoSeq,
    visual_parent: visualParent,
    source: {
      stream_id: `rappid:@test/subject:${C}:memory`,
      seq: holoSeq,
      frame_hash: C,
    },
    authored_hash: C,
    producer_provenance: null,
    authored,
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
    protocol.calls.find(([name]) => name === "validateOutput")[1],
    authored,
  );
});

test("historical selection keeps its identity separate from authoritative head", () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const accepted = [];
  const controller = hooks.createController({
    protocol,
    now: () => 0,
    onAccepted: (evidence) => accepted.push(plain(evidence)),
  });
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
    authored_hash: C,
    producer_provenance: null,
    authored,
  };

  assert.equal(controller.acceptUpdate({
    schema: "rapp-holo-player-update/1",
    authoritative_holo_id: B,
    record: {
      frame_hash: A,
      payload: record,
    },
    history: [],
  }), true);
  const state = plain(controller.snapshot(0));
  assert.equal(state.player_active_holo_id, A);
  assert.equal(state.authoritative_holo_id, B);
  assert.equal(hooks.activeMessage(accepted[0], null).authoritative, false);
});

test("renderer orchestration calls the fixed shared protocol API", () => {
  const calls = [];
  const protocol = {
    canonical,
    growlEvents() {
      calls.push(["growlEvents"]);
      return [];
    },
    validateOutput(authored, options = {}) {
      calls.push(["validateOutput", plain(options)]);
      return authored;
    },
    compileSceneManifest(authored) {
      calls.push(["compileSceneManifest"]);
      return manifest(authored);
    },
    domainHash(space, value) {
      calls.push(["domainHash", space]);
      return createHash("sha256").update(
        `${space}\n${canonical(value)}`,
      ).digest("hex");
    },
    localSustainTime() {
      calls.push(["localSustainTime"]);
      return 0;
    },
    evaluatePropertyTrack() {
      calls.push(["evaluatePropertyTrack"]);
      return null;
    },
    selectFlipbook() {
      calls.push(["selectFlipbook"]);
      return [{ holo_id: "self", weight: SCALE }];
    },
    easing(_name, progress) {
      calls.push(["easing"]);
      return progress;
    },
    roundDiv(numerator, denominator) {
      calls.push(["roundDiv"]);
      return Math.round(numerator / denominator);
    },
  };
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => 0 });

  assert.equal(controller.acceptUpdate(update(A, output())), true);
  controller.evaluateAt(0);
  assert.ok(calls.some(([name]) => name === "validateOutput"));
  assert.ok(calls.some(([name]) => name === "compileSceneManifest"));
  assert.ok(calls.some(([name]) => name === "localSustainTime"));
  assert.ok(calls.some(([name]) => name === "selectFlipbook"));
});

test("real validator output is compiled before raster planning", () => {
  const actual = loadActualHooks();
  const node = {
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
  };
  const authored = typeof actual.protocol.growlEvents === "function"
    ? output({ nodes: [node] })
    : {
      ...plain(blankFixture),
      state: {
        ...plain(blankFixture.state),
        nodes: [node],
      },
    };
  actual.protocol.validateOutput(authored);
  const compiled = actual.protocol.compileSceneManifest(authored);
  const plan = plain(actual.hooks.rasterPlan({
    layers: [{
      holo_id: A,
      weight: SCALE,
      manifest: compiled,
    }],
  }));

  assert.equal(compiled.schema, "rapp-holo-compiled/1");
  assert.equal(plan.environment.clear_color, authored.state.environment.clear_color);
  assert.equal(plan.layers[0].nodes[0].id, "nonhuman-fold");
});

test("growl completion and WebAudio scheduling are deterministic and gesture-only", async () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const authoredGrowl = output().growl;
  const originalGrowl = plain(authoredGrowl);
  const events = plain(hooks.completedGrowl(authoredGrowl, protocol));
  const schedule = plain(hooks.growlSchedule(authoredGrowl, protocol));

  assert.deepEqual(authoredGrowl, originalGrowl);
  assert.deepEqual(events, [
    ...authoredGrowl.prompt,
    ...authoredGrowl.continuation,
  ]);
  assert.deepEqual(schedule.preset, {
    name: "round",
    waveform: "sine",
    attack_us: 3000,
    release_us: 110000,
  });
  assert.equal(schedule.step_us, 5000);
  assert.equal(schedule.duration_us, 100000);
  assert.deepEqual(
    schedule.events.map((event) => [event.start_us, event.duration_us]),
    [
      [0, 20000],
      [0, 20000],
      [0, 20000],
      [20000, 20000],
      [20000, 20000],
      [20000, 20000],
      [40000, 20000],
      [40000, 20000],
      [60000, 40000],
      [80000, 20000],
    ],
  );
  assert.deepEqual(
    protocol.calls.find(([name]) => name === "growlEvents")[1],
    authoredGrowl,
  );

  const audioCalls = [];
  let contexts = 0;
  class FakeAudioContext {
    constructor() {
      contexts += 1;
      this.currentTime = 10;
      this.destination = {};
      this.state = "suspended";
    }

    async resume() {
      audioCalls.push(["resume"]);
      this.state = "running";
    }

    createOscillator() {
      const oscillator = {
        frequency: {
          setValueAtTime(value, at) {
            audioCalls.push(["frequency", value, at]);
          },
        },
        connect() {},
        start(at) {
          audioCalls.push(["start", at, oscillator.type]);
        },
        stop(at) {
          audioCalls.push(["stop", at]);
        },
        type: null,
      };
      return oscillator;
    }

    createGain() {
      return {
        gain: {
          setValueAtTime(value, at) {
            audioCalls.push(["gain", value, at]);
          },
          linearRampToValueAtTime(value, at) {
            audioCalls.push(["gain-ramp", value, at]);
          },
        },
        connect() {},
      };
    }
  }
  const player = hooks.createGrowlPlayer({
    protocol,
    AudioContextClass: FakeAudioContext,
  });
  await assert.rejects(
    player.play(authoredGrowl),
    /requires an explicit user gesture/,
  );
  assert.equal(contexts, 0);
  await player.play(authoredGrowl, { user_gesture: true });
  assert.equal(contexts, 1);
  assert.equal(
    audioCalls.filter(([name]) => name === "start").length,
    events.length,
  );
  assert.ok(
    audioCalls
      .filter(([name]) => name === "start")
      .every((call) => call[2] === "sine"),
  );
  await assert.rejects(
    player.play(authoredGrowl, { user_gesture: true }),
    /already active/,
  );

  const missingGrowl = output();
  delete missingGrowl.growl;
  const controller = hooks.createController({ protocol, now: () => 0 });
  assert.equal(controller.acceptUpdate(update(A, missingGrowl)), false);
  assert.equal(controller.metadata().player_active_holo_id, null);
  assert.doesNotMatch(
    runtimeFunctionBody("completedGrowl"),
    /default_seed|Math\.random|crypto/,
  );
  assert.doesNotMatch(
    runtimeFunctionBody("completedGrowl"),
    /completeGrowl/,
  );
  assert.doesNotMatch(
    runtimeFunctionBody("growlStepUs"),
    /step_microseconds|step_milliseconds|steps_per_beat/,
  );
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

test("maximum points and long polylines each batch into one raster draw", () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol, { three: true });
  const positions = Array.from({ length: 8192 }, (_, index) => ({
    position: [index, index % 31, 0],
    size: 10 + (index % 7),
  }));
  const points = hooks.rasterBatchDescriptor({
    type: "points",
    geometry: { points: positions },
  });
  const polyline = hooks.rasterBatchDescriptor({
    type: "polyline",
    geometry: {
      points: positions.map((point) => point.position),
      closed: true,
      width: 20,
    },
  });

  assert.deepEqual(plain(points), {
    kind: "points",
    vertex_count: 8192,
    object_count: 1,
    draw_count: 1,
  });
  assert.deepEqual(plain(polyline), {
    kind: "line-loop",
    vertex_count: 8192,
    object_count: 1,
    draw_count: 1,
  });
  const pointsObject = hooks.createRasterObject({
    id: "many-points",
    parent: null,
    type: "points",
    visible: true,
    transform: transform(),
    geometry: { points: positions },
    material: material("points", "#336699"),
  });
  const lineObject = hooks.createRasterObject({
    id: "long-line",
    parent: null,
    type: "polyline",
    visible: true,
    transform: transform(),
    geometry: {
      points: positions.map((point) => point.position),
      closed: true,
      width: 20,
    },
    material: material("line", "#996633"),
  });
  assert.equal(pointsObject.isPoints, true);
  assert.equal(pointsObject.children.length, 0);
  assert.equal(pointsObject.geometry.attributes.position.count, 8192);
  assert.equal(pointsObject.geometry.attributes.holoSize.count, 8192);
  assert.equal(lineObject.isLineLoop, true);
  assert.equal(lineObject.children.length, 0);
  assert.equal(lineObject.geometry.attributes.position.count, 8192);
  assert.doesNotMatch(runtimeSource, /new THREE\.Sprite\(/);
  assert.match(runtimeSource, /new THREE\.Points\(geometry, material\)/);
  assert.match(runtimeSource, /new THREE\.LineLoop\(geometry, material\)/);
  assert.doesNotMatch(runtimeFunctionBody("pointsObject"), /for\s*\(/);
  assert.doesNotMatch(runtimeFunctionBody("polylineObject"), /for\s*\(/);
  assert.doesNotMatch(
    runtimeFunctionBody("polylineObject"),
    /CylinderGeometry|SphereGeometry|new THREE\.Group/,
  );
});

test("canonical brand SHAPEE becomes one mesh without entering scene defaults", () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol, { three: true });
  const geometry = {
    shape: "shapee",
    seed: "005db34e1c471e94ac4c2b286efb46a9aa328ec7fcd2b9762fa20cc961eef3f7",
    width: 2400,
    height: 1800,
    depth: 180,
    teeth: 16,
    relief: 420,
  };
  const extrusion = plain(hooks.shapeeExtrusion(geometry, protocol));

  assert.deepEqual(
    protocol.calls.find(([name]) => name === "shapeeOutline")[1],
    geometry,
  );
  assert.equal(extrusion.depth, geometry.depth);
  assert.deepEqual(extrusion.outline[0], [-1200, -900]);
  assert.deepEqual(extrusion.outline.at(-1), extrusion.outline[0]);
  const object = hooks.createRasterObject({
    id: "authored-shapee",
    parent: null,
    type: "primitive",
    visible: true,
    transform: transform(),
    geometry,
    material: material("solid", "#ABCDEF"),
  });
  assert.equal(object.isMesh, true);
  assert.equal(object.geometry.type, "ExtrudeGeometry");
  assert.equal(object.children.length, 0);
  assert.doesNotMatch(runtimeSource, new RegExp(geometry.seed));
  assert.match(runtimeSource, /new THREE\.ExtrudeGeometry\(shapePath/);
  assert.match(runtimeSource, /shapeeOutline\(clone\(geometry\)\)/);
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
  assert.equal(halfway.layers[0].environment_weight, 500000);
  assert.equal(halfway.layers[1].holo_id, B);
  assert.equal(halfway.layers[1].environment_weight, 500000);
  assert.equal(controller.snapshot(500).player_active_holo_id, B);
});

test("nonzero genesis transition fades from an empty departure composition", () => {
  const node = {
    id: "genesis-plane",
    parent: null,
    type: "primitive",
    visible: true,
    transform: transform(),
    geometry: { shape: "plane", width: 1000, height: 1000 },
    material: material("solid", "#123456"),
  };
  const genesis = output({
    nodes: [node],
    transition: {
      duration_ms: 1000,
      easing: "linear",
      default: "crossfade",
      nodes: [{ id: node.id, mode: "fade-in" }],
    },
  });
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => 0 });
  assert.equal(controller.acceptUpdate(update(A, genesis)), true);

  const start = plain(controller.evaluateAt(0));
  const middle = plain(controller.evaluateAt(500));
  const end = plain(controller.evaluateAt(1000));
  assert.equal(start.phase, "transition");
  assert.equal(start.layers.length, 1);
  assert.equal(start.layers[0].environment_weight, 0);
  assert.equal(start.layers[0].manifest.nodes[0].render_weight, 0);
  assert.equal(middle.layers[0].environment_weight, 500000);
  assert.equal(middle.layers[0].manifest.nodes[0].render_weight, 500000);
  assert.equal(end.phase, "sustain");
  assert.equal(end.layers[0].environment_weight, SCALE);
  assert.equal(end.layers[0].manifest.nodes[0].render_weight ?? SCALE, SCALE);
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
  const hash = hooks.departureManifestHash(
    evidence.departure_manifest,
    protocol,
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
    base: { holo_id: A, authored: prior },
    history: [{ holo_id: A, authored: prior }],
  })), true);
  const currentCompile = protocol.calls.find(
    ([name, authored]) => name === "validateOutput"
      && authored.base_holo_id === A,
  );
  assert.deepEqual(currentCompile[2].base, prior);
  assert.deepEqual(currentCompile[2].ancestorIds[A], prior);
  assert.equal(controller.evaluateAt(500).layers[0].holo_id, B);
  assert.equal(controller.evaluateAt(1500).layers[0].holo_id, A);
  assert.equal(controller.evaluateAt(2500).layers[0].holo_id, B);
});

test("historical flipbooks recursively evaluate three verified levels", () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => 0 });
  const first = output({
    nodes: [{
      id: "recursive-plane",
      parent: null,
      type: "primitive",
      visible: true,
      transform: transform(),
      geometry: { shape: "plane", width: 1000, height: 1000 },
      material: material("solid", "#112233"),
    }],
    sustain: {
      duration_ms: 1000,
      repeat: "loop",
      tracks: [{
        node_id: "recursive-plane",
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
  const second = output({
    base: A,
    sustain: {
      duration_ms: 500,
      repeat: "loop",
      tracks: [],
      flipbook: [
        { at_ms: 0, holo_id: A, blend: "cut", blend_ms: 0 },
      ],
    },
  });
  const third = output({
    base: B,
    sustain: {
      duration_ms: 1000,
      repeat: "loop",
      tracks: [],
      flipbook: [
        { at_ms: 0, holo_id: B, blend: "cut", blend_ms: 0 },
      ],
    },
  });
  const firstRecord = recordPayload(first, 0, null);
  const secondRecord = recordPayload(second, 1, A);

  assert.equal(controller.acceptUpdate(update(C, third, {
    base: { holo_id: B, record: secondRecord },
    history: [
      { holo_id: A, record: firstRecord },
      { holo_id: B, record: secondRecord },
    ],
  })), true);
  const currentValidation = protocol.calls.find(
    ([name, authored]) => name === "validateOutput"
      && authored.base_holo_id === B,
  );
  assert.deepEqual(currentValidation[2].ancestorIds[A], firstRecord);
  assert.deepEqual(currentValidation[2].ancestorIds[B], secondRecord);
  const evaluated = plain(controller.evaluateAt(1750));
  assert.deepEqual(evaluated.layers.map((layer) => layer.holo_id), [A]);
  assert.equal(evaluated.layers[0].weight, SCALE);
  assert.deepEqual(
    evaluated.layers[0].manifest.nodes[0].transform.rotation,
    [0, 45000, 0],
  );
});

test("recursive flipbooks refuse cycles and depth beyond eight", () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const cyclicA = output({
    sustain: {
      duration_ms: 1000,
      repeat: "loop",
      tracks: [],
      flipbook: [{ at_ms: 0, holo_id: B, blend: "cut", blend_ms: 0 }],
    },
  });
  const cyclicB = output({
    sustain: {
      duration_ms: 1000,
      repeat: "loop",
      tracks: [],
      flipbook: [{ at_ms: 0, holo_id: A, blend: "cut", blend_ms: 0 }],
    },
  });
  const cyclicRoot = output({
    sustain: {
      duration_ms: 1000,
      repeat: "loop",
      tracks: [],
      flipbook: [{ at_ms: 0, holo_id: A, blend: "cut", blend_ms: 0 }],
    },
  });
  const cyclicController = hooks.createController({ protocol, now: () => 0 });
  assert.equal(cyclicController.acceptUpdate(update(C, cyclicRoot, {
    history: [
      { holo_id: A, authored: cyclicA },
      { holo_id: B, authored: cyclicB },
    ],
  })), false);
  assert.match(
    cyclicController.metadata().errors.at(-1).message,
    /recursive flipbook cycle/,
  );

  const ids = "012345678".split("").map((digit) => digit.repeat(64));
  const history = ids.map((holoId, index) => ({
    holo_id: holoId,
    authored: output({
      sustain: index === ids.length - 1
        ? {
          duration_ms: 0,
          repeat: "hold",
          tracks: [],
          flipbook: [],
        }
        : {
          duration_ms: 1000,
          repeat: "loop",
          tracks: [],
          flipbook: [{
            at_ms: 0,
            holo_id: ids[index + 1],
            blend: "cut",
            blend_ms: 0,
          }],
        },
    }),
  }));
  const deepRoot = output({
    sustain: {
      duration_ms: 1000,
      repeat: "loop",
      tracks: [],
      flipbook: [{
        at_ms: 0,
        holo_id: ids[0],
        blend: "cut",
        blend_ms: 0,
      }],
    },
  });
  const depthController = hooks.createController({ protocol, now: () => 0 });
  assert.equal(depthController.acceptUpdate(update(C, deepRoot, {
    history,
  })), false);
  assert.match(
    depthController.metadata().errors.at(-1).message,
    /depth exceeds 8/,
  );
});

test("recursive history refuses excess unique frames and expanded draws", () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const tooMany = Array.from({ length: 65 }, (_, index) => ({
    holo_id: index.toString(16).padStart(2, "0").repeat(32),
    authored: output(),
  }));
  const uniqueController = hooks.createController({ protocol, now: () => 0 });
  assert.equal(uniqueController.acceptUpdate(update("f".repeat(64), output(), {
    history: tooMany,
  })), false);
  assert.match(
    uniqueController.metadata().errors.at(-1).message,
    /exceeds 64 unique frames/,
  );

  const branchingProtocol = fakeProtocol();
  branchingProtocol.selectFlipbook = (flipbook) => {
    if (!flipbook.length) return [{ holo_id: "self", weight: SCALE }];
    return flipbook.map((entry) => ({
      holo_id: entry.holo_id,
      weight: SCALE / flipbook.length,
    }));
  };
  const branchingHooks = loadHooks(branchingProtocol);
  const ids = "12345678".split("").map((digit) => digit.repeat(64));
  const leafNodes = ["leaf-one", "leaf-two"].map((id, index) => ({
    id,
    parent: null,
    type: "primitive",
    visible: true,
    transform: transform([index * 1000, 0, 0]),
    geometry: { shape: "plane", width: 100, height: 100 },
    material: material("solid", "#123456"),
  }));
  const history = ids.map((holoId, index) => ({
    holo_id: holoId,
    authored: output({
      nodes: index === ids.length - 1 ? leafNodes : [],
      sustain: index === ids.length - 1
        ? {
          duration_ms: 0,
          repeat: "hold",
          tracks: [],
          flipbook: [],
        }
        : {
          duration_ms: 1000,
          repeat: "loop",
          tracks: [],
          flipbook: [
            { at_ms: 0, holo_id: ids[index + 1], blend: "cut", blend_ms: 0 },
            { at_ms: 500, holo_id: ids[index + 1], blend: "cut", blend_ms: 0 },
          ],
        },
    }),
  }));
  const root = output({
    sustain: {
      duration_ms: 1000,
      repeat: "loop",
      tracks: [],
      flipbook: [
        { at_ms: 0, holo_id: ids[0], blend: "cut", blend_ms: 0 },
        { at_ms: 500, holo_id: ids[0], blend: "cut", blend_ms: 0 },
      ],
    },
  });
  const drawController = branchingHooks.createController({
    protocol: branchingProtocol,
    now: () => 0,
  });
  assert.equal(drawController.acceptUpdate(update("e".repeat(64), root, {
    history,
  })), false);
  assert.match(
    drawController.metadata().errors.at(-1).message,
    /expanded live draws exceed 256/,
  );
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
  assert.ok(protocol.calls.some(([name]) => name === "evaluatePropertyTrack"));
});

test("unchanged hold scenes reuse their raster build across animation frames", () => {
  const protocol = fakeProtocol();
  const hooks = loadHooks(protocol);
  const controller = hooks.createController({ protocol, now: () => 0 });
  assert.equal(controller.acceptUpdate(update(A, output())), true);
  const gate = hooks.createRasterBuildGate(protocol.canonical);

  const firstPlan = hooks.rasterPlan(controller.evaluateAt(0));
  const first = gate.inspect(firstPlan);
  assert.equal(first.rebuild, true);
  gate.commit(first.key);

  const laterPlan = hooks.rasterPlan(controller.evaluateAt(500000));
  const later = gate.inspect(laterPlan);
  assert.equal(later.rebuild, false);
  assert.equal(gate.stats().rebuild_count, 1);
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
  assert.match(
    runtimeSource,
    /LEGACY CHARACTER BOTTLE — NOT A ROLLING CORE/,
  );
  assert.match(runtimeSource, /LEGACY DATA BOTTLE — NOT A ROLLING CORE/);
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
  assert.match(serviceWorkerSource, /rapp-zoo-shell-v5/);
  assert.match(viewerSource, /id="hologram-growl"[^>]*hidden/);
  assert.match(viewerSource, /<title>Rolling Core Capsule Player<\/title>/);
  assert.match(viewerSource, />play authored piano<\/button>/);
  assert.match(runtimeSource, /ROLLING CORE CAPSULE · HOLO\/1/);
  assert.match(runtimeSource, /Rapterbox · outside this player/);
  assert.match(runtimeSource, /cloud compute", "optional · not required"/);
  assert.match(
    runtimeFunctionBody("runHoloPlayer"),
    /growlButton\.addEventListener\("click"/,
  );
  assert.doesNotMatch(
    runtimeFunctionBody("accept"),
    /growlPlayer\.play/,
  );
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
      substrate: "rapp/1",
      player_mode: "rolling-core-capsule",
      storefront: "rapterbox",
      ownership_model: "one-time-local",
      offline_capable: true,
      cloud_compute_required: false,
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
