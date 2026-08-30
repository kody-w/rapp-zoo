import { canonicalize, domainHash, strictParse } from "./strict-json";
import { parseCompletedGrowl } from "./growl";
import type { JsonObject, JsonValue, ValidatedHolo } from "./types";

const FRAME_KEYS = new Set([
  "spec",
  "kind",
  "stream_id",
  "seq",
  "utc",
  "payload",
  "payload_hash",
  "frame_hash",
  "prev",
  "prev_wave",
  "sig",
]);
const RECORD_KEYS = new Set([
  "schema",
  "holo_seq",
  "visual_parent",
  "source",
  "authored_hash",
  "producer_provenance",
  "authored",
]);
const OUTPUT_KEYS = new Set([
  "schema",
  "base_holo_id",
  "ir_version",
  "renderer_contract",
  "growl",
  "state",
  "transition",
  "performance",
  "accessibility",
]);
const HEX64 = /^[0-9a-f]{64}$/;
const LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const RAPPID =
  /^rappid:@[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*:[0-9a-f]{64}$/;
const MEMORY_STREAM =
  /^(rappid:@[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*:[0-9a-f]{64}):([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class HoloValidationError extends Error {
  constructor(message: string) {
    super(`Holo/1 refused: ${message}`);
    this.name = "HoloValidationError";
  }
}

export function validateHoloRaw(raw: string): ValidatedHolo {
  const root = strictParse(raw);
  const object = asObject(root, "document");
  if (sameKeys(object, FRAME_KEYS)) {
    return validateFrame(object, raw);
  }
  if (sameKeys(object, RECORD_KEYS)) {
    return validateRecordDocument(object, raw);
  }
  throw new HoloValidationError(
    "document must be exactly an eleven-key RAPP frame or rapp-holo-record/1 payload",
  );
}

export function validateHoloValue(value: JsonValue): ValidatedHolo {
  return validateHoloRaw(canonicalize(value));
}

export function validateRappFrameValue(value: JsonValue): JsonObject {
  return validateRappFrame(asObject(value, "frame"));
}

export function verifySourceFrame(
  sourceValue: JsonValue,
  holo: ValidatedHolo,
): JsonObject {
  const source = validateRappFrame(asObject(sourceValue, "source frame"));
  require(source.kind === "memory.chat-turn", "source kind must be memory.chat-turn");
  require(
    source.stream_id === holo.sourceStreamId,
    "source stream does not match record.source",
  );
  require(
    source.seq === holo.sourceSequence,
    "source sequence does not match record.source",
  );
  require(
    source.frame_hash === holo.sourceFrameHash,
    "source hash does not match record.source",
  );
  const payload = asObject(source.payload, "source payload");
  require(payload.role === "assistant", "source payload role must be assistant");
  const outputs = asObject(payload.outputs, "source payload.outputs");
  require(outputs.holo !== undefined, "source payload.outputs.holo is missing");
  require(
    canonicalize(outputs.holo!) === canonicalize(holo.authored),
    "source outputs.holo differs from materialized authored output",
  );
  return source;
}

export function buildPlayerUpdate(
  selected: ValidatedHolo,
  frames: ValidatedHolo[],
  authoritativeHoloId: string,
  reducedMotion: boolean,
): JsonObject {
  const base = selected.visualParent
    ? frames.find((frame) => frame.id === selected.visualParent)
    : undefined;
  return {
    schema: "rapp-holo-player-update/1",
    player_id: "rolling-cores-expo",
    holo_id: selected.id,
    authoritative_holo_id: authoritativeHoloId,
    record: selected.outerFrame ?? selected.record,
    base: base ? base.outerFrame ?? base.record : null,
    history: frames
      .filter((frame) => frame.id !== selected.id)
      .map((frame) => frame.outerFrame ?? frame.record),
    reduced_motion: reducedMotion,
  };
}

function validateFrame(frame: JsonObject, raw: string): ValidatedHolo {
  validateRappFrame(frame);
  require(frame.kind === "body.pulse", "frame.kind must be body.pulse");
  const subject = string(frame.stream_id, "frame.stream_id");
  require(RAPPID.test(subject), "body.pulse stream_id must be a RAPPID");
  require(frame.prev_wave === null, "body frames require prev_wave null");
  const frameHash = hex64(frame.frame_hash, "frame.frame_hash");
  return validateRecord(
    asObject(frame.payload, "frame.payload"),
    subject,
    frameHash,
    raw,
    frame,
  );
}

function validateRecordDocument(record: JsonObject, raw: string): ValidatedHolo {
  const source = exactObject(record.source, ["stream_id", "seq", "frame_hash"], "record.source");
  const stream = string(source.stream_id, "record.source.stream_id");
  const match = MEMORY_STREAM.exec(stream);
  require(match !== null, "record.source.stream_id must be a memory stream");
  return validateRecord(
    record,
    match![1]!,
    domainHash("rapp-holo/1:local-record", record),
    raw,
    null,
  );
}

function validateRecord(
  record: JsonObject,
  subject: string,
  id: string,
  raw: string,
  outerFrame: JsonObject | null,
): ValidatedHolo {
  exactKeys(record, RECORD_KEYS, "record");
  require(record.schema === "rapp-holo-record/1", "record.schema is unsupported");
  const holoSequence = integer(record.holo_seq, "record.holo_seq", 0, Number.MAX_SAFE_INTEGER);
  const visualParent = optionalHex64(record.visual_parent, "record.visual_parent");
  require(
    (holoSequence === 0) === (visualParent === null),
    "genesis and visual_parent rules disagree",
  );
  const source = exactObject(record.source, ["stream_id", "seq", "frame_hash"], "record.source");
  const sourceStreamId = string(source.stream_id, "record.source.stream_id");
  const match = MEMORY_STREAM.exec(sourceStreamId);
  require(match !== null && match[1] === subject, "source subject does not equal body subject");
  const sourceSequence = integer(source.seq, "record.source.seq", 0, Number.MAX_SAFE_INTEGER);
  const sourceFrameHash = hex64(source.frame_hash, "record.source.frame_hash");
  const authoredHash = hex64(record.authored_hash, "record.authored_hash");
  const authored = validateOutput(asObject(record.authored, "record.authored"));
  require(
    domainHash("rapp-holo/1:authored", authored) === authoredHash,
    "record.authored_hash mismatch",
  );
  require(
    optionalHex64(authored.base_holo_id, "authored.base_holo_id") === visualParent,
    "authored.base_holo_id must equal visual_parent",
  );
  validateProvenance(record.producer_provenance, subject, source, authoredHash);
  const accessibility = asObject(authored.accessibility, "authored.accessibility");
  return {
    id,
    raw,
    root: outerFrame ?? record,
    outerFrame,
    record,
    authored,
    subjectRappid: subject,
    holoSequence,
    visualParent,
    sourceStreamId,
    sourceSequence,
    sourceFrameHash,
    authoredHash,
    accessibilityDescription: string(
      accessibility.description,
      "authored.accessibility.description",
    ),
    growl: parseCompletedGrowl(authored.growl),
  };
}

function validateRappFrame(frame: JsonObject): JsonObject {
  exactKeys(frame, FRAME_KEYS, "frame");
  require(frame.spec === "rapp/1", "frame.spec must be rapp/1");
  const kind = string(frame.kind, "frame.kind");
  require(
    /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(kind),
    "frame.kind grammar is invalid",
  );
  const stream = string(frame.stream_id, "frame.stream_id");
  require(
    RAPPID.test(stream) || MEMORY_STREAM.test(stream) || stream.startsWith("net:"),
    "frame.stream_id grammar is invalid",
  );
  integer(frame.seq, "frame.seq", 0, Number.MAX_SAFE_INTEGER);
  require(UTC.test(string(frame.utc, "frame.utc")), "frame.utc is invalid");
  asObject(frame.payload, "frame.payload");
  const payloadHash = hex64(frame.payload_hash, "frame.payload_hash");
  const frameHash = hex64(frame.frame_hash, "frame.frame_hash");
  optionalHex64(frame.prev, "frame.prev");
  optionalHex64(frame.prev_wave, "frame.prev_wave");
  if (frame.sig !== null) string(frame.sig, "frame.sig");
  require(
    domainHash("rapp/1:particle", frame.payload!) === payloadHash,
    "frame.payload_hash mismatch",
  );
  const { frame_hash: ignoredHash, sig: ignoredSignature, ...preimage } = frame;
  void ignoredHash;
  void ignoredSignature;
  require(domainHash("rapp/1:wave", preimage) === frameHash, "frame.frame_hash mismatch");
  return frame;
}

function validateOutput(authored: JsonObject): JsonObject {
  exactKeys(authored, OUTPUT_KEYS, "authored");
  require(authored.schema === "rapp-holo-output/1", "authored.schema is unsupported");
  optionalHex64(authored.base_holo_id, "authored.base_holo_id");
  require(authored.ir_version === "rapp-holo-ir/1", "authored.ir_version is unsupported");
  require(
    authored.renderer_contract === "rapp-holo-renderer/1",
    "authored.renderer_contract is unsupported",
  );
  const nodes = validateState(authored.state);
  validateTransition(authored.transition, nodes, authored.base_holo_id === null);
  validatePerformance(authored.performance, nodes);
  validateAccessibility(authored.accessibility);
  const growl = parseCompletedGrowl(authored.growl);
  require(growl.kind === "playable", growl.message);
  require(
    new TextEncoder().encode(canonicalize(authored)).length <= 256 * 1024,
    "authored output exceeds 256 KiB",
  );
  return authored;
}

function validateState(value: JsonValue | undefined): Map<string, { material: boolean }> {
  const state = exactObject(value, ["camera", "environment", "nodes"], "authored.state");
  const camera = exactObject(
    state.camera,
    ["projection", "position", "target", "up", "near", "far", "fov_mdeg", "ortho_height"],
    "state.camera",
  );
  const projection = string(camera.projection, "state.camera.projection");
  require(["perspective", "orthographic"].includes(projection), "camera projection is invalid");
  const position = vector(camera.position, "state.camera.position", -1_000_000, 1_000_000);
  const target = vector(camera.target, "state.camera.target", -1_000_000, 1_000_000);
  const up = vector(camera.up, "state.camera.up", -1000, 1000);
  require(canonicalize(position) !== canonicalize(target), "camera position equals target");
  require(up.some((component) => component !== 0), "camera up vector is zero");
  const near = integer(camera.near, "state.camera.near", 1, 1_000_000);
  const far = integer(camera.far, "state.camera.far", 2, 10_000_000);
  require(far > near, "camera far must exceed near");
  if (projection === "perspective") {
    integer(camera.fov_mdeg, "state.camera.fov_mdeg", 1000, 179_000);
    require(camera.ortho_height === null, "perspective ortho_height must be null");
  } else {
    require(camera.fov_mdeg === null, "orthographic fov_mdeg must be null");
    integer(camera.ortho_height, "state.camera.ortho_height", 1, 2_000_000);
  }
  const environment = exactObject(
    state.environment,
    ["clear_color", "fog"],
    "state.environment",
  );
  color(environment.clear_color, "state.environment.clear_color");
  if (environment.fog !== null) {
    const fog = exactObject(environment.fog, ["color", "near", "far"], "state.environment.fog");
    color(fog.color, "state.environment.fog.color");
    const fogNear = integer(fog.near, "state.environment.fog.near", 1, 10_000_000);
    const fogFar = integer(fog.far, "state.environment.fog.far", 2, 10_000_000);
    require(fogFar > fogNear, "fog far must exceed near");
  }
  const values = array(state.nodes, "state.nodes");
  require(values.length <= 128, "state.nodes exceeds 128 entries");
  const nodes = new Map<string, { material: boolean }>();
  const depths = new Map<string, number>();
  values.forEach((value, index) => {
    const path = `state.nodes[${index}]`;
    const node = exactObject(
      value,
      ["id", "parent", "type", "visible", "transform", "geometry", "material"],
      path,
    );
    const id = label(node.id, `${path}.id`);
    require(!nodes.has(id), `${path}.id is duplicated`);
    let depth = 0;
    if (node.parent !== null) {
      const parent = label(node.parent, `${path}.parent`);
      require(nodes.has(parent), `${path}.parent must precede its child`);
      depth = (depths.get(parent) ?? 0) + 1;
      require(depth <= 8, `${path} exceeds parent depth eight`);
    }
    const type = string(node.type, `${path}.type`);
    require(
      ["group", "primitive", "mesh", "polyline", "points", "light"].includes(type),
      `${path}.type is unsupported`,
    );
    boolean(node.visible, `${path}.visible`);
    validateTransform(node.transform, `${path}.transform`);
    if (type === "group") {
      require(node.geometry === null && node.material === null, `${path} group data must be null`);
    } else if (type === "light") {
      validateLight(node.geometry, `${path}.geometry`);
      require(node.material === null, `${path}.material must be null for light`);
    } else {
      validateGeometry(node.geometry, type, `${path}.geometry`);
      validateMaterial(node.material, type, `${path}.material`);
    }
    nodes.set(id, { material: node.material !== null });
    depths.set(id, depth);
  });
  return nodes;
}

function validateTransform(value: JsonValue | undefined, path: string): void {
  const transform = exactObject(value, ["position", "rotation", "scale"], path);
  vector(transform.position, `${path}.position`, -1_000_000, 1_000_000);
  vector(transform.rotation, `${path}.rotation`, -360_000, 360_000);
  vector(transform.scale, `${path}.scale`, 1, 100_000);
}

function validateGeometry(value: JsonValue | undefined, type: string, path: string): void {
  const geometry = asObject(value, path);
  if (type === "primitive") {
    const shape = string(geometry.shape, `${path}.shape`);
    if (["sphere", "tetrahedron", "octahedron", "icosahedron"].includes(shape)) {
      exactKeys(geometry, new Set(["shape", "radius", "detail"]), path);
      integer(geometry.radius, `${path}.radius`, 1, 1_000_000);
      integer(geometry.detail, `${path}.detail`, 0, 5);
    } else if (shape === "box") {
      exactKeys(geometry, new Set(["shape", "size"]), path);
      vector(geometry.size, `${path}.size`, 1, 2_000_000);
    } else if (["capsule", "cylinder", "cone"].includes(shape)) {
      exactKeys(geometry, new Set(["shape", "radius", "height", "detail"]), path);
      const radius = integer(geometry.radius, `${path}.radius`, 1, 1_000_000);
      const height = integer(geometry.height, `${path}.height`, 1, 2_000_000);
      integer(geometry.detail, `${path}.detail`, 3, 128);
      if (shape === "capsule") require(height >= radius * 2, "capsule height is too small");
    } else if (["torus", "ring"].includes(shape)) {
      exactKeys(
        geometry,
        new Set(["shape", "major_radius", "minor_radius", "detail"]),
        path,
      );
      const major = integer(geometry.major_radius, `${path}.major_radius`, 2, 1_000_000);
      const minor = integer(geometry.minor_radius, `${path}.minor_radius`, 1, 999_999);
      require(minor < major, "minor_radius must be less than major_radius");
      integer(geometry.detail, `${path}.detail`, 3, 128);
    } else if (shape === "plane") {
      exactKeys(geometry, new Set(["shape", "width", "height"]), path);
      integer(geometry.width, `${path}.width`, 1, 2_000_000);
      integer(geometry.height, `${path}.height`, 1, 2_000_000);
    } else if (shape === "shapee") {
      exactKeys(
        geometry,
        new Set(["shape", "seed", "width", "height", "depth", "teeth", "relief"]),
        path,
      );
      hex64(geometry.seed, `${path}.seed`);
      integer(geometry.width, `${path}.width`, 1, 2_000_000);
      integer(geometry.height, `${path}.height`, 1, 2_000_000);
      integer(geometry.depth, `${path}.depth`, 1, 1_000_000);
      integer(geometry.teeth, `${path}.teeth`, 3, 128);
      integer(geometry.relief, `${path}.relief`, 0, 1_000_000);
    } else throw new HoloValidationError(`${path}.shape is unsupported`);
    return;
  }
  if (type === "mesh") {
    exactKeys(geometry, new Set(["vertices", "triangles"]), path);
    const vertices = array(geometry.vertices, `${path}.vertices`);
    require(vertices.length >= 3 && vertices.length <= 4096, "mesh vertex count is invalid");
    vertices.forEach((vertex, index) =>
      vector(vertex, `${path}.vertices[${index}]`, -1_000_000, 1_000_000),
    );
    const triangles = array(geometry.triangles, `${path}.triangles`);
    require(triangles.length >= 1 && triangles.length <= 8192, "mesh triangle count is invalid");
    triangles.forEach((triangle, index) => {
      const indices = vector(triangle, `${path}.triangles[${index}]`, 0, 4095);
      require(new Set(indices).size === 3, "triangle indices must be distinct");
      require(indices.every((value) => value < vertices.length), "triangle index is out of range");
    });
    return;
  }
  if (type === "polyline") {
    exactKeys(geometry, new Set(["points", "closed", "width"]), path);
    const points = array(geometry.points, `${path}.points`);
    require(points.length >= 2 && points.length <= 8192, "polyline point count is invalid");
    points.forEach((point, index) =>
      vector(point, `${path}.points[${index}]`, -1_000_000, 1_000_000),
    );
    boolean(geometry.closed, `${path}.closed`);
    integer(geometry.width, `${path}.width`, 1, 100_000);
    return;
  }
  if (type === "points") {
    exactKeys(geometry, new Set(["points"]), path);
    const points = array(geometry.points, `${path}.points`);
    require(points.length >= 1 && points.length <= 8192, "point count is invalid");
    points.forEach((point, index) => {
      const item = exactObject(point, ["position", "size"], `${path}.points[${index}]`);
      vector(item.position, `${path}.points[${index}].position`, -1_000_000, 1_000_000);
      integer(item.size, `${path}.points[${index}].size`, 1, 100_000);
    });
  }
}

function validateLight(value: JsonValue | undefined, path: string): void {
  const light = exactObject(
    value,
    ["kind", "color", "intensity", "range", "angle_mdeg", "direction"],
    path,
  );
  const kind = string(light.kind, `${path}.kind`);
  require(["ambient", "directional", "point", "spot"].includes(kind), "light kind is invalid");
  color(light.color, `${path}.color`);
  integer(light.intensity, `${path}.intensity`, 0, 10_000);
  if (kind === "point" || kind === "spot") {
    integer(light.range, `${path}.range`, 1, 10_000_000);
  } else require(light.range === null, `${path}.range must be null`);
  if (kind === "spot") integer(light.angle_mdeg, `${path}.angle_mdeg`, 1, 179_000);
  else require(light.angle_mdeg === null, `${path}.angle_mdeg must be null`);
  if (kind === "directional" || kind === "spot") {
    const direction = vector(light.direction, `${path}.direction`, -1000, 1000);
    require(direction.some((component) => component !== 0), "light direction is zero");
  } else require(light.direction === null, `${path}.direction must be null`);
}

function validateMaterial(value: JsonValue | undefined, type: string, path: string): void {
  const material = exactObject(
    value,
    [
      "color",
      "emissive",
      "emissive_strength",
      "opacity",
      "presentation",
      "blend",
      "side",
      "metallic",
      "roughness",
    ],
    path,
  );
  color(material.color, `${path}.color`);
  color(material.emissive, `${path}.emissive`);
  integer(material.emissive_strength, `${path}.emissive_strength`, 0, 10_000);
  integer(material.opacity, `${path}.opacity`, 0, 1000);
  const presentation = string(material.presentation, `${path}.presentation`);
  const presentations: Record<string, string[]> = {
    primitive: ["solid", "wire"],
    mesh: ["solid", "wire"],
    polyline: ["line"],
    points: ["points"],
  };
  require(presentations[type]!.includes(presentation), "material presentation is invalid");
  require(["normal", "additive", "multiply"].includes(string(material.blend, `${path}.blend`)), "blend is invalid");
  require(["front", "double"].includes(string(material.side, `${path}.side`)), "side is invalid");
  const metallic = integer(material.metallic, `${path}.metallic`, 0, 1000);
  const roughness = integer(material.roughness, `${path}.roughness`, 0, 1000);
  if (presentation !== "solid") {
    require(metallic === 0 && roughness === 1000, "non-solid material PBR values are invalid");
  }
}

function validateTransition(
  value: JsonValue | undefined,
  nodes: Map<string, { material: boolean }>,
  genesis: boolean,
): void {
  const transition = exactObject(value, ["duration_ms", "easing", "default", "nodes"], "transition");
  integer(transition.duration_ms, "transition.duration_ms", 0, 10_000);
  require(
    ["linear", "ease-in", "ease-out", "ease-in-out"].includes(
      string(transition.easing, "transition.easing"),
    ),
    "transition easing is invalid",
  );
  require(
    ["cut", "crossfade"].includes(string(transition.default, "transition.default")),
    "transition default is invalid",
  );
  const rules = array(transition.nodes, "transition.nodes");
  require(rules.length <= 128, "transition nodes exceed 128");
  const seen = new Set<string>();
  rules.forEach((value, index) => {
    const rule = exactObject(value, ["id", "mode"], `transition.nodes[${index}]`);
    const id = label(rule.id, `transition.nodes[${index}].id`);
    require(!seen.has(id), "transition node ID is duplicated");
    seen.add(id);
    const mode = string(rule.mode, `transition.nodes[${index}].mode`);
    require(
      ["cut", "fade-in", "fade-out", "crossfade", "interpolate"].includes(mode),
      "transition node mode is invalid",
    );
    if (mode === "fade-in") require(nodes.has(id), "fade-in node is missing from new state");
    if (genesis) {
      require(["cut", "fade-in"].includes(mode) && nodes.has(id), "genesis references prior state");
    }
  });
}

function validatePerformance(
  value: JsonValue | undefined,
  nodes: Map<string, { material: boolean }>,
): void {
  const performance = exactObject(value, ["clock", "sustain"], "performance");
  require(performance.clock === "rapp-holo-logical-ms/1", "performance clock is invalid");
  const sustain = exactObject(
    performance.sustain,
    ["duration_ms", "repeat", "tracks", "flipbook"],
    "performance.sustain",
  );
  const duration = integer(sustain.duration_ms, "performance.sustain.duration_ms", 0, 60_000);
  const repeat = string(sustain.repeat, "performance.sustain.repeat");
  require(["hold", "once", "loop", "ping-pong"].includes(repeat), "sustain repeat is invalid");
  const tracks = array(sustain.tracks, "performance.sustain.tracks");
  const flipbook = array(sustain.flipbook, "performance.sustain.flipbook");
  if (repeat === "hold") {
    require(duration === 0 && tracks.length === 0 && flipbook.length === 0, "hold timeline is invalid");
  } else require(duration > 0, "non-hold sustain requires positive duration");
  require(tracks.length <= 512 && flipbook.length <= 16, "performance budget is exceeded");
  tracks.forEach((value, index) => {
    const path = `performance.sustain.tracks[${index}]`;
    const track = exactObject(value, ["node_id", "property", "interpolation", "keyframes"], path);
    const nodeId = label(track.node_id, `${path}.node_id`);
    require(nodes.has(nodeId), "track target does not exist");
    const property = string(track.property, `${path}.property`);
    require(
      [
        "transform.position",
        "transform.rotation",
        "transform.scale",
        "material.color",
        "material.emissive",
        "material.opacity",
        "visible",
      ].includes(property),
      "track property is invalid",
    );
    if (property.startsWith("material.")) {
      require(nodes.get(nodeId)!.material, "material track targets a node without material");
    }
    const interpolation = string(track.interpolation, `${path}.interpolation`);
    require(
      ["step", "linear", "ease-in", "ease-out", "ease-in-out"].includes(interpolation),
      "track interpolation is invalid",
    );
    if (property === "visible") require(interpolation === "step", "visible track must use step");
    const keyframes = array(track.keyframes, `${path}.keyframes`);
    require(keyframes.length >= 1 && keyframes.length <= 64, "keyframe count is invalid");
    let previous = -1;
    keyframes.forEach((value, keyframeIndex) => {
      const keyframe = exactObject(value, ["at_ms", "value"], `${path}.keyframes[${keyframeIndex}]`);
      const at = integer(keyframe.at_ms, `${path}.keyframes[${keyframeIndex}].at_ms`, 0, 60_000);
      require(at > previous && at <= duration, "keyframe timing is invalid");
      if (keyframeIndex === 0) require(at === 0, "first keyframe must start at zero");
      validateTrackValue(keyframe.value, property, `${path}.keyframes[${keyframeIndex}].value`);
      previous = at;
    });
  });
  let previous = -1;
  flipbook.forEach((value, index) => {
    const path = `performance.sustain.flipbook[${index}]`;
    const entry = exactObject(value, ["at_ms", "holo_id", "blend", "blend_ms"], path);
    const at = integer(entry.at_ms, `${path}.at_ms`, 0, 60_000);
    require(at > previous && at <= duration, "flipbook timing is invalid");
    if (index === 0) require(at === 0, "first flipbook entry must start at zero");
    const id = string(entry.holo_id, `${path}.holo_id`);
    require(id === "self" || HEX64.test(id), "flipbook holo_id is invalid");
    const blend = string(entry.blend, `${path}.blend`);
    require(["cut", "crossfade"].includes(blend), "flipbook blend is invalid");
    const blendMs = integer(entry.blend_ms, `${path}.blend_ms`, 0, 10_000);
    if (blend === "cut") require(blendMs === 0, "cut requires blend_ms zero");
    previous = at;
  });
}

function validateTrackValue(value: JsonValue | undefined, property: string, path: string): void {
  if (property === "transform.position") vector(value, path, -1_000_000, 1_000_000);
  else if (property === "transform.rotation") vector(value, path, -360_000, 360_000);
  else if (property === "transform.scale") vector(value, path, 1, 100_000);
  else if (property === "material.color" || property === "material.emissive") color(value, path);
  else if (property === "material.opacity") integer(value, path, 0, 1000);
  else boolean(value, path);
}

function validateAccessibility(value: JsonValue | undefined): void {
  const accessibility = exactObject(value, ["description", "reduced_motion"], "accessibility");
  const description = string(accessibility.description, "accessibility.description");
  require(description.length >= 1 && description.length <= 1024, "accessibility description is invalid");
  require(
    ["hold", "crossfade"].includes(
      string(accessibility.reduced_motion, "accessibility.reduced_motion"),
    ),
    "accessibility reduced_motion is invalid",
  );
}

function validateProvenance(
  value: JsonValue | undefined,
  subject: string,
  source: JsonObject,
  authoredHash: string,
): void {
  if (value === null) return;
  const provenance = exactObject(value, ["statement", "sig"], "record.producer_provenance");
  const statement = exactObject(
    provenance.statement,
    [
      "schema",
      "subject_rappid",
      "producer_rappid",
      "source_stream_id",
      "source_seq",
      "source_frame_hash",
      "authored_hash",
      "issued_utc",
    ],
    "record.producer_provenance.statement",
  );
  require(statement.schema === "rapp-holo-provenance/1", "provenance schema is invalid");
  require(statement.subject_rappid === subject, "provenance subject mismatch");
  require(statement.source_stream_id === source.stream_id, "provenance source stream mismatch");
  require(statement.source_seq === source.seq, "provenance source sequence mismatch");
  require(statement.source_frame_hash === source.frame_hash, "provenance source hash mismatch");
  require(statement.authored_hash === authoredHash, "provenance authored hash mismatch");
  require(UTC.test(string(statement.issued_utc, "provenance.issued_utc")), "provenance UTC is invalid");
  string(provenance.sig, "record.producer_provenance.sig");
}

function exactObject(value: JsonValue | undefined, keys: string[], path: string): JsonObject {
  const object = asObject(value, path);
  exactKeys(object, new Set(keys), path);
  return object;
}

function exactKeys(value: JsonObject, keys: Set<string>, path: string): void {
  const actual = new Set(Object.keys(value));
  if (!setsEqual(actual, keys)) {
    const missing = [...keys].filter((key) => !actual.has(key)).sort();
    const extra = [...actual].filter((key) => !keys.has(key)).sort();
    throw new HoloValidationError(
      `${path} keys differ; missing=[${missing.join(",")}] extra=[${extra.join(",")}]`,
    );
  }
}

function sameKeys(value: JsonObject, keys: Set<string>): boolean {
  return setsEqual(new Set(Object.keys(value)), keys);
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function asObject(value: JsonValue | undefined, path: string): JsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new HoloValidationError(`${path} must be an object`);
  }
  return value;
}

function array(value: JsonValue | undefined, path: string): JsonValue[] {
  if (!Array.isArray(value)) throw new HoloValidationError(`${path} must be an array`);
  return value;
}

function string(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string") throw new HoloValidationError(`${path} must be a string`);
  return value;
}

function boolean(value: JsonValue | undefined, path: string): boolean {
  if (typeof value !== "boolean") throw new HoloValidationError(`${path} must be boolean`);
  return value;
}

function integer(value: JsonValue | undefined, path: string, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new HoloValidationError(`${path} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function vector(value: JsonValue | undefined, path: string, minimum: number, maximum: number): number[] {
  const values = array(value, path);
  require(values.length === 3, `${path} must contain exactly three integers`);
  return values.map((item, index) => integer(item, `${path}[${index}]`, minimum, maximum));
}

function label(value: JsonValue | undefined, path: string): string {
  const result = string(value, path);
  require(result.length <= 64 && LABEL.test(result), `${path} must be a bounded lowercase label`);
  return result;
}

function color(value: JsonValue | undefined, path: string): string {
  const result = string(value, path);
  require(COLOR.test(result), `${path} must be #RRGGBB or #RRGGBBAA`);
  return result;
}

function hex64(value: JsonValue | undefined, path: string): string {
  const result = string(value, path);
  require(HEX64.test(result), `${path} must be 64 lowercase hexadecimal characters`);
  return result;
}

function optionalHex64(value: JsonValue | undefined, path: string): string | null {
  return value === null ? null : hex64(value, path);
}

function require(condition: unknown, message: string): asserts condition {
  if (!condition) throw new HoloValidationError(message);
}
