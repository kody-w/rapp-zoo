(function (global) {
  "use strict";

  const S = 1000000;
  const MAX_SAFE_INTEGER = 9007199254740991;
  const MAX_AUTHORED_BYTES = 256 * 1024;
  const MAX_REFERENCED_STATE_BYTES = 4 * 1024 * 1024;
  const OUTPUT_KEYS = [
    "schema", "base_holo_id", "ir_version", "renderer_contract",
    "state", "transition", "performance", "accessibility",
  ];
  const RECORD_KEYS = [
    "schema", "holo_seq", "visual_parent", "source",
    "authored_hash", "producer_provenance", "authored",
  ];
  const NODE_KEYS = [
    "id", "parent", "type", "visible", "transform", "geometry", "material",
  ];
  const EASINGS = new Set(["linear", "ease-in", "ease-out", "ease-in-out"]);
  const TRACK_EASINGS = new Set(["step", ...EASINGS]);
  const TRACK_PROPERTIES = new Set([
    "transform.position", "transform.rotation", "transform.scale",
    "material.color", "material.emissive", "material.opacity", "visible",
  ]);
  const HEX64_RE = /^[0-9a-f]{64}$/;
  const NODE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const COLOR_RE = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;
  const RAPPID_RE = /^rappid:@([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-z0-9]+(?:-[a-z0-9]+)*):([0-9a-f]{64})$/;
  const MEMORY_STREAM_RE = /^(rappid:@[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*:[0-9a-f]{64}):([a-z0-9]+(?:-[a-z0-9]+)*)$/;
  const UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const UNSET = Symbol("unset");

  class HoloProtocolError extends Error {
    constructor(message) {
      super(message);
      this.name = "HoloProtocolError";
    }
  }

  function fail(path, reason) {
    throw new HoloProtocolError(`${path}: ${reason}`);
  }

  function sameKeys(value, keys) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length
      && actual.every((key, index) => key === expected[index]);
  }

  function objectValue(value, keys, path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail(path, "must be an object");
    }
    if (!sameKeys(value, keys)) {
      const actual = new Set(Object.keys(value));
      const expected = new Set(keys);
      const missing = [...expected].filter((key) => !actual.has(key)).sort();
      const extra = [...actual].filter((key) => !expected.has(key)).sort();
      fail(path, `must contain exact keys; missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}`);
    }
    return value;
  }

  function arrayValue(value, path, minimum = 0, maximum = null) {
    if (!Array.isArray(value)) fail(path, "must be an array");
    if (value.length < minimum || (maximum !== null && value.length > maximum)) {
      fail(path, `length must be between ${minimum} and ${maximum}`);
    }
    return value;
  }

  function integer(value, path, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      fail(path, `must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
  }

  function stringValue(value, path, minimum = 0, maximum = null) {
    if (typeof value !== "string") fail(path, "must be a string");
    if (value.length < minimum || (maximum !== null && value.length > maximum)) {
      fail(path, `length must be between ${minimum} and ${maximum}`);
    }
    return value;
  }

  function enumValue(value, choices, path) {
    if (typeof value !== "string" || !choices.has(value)) {
      fail(path, `must be one of ${JSON.stringify([...choices].sort())}`);
    }
    return value;
  }

  function booleanValue(value, path) {
    if (typeof value !== "boolean") fail(path, "must be a boolean");
    return value;
  }

  function hex64(value, path) {
    if (typeof value !== "string" || !HEX64_RE.test(value)) {
      fail(path, "must be 64 lowercase hexadecimal characters");
    }
    return value;
  }

  function nodeId(value, path) {
    if (typeof value !== "string" || value.length < 1 || value.length > 64
        || !NODE_ID_RE.test(value)) {
      fail(path, "must be a bounded lowercase label");
    }
    return value;
  }

  function color(value, path) {
    if (typeof value !== "string" || !COLOR_RE.test(value)) {
      fail(path, "must be #RRGGBB or #RRGGBBAA");
    }
    return value;
  }

  function vector(value, path, minimum, maximum) {
    return arrayValue(value, path, 3, 3)
      .map((item, index) => integer(item, `${path}[${index}]`, minimum, maximum));
  }

  function nonzero(value) {
    return value.some((component) => component !== 0);
  }

  function colorChannels(value) {
    let raw = value.slice(1);
    if (raw.length === 6) raw += "FF";
    return [0, 2, 4, 6].map((index) => Number.parseInt(raw.slice(index, index + 2), 16));
  }

  function clone(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(clone);
    const result = {};
    for (const key of Object.keys(value)) result[key] = clone(value[key]);
    return result;
  }

  function validUnicode(value) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
        index += 1;
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        return false;
      }
    }
    return true;
  }

  function canonical(value, depth = 1) {
    if (depth > 64) throw new HoloProtocolError("JSON nesting exceeds 64");
    if (value === null || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) {
        throw new HoloProtocolError("numbers must be interoperable integers");
      }
      return JSON.stringify(value);
    }
    if (typeof value === "string") {
      if (!validUnicode(value)) throw new HoloProtocolError("unpaired UTF-16 surrogate");
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`;
    }
    if (typeof value === "object") {
      const keys = Object.keys(value);
      for (const key of keys) {
        if (!validUnicode(key)) throw new HoloProtocolError("unpaired UTF-16 surrogate in key");
      }
      keys.sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
    }
    throw new HoloProtocolError(`non-I-JSON value: ${typeof value}`);
  }

  function utf8(value) {
    const bytes = [];
    for (let index = 0; index < value.length; index += 1) {
      let code = value.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const low = value.charCodeAt(index + 1);
        if (!(low >= 0xDC00 && low <= 0xDFFF)) {
          throw new HoloProtocolError("unpaired UTF-16 surrogate");
        }
        code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
        index += 1;
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        throw new HoloProtocolError("unpaired UTF-16 surrogate");
      }
      if (code <= 0x7F) bytes.push(code);
      else if (code <= 0x7FF) {
        bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code <= 0xFFFF) {
        bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        bytes.push(
          0xF0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3F),
          0x80 | ((code >> 6) & 0x3F),
          0x80 | (code & 0x3F),
        );
      }
    }
    return bytes;
  }

  function rotateRight(value, count) {
    return (value >>> count) | (value << (32 - count));
  }

  function sha256(bytes) {
    const constants = [
      0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
      0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
      0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
      0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
      0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
      0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
      0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
      0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
    ];
    const data = bytes.slice();
    const bitLength = data.length * 8;
    data.push(0x80);
    while (data.length % 64 !== 56) data.push(0);
    const high = Math.floor(bitLength / 0x100000000);
    const low = bitLength >>> 0;
    data.push(
      (high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255,
      (low >>> 24) & 255, (low >>> 16) & 255, (low >>> 8) & 255, low & 255,
    );
    const hash = [
      0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A,
      0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
    ];
    const words = new Array(64);
    for (let offset = 0; offset < data.length; offset += 64) {
      for (let index = 0; index < 16; index += 1) {
        const at = offset + index * 4;
        words[index] = (
          (data[at] << 24) | (data[at + 1] << 16)
          | (data[at + 2] << 8) | data[at + 3]
        ) >>> 0;
      }
      for (let index = 16; index < 64; index += 1) {
        const x = words[index - 15];
        const y = words[index - 2];
        const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
        const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
        words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choice = (e & f) ^ (~e & g);
        const temp1 = (h + s1 + choice + constants[index] + words[index]) >>> 0;
        const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (s0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }
    return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
  }

  function domainHash(space, value) {
    if (typeof space !== "string" || /[^\x00-\x7F]/.test(space)) {
      throw new HoloProtocolError("hash domain must be an ASCII string");
    }
    return sha256([...utf8(space), 10, ...utf8(canonical(value))]);
  }

  function canonicalAuthoredBytes(authored) {
    const bytes = utf8(canonical(authored));
    if (bytes.length > MAX_AUTHORED_BYTES) {
      throw new HoloProtocolError("authored output exceeds 256 KiB");
    }
    return bytes;
  }

  function authoredHash(authored) {
    canonicalAuthoredBytes(authored);
    return domainHash("rapp-holo/1:authored", authored);
  }

  function roundDiv(numerator, denominator) {
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
      throw new HoloProtocolError("roundDiv requires safe integers");
    }
    if (denominator <= 0) throw new HoloProtocolError("roundDiv denominator must be positive");
    const absolute = Math.abs(numerator);
    let quotient = Math.trunc(absolute / denominator);
    const remainder = absolute % denominator;
    if (2 * remainder >= denominator) quotient += 1;
    return numerator < 0 ? -quotient : quotient;
  }

  function easing(name, progress) {
    enumValue(name, EASINGS, "easing");
    integer(progress, "progress", 0, S);
    if (name === "linear") return progress;
    if (name === "ease-in") return roundDiv(progress * progress, S);
    if (name === "ease-out") {
      const remainder = S - progress;
      return S - roundDiv(remainder * remainder, S);
    }
    if (progress <= S / 2) return roundDiv(2 * progress * progress, S);
    const remainder = S - progress;
    return S - roundDiv(2 * remainder * remainder, S);
  }

  function localSustainTime(activeT, transitionDurationMs, durationMs, repeat) {
    integer(activeT, "activeT", 0, MAX_SAFE_INTEGER);
    integer(transitionDurationMs, "transitionDurationMs", 0, 10000);
    integer(durationMs, "durationMs", 0, 60000);
    enumValue(repeat, new Set(["hold", "once", "loop", "ping-pong"]), "repeat");
    const sustainT = Math.max(0, activeT - transitionDurationMs);
    if (repeat === "hold") {
      if (durationMs !== 0) throw new HoloProtocolError("hold sustain duration must be zero");
      return 0;
    }
    if (durationMs <= 0) throw new HoloProtocolError("non-hold sustain duration must be positive");
    if (repeat === "once") return Math.min(sustainT, durationMs);
    if (repeat === "loop") return sustainT % durationMs;
    const phase = sustainT % (2 * durationMs);
    return phase <= durationMs ? phase : 2 * durationMs - phase;
  }

  function lerp(left, right, progress) {
    return left + roundDiv((right - left) * progress, S);
  }

  function evaluatedValue(property, value) {
    if (property === "material.color" || property === "material.emissive") {
      return colorChannels(value);
    }
    return clone(value);
  }

  function evaluatePropertyTrack(track, localT) {
    integer(localT, "localT", 0, MAX_SAFE_INTEGER);
    validateTrackShape(track, null, 60000, "track");
    const keyframes = track.keyframes;
    if (localT >= keyframes[keyframes.length - 1].at_ms) {
      return evaluatedValue(track.property, keyframes[keyframes.length - 1].value);
    }
    const rightIndex = keyframes.findIndex((keyframe) => keyframe.at_ms > localT);
    const left = keyframes[rightIndex - 1];
    const right = keyframes[rightIndex];
    if (track.interpolation === "step") return evaluatedValue(track.property, left.value);
    const progress = roundDiv(
      (localT - left.at_ms) * S,
      right.at_ms - left.at_ms,
    );
    const eased = easing(track.interpolation, progress);
    let leftValue = left.value;
    let rightValue = right.value;
    if (track.property === "material.color" || track.property === "material.emissive") {
      leftValue = colorChannels(leftValue);
      rightValue = colorChannels(rightValue);
    }
    if (Array.isArray(leftValue)) {
      return leftValue.map((value, index) => lerp(value, rightValue[index], eased));
    }
    return lerp(leftValue, rightValue, eased);
  }

  function weightedLayers(previous, following, progress) {
    if (progress <= 0) return [{ holo_id: previous, weight: S }];
    if (progress >= S) return [{ holo_id: following, weight: S }];
    return [
      { holo_id: previous, weight: S - progress },
      { holo_id: following, weight: progress },
    ];
  }

  function selectFlipbook(flipbook, localT, durationMs, repeat) {
    integer(localT, "localT", 0, MAX_SAFE_INTEGER);
    integer(durationMs, "durationMs", 0, 60000);
    enumValue(repeat, new Set(["hold", "once", "loop", "ping-pong"]), "repeat");
    const entries = arrayValue(flipbook, "flipbook", 0, 16);
    if (entries.length === 0) return [{ holo_id: "self", weight: S }];
    validateFlipbook(entries, durationMs, repeat, null, false);
    const timelineT = Math.min(localT, durationMs);
    const first = entries[0];
    if (repeat === "loop" && first.blend === "crossfade" && first.blend_ms > 0
        && timelineT >= durationMs - first.blend_ms) {
      const progress = roundDiv(
        (timelineT - (durationMs - first.blend_ms)) * S,
        first.blend_ms,
      );
      return weightedLayers(entries[entries.length - 1].holo_id, first.holo_id, progress);
    }
    let currentIndex = 0;
    entries.forEach((entry, index) => {
      if (entry.at_ms <= timelineT) currentIndex = index;
    });
    if (currentIndex + 1 < entries.length) {
      const following = entries[currentIndex + 1];
      if (following.blend === "crossfade" && following.blend_ms > 0
          && timelineT >= following.at_ms - following.blend_ms) {
        const progress = roundDiv(
          (timelineT - (following.at_ms - following.blend_ms)) * S,
          following.blend_ms,
        );
        return weightedLayers(entries[currentIndex].holo_id, following.holo_id, progress);
      }
    }
    return [{ holo_id: entries[currentIndex].holo_id, weight: S }];
  }

  function validateTransform(value, path) {
    const object = objectValue(value, ["position", "rotation", "scale"], path);
    vector(object.position, `${path}.position`, -1000000, 1000000);
    vector(object.rotation, `${path}.rotation`, -360000, 360000);
    vector(object.scale, `${path}.scale`, 1, 100000);
  }

  function validateCamera(value, path) {
    const object = objectValue(value, [
      "projection", "position", "target", "up", "near", "far",
      "fov_mdeg", "ortho_height",
    ], path);
    const projection = enumValue(object.projection, new Set(["perspective", "orthographic"]), `${path}.projection`);
    const position = vector(object.position, `${path}.position`, -1000000, 1000000);
    const target = vector(object.target, `${path}.target`, -1000000, 1000000);
    const up = vector(object.up, `${path}.up`, -1000, 1000);
    const near = integer(object.near, `${path}.near`, 1, 1000000);
    const far = integer(object.far, `${path}.far`, 2, 10000000);
    if (position.every((item, index) => item === target[index])) {
      fail(path, "camera position must differ from target");
    }
    if (!nonzero(up)) fail(path, "camera up vector must be nonzero");
    if (far <= near) fail(path, "camera far must be greater than near");
    if (projection === "perspective") {
      integer(object.fov_mdeg, `${path}.fov_mdeg`, 1000, 179000);
      if (object.ortho_height !== null) fail(`${path}.ortho_height`, "must be null for perspective");
    } else {
      if (object.fov_mdeg !== null) fail(`${path}.fov_mdeg`, "must be null for orthographic");
      integer(object.ortho_height, `${path}.ortho_height`, 1, 2000000);
    }
  }

  function validateEnvironment(value, path) {
    const object = objectValue(value, ["clear_color", "fog"], path);
    color(object.clear_color, `${path}.clear_color`);
    if (object.fog === null) return;
    const fog = objectValue(object.fog, ["color", "near", "far"], `${path}.fog`);
    color(fog.color, `${path}.fog.color`);
    const near = integer(fog.near, `${path}.fog.near`, 1, 10000000);
    const far = integer(fog.far, `${path}.fog.far`, 2, 10000000);
    if (far <= near) fail(`${path}.fog`, "fog far must be greater than near");
  }

  function validateMaterial(value, nodeType, path) {
    const object = objectValue(value, [
      "color", "emissive", "emissive_strength", "opacity", "presentation",
      "blend", "side", "metallic", "roughness",
    ], path);
    color(object.color, `${path}.color`);
    color(object.emissive, `${path}.emissive`);
    integer(object.emissive_strength, `${path}.emissive_strength`, 0, 10000);
    integer(object.opacity, `${path}.opacity`, 0, 1000);
    const presentation = enumValue(
      object.presentation,
      new Set(["solid", "wire", "points", "line"]),
      `${path}.presentation`,
    );
    enumValue(object.blend, new Set(["normal", "additive", "multiply"]), `${path}.blend`);
    enumValue(object.side, new Set(["front", "double"]), `${path}.side`);
    const metallic = integer(object.metallic, `${path}.metallic`, 0, 1000);
    const roughness = integer(object.roughness, `${path}.roughness`, 0, 1000);
    const allowed = {
      primitive: new Set(["solid", "wire"]),
      mesh: new Set(["solid", "wire"]),
      polyline: new Set(["line"]),
      points: new Set(["points"]),
    }[nodeType];
    if (!allowed.has(presentation)) fail(path, `${presentation} presentation is incompatible with ${nodeType}`);
    if (presentation !== "solid" && (metallic !== 0 || roughness !== 1000)) {
      fail(path, "non-solid material requires metallic 0 and roughness 1000");
    }
  }

  function validatePrimitive(value, path) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || typeof value.shape !== "string") {
      fail(path, "primitive geometry must declare a shape");
    }
    const shape = value.shape;
    if (new Set(["sphere", "tetrahedron", "octahedron", "icosahedron"]).has(shape)) {
      const object = objectValue(value, ["shape", "radius", "detail"], path);
      integer(object.radius, `${path}.radius`, 1, 1000000);
      integer(object.detail, `${path}.detail`, 0, 5);
    } else if (shape === "box") {
      const object = objectValue(value, ["shape", "size"], path);
      vector(object.size, `${path}.size`, 1, 2000000);
    } else if (new Set(["capsule", "cylinder", "cone"]).has(shape)) {
      const object = objectValue(value, ["shape", "radius", "height", "detail"], path);
      const radius = integer(object.radius, `${path}.radius`, 1, 1000000);
      const height = integer(object.height, `${path}.height`, 1, 2000000);
      integer(object.detail, `${path}.detail`, 3, 128);
      if (shape === "capsule" && height < 2 * radius) {
        fail(path, "capsule height must be at least twice its radius");
      }
    } else if (new Set(["torus", "ring"]).has(shape)) {
      const object = objectValue(value, ["shape", "major_radius", "minor_radius", "detail"], path);
      const major = integer(object.major_radius, `${path}.major_radius`, 2, 1000000);
      const minor = integer(object.minor_radius, `${path}.minor_radius`, 1, 999999);
      integer(object.detail, `${path}.detail`, 3, 128);
      if (minor >= major) fail(path, "minor_radius must be less than major_radius");
    } else if (shape === "plane") {
      const object = objectValue(value, ["shape", "width", "height"], path);
      integer(object.width, `${path}.width`, 1, 2000000);
      integer(object.height, `${path}.height`, 1, 2000000);
    } else {
      fail(`${path}.shape`, "unsupported primitive shape");
    }
  }

  function validateMesh(value, path) {
    const object = objectValue(value, ["vertices", "triangles"], path);
    const vertices = arrayValue(object.vertices, `${path}.vertices`, 3, 4096);
    vertices.forEach((vertex, index) => vector(vertex, `${path}.vertices[${index}]`, -1000000, 1000000));
    const triangles = arrayValue(object.triangles, `${path}.triangles`, 1, 8192);
    triangles.forEach((triangle, index) => {
      const indices = arrayValue(triangle, `${path}.triangles[${index}]`, 3, 3)
        .map((item, offset) => integer(item, `${path}.triangles[${index}][${offset}]`, 0, 4095));
      if (new Set(indices).size !== 3) fail(`${path}.triangles[${index}]`, "triangle indices must be distinct");
      if (indices.some((item) => item >= vertices.length)) {
        fail(`${path}.triangles[${index}]`, "triangle index exceeds vertex count");
      }
      const [a, b, c] = indices.map((item) => vertices[item]);
      const ab = b.map((item, axis) => item - a[axis]);
      const ac = c.map((item, axis) => item - a[axis]);
      const cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      if (!nonzero(cross)) fail(`${path}.triangles[${index}]`, "zero-area triangle");
    });
  }

  function validatePolyline(value, path) {
    const object = objectValue(value, ["points", "closed", "width"], path);
    const points = arrayValue(object.points, `${path}.points`, 2, 8192);
    points.forEach((point, index) => {
      vector(point, `${path}.points[${index}]`, -1000000, 1000000);
      if (index > 0 && point.every((item, axis) => item === points[index - 1][axis])) {
        fail(`${path}.points[${index}]`, "adjacent points must differ");
      }
    });
    const closed = booleanValue(object.closed, `${path}.closed`);
    if (closed && points[0].every((item, axis) => item === points[points.length - 1][axis])) {
      fail(path, "closed polyline final segment must be nonzero");
    }
    integer(object.width, `${path}.width`, 1, 100000);
  }

  function validatePoints(value, path) {
    const object = objectValue(value, ["points"], path);
    arrayValue(object.points, `${path}.points`, 1, 8192).forEach((point, index) => {
      const item = objectValue(point, ["position", "size"], `${path}.points[${index}]`);
      vector(item.position, `${path}.points[${index}].position`, -1000000, 1000000);
      integer(item.size, `${path}.points[${index}].size`, 1, 100000);
    });
  }

  function validateLight(value, path) {
    const object = objectValue(value, ["kind", "color", "intensity", "range", "angle_mdeg", "direction"], path);
    const kind = enumValue(object.kind, new Set(["ambient", "directional", "point", "spot"]), `${path}.kind`);
    color(object.color, `${path}.color`);
    integer(object.intensity, `${path}.intensity`, 0, 10000);
    if (kind === "point" || kind === "spot") integer(object.range, `${path}.range`, 1, 10000000);
    else if (object.range !== null) fail(`${path}.range`, `must be null for ${kind}`);
    if (kind === "spot") integer(object.angle_mdeg, `${path}.angle_mdeg`, 1, 179000);
    else if (object.angle_mdeg !== null) fail(`${path}.angle_mdeg`, `must be null for ${kind}`);
    if (kind === "directional" || kind === "spot") {
      const direction = vector(object.direction, `${path}.direction`, -1000, 1000);
      if (!nonzero(direction)) fail(`${path}.direction`, "must be nonzero");
    } else if (object.direction !== null) {
      fail(`${path}.direction`, `must be null for ${kind}`);
    }
  }

  function primitiveCounts(geometry) {
    const shape = geometry.shape;
    if (shape === "sphere") {
      const longitude = 8 * (2 ** geometry.detail);
      const latitude = 4 * (2 ** geometry.detail);
      return [(longitude + 1) * (latitude + 1), 2 * longitude * (latitude - 1), {
        longitude_segments: longitude, latitude_segments: latitude,
      }];
    }
    if (new Set(["tetrahedron", "octahedron", "icosahedron"]).has(shape)) {
      const faces = { tetrahedron: 4, octahedron: 8, icosahedron: 20 }[shape];
      const triangles = faces * (4 ** geometry.detail);
      return [3 * triangles, triangles, { subdivision_detail: geometry.detail }];
    }
    if (shape === "box") return [24, 12, { segments_x: 1, segments_y: 1, segments_z: 1 }];
    if (shape === "cylinder") return [6 * geometry.detail + 4, 4 * geometry.detail, { radial_segments: geometry.detail }];
    if (shape === "cone") return [4 * geometry.detail + 3, 2 * geometry.detail, { radial_segments: geometry.detail }];
    if (shape === "capsule") {
      const rings = Math.max(2, Math.trunc(geometry.detail / 2));
      return [
        2 * (geometry.detail + 1) + 2 * (rings + 1) * (geometry.detail + 1),
        2 * geometry.detail + 2 * geometry.detail * (2 * rings - 1),
        { radial_segments: geometry.detail, hemisphere_rings: rings },
      ];
    }
    if (shape === "torus") {
      const minor = geometry.detail;
      const major = 2 * minor;
      return [(minor + 1) * (major + 1), 2 * minor * major, {
        major_segments: major, minor_segments: minor,
      }];
    }
    if (shape === "ring") {
      const radial = 2 * geometry.detail;
      return [2 * (radial + 1), 2 * radial, { radial_segments: radial }];
    }
    return [4, 2, { segments_x: 1, segments_y: 1 }];
  }

  function geometryCounts(node) {
    const geometry = node.geometry;
    if (node.type === "primitive") return primitiveCounts(geometry).slice(0, 2);
    if (node.type === "mesh") return [geometry.vertices.length, geometry.triangles.length];
    if (node.type === "polyline") {
      const count = geometry.points.length;
      const segments = geometry.closed ? count : count - 1;
      const joints = geometry.closed ? count : Math.max(0, count - 2);
      return [segments * 52 + joints * 45, segments * 32 + joints * 48];
    }
    if (node.type === "points") return [4 * geometry.points.length, 2 * geometry.points.length];
    return [0, 0];
  }

  function validateState(value, path = "state") {
    const object = objectValue(value, ["camera", "environment", "nodes"], path);
    validateCamera(object.camera, `${path}.camera`);
    validateEnvironment(object.environment, `${path}.environment`);
    const nodes = arrayValue(object.nodes, `${path}.nodes`, 0, 128);
    const seen = new Map();
    const depths = new Map();
    const totals = {
      lights: 0, materials: 0, mesh_vertices: 0, mesh_triangles: 0,
      compiled_vertices: 0, compiled_triangles: 0, polyline_points: 0,
      point_points: 0, draws: 0, transparent_draws: 0,
    };
    nodes.forEach((node, index) => {
      const nodePath = `${path}.nodes[${index}]`;
      const item = objectValue(node, NODE_KEYS, nodePath);
      const id = nodeId(item.id, `${nodePath}.id`);
      if (seen.has(id)) fail(`${nodePath}.id`, "node IDs must be unique");
      let depth = 0;
      if (item.parent !== null) {
        nodeId(item.parent, `${nodePath}.parent`);
        if (!seen.has(item.parent)) {
          fail(`${nodePath}.parent`, "parent must exist earlier in authored order");
        }
        depth = depths.get(item.parent) + 1;
      }
      if (depth > 8) fail(nodePath, "parent depth exceeds eight");
      const type = enumValue(
        item.type,
        new Set(["group", "primitive", "mesh", "polyline", "points", "light"]),
        `${nodePath}.type`,
      );
      booleanValue(item.visible, `${nodePath}.visible`);
      validateTransform(item.transform, `${nodePath}.transform`);
      if (type === "group") {
        if (item.geometry !== null || item.material !== null) {
          fail(nodePath, "group geometry and material must be null");
        }
      } else if (type === "light") {
        validateLight(item.geometry, `${nodePath}.geometry`);
        if (item.material !== null) fail(`${nodePath}.material`, "light material must be null");
        totals.lights += 1;
      } else {
        if (type === "primitive") validatePrimitive(item.geometry, `${nodePath}.geometry`);
        else if (type === "mesh") {
          validateMesh(item.geometry, `${nodePath}.geometry`);
          totals.mesh_vertices += item.geometry.vertices.length;
          totals.mesh_triangles += item.geometry.triangles.length;
        } else if (type === "polyline") {
          validatePolyline(item.geometry, `${nodePath}.geometry`);
          totals.polyline_points += item.geometry.points.length;
        } else {
          validatePoints(item.geometry, `${nodePath}.geometry`);
          totals.point_points += item.geometry.points.length;
        }
        validateMaterial(item.material, type, `${nodePath}.material`);
        totals.materials += 1;
        totals.draws += 1;
        const alpha = colorChannels(item.material.color)[3];
        const effective = roundDiv(item.material.opacity * alpha, 255);
        if (effective < 1000 || item.material.blend !== "normal") totals.transparent_draws += 1;
        const [vertices, triangles] = geometryCounts(item);
        totals.compiled_vertices += vertices;
        totals.compiled_triangles += triangles;
      }
      seen.set(id, item);
      depths.set(id, depth);
    });
    const ceilings = {
      lights: 8, materials: 128, mesh_vertices: 4096, mesh_triangles: 8192,
      compiled_vertices: 65536, compiled_triangles: 131072,
      polyline_points: 8192, point_points: 8192, draws: 256,
      transparent_draws: 128,
    };
    Object.entries(ceilings).forEach(([name, ceiling]) => {
      if (totals[name] > ceiling) fail(path, `aggregate ${name} budget exceeds ${ceiling}`);
    });
    return { nodes: seen, depths, totals };
  }

  function compatibleTopology(oldNode, newNode) {
    if (oldNode.type !== newNode.type) return false;
    const type = oldNode.type;
    if (type === "group") return oldNode.id === newNode.id;
    if (type === "primitive") {
      return oldNode.geometry.shape === newNode.geometry.shape
        && sameKeys(oldNode.geometry, Object.keys(newNode.geometry));
    }
    if (type === "mesh") {
      return oldNode.geometry.vertices.length === newNode.geometry.vertices.length
        && canonical(oldNode.geometry.triangles) === canonical(newNode.geometry.triangles);
    }
    if (type === "polyline") {
      return oldNode.geometry.points.length === newNode.geometry.points.length
        && oldNode.geometry.closed === newNode.geometry.closed;
    }
    if (type === "points") {
      return oldNode.geometry.points.length === newNode.geometry.points.length;
    }
    return oldNode.geometry.kind === newNode.geometry.kind;
  }

  function validateTransition(value, newNodes, baseNodes, baseIsGenesis, path) {
    const object = objectValue(value, ["duration_ms", "easing", "default", "nodes"], path);
    integer(object.duration_ms, `${path}.duration_ms`, 0, 10000);
    enumValue(object.easing, EASINGS, `${path}.easing`);
    enumValue(object.default, new Set(["cut", "crossfade"]), `${path}.default`);
    const nodes = arrayValue(object.nodes, `${path}.nodes`, 0, 128);
    const seen = new Set();
    const baseKnown = baseIsGenesis || baseNodes !== null;
    const effectiveBase = baseNodes === null ? new Map() : baseNodes;
    nodes.forEach((item, index) => {
      const itemPath = `${path}.nodes[${index}]`;
      const rule = objectValue(item, ["id", "mode"], itemPath);
      const id = nodeId(rule.id, `${itemPath}.id`);
      if (seen.has(id)) fail(`${itemPath}.id`, "transition node IDs must be unique");
      seen.add(id);
      const mode = enumValue(
        rule.mode,
        new Set(["cut", "fade-in", "fade-out", "crossfade", "interpolate"]),
        `${itemPath}.mode`,
      );
      const inNew = newNodes.has(id);
      const inBase = effectiveBase.has(id);
      if (mode === "fade-in" && !inNew) fail(itemPath, "fade-in node must exist in the new state");
      if (baseKnown) {
        if (mode === "cut" && !(inNew || inBase)) {
          fail(itemPath, "cut node must exist in the base or new state");
        }
        if (mode === "fade-out" && !inBase) fail(itemPath, "fade-out node must exist in the base state");
        if ((mode === "crossfade" || mode === "interpolate") && !(inBase && inNew)) {
          fail(itemPath, `${mode} node must exist in both states`);
        }
      }
      if (mode === "interpolate" && baseKnown
          && !compatibleTopology(effectiveBase.get(id), newNodes.get(id))) {
        fail(itemPath, "interpolate topology is incompatible");
      }
    });
  }

  function validateTrackShape(track, nodes, durationMs, path) {
    const object = objectValue(track, ["node_id", "property", "interpolation", "keyframes"], path);
    const id = nodeId(object.node_id, `${path}.node_id`);
    const property = enumValue(object.property, TRACK_PROPERTIES, `${path}.property`);
    const interpolation = enumValue(object.interpolation, TRACK_EASINGS, `${path}.interpolation`);
    if (property === "visible" && interpolation !== "step") {
      fail(path, "visible tracks require step interpolation");
    }
    if (nodes !== null) {
      if (!nodes.has(id)) fail(path, "track target does not exist");
      if (property.startsWith("material.") && nodes.get(id).material === null) {
        fail(path, "material track requires a non-null node material");
      }
    }
    const keyframes = arrayValue(object.keyframes, `${path}.keyframes`, 1, 64);
    let previous = null;
    keyframes.forEach((frame, index) => {
      const framePath = `${path}.keyframes[${index}]`;
      const keyframe = objectValue(frame, ["at_ms", "value"], framePath);
      const atMs = integer(keyframe.at_ms, `${framePath}.at_ms`, 0, 60000);
      if (previous !== null && atMs <= previous) {
        fail(`${framePath}.at_ms`, "keyframe times must be strictly increasing");
      }
      if (index === 0 && atMs !== 0) fail(`${framePath}.at_ms`, "first keyframe must begin at zero");
      if (atMs > durationMs) fail(`${framePath}.at_ms`, "keyframe exceeds sustain duration");
      previous = atMs;
      if (property === "transform.position") vector(keyframe.value, `${framePath}.value`, -1000000, 1000000);
      else if (property === "transform.rotation") vector(keyframe.value, `${framePath}.value`, -360000, 360000);
      else if (property === "transform.scale") vector(keyframe.value, `${framePath}.value`, 1, 100000);
      else if (property === "material.color" || property === "material.emissive") color(keyframe.value, `${framePath}.value`);
      else if (property === "material.opacity") integer(keyframe.value, `${framePath}.value`, 0, 1000);
      else booleanValue(keyframe.value, `${framePath}.value`);
    });
    return `${id}\u0000${property}`;
  }

  function resolverValue(id, resolver) {
    if (resolver === null || resolver === undefined) {
      fail("performance.sustain.flipbook", `ancestor ${id} cannot be resolved`);
    }
    let value;
    try {
      value = typeof resolver === "function" ? resolver(id) : resolver[id];
    } catch (error) {
      throw new HoloProtocolError(`ancestor resolver failed for ${id}: ${error.message}`);
    }
    if (value === null || value === undefined) {
      fail("performance.sustain.flipbook", `ancestor ${id} is unavailable`);
    }
    const result = objectValue(value, ["state", "verified_ancestor"], `ancestor[${id}]`);
    if (result.verified_ancestor !== true) {
      fail(`ancestor[${id}]`, "must be a verified strict visual ancestor");
    }
    validateState(result.state, `ancestor[${id}].state`);
    return result;
  }

  function validateFlipbook(entries, durationMs, repeat, resolver, requireResolver = true) {
    let previousTime = null;
    const referenced = new Map();
    entries.forEach((entry, index) => {
      const path = `performance.sustain.flipbook[${index}]`;
      const item = objectValue(entry, ["at_ms", "holo_id", "blend", "blend_ms"], path);
      const atMs = integer(item.at_ms, `${path}.at_ms`, 0, 60000);
      if (index === 0 && atMs !== 0) fail(`${path}.at_ms`, "first flipbook entry must begin at zero");
      if (previousTime !== null && atMs <= previousTime) {
        fail(`${path}.at_ms`, "flipbook times must be strictly increasing");
      }
      if (atMs > durationMs) fail(`${path}.at_ms`, "flipbook entry exceeds sustain duration");
      if (item.holo_id !== "self") hex64(item.holo_id, `${path}.holo_id`);
      const blend = enumValue(item.blend, new Set(["cut", "crossfade"]), `${path}.blend`);
      const blendMs = integer(item.blend_ms, `${path}.blend_ms`, 0, 10000);
      if (blend === "cut" && blendMs !== 0) fail(path, "cut entries require blend_ms zero");
      if (blend === "crossfade" && blendMs > 0) {
        if (index === 0 && repeat !== "loop") fail(path, "only loop may crossfade the first entry");
        if (index > 0 && atMs - blendMs < previousTime) {
          fail(path, "crossfade window overlaps the prior entry");
        }
      }
      previousTime = atMs;
      if (item.holo_id !== "self" && !referenced.has(item.holo_id)
          && resolver !== null && resolver !== undefined) {
        const resolved = resolverValue(item.holo_id, resolver);
        referenced.set(item.holo_id, utf8(canonical(resolved.state)).length);
      }
    });
    if (entries.length > 0 && repeat === "loop") {
      const first = entries[0];
      if (first.blend === "crossfade" && first.blend_ms > 0
          && durationMs - first.blend_ms < entries[entries.length - 1].at_ms) {
        fail("performance.sustain.flipbook[0]", "loop-boundary crossfade overlaps the final entry");
      }
    }
    const historical = new Set(entries.filter((entry) => entry.holo_id !== "self").map((entry) => entry.holo_id));
    if (requireResolver && historical.size > 0 && (resolver === null || resolver === undefined)) {
      fail("performance.sustain.flipbook", `ancestor ${[...historical].sort()[0]} cannot be resolved`);
    }
    const totalBytes = [...referenced.values()].reduce((total, value) => total + value, 0);
    if (totalBytes > MAX_REFERENCED_STATE_BYTES) {
      fail("performance.sustain.flipbook", "referenced state bytes exceed 4 MiB");
    }
  }

  function validatePerformance(value, nodes, ancestorResolver, path) {
    const object = objectValue(value, ["clock", "sustain"], path);
    if (object.clock !== "rapp-holo-logical-ms/1") fail(`${path}.clock`, "unsupported performance clock");
    const sustain = objectValue(object.sustain, ["duration_ms", "repeat", "tracks", "flipbook"], `${path}.sustain`);
    const duration = integer(sustain.duration_ms, `${path}.sustain.duration_ms`, 0, 60000);
    const repeat = enumValue(sustain.repeat, new Set(["hold", "once", "loop", "ping-pong"]), `${path}.sustain.repeat`);
    const tracks = arrayValue(sustain.tracks, `${path}.sustain.tracks`, 0, 512);
    const flipbook = arrayValue(sustain.flipbook, `${path}.sustain.flipbook`, 0, 16);
    if (repeat === "hold") {
      if (duration !== 0 || tracks.length !== 0 || flipbook.length !== 0) {
        fail(`${path}.sustain`, "hold requires zero duration and empty timelines");
      }
    } else if (duration === 0) {
      fail(`${path}.sustain.duration_ms`, "non-hold sustain requires positive duration");
    }
    const pairs = new Set();
    let keyframeCount = 0;
    tracks.forEach((track, index) => {
      const pair = validateTrackShape(track, nodes, duration, `${path}.sustain.tracks[${index}]`);
      if (pairs.has(pair)) fail(`${path}.sustain.tracks[${index}]`, "duplicate node/property sustain track");
      pairs.add(pair);
      keyframeCount += track.keyframes.length;
    });
    if (keyframeCount > 4096) fail(`${path}.sustain.tracks`, "aggregate keyframes exceed 4096");
    validateFlipbook(flipbook, duration, repeat, ancestorResolver);
  }

  function validateAccessibility(value, path) {
    const object = objectValue(value, ["description", "reduced_motion"], path);
    stringValue(object.description, `${path}.description`, 1, 1024);
    enumValue(object.reduced_motion, new Set(["hold", "crossfade"]), `${path}.reduced_motion`);
  }

  function roundDivBig(numerator, denominator) {
    if (denominator <= 0n) throw new HoloProtocolError("roundDiv denominator must be positive");
    const negative = numerator < 0n;
    const absolute = negative ? -numerator : numerator;
    let quotient = absolute / denominator;
    const remainder = absolute % denominator;
    if (2n * remainder >= denominator) quotient += 1n;
    return negative ? -quotient : quotient;
  }

  function normalizeVector(value) {
    const components = value.map((component) => BigInt(component));
    const squared = components.reduce((total, component) => total + component * component, 0n);
    const length = integerSqrt(squared);
    if (length === 0n) throw new HoloProtocolError("cannot normalize a zero vector");
    return components.map((component) => Number(roundDivBig(component * BigInt(S), length)));
  }

  function integerSqrt(value) {
    if (typeof value !== "bigint" || value < 0n) {
      throw new HoloProtocolError("integer square root requires a nonnegative integer");
    }
    if (value < 2n) return value;
    let left = 1n;
    let right = value;
    let answer = 1n;
    while (left <= right) {
      const middle = (left + right) / 2n;
      if (middle <= value / middle) {
        answer = middle;
        left = middle + 1n;
      } else {
        right = middle - 1n;
      }
    }
    return answer;
  }

  function meshNormals(geometry) {
    const accumulators = geometry.vertices.map(() => [0n, 0n, 0n]);
    geometry.triangles.forEach((triangle) => {
      const [a, b, c] = triangle.map((index) => geometry.vertices[index].map(BigInt));
      const ab = b.map((item, axis) => item - a[axis]);
      const ac = c.map((item, axis) => item - a[axis]);
      const normal = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      triangle.forEach((index) => {
        normal.forEach((component, axis) => {
          accumulators[index][axis] += component;
        });
      });
    });
    return accumulators.map((value) => {
      if (value.every((component) => component === 0n)) return [0, 0, S];
      const squared = value.reduce((total, component) => total + component * component, 0n);
      const length = integerSqrt(squared);
      return value.map((component) => Number(roundDivBig(component * BigInt(S), length)));
    });
  }

  function compiledGeometry(node) {
    const geometry = node.geometry;
    if (node.type === "group") return null;
    if (node.type === "primitive") {
      const [vertices, triangles, derived] = primitiveCounts(geometry);
      return {
        kind: "primitive", authored: clone(geometry), derived,
        vertex_count: vertices, triangle_count: triangles,
      };
    }
    if (node.type === "mesh") {
      return {
        kind: "mesh", vertices: clone(geometry.vertices),
        triangles: clone(geometry.triangles), normals: meshNormals(geometry),
        vertex_count: geometry.vertices.length,
        triangle_count: geometry.triangles.length,
      };
    }
    if (node.type === "polyline") {
      const [vertices, triangles] = geometryCounts(node);
      return {
        kind: "polyline", authored: clone(geometry), radial_segments: 8,
        vertex_count: vertices, triangle_count: triangles,
      };
    }
    if (node.type === "points") {
      const [vertices, triangles] = geometryCounts(node);
      return {
        kind: "points", authored: clone(geometry),
        billboard: "camera-facing-square",
        vertex_count: vertices, triangle_count: triangles,
      };
    }
    const light = clone(geometry);
    if (light.direction !== null) light.normalized_direction = normalizeVector(light.direction);
    return { kind: "light", authored: light };
  }

  function compileSceneManifest(authored, validated = false) {
    if (!validated) validateOutput(authored);
    const state = authored.state;
    const camera = clone(state.camera);
    camera.normalized_up = normalizeVector(camera.up);
    const nodes = [];
    const draws = [];
    const lights = [];
    state.nodes.forEach((node) => {
      const geometry = compiledGeometry(node);
      nodes.push({
        node_id: node.id, parent: node.parent, type: node.type,
        visible: node.visible, transform: clone(node.transform),
        geometry, material: clone(node.material),
      });
      if (new Set(["primitive", "mesh", "polyline", "points"]).has(node.type)) {
        const alpha = colorChannels(node.material.color)[3];
        const effective = roundDiv(node.material.opacity * alpha, 255);
        draws.push({
          draw_order: draws.length, node_id: node.id, parent: node.parent,
          node_type: node.type, visible: node.visible,
          transform: clone(node.transform), geometry: clone(geometry),
          material: clone(node.material), effective_opacity: effective,
          transparent: effective < 1000 || node.material.blend !== "normal",
        });
      } else if (node.type === "light" && node.visible) {
        lights.push({
          light_order: lights.length, node_id: node.id, parent: node.parent,
          transform: clone(node.transform), light: clone(geometry),
        });
      }
    });
    const manifest = {
      schema: "rapp-holo-compiled/1", camera,
      environment: clone(state.environment), nodes, draws, lights,
    };
    canonical(manifest);
    return manifest;
  }

  function validateOutput(authored, options = {}) {
    canonicalAuthoredBytes(authored);
    const object = objectValue(authored, OUTPUT_KEYS, "authored");
    if (object.schema !== "rapp-holo-output/1") fail("authored.schema", "must be rapp-holo-output/1");
    if (object.base_holo_id !== null) hex64(object.base_holo_id, "authored.base_holo_id");
    if (object.ir_version !== "rapp-holo-ir/1") fail("authored.ir_version", "unsupported IR version");
    if (object.renderer_contract !== "rapp-holo-renderer/1") {
      fail("authored.renderer_contract", "unsupported renderer contract");
    }
    const stateInfo = validateState(object.state);
    let baseNodes = null;
    if (options.baseState !== undefined && options.baseState !== null) {
      if (object.base_holo_id === null) fail("baseState", "cannot be supplied for holo genesis");
      baseNodes = validateState(options.baseState, "baseState").nodes;
    }
    validateTransition(
      object.transition,
      stateInfo.nodes,
      baseNodes,
      object.base_holo_id === null,
      "transition",
    );
    validatePerformance(object.performance, stateInfo.nodes, options.ancestorResolver, "performance");
    validateAccessibility(object.accessibility, "accessibility");
    return compileSceneManifest(object, true);
  }

  function rappidValid(value) {
    if (typeof value !== "string") return false;
    const match = RAPPID_RE.exec(value);
    return Boolean(match && match[1].length <= 39 && match[2].length <= 100);
  }

  function memoryStream(value, path) {
    if (typeof value !== "string") fail(path, "must be a memory stream ID");
    const match = MEMORY_STREAM_RE.exec(value);
    if (!match || !rappidValid(match[1]) || match[2].length > 64) {
      fail(path, "must be a valid RAPPID memory stream");
    }
    return [match[1], match[2]];
  }

  function validUtc(value) {
    if (typeof value !== "string" || !UTC_RE.test(value)
        || value.startsWith("0000-") || value.slice(17, 19) === "60") return false;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return false;
    return new Date(parsed).toISOString() === value;
  }

  function validateSource(value, path) {
    const object = objectValue(value, ["stream_id", "seq", "frame_hash"], path);
    memoryStream(object.stream_id, `${path}.stream_id`);
    integer(object.seq, `${path}.seq`, 0, MAX_SAFE_INTEGER);
    hex64(object.frame_hash, `${path}.frame_hash`);
    return object;
  }

  function base64urlDecode(value) {
    if (typeof value !== "string" || value.includes("=") || !/^[A-Za-z0-9_-]*$/.test(value)) {
      throw new HoloProtocolError("invalid unpadded base64url");
    }
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let bits = 0;
    let bitCount = 0;
    const bytes = [];
    for (const character of value) {
      bits = bits * 64 + alphabet.indexOf(character);
      bitCount += 6;
      while (bitCount >= 8) {
        bitCount -= 8;
        bytes.push(Math.trunc(bits / (2 ** bitCount)) & 255);
        bits %= 2 ** bitCount;
      }
    }
    if (bitCount > 0 && bits !== 0) throw new HoloProtocolError("invalid base64url padding bits");
    return bytes;
  }

  function parseAsciiJson(bytes) {
    if (bytes.some((byte) => byte > 127)) throw new HoloProtocolError("JWS header must be ASCII JSON");
    return parseJson(String.fromCharCode(...bytes));
  }

  function parseDetachedJws(value) {
    const parts = typeof value === "string" ? value.split(".") : [];
    if (parts.length !== 3 || parts[1] !== "") {
      throw new HoloProtocolError("JWS must use detached compact serialization");
    }
    const headerBytes = base64urlDecode(parts[0]);
    const header = parseAsciiJson(headerBytes);
    objectValue(header, ["alg", "b64", "crit", "kid"], "JWS header");
    if (header.alg !== "EdDSA" && header.alg !== "ES256") {
      throw new HoloProtocolError("JWS alg must be EdDSA or ES256");
    }
    if (header.b64 !== false || canonical(header.crit) !== '["b64"]') {
      throw new HoloProtocolError("JWS must use b64=false with crit=['b64']");
    }
    if (!rappidValid(header.kid)) throw new HoloProtocolError("JWS kid must be a valid RAPPID");
    if (utf8(canonical(header)).join(",") !== headerBytes.join(",")) {
      throw new HoloProtocolError("JWS protected header is not canonical");
    }
    base64urlDecode(parts[2]);
    return header;
  }

  function validateProvenance(value, record, subjectRappid, path) {
    const object = objectValue(value, ["statement", "sig"], path);
    const statement = objectValue(object.statement, [
      "schema", "subject_rappid", "producer_rappid", "source_stream_id",
      "source_seq", "source_frame_hash", "authored_hash", "issued_utc",
    ], `${path}.statement`);
    if (statement.schema !== "rapp-holo-provenance/1") {
      fail(`${path}.statement.schema`, "must be rapp-holo-provenance/1");
    }
    if (!rappidValid(statement.subject_rappid)) fail(`${path}.statement.subject_rappid`, "invalid subject RAPPID");
    if (!rappidValid(statement.producer_rappid)) fail(`${path}.statement.producer_rappid`, "invalid producer RAPPID");
    memoryStream(statement.source_stream_id, `${path}.statement.source_stream_id`);
    integer(statement.source_seq, `${path}.statement.source_seq`, 0, MAX_SAFE_INTEGER);
    hex64(statement.source_frame_hash, `${path}.statement.source_frame_hash`);
    hex64(statement.authored_hash, `${path}.statement.authored_hash`);
    if (!validUtc(statement.issued_utc)) fail(`${path}.statement.issued_utc`, "invalid fixed-form UTC");
    const signature = stringValue(object.sig, `${path}.sig`, 1, 16384);
    let header;
    try {
      header = parseDetachedJws(signature);
    } catch (error) {
      fail(`${path}.sig`, `invalid detached JWS: ${error.message}`);
    }
    if (header.kid !== statement.producer_rappid) fail(`${path}.sig`, "JWS kid must equal producer_rappid");
    const expected = {
      subject_rappid: subjectRappid,
      source_stream_id: record.source.stream_id,
      source_seq: record.source.seq,
      source_frame_hash: record.source.frame_hash,
      authored_hash: record.authored_hash,
    };
    Object.entries(expected).forEach(([key, expectedValue]) => {
      if (statement[key] !== expectedValue) {
        fail(`${path}.statement.${key}`, "does not match the materialized record");
      }
    });
  }

  function validateRecord(record, options = {}) {
    const subjectRappid = options.subjectRappid;
    const sourceBinding = options.sourceBinding;
    if (!rappidValid(subjectRappid)) fail("subjectRappid", "must be a valid RAPPID");
    const object = objectValue(record, RECORD_KEYS, "record");
    if (object.schema !== "rapp-holo-record/1") fail("record.schema", "must be rapp-holo-record/1");
    const holoSeq = integer(object.holo_seq, "record.holo_seq", 0, MAX_SAFE_INTEGER);
    if (object.visual_parent !== null) hex64(object.visual_parent, "record.visual_parent");
    if ((holoSeq === 0) !== (object.visual_parent === null)) {
      fail("record", "holo genesis and visual_parent rules disagree");
    }
    const source = validateSource(object.source, "record.source");
    const [sourceSubject] = memoryStream(source.stream_id, "record.source.stream_id");
    if (sourceSubject !== subjectRappid) {
      fail("record.source.stream_id", "source subject must equal body subject");
    }
    hex64(object.authored_hash, "record.authored_hash");
    objectValue(object.authored, OUTPUT_KEYS, "record.authored");
    if (object.authored_hash !== authoredHash(object.authored)) {
      fail("record.authored_hash", "does not match H(rapp-holo/1:authored, authored)");
    }
    if (object.authored.base_holo_id !== object.visual_parent) {
      fail("record.authored.base_holo_id", "must equal visual_parent");
    }
    const binding = objectValue(sourceBinding, ["stream_id", "seq", "frame_hash", "authored"], "sourceBinding");
    const expectedSource = validateSource({
      stream_id: binding.stream_id, seq: binding.seq, frame_hash: binding.frame_hash,
    }, "sourceBinding");
    if (canonical(source) !== canonical(expectedSource)) {
      fail("record.source", "does not match the exact verified source binding");
    }
    if (canonical(binding.authored) !== canonical(object.authored)) {
      fail("record.authored", "differs from the exact source candidate");
    }
    const expectedParent = Object.prototype.hasOwnProperty.call(options, "expectedVisualParent")
      ? options.expectedVisualParent : UNSET;
    if (expectedParent !== UNSET && object.visual_parent !== expectedParent) {
      fail("record.visual_parent", "is stale relative to the authoritative holo head");
    }
    if (object.producer_provenance !== null) {
      validateProvenance(object.producer_provenance, object, subjectRappid, "record.producer_provenance");
    }
    return validateOutput(object.authored, {
      baseState: options.baseState,
      ancestorResolver: options.ancestorResolver,
    });
  }

  function parseJson(raw) {
    if (typeof raw !== "string") throw new HoloProtocolError("JSON input must be a string");
    let index = 0;
    function whitespace() {
      while (index < raw.length && /[\u0009\u000A\u000D\u0020]/.test(raw[index])) index += 1;
    }
    function parseString() {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < raw.length) {
        const code = raw.charCodeAt(index);
        if (!escaped && code === 34) {
          index += 1;
          let value;
          try {
            value = JSON.parse(raw.slice(start, index));
          } catch (error) {
            throw new HoloProtocolError(`invalid JSON string: ${error.message}`);
          }
          if (!validUnicode(value)) throw new HoloProtocolError("unpaired UTF-16 surrogate");
          return value;
        }
        if (!escaped && code < 32) throw new HoloProtocolError("unescaped control character");
        if (!escaped && code === 92) escaped = true;
        else escaped = false;
        index += 1;
      }
      throw new HoloProtocolError("unterminated JSON string");
    }
    function parseValue() {
      whitespace();
      const character = raw[index];
      if (character === '"') return parseString();
      if (character === "{") {
        index += 1;
        whitespace();
        const result = Object.create(null);
        const keys = new Set();
        if (raw[index] === "}") {
          index += 1;
          return result;
        }
        while (true) {
          whitespace();
          if (raw[index] !== '"') throw new HoloProtocolError("object key must be a string");
          const key = parseString();
          if (keys.has(key)) throw new HoloProtocolError(`duplicate object member: ${key}`);
          keys.add(key);
          whitespace();
          if (raw[index] !== ":") throw new HoloProtocolError("object member requires colon");
          index += 1;
          result[key] = parseValue();
          whitespace();
          if (raw[index] === "}") {
            index += 1;
            return result;
          }
          if (raw[index] !== ",") throw new HoloProtocolError("object members require commas");
          index += 1;
        }
      }
      if (character === "[") {
        index += 1;
        whitespace();
        const result = [];
        if (raw[index] === "]") {
          index += 1;
          return result;
        }
        while (true) {
          result.push(parseValue());
          whitespace();
          if (raw[index] === "]") {
            index += 1;
            return result;
          }
          if (raw[index] !== ",") throw new HoloProtocolError("array items require commas");
          index += 1;
        }
      }
      if (raw.startsWith("true", index)) {
        index += 4;
        return true;
      }
      if (raw.startsWith("false", index)) {
        index += 5;
        return false;
      }
      if (raw.startsWith("null", index)) {
        index += 4;
        return null;
      }
      const match = /^-?(?:0|[1-9]\d*)/.exec(raw.slice(index));
      if (!match) throw new HoloProtocolError("invalid JSON value");
      index += match[0].length;
      if (raw[index] === "." || raw[index] === "e" || raw[index] === "E") {
        throw new HoloProtocolError("JSON numbers must be integers");
      }
      const value = Number(match[0]);
      if (!Number.isSafeInteger(value)) throw new HoloProtocolError("integer outside interoperable range");
      return value;
    }
    const value = parseValue();
    whitespace();
    if (index !== raw.length) throw new HoloProtocolError("trailing JSON data");
    canonical(value);
    return value;
  }

  global.RappHoloProtocol = Object.freeze({
    HoloProtocolError,
    MAX_AUTHORED_BYTES,
    MAX_REFERENCED_STATE_BYTES,
    S,
    authoredHash,
    canonical,
    canonicalAuthoredBytes,
    compileSceneManifest,
    domainHash,
    easing,
    evaluatePropertyTrack,
    localSustainTime,
    parseJson,
    roundDiv,
    selectFlipbook,
    validateOutput,
    validateRecord,
  });
}(typeof window === "undefined" ? globalThis : window));
