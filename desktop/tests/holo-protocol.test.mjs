import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";


const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SCRIPT_PATH = path.join(ROOT, "static", "holo-protocol.js");
const CORPUS_PATH = path.join(
  ROOT,
  "holograms",
  "protocol",
  "fixtures",
  "corpus.json",
);
const source = fs.readFileSync(SCRIPT_PATH, "utf8");
const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: SCRIPT_PATH });
const H = sandbox.window.RappHoloProtocol;


function clone(value) {
  return structuredClone(value);
}


function resolveReferences(value) {
  if (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === "document,path"
  ) {
    let result = clone(corpus.documents[value.document]);
    for (const part of value.path) result = result[part];
    return clone(result);
  }
  if (Array.isArray(value)) return value.map(resolveReferences);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveReferences(item)]),
    );
  }
  return clone(value);
}


function applyPatches(value, patches) {
  for (const patch of patches) {
    let target = value;
    for (const part of patch.path.slice(0, -1)) target = target[part];
    const final = patch.path.at(-1);
    const replacement = clone(patch.value);
    if (patch.op === "replace") {
      target[final] = replacement;
    } else if (patch.op === "remove") {
      if (Array.isArray(target)) target.splice(final, 1);
      else delete target[final];
    } else if (patch.op === "add" && Array.isArray(target)) {
      if (final === "-") target.push(replacement);
      else target.splice(final, 0, replacement);
    } else if (patch.op === "add") {
      target[final] = replacement;
    } else {
      throw new Error(`unsupported fixture patch: ${JSON.stringify(patch)}`);
    }
  }
  return value;
}


function validate(kind, value, context) {
  if (kind === "output") {
    return H.validateOutput(value, {
      base: context.base_state,
      ancestorIds: context.ancestors,
    });
  }
  const options = {
    subjectRappid: context.subject_rappid,
    sourceBinding: context.source_binding,
    baseState: context.base_state,
    ancestorResolver: context.ancestors,
  };
  if (Object.hasOwn(context, "expected_visual_parent")) {
    options.expectedVisualParent = context.expected_visual_parent;
  }
  return H.validateBoundRecord(value, options);
}


function historyOutput(references, { baseHoloId = null, state = null } = {}) {
  const value = clone(corpus.documents["blank-valid-output"]);
  value.base_holo_id = baseHoloId;
  if (state !== null) value.state = clone(state);
  if (references.length > 0) {
    value.performance.sustain = {
      duration_ms: Math.max(1, references.length - 1),
      repeat: "once",
      tracks: [],
      flipbook: references.map((holoId, index) => ({
        at_ms: index,
        holo_id: holoId,
        blend: "cut",
        blend_ms: 0,
      })),
    };
  }
  return value;
}


function historyRecord(sequence, parent, references, state = null) {
  const authored = historyOutput(references, {
    baseHoloId: parent,
    state,
  });
  return {
    schema: "rapp-holo-record/1",
    holo_seq: sequence,
    visual_parent: parent,
    source: {
      stream_id: `rappid:@kody-w/history:${"3".repeat(64)}:session`,
      seq: sequence,
      frame_hash: (sequence + 1000).toString(16).padStart(64, "0"),
    },
    authored_hash: H.authoredHash(authored),
    producer_provenance: null,
    authored,
  };
}


function historyId(index) {
  return (index + 100).toString(16).padStart(64, "0");
}


test("classic script exposes one frozen dependency-free protocol global", () => {
  assert.ok(H);
  assert.equal(Object.isFrozen(H), true);
  assert.equal(typeof H.validateOutput, "function");
  assert.equal(typeof H.compileManifest, "function");
  assert.equal(typeof H.validateRecord, "function");
  assert.equal(typeof H.validateBoundRecord, "function");
  assert.equal(typeof H.shapeeOutline, "function");
  assert.equal(typeof H.growlEvents, "function");
  assert.equal(H.completeGrowl, H.growlEvents);
  assert.equal(typeof H.resolveHistory, "function");
  assert.equal(H.validate_output, H.validateOutput);
  assert.equal(H.validate_record, H.validateRecord);
  assert.equal(H.compile_manifest, H.compileManifest);
  assert.equal(H.authored_hash, H.authoredHash);
  assert.equal(H.shapee_outline, H.shapeeOutline);
  assert.equal(H.growl_events, H.growlEvents);
  assert.equal(H.complete_growl, H.growlEvents);
  assert.equal(H.resolve_history, H.resolveHistory);
  assert.doesNotMatch(source, /\beval\s*\(|\bfetch\s*\(|XMLHttpRequest|import\s*\(/);
  assert.doesNotMatch(source, /https?:\/\//);
});


test("shared fixture corpus has identical accept/refuse and manifest hashes", () => {
  assert.equal(corpus.schema, "rapp-holo-fixtures/1");
  for (const fixture of corpus.cases) {
    const value = applyPatches(
      clone(corpus.documents[fixture.document]),
      fixture.patches ?? [],
    );
    const context = resolveReferences(corpus.contexts[fixture.context]);
    const before = clone(value);
    if (fixture.accept) {
      const result = validate(fixture.kind, value, context);
      let manifest = result;
      if (fixture.kind === "output") {
        assert.equal(result, value, fixture.name);
        manifest = H.compileManifest(value, {
          base: context.base_state,
          ancestorIds: context.ancestors,
        });
      }
      assert.equal(
        H.domainHash("rapp-holo/1:compiled", manifest),
        fixture.manifest_hash,
        fixture.name,
      );
      assert.deepEqual(value, before, fixture.name);
    } else {
      assert.throws(() => validate(fixture.kind, value, context), undefined, fixture.name);
      assert.deepEqual(value, before, fixture.name);
    }
  }
});


test("every rejected fixture is a mutation of an accepted baseline", () => {
  for (const fixture of corpus.cases.filter((item) => !item.accept)) {
    const baseline = clone(corpus.documents[fixture.document]);
    const baselineContext = resolveReferences(
      corpus.contexts[fixture.baseline_context],
    );
    validate(fixture.kind, baseline, baselineContext);
    const value = applyPatches(clone(baseline), fixture.patches ?? []);
    const mutatedContext = resolveReferences(corpus.contexts[fixture.context]);
    assert.throws(
      () => validate(fixture.kind, value, mutatedContext),
      undefined,
      fixture.name,
    );
  }
});


test("every accepted fixture rejects an unknown-member mutation", () => {
  for (const fixture of corpus.cases.filter((item) => item.accept)) {
    const value = clone(corpus.documents[fixture.document]);
    value["validator-invented"] = true;
    const context = resolveReferences(corpus.contexts[fixture.context]);
    assert.throws(
      () => validate(fixture.kind, value, context),
      undefined,
      fixture.name,
    );
  }
});


test("shared deterministic helper vectors match Python", () => {
  for (const item of corpus.helpers.round_div) {
    assert.equal(H.roundDiv(...item.args), item.expected);
  }
  for (const item of corpus.helpers.easing) {
    assert.equal(H.easing(...item.args), item.expected);
  }
  for (const item of corpus.helpers.local_sustain_time) {
    assert.equal(H.localSustainTime(...item.args), item.expected);
  }
  for (const item of corpus.helpers.growl_events) {
    const growl = clone(item.growl);
    assert.deepEqual(clone(H.growlEvents(growl)), item.expected);
    assert.deepEqual(growl, item.growl);
  }
  for (const item of corpus.helpers.property_tracks) {
    assert.deepEqual(
      clone(H.evaluatePropertyTrack(resolveReferences(item.track), item.at_ms)),
      item.expected,
    );
  }
  const flipbook = corpus.documents["historical-flipbook"].performance.sustain.flipbook;
  for (const item of corpus.helpers.flipbook) {
    assert.deepEqual(
      clone(H.selectFlipbook(flipbook, item.at_ms, 4000, "loop")),
      item.expected,
    );
  }
});


test("strict parser and authored byte ceiling refuse instead of repairing", () => {
  assert.throws(() => H.parseJson('{"a":1,"a":2}'));
  assert.throws(() => H.parseJson('{"a":1.0}'));
  const value = clone(corpus.documents["blank-valid-output"]);
  value.accessibility.description = "🧭".repeat(
    Math.trunc(H.MAX_AUTHORED_BYTES / 4),
  );
  assert.throws(() => H.validateOutput(value), /256 KiB/);
});


test("unverified ancestor and invalid round divisor are refused", () => {
  const value = clone(corpus.documents["historical-flipbook"]);
  const context = resolveReferences(corpus.contexts.historical);
  context.ancestors["a".repeat(64)].verified_ancestor = false;
  assert.throws(
    () => H.validateOutput(value, {
      base: context.base_state,
      ancestorIds: context.ancestors,
    }),
    /verified strict/,
  );
  assert.throws(() => H.roundDiv(1, 0));
});


test("non-null producer provenance fails closed", () => {
  const fixture = corpus.cases.find((item) => item.name === "untrusted-provenance");
  const record = applyPatches(
    clone(corpus.documents[fixture.document]),
    fixture.patches,
  );
  assert.throws(
    () => H.validateRecord(record),
    /trusted provenance verification unavailable/,
  );
});


test("stable adapters accept an output base and ancestor ID set", () => {
  const value = clone(corpus.documents["historical-flipbook"]);
  const base = corpus.documents["multi-node-non-humanoid-scene"];
  const ancestorIds = new Set(["a".repeat(64), "b".repeat(64)]);
  assert.equal(H.validateOutput(value, { base, ancestorIds }), value);
  assert.equal(
    H.compileManifest(value, { base, ancestorIds }).schema,
    "rapp-holo-compiled/1",
  );
  assert.equal(
    H.compileSceneManifest(value).schema,
    "rapp-holo-compiled/1",
  );
});


test("stable record adapter preserves the exact payload", () => {
  const record = clone(corpus.documents["valid-successor-record"]);
  assert.equal(H.validateRecord(record), record);
  assert.equal(
    H.validateRecord(record, {
      subjectRappid: corpus.contexts["successor-record"].subject_rappid,
    }),
    record,
  );
  const historical = clone(record);
  historical.authored = clone(corpus.documents["historical-flipbook"]);
  historical.authored_hash = H.authoredHash(historical.authored);
  historical.producer_provenance = null;
  assert.equal(H.validateRecord(historical), historical);
  assert.throws(
    () => H.validateRecord(record, {
      subjectRappid: `rappid:@kody-w/other:${"2".repeat(64)}`,
    }),
    /body subject/,
  );
});


test("shared SHAPEE outline and compiled counts match Python", () => {
  for (const item of corpus.helpers.shapee_outline) {
    const geometry = clone(item.geometry);
    assert.deepEqual(clone(H.shapeeOutline(geometry)), item.expected);
    assert.deepEqual(geometry, item.geometry);
    assert.deepEqual(item.expected[0], item.expected.at(-1));
  }
  const manifest = H.compileManifest(corpus.documents["shapee-ai-tile"]);
  const geometry = manifest.draws[0].geometry;
  const expected = corpus.helpers.shapee_outline[0];
  assert.deepEqual(clone(geometry.derived.outline), expected.expected);
  assert.equal(
    geometry.derived.outline_vertex_count,
    expected.outline_vertex_count,
  );
  assert.equal(geometry.vertex_count, expected.vertex_count);
  assert.equal(geometry.triangle_count, expected.triangle_count);
});


test("shared recursive history resolution matches Python", () => {
  const item = corpus.helpers.resolve_history[0];
  const value = clone(corpus.documents[item.document]);
  const context = resolveReferences(corpus.contexts[item.context]);
  assert.deepEqual(
    clone(H.resolveHistory(value, context.ancestors)),
    item.expected,
  );
  for (const [caseName, message] of [
    ["recursive-history-cycle", /historical reference cycle/],
    ["recursive-history-non-ancestor", /not a strict visual ancestor/],
  ]) {
    const fixture = corpus.cases.find((entry) => entry.name === caseName);
    const rejectedContext = resolveReferences(corpus.contexts[fixture.context]);
    assert.throws(
      () => H.resolveHistory(
        clone(corpus.documents[fixture.document]),
        rejectedContext.ancestors,
      ),
      message,
    );
  }
});


test("recursive history depth and unique limits are enforced", () => {
  let records = {};
  for (let index = 0; index < 9; index += 1) {
    const parent = index === 0 ? null : historyId(index - 1);
    records[historyId(index)] = historyRecord(
      index,
      parent,
      parent === null ? [] : [parent],
    );
  }
  let root = historyOutput([historyId(8)], { baseHoloId: historyId(8) });
  assert.throws(() => H.resolveHistory(root, records), /depth exceeds eight/);

  records = {};
  const nested = new Map([
    [64, Array.from({ length: 16 }, (_, index) => index + 48)],
    [48, Array.from({ length: 16 }, (_, index) => index + 32)],
    [32, Array.from({ length: 16 }, (_, index) => index + 16)],
    [16, Array.from({ length: 16 }, (_, index) => index)],
  ]);
  for (let index = 0; index < 65; index += 1) {
    const parent = index === 0 ? null : historyId(index - 1);
    records[historyId(index)] = historyRecord(
      index,
      parent,
      (nested.get(index) ?? []).map(historyId),
    );
  }
  root = historyOutput([historyId(64)], { baseHoloId: historyId(64) });
  assert.throws(() => H.resolveHistory(root, records), /exceed 64/);
});


test("recursive history aggregate state byte limit is enforced", () => {
  const points = Array.from({ length: 5000 }, (_, index) => ({
    position: [index % 1000, Math.trunc(index / 1000), 0],
    size: 1,
  }));
  const state = clone(corpus.documents["blank-valid-output"].state);
  state.nodes = [{
    id: "mass",
    parent: null,
    type: "points",
    visible: true,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1000, 1000, 1000],
    },
    geometry: { points },
    material: {
      color: "#FFFFFF",
      emissive: "#000000",
      emissive_strength: 0,
      opacity: 1000,
      presentation: "points",
      blend: "normal",
      side: "front",
      metallic: 0,
      roughness: 1000,
    },
  }];
  const records = {};
  const nested = new Map([
    [31, Array.from({ length: 15 }, (_, index) => index + 16)],
    [16, Array.from({ length: 16 }, (_, index) => index)],
  ]);
  for (let index = 0; index < 32; index += 1) {
    const parent = index === 0 ? null : historyId(index - 1);
    records[historyId(index)] = historyRecord(
      index,
      parent,
      (nested.get(index) ?? []).map(historyId),
      state,
    );
  }
  const root = historyOutput([historyId(31)], {
    baseHoloId: historyId(31),
  });
  assert.throws(() => H.resolveHistory(root, records), /exceed 4 MiB/);
});


test("growl aggregate duration is bounded", () => {
  const value = clone(corpus.documents["blank-valid-output"]);
  const note = {
    pitch: 64,
    delta_onset: 65535,
    duration: 1,
    velocity: 64,
  };
  value.growl.continuation = Array.from(
    { length: 257 },
    () => clone(note),
  );
  assert.throws(() => H.validateOutput(value), /song duration/);
});
