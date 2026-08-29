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


test("classic script exposes one frozen dependency-free protocol global", () => {
  assert.ok(H);
  assert.equal(Object.isFrozen(H), true);
  assert.equal(typeof H.validateOutput, "function");
  assert.equal(typeof H.compileManifest, "function");
  assert.equal(typeof H.validateRecord, "function");
  assert.equal(typeof H.validateBoundRecord, "function");
  assert.equal(H.validate_output, H.validateOutput);
  assert.equal(H.validate_record, H.validateRecord);
  assert.equal(H.compile_manifest, H.compileManifest);
  assert.equal(H.authored_hash, H.authoredHash);
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
