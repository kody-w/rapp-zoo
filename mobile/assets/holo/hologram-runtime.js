(() => {
  "use strict";

  const root = typeof window === "undefined" ? globalThis : window;
  const HOLO_SCALE = 1000000;
  const HEX64 = /^[0-9a-f]{64}$/;

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function departureManifestHash(manifest, api = root.RappHoloProtocol) {
    if (typeof api?.domainHash !== "function") {
      throw new Error("RappHoloProtocol departure hashing is unavailable.");
    }
    return api.domainHash("rapp-holo/1:departure", manifest);
  }

  function activeMessage(evidence, manifestHash) {
    const firstActivation = evidence.previous_active_holo_id === null;
    return {
      schema: "rapp-holo-active/1",
      holo_id: evidence.holo_id,
      previous_active_holo_id: evidence.previous_active_holo_id,
      departure_logical_ms: firstActivation
        ? null
        : evidence.departure_logical_ms,
      departure_manifest_hash: firstActivation ? null : manifestHash,
      authoritative: evidence.authoritative_holo_id === evidence.holo_id,
    };
  }

  function readyMessage(playerId, state) {
    return {
      schema: "rapp-holo-ready/1",
      player_id: playerId || null,
      authoritative_holo_id: state.authoritative_holo_id,
      player_active_holo_id: state.player_active_holo_id,
      substrate: "rapp/1",
      player_mode: "rolling-core-capsule",
      storefront: "rapterbox",
      ownership_model: "one-time-local",
      offline_capable: true,
      cloud_compute_required: false,
    };
  }

  function errorMessage(error, state) {
    return {
      schema: "rapp-holo-error/1",
      holo_id: state.authoritative_holo_id,
      player_active_holo_id: state.player_active_holo_id,
      authoritative: Boolean(
        state.authoritative_holo_id
        && state.authoritative_holo_id === state.player_active_holo_id
      ),
      error: String(error?.message || error),
    };
  }

  function completedGrowl(growl, api = root.RappHoloProtocol) {
    if (typeof api?.growlEvents !== "function") {
      throw new Error("RappHoloProtocol growlEvents is unavailable.");
    }
    const events = api.growlEvents(clone(growl));
    if (!Array.isArray(events) || events.length > 2080) {
      throw new Error("RappHoloProtocol returned an invalid growl event list.");
    }
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (
        !event
        || !Number.isInteger(event.pitch)
        || event.pitch < 0
        || event.pitch > 127
        || !Number.isInteger(event.delta_onset)
        || event.delta_onset < 0
        || !Number.isInteger(event.duration)
        || event.duration < 1
        || !Number.isInteger(event.velocity)
        || event.velocity < 1
        || event.velocity > 127
      ) {
        throw new Error("RappHoloProtocol returned an invalid growl event.");
      }
      if (
        index > 0
        && event.delta_onset === 0
        && event.pitch < events[index - 1].pitch
      ) {
        throw new Error("RappHoloProtocol returned an unsorted growl chord.");
      }
    }
    return clone(events);
  }

  function growlPreset(program) {
    const presets = [
      { name: "mellow", waveform: "triangle", attack_us: 4000, release_us: 90000 },
      { name: "round", waveform: "sine", attack_us: 3000, release_us: 110000 },
      { name: "bright", waveform: "triangle", attack_us: 2000, release_us: 60000 },
      { name: "reed", waveform: "sine", attack_us: 6000, release_us: 75000 },
    ];
    return clone(presets[program % presets.length]);
  }

  function growlStepUs(growl, api) {
    if (
      !Number.isInteger(growl.tempo_milli_bpm)
      || !Number.isInteger(growl.ticks_per_quarter)
    ) {
      throw new Error("Holo/1 growl has no valid note timing.");
    }
    return api.roundDiv(
      60000000000,
      growl.tempo_milli_bpm * growl.ticks_per_quarter,
    );
  }

  function growlSchedule(growl, api = root.RappHoloProtocol) {
    const events = completedGrowl(growl, api);
    const stepUs = growlStepUs(growl, api);
    const preset = growlPreset(growl.program);
    let durationUs = 0;
    let onsetSteps = 0;
    const scheduled = events.map((event) => {
      onsetSteps += event.delta_onset;
      const startUs = onsetSteps * stepUs;
      const eventDurationUs = event.duration * stepUs;
      durationUs = Math.max(durationUs, startUs + eventDurationUs);
      return {
        ...event,
        start_us: startUs,
        duration_us: eventDurationUs,
        frequency_hz: 440 * (2 ** ((event.pitch - 69) / 12)),
        gain: event.velocity / 127,
      };
    });
    return {
      schema: "rapp-holo-growl-schedule/1",
      program: growl.program,
      preset,
      step_us: stepUs,
      duration_us: durationUs,
      events: scheduled,
    };
  }

  function createGrowlPlayer(options = {}) {
    const api = options.protocol || root.RappHoloProtocol;
    const AudioContextClass = options.AudioContextClass
      || root.AudioContext
      || root.webkitAudioContext;
    let context = null;
    let playingUntil = 0;
    return Object.freeze({
      async play(growl, playback = {}) {
        if (playback.user_gesture !== true) {
          throw new Error("Holo/1 growl playback requires an explicit user gesture.");
        }
        if (typeof AudioContextClass !== "function") {
          throw new Error("WebAudio is unavailable for Holo/1 growl playback.");
        }
        const schedule = growlSchedule(growl, api);
        context ||= new AudioContextClass();
        if (context.state === "suspended" && typeof context.resume === "function") {
          await context.resume();
        }
        if (context.currentTime < playingUntil) {
          throw new Error("Holo/1 growl playback is already active.");
        }
        const origin = context.currentTime;
        for (const event of schedule.events) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const startsAt = origin + event.start_us / 1000000;
          const stopsAt = startsAt + event.duration_us / 1000000;
          const attackEndsAt = startsAt + Math.min(
            schedule.preset.attack_us,
            event.duration_us,
          ) / 1000000;
          const releaseStartsAt = stopsAt - Math.min(
            schedule.preset.release_us,
            event.duration_us,
          ) / 1000000;
          const peak = event.gain * .12;
          oscillator.type = schedule.preset.waveform;
          oscillator.frequency.setValueAtTime(event.frequency_hz, startsAt);
          gain.gain.setValueAtTime(0, startsAt);
          gain.gain.linearRampToValueAtTime(peak, attackEndsAt);
          gain.gain.linearRampToValueAtTime(peak * .25, Math.max(
            attackEndsAt,
            releaseStartsAt,
          ));
          gain.gain.linearRampToValueAtTime(0, stopsAt);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(startsAt);
          oscillator.stop(stopsAt);
        }
        playingUntil = origin + schedule.duration_us / 1000000;
        return clone(schedule);
      },
      schedule(growl) {
        return growlSchedule(growl, api);
      },
    });
  }

  function protocolColor(value) {
    if (Array.isArray(value)) return clone(value);
    const raw = String(value).slice(1);
    return [
      Number.parseInt(raw.slice(0, 2), 16),
      Number.parseInt(raw.slice(2, 4), 16),
      Number.parseInt(raw.slice(4, 6), 16),
      raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) : 255,
    ];
  }

  function interpolateArray(api, left, right, progress) {
    return left.map((value, index) => (
      value + api.roundDiv((right[index] - value) * progress, HOLO_SCALE)
    ));
  }

  function interpolateColor(api, left, right, progress) {
    return interpolateArray(api, protocolColor(left), protocolColor(right), progress);
  }

  function interpolateMaterial(api, left, right, progress) {
    if (!left || !right) return clone(progress === HOLO_SCALE ? right : left);
    const output = clone(right);
    output.color = interpolateColor(api, left.color, right.color, progress);
    output.emissive = interpolateColor(api, left.emissive, right.emissive, progress);
    for (const field of [
      "emissive_strength",
      "opacity",
      "metallic",
      "roughness",
    ]) {
      output[field] = left[field]
        + api.roundDiv((right[field] - left[field]) * progress, HOLO_SCALE);
    }
    if (progress < HOLO_SCALE) {
      output.presentation = left.presentation;
      output.blend = left.blend;
      output.side = left.side;
    }
    return output;
  }

  function interpolateGeometry(api, left, right, progress) {
    if (!left || !right) return clone(progress === HOLO_SCALE ? right : left);
    const output = clone(right);
    if (right.kind === "primitive") {
      output.authored = clone(right.authored);
      for (const [key, value] of Object.entries(right.authored)) {
        if (typeof value === "number") {
          output.authored[key] = left.authored[key]
            + api.roundDiv(
              (value - left.authored[key]) * progress,
              HOLO_SCALE,
            );
        } else if (Array.isArray(value)) {
          output.authored[key] = interpolateArray(
            api,
            left.authored[key],
            value,
            progress,
          );
        } else if (progress < HOLO_SCALE) {
          output.authored[key] = left.authored[key];
        }
      }
    } else if (right.kind === "mesh") {
      output.vertices = right.vertices.map((vertex, index) => (
        interpolateArray(api, left.vertices[index], vertex, progress)
      ));
    } else if (right.kind === "polyline") {
      output.authored.points = right.authored.points.map((point, index) => (
        interpolateArray(api, left.authored.points[index], point, progress)
      ));
      output.authored.width = left.authored.width
        + api.roundDiv(
          (right.authored.width - left.authored.width) * progress,
          HOLO_SCALE,
        );
    } else if (right.kind === "points") {
      output.authored.points = right.authored.points.map((point, index) => ({
        position: interpolateArray(
          api,
          left.authored.points[index].position,
          point.position,
          progress,
        ),
        size: left.authored.points[index].size
          + api.roundDiv(
            (point.size - left.authored.points[index].size) * progress,
            HOLO_SCALE,
          ),
      }));
    } else if (right.kind === "light") {
      const leftLight = left.authored;
      const rightLight = right.authored;
      output.authored.color = interpolateColor(
        api,
        leftLight.color,
        rightLight.color,
        progress,
      );
      for (const field of ["intensity", "range", "angle_mdeg"]) {
        if (leftLight[field] !== null && rightLight[field] !== null) {
          output.authored[field] = leftLight[field]
            + api.roundDiv(
              (rightLight[field] - leftLight[field]) * progress,
              HOLO_SCALE,
            );
        }
      }
      if (leftLight.direction !== null && rightLight.direction !== null) {
        output.authored.direction = interpolateArray(
          api,
          leftLight.direction,
          rightLight.direction,
          progress,
        );
      }
    }
    return output;
  }

  function interpolateNode(api, left, right, progress) {
    return {
      ...clone(right),
      visible: progress === HOLO_SCALE ? right.visible : left.visible,
      transform: {
        position: interpolateArray(
          api,
          left.transform.position,
          right.transform.position,
          progress,
        ),
        rotation: interpolateArray(
          api,
          left.transform.rotation,
          right.transform.rotation,
          progress,
        ),
        scale: interpolateArray(
          api,
          left.transform.scale,
          right.transform.scale,
          progress,
        ),
      },
      geometry: interpolateGeometry(api, left.geometry, right.geometry, progress),
      material: interpolateMaterial(api, left.material, right.material, progress),
      render_weight: HOLO_SCALE,
    };
  }

  function nodeWeight(api, existing, factor) {
    return api.roundDiv(
      (existing ?? HOLO_SCALE) * factor,
      HOLO_SCALE,
    );
  }

  function weightedManifest(api, manifest, factors) {
    const output = clone(manifest);
    output.nodes = output.nodes.map((node) => ({
      ...node,
      render_weight: nodeWeight(
        api,
        node.render_weight,
        factors.get(node.node_id || node.id) ?? HOLO_SCALE,
      ),
    }));
    return output;
  }

  function applyTrack(manifest, track, value) {
    const node = manifest.nodes.find((entry) => (
      (entry.node_id || entry.id) === track.node_id
    ));
    if (!node) throw new Error(`Track node ${track.node_id} is unavailable.`);
    if (track.property === "visible") {
      node.visible = value;
      return;
    }
    const [group, field] = track.property.split(".");
    node[group][field] = clone(value);
  }

  function compileWithSharedProtocol(api, input) {
    const snapshots = new Map();
    if (input.base) snapshots.set(input.base.holo_id, input.base);
    for (const snapshot of input.history) {
      if (snapshots.has(snapshot.holo_id)) {
        const existing = snapshots.get(snapshot.holo_id);
        let existingValue = existing.state;
        let snapshotValue = snapshot.state;
        if (existing.authored && snapshot.authored) {
          existingValue = existing.authored;
          snapshotValue = snapshot.authored;
        }
        if (existing.record && snapshot.record) {
          existingValue = existing.record;
          snapshotValue = snapshot.record;
        }
        if (
          api.canonical(existingValue) !== api.canonical(snapshotValue)
        ) {
          throw new Error(`Conflicting resolved snapshot ${snapshot.holo_id}.`);
        }
      }
      snapshots.set(snapshot.holo_id, snapshot);
    }
    if (snapshots.size > 64) {
      throw new Error("Holo/1 recursive history exceeds 64 unique frames.");
    }
    const ancestorIds = Object.fromEntries([...snapshots].map(
      ([holoId, snapshot]) => [
        holoId,
        clone(snapshot.record || snapshot.authored || snapshot.state),
      ],
    ));
    api.validateOutput(input.authored, {
      base: clone(input.base?.authored || input.base?.state || null),
      ancestorIds,
    });
    const manifest = api.compileSceneManifest(input.authored);
    const historyManifests = {};
    const historyAuthored = {};
    for (const [holoId, snapshot] of snapshots) {
      historyManifests[holoId] = api.compileSceneManifest(snapshot.authored);
      historyAuthored[holoId] = clone(snapshot.authored);
    }
    return {
      input: clone(input),
      growl_events: completedGrowl(input.authored.growl, api),
      history_authored: historyAuthored,
      manifest: clone(manifest),
      base_manifest: input.base
        ? clone(historyManifests[input.base.holo_id])
        : null,
      history_manifests: historyManifests,
    };
  }

  function historicalCompiled(compiled, holoId) {
    const authored = compiled.history_authored[holoId];
    const manifest = compiled.history_manifests[holoId];
    if (!manifest) {
      throw new Error(`Resolved historical holo ${holoId} is unavailable.`);
    }
    if (!authored) {
      throw new Error(
        `Recursive historical holo ${holoId} requires its complete authored output.`,
      );
    }
    return {
      input: {
        holo_id: holoId,
        authored,
      },
      history_authored: compiled.history_authored,
      history_manifests: compiled.history_manifests,
      manifest,
    };
  }

  function evaluateRecursiveSustain(
    api,
    compiled,
    sustainElapsed,
    reducedMotion,
    traversal,
    depth,
  ) {
    if (depth > 8) {
      throw new Error("Holo/1 recursive flipbook depth exceeds 8.");
    }
    const holoId = compiled.input.holo_id;
    if (traversal.path.has(holoId)) {
      throw new Error(`Holo/1 recursive flipbook cycle includes ${holoId}.`);
    }
    traversal.path.add(holoId);
    if (depth > 0) traversal.unique.add(holoId);
    if (traversal.unique.size > 64) {
      throw new Error("Holo/1 recursive history exceeds 64 unique frames.");
    }
    const authored = compiled.input.authored;
    const sustain = authored.performance.sustain;
    if (reducedMotion && authored.accessibility.reduced_motion === "hold") {
      traversal.path.delete(holoId);
      return {
        layers: [{
          holo_id: holoId,
          weight: HOLO_SCALE,
          environment_weight: HOLO_SCALE,
          manifest: clone(compiled.manifest),
        }],
      };
    }
    const localT = api.localSustainTime(
      sustainElapsed + authored.transition.duration_ms,
      authored.transition.duration_ms,
      sustain.duration_ms,
      sustain.repeat,
    );
    const selfManifest = clone(compiled.manifest);
    if (!reducedMotion) {
      for (const track of sustain.tracks) {
        applyTrack(
          selfManifest,
          track,
          api.evaluatePropertyTrack(track, localT),
        );
      }
    }
    const selected = api.selectFlipbook(
      sustain.flipbook,
      localT,
      sustain.duration_ms,
      sustain.repeat,
    );
    const layers = selected.map((layer) => {
      if (layer.holo_id === "self") {
        return [{
          holo_id: holoId,
          weight: layer.weight,
          environment_weight: layer.weight,
          manifest: clone(selfManifest),
        }];
      }
      const nested = evaluateRecursiveSustain(
        api,
        historicalCompiled(compiled, layer.holo_id),
        localT,
        reducedMotion,
        traversal,
        depth + 1,
      );
      return nested.layers.map((nestedLayer) => ({
        ...nestedLayer,
        weight: api.roundDiv(
          nestedLayer.weight * layer.weight,
          HOLO_SCALE,
        ),
        environment_weight: api.roundDiv(
          nestedLayer.environment_weight * layer.weight,
          HOLO_SCALE,
        ),
      }));
    }).flat();
    traversal.path.delete(holoId);
    return {
      local_ms: localT,
      layers,
    };
  }

  function enforceExpandedLimits(evaluation) {
    if (evaluation.layers.length > 256) {
      throw new Error("Holo/1 expanded live layers exceed 256.");
    }
    let draws = 0;
    let transparentDraws = 0;
    for (const layer of evaluation.layers) {
      if (layer.weight === 0) continue;
      const nodes = new Map(layer.manifest.nodes.map((node) => [
        node.node_id || node.id,
        node,
      ]));
      for (const draw of layer.manifest.draws || []) {
        const nodeId = draw.node_id || draw;
        const node = nodes.get(nodeId);
        if (node && (!node.visible || (node.render_weight ?? HOLO_SCALE) === 0)) {
          continue;
        }
        draws += 1;
        if (
          draw.transparent === true
          || layer.weight < HOLO_SCALE
          || (node?.render_weight ?? HOLO_SCALE) < HOLO_SCALE
        ) {
          transparentDraws += 1;
        }
      }
    }
    if (draws > 256) {
      throw new Error("Holo/1 expanded live draws exceed 256.");
    }
    if (transparentDraws > 128) {
      throw new Error("Holo/1 expanded transparent draws exceed 128.");
    }
    return evaluation;
  }

  function evaluateSustain(api, compiled, activeT, reducedMotion) {
    const sustainElapsed = Math.max(
      0,
      activeT - compiled.input.authored.transition.duration_ms,
    );
    const evaluated = evaluateRecursiveSustain(
      api,
      compiled,
      sustainElapsed,
      reducedMotion,
      {
        path: new Set(),
        unique: new Set(),
      },
      0,
    );
    return enforceExpandedLimits({
      logical_ms: activeT,
      local_ms: evaluated.local_ms ?? 0,
      phase: reducedMotion
        && compiled.input.authored.accessibility.reduced_motion === "hold"
        ? "reduced-motion-hold"
        : "sustain",
      layers: evaluated.layers,
    });
  }

  function evaluateTransition(api, compiled, activeT, departure, reducedMotion) {
    const authored = compiled.input.authored;
    const duration = authored.transition.duration_ms;
    if (duration === 0) {
      return evaluateSustain(api, compiled, duration, reducedMotion);
    }
    const progress = api.easing(
      authored.transition.easing,
      api.roundDiv(activeT * HOLO_SCALE, duration),
    );
    const rules = reducedMotion
      ? new Map()
      : new Map(authored.transition.nodes.map((rule) => [rule.id, rule.mode]));
    const defaultMode = authored.transition.default;
    const baseId = authored.base_holo_id;
    const oldLayers = departure.layers.map((layer) => {
      const factors = new Map();
      for (const node of layer.manifest.nodes) {
        const id = node.node_id || node.id;
        const mode = layer.holo_id === baseId && !reducedMotion
          ? (rules.get(id) || defaultMode)
          : defaultMode;
        let factor = HOLO_SCALE;
        if (mode === "cut" || mode === "fade-in" || mode === "interpolate") {
          factor = 0;
        } else if (mode === "fade-out" || mode === "crossfade") {
          factor = HOLO_SCALE - progress;
        }
        factors.set(id, factor);
      }
      return {
        holo_id: layer.holo_id,
        weight: layer.weight,
        environment_weight: defaultMode === "crossfade"
          ? nodeWeight(api, layer.environment_weight ?? layer.weight, HOLO_SCALE - progress)
          : 0,
        manifest: weightedManifest(api, layer.manifest, factors),
      };
    });
    const departureBase = departure.layers.find((layer) => layer.holo_id === baseId);
    const oldById = new Map(
      (departureBase?.manifest.nodes || []).map((node) => [
        node.node_id || node.id,
        node,
      ]),
    );
    const newManifest = clone(compiled.manifest);
    newManifest.nodes = newManifest.nodes.map((node) => {
      const id = node.node_id || node.id;
      const mode = reducedMotion ? defaultMode : (rules.get(id) || defaultMode);
      if (mode === "interpolate") {
        const oldNode = oldById.get(id);
        if (!oldNode) throw new Error(`Transition node ${id} has no departure node.`);
        return interpolateNode(api, oldNode, node, progress);
      }
      let factor = HOLO_SCALE;
      if (mode === "fade-in" || mode === "crossfade") factor = progress;
      if (mode === "fade-out") factor = 0;
      return {
        ...node,
        render_weight: nodeWeight(api, node.render_weight, factor),
      };
    });
    return enforceExpandedLimits({
      logical_ms: activeT,
      transition_ms: activeT,
      phase: "transition",
      layers: [
        ...oldLayers,
        {
          holo_id: compiled.input.holo_id,
          weight: HOLO_SCALE,
          environment_weight: defaultMode === "crossfade" ? progress : HOLO_SCALE,
          manifest: newManifest,
        },
      ],
    });
  }

  function evaluateWithSharedProtocol(api, compiled, options) {
    const activeT = Math.max(0, Math.floor(options.logical_ms));
    const authored = compiled.input.authored;
    if (
      options.reduced_motion
      && authored.accessibility.reduced_motion === "hold"
    ) {
      return evaluateSustain(api, compiled, activeT, true);
    }
    let departure = options.departure;
    if (!departure && compiled.base_manifest) {
      departure = {
        layers: [{
          holo_id: authored.base_holo_id,
          weight: HOLO_SCALE,
          environment_weight: HOLO_SCALE,
          manifest: compiled.base_manifest,
        }],
      };
    }
    if (!departure && authored.base_holo_id === null) {
      departure = { layers: [] };
    }
    if (activeT < authored.transition.duration_ms) {
      return evaluateTransition(
        api,
        compiled,
        activeT,
        departure,
        Boolean(options.reduced_motion),
      );
    }
    return evaluateSustain(
      api,
      compiled,
      activeT,
      Boolean(options.reduced_motion),
    );
  }

  function protocolBridge(api = root.RappHoloProtocol) {
    if (!api || typeof api !== "object") {
      throw new Error("window.RappHoloProtocol is required for Holo/1 playback.");
    }
    const required = [
      "canonical",
      "compileSceneManifest",
      "domainHash",
      "easing",
      "evaluatePropertyTrack",
      "growlEvents",
      "localSustainTime",
      "roundDiv",
      "selectFlipbook",
      "validateOutput",
    ].every((name) => typeof api[name] === "function");
    if (!required) {
      throw new Error("RappHoloProtocol does not provide the pinned player helpers.");
    }
    return {
      compile(input) {
        return compileWithSharedProtocol(api, clone(input));
      },
      evaluate(compiled, options) {
        return evaluateWithSharedProtocol(
          api,
          clone(compiled),
          clone(options),
        );
      },
    };
  }

  function materializedRecord(value) {
    if (value?.schema === "rapp-holo-record/1") return value;
    if (value?.payload?.schema === "rapp-holo-record/1") return value.payload;
    if (value?.record?.schema === "rapp-holo-record/1") return value.record;
    if (value?.record?.payload?.schema === "rapp-holo-record/1") {
      return value.record.payload;
    }
    return null;
  }

  function announcedHoloId(value) {
    const candidate = value?.holo_id
      || value?.frame_hash
      || value?.record?.frame_hash;
    return HEX64.test(candidate || "") ? candidate : null;
  }

  function authoritativeHoloId(value) {
    const candidate = value?.authoritative_holo_id;
    return HEX64.test(candidate || "") ? candidate : null;
  }

  function normalizeSnapshot(value, fallbackId = null) {
    if (!value || typeof value !== "object") {
      throw new Error("A resolved Holo/1 snapshot must be an object.");
    }
    const record = materializedRecord(value);
    const authored = value.authored
      || record?.authored
      || (value.schema === "rapp-holo-output/1" ? value : null);
    const state = authored?.state || null;
    const holoId = value.holo_id
      || value.frame_hash
      || value.record?.frame_hash
      || fallbackId;
    if (!HEX64.test(holoId || "")) {
      throw new Error("A resolved Holo/1 snapshot requires its exact holo_id.");
    }
    if (authored?.schema !== "rapp-holo-output/1") {
      throw new Error(
        `Resolved snapshot ${holoId} requires its complete authored Holo/1 output.`,
      );
    }
    return {
      holo_id: holoId,
      authored: authored ? clone(authored) : null,
      record: record ? clone(record) : null,
      state: state ? clone(state) : null,
    };
  }

  function normalizeHistory(value) {
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value.map((entry) => normalizeSnapshot(entry));
    if (typeof value !== "object") {
      throw new Error("Resolved Holo/1 history must be an array or ID map.");
    }
    return Object.entries(value).map(([holoId, snapshot]) => (
      normalizeSnapshot(snapshot, holoId)
    ));
  }

  function normalizePlayerUpdate(value, active) {
    if (!value || typeof value !== "object") {
      throw new Error("Holo/1 player updates must be objects.");
    }
    const record = materializedRecord(value);
    const authored = value.authored
      || value.output
      || record?.authored
      || (value.schema === "rapp-holo-output/1" ? value : null);
    if (authored?.schema !== "rapp-holo-output/1") {
      throw new Error("Holo/1 update has no verified authored output.");
    }
    const holoId = announcedHoloId(value);
    if (!holoId) {
      throw new Error("Holo/1 update requires the exact materialized holo_id.");
    }
    if (
      value.authoritative_holo_id !== undefined
      && !authoritativeHoloId(value)
    ) {
      throw new Error("Authoritative Holo/1 head metadata is invalid.");
    }
    const authoritativeId = authoritativeHoloId(value) || holoId;

    let base = value.base || value.base_snapshot || null;
    if (!base && authored.base_holo_id && active?.holo_id === authored.base_holo_id) {
      base = {
        holo_id: active.holo_id,
        authored: active.authored,
        state: active.authored.state,
      };
    }
    if (authored.base_holo_id && !base) {
      throw new Error("Holo/1 successor requires its resolved base snapshot.");
    }
    const normalizedBase = base ? normalizeSnapshot(base, authored.base_holo_id) : null;
    if (
      normalizedBase
      && authored.base_holo_id !== normalizedBase.holo_id
    ) {
      throw new Error("Resolved base snapshot does not match base_holo_id.");
    }

    return {
      schema: "rapp-holo-player-input/1",
      holo_id: holoId,
      authoritative_holo_id: authoritativeId,
      record: record ? clone(record) : null,
      authored: clone(authored),
      base: normalizedBase,
      history: normalizeHistory(value.history || value.history_snapshots),
      reduced_motion: Boolean(value.reduced_motion),
    };
  }

  function compiledManifest(compiled) {
    return compiled?.manifest
      || compiled?.compiled_manifest
      || compiled?.current?.manifest
      || compiled;
  }

  function normalizedEvaluation(value, activeHoloId) {
    const evaluation = value?.evaluation || value?.composition || value;
    if (!evaluation || typeof evaluation !== "object") {
      throw new Error("Holo/1 evaluator returned no composition.");
    }
    let layers = evaluation.layers;
    if (!Array.isArray(layers) && evaluation.manifest) {
      layers = [{
        holo_id: activeHoloId,
        weight: HOLO_SCALE,
        manifest: evaluation.manifest,
      }];
    }
    if (!Array.isArray(layers)) {
      throw new Error("Holo/1 evaluator returned no explicit layers.");
    }
    return {
      ...clone(evaluation),
      layers: layers.map((layer) => {
        const weight = layer.weight ?? layer.weight_millionths ?? HOLO_SCALE;
        if (!Number.isInteger(weight) || weight < 0 || weight > HOLO_SCALE) {
          throw new Error("Holo/1 evaluator returned an invalid layer weight.");
        }
        const manifest = layer.manifest || layer.compiled_manifest;
        if (!manifest || typeof manifest !== "object") {
          throw new Error("Holo/1 evaluator returned a layer without a manifest.");
        }
        return {
          ...clone(layer),
          holo_id: layer.holo_id || activeHoloId,
          weight,
          manifest: clone(manifest),
        };
      }),
    };
  }

  function createHoloController(options = {}) {
    let bridge = null;
    const now = options.now || (() => performance.now());
    const state = {
      authoritative_holo_id: HEX64.test(options.authoritative_holo_id || "")
        ? options.authoritative_holo_id
        : null,
      player_active_holo_id: null,
      active: null,
      errors: [],
    };

    function sharedBridge() {
      bridge ||= protocolBridge(options.protocol);
      return bridge;
    }

    function logicalMs(at = now()) {
      if (!state.active) return 0;
      return Math.max(0, Math.floor(at - state.active.activated_at));
    }

    function evaluateActive(atLogicalMs) {
      if (!state.active) return null;
      const logical = Math.max(0, Math.floor(atLogicalMs));
      return normalizedEvaluation(
        sharedBridge().evaluate(state.active.compiled, {
          logical_ms: logical,
          departure: state.active.departure,
          reduced_motion: state.active.reduced_motion,
        }),
        state.active.holo_id,
      );
    }

    function rememberError(error) {
      const message = String(error?.message || error);
      if (state.errors.at(-1)?.message !== message) {
        state.errors.push({
          message,
          authoritative_holo_id: state.authoritative_holo_id,
          player_active_holo_id: state.player_active_holo_id,
        });
      }
      options.onError?.(clone(state.errors.at(-1)));
    }

    function acceptUpdate(value, acceptance = {}) {
      const selected = announcedHoloId(value);
      const authority = Object.hasOwn(value || {}, "authoritative_holo_id")
        ? authoritativeHoloId(value)
        : selected;
      if (authority) state.authoritative_holo_id = authority;
      try {
        const input = normalizePlayerUpdate(value, state.active);
        state.authoritative_holo_id = input.authoritative_holo_id;
        if (
          state.active
          && input.authored.base_holo_id !== state.active.holo_id
        ) {
          throw new Error(
            "Holo/1 player cannot activate across a player-active base gap.",
          );
        }
        const cutover = acceptance.activated_at ?? now();
        const previousActiveHoloId = state.player_active_holo_id;
        const departureLogicalMs = state.active
          ? logicalMs(cutover)
          : null;
        const departure = state.active
          ? evaluateActive(departureLogicalMs)
          : null;
        const compiled = sharedBridge().compile(input);
        const candidate = {
          holo_id: input.holo_id,
          authored: input.authored,
          compiled,
          departure,
          departure_logical_ms: departureLogicalMs,
          reduced_motion: input.reduced_motion,
          activated_at: cutover,
        };
        const firstEvaluation = normalizedEvaluation(
          sharedBridge().evaluate(compiled, {
            logical_ms: 0,
            departure,
            reduced_motion: candidate.reduced_motion,
          }),
          candidate.holo_id,
        );
        acceptance.activate?.(candidate, firstEvaluation);
        state.active = candidate;
        state.player_active_holo_id = candidate.holo_id;
        options.onAccepted?.({
          authoritative_holo_id: state.authoritative_holo_id,
          holo_id: state.player_active_holo_id,
          previous_active_holo_id: previousActiveHoloId,
          departure_logical_ms: departureLogicalMs,
          departure_manifest: clone(departure),
        });
        return true;
      } catch (error) {
        rememberError(error);
        return false;
      }
    }

    function snapshot(atLogicalMs = null) {
      const logical = atLogicalMs === null
        ? logicalMs()
        : Math.max(0, Math.floor(atLogicalMs));
      let evaluated = null;
      if (state.active) evaluated = evaluateActive(logical);
      return {
        authoritative_holo_id: state.authoritative_holo_id,
        player_active_holo_id: state.player_active_holo_id,
        logical_ms: logical,
        compiled_manifest: state.active
          ? clone(compiledManifest(state.active.compiled))
          : null,
        evaluated_manifest: clone(evaluated),
        errors: clone(state.errors),
      };
    }

    function metadata() {
      return {
        authoritative_holo_id: state.authoritative_holo_id,
        player_active_holo_id: state.player_active_holo_id,
        logical_ms: logicalMs(),
        errors: clone(state.errors),
      };
    }

    return Object.freeze({
      acceptUpdate,
      activeGrowl() {
        return state.active ? clone(state.active.authored.growl) : null;
      },
      evaluateAt: evaluateActive,
      metadata,
      snapshot,
    });
  }

  function rasterPlan(evaluation) {
    const normalized = normalizedEvaluation(
      evaluation,
      evaluation?.active_holo_id || null,
    );
    let camera = normalized.camera || normalized.manifest?.camera || null;
    let environment = normalized.environment
      || normalized.manifest?.environment
      || null;
    if (normalized.layers.length === 1) {
      camera ||= normalized.layers[0].manifest.camera;
      environment ||= normalized.layers[0].manifest.environment;
    }
    if (
      (!camera || !environment)
      && normalized.layers.length > 1
      && normalized.layers.some((layer) => (
        !layer.manifest.camera || !layer.manifest.environment
      ))
    ) {
      throw new Error(
        "Layered Holo/1 evaluation requires explicit camera and environment.",
      );
    }
    const renderNode = (node) => ({
      ...clone(node),
      id: node.id || node.node_id,
      geometry: node.geometry?.authored
        ? clone(node.geometry.authored)
        : clone(node.geometry),
    });
    return {
      schema: "rapp-holo-raster-plan/1",
      camera: clone(camera),
      environment: clone(environment),
      layers: normalized.layers.map((layer) => ({
        holo_id: layer.holo_id,
        weight: layer.weight,
        environment_weight: layer.environment_weight ?? layer.weight,
        camera: clone(layer.manifest.camera || camera),
        environment: clone(layer.manifest.environment || environment),
        nodes: (layer.manifest.nodes || []).map(renderNode),
        draws: clone(layer.manifest.draws || []),
        lights: clone(layer.manifest.lights || []),
      })),
    };
  }

  function rasterBatchDescriptor(node) {
    if (node?.type === "points") {
      return {
        kind: "points",
        vertex_count: node.geometry.points.length,
        object_count: 1,
        draw_count: 1,
      };
    }
    if (node?.type === "polyline") {
      return {
        kind: node.geometry.closed ? "line-loop" : "line",
        vertex_count: node.geometry.points.length,
        object_count: 1,
        draw_count: 1,
      };
    }
    return {
      kind: node?.type || null,
      object_count: 1,
      draw_count: node?.type === "group" ? 0 : 1,
    };
  }

  function shapeeExtrusion(
    geometry,
    api = root.RappHoloProtocol,
  ) {
    if (typeof api?.shapeeOutline !== "function") {
      throw new Error("RappHoloProtocol shapeeOutline is unavailable.");
    }
    const outline = api.shapeeOutline(clone(geometry));
    if (
      !Array.isArray(outline)
      || outline.length < 4
      || outline.some((point) => (
        !Array.isArray(point)
        || point.length !== 2
        || point.some((value) => !Number.isInteger(value))
      ))
    ) {
      throw new Error("RappHoloProtocol returned an invalid shapee outline.");
    }
    const first = outline[0];
    const last = outline.at(-1);
    if (first[0] !== last[0] || first[1] !== last[1]) {
      throw new Error("RappHoloProtocol returned an open shapee outline.");
    }
    return {
      outline: clone(outline),
      depth: geometry.depth,
    };
  }

  function createRasterBuildGate(canonicalize) {
    let activeKey = null;
    let rebuildCount = 0;
    return Object.freeze({
      inspect(plan) {
        const key = canonicalize(plan);
        return {
          key,
          rebuild: key !== activeKey,
        };
      },
      commit(key) {
        activeKey = key;
        rebuildCount += 1;
      },
      reset() {
        activeKey = null;
      },
      stats() {
        return {
          active_key: activeKey,
          rebuild_count: rebuildCount,
        };
      },
    });
  }

  root.RappHoloPlayerTest = Object.freeze({
    activeMessage,
    completedGrowl,
    createController: createHoloController,
    createGrowlPlayer,
    createRasterObject(node, layerWeight = HOLO_SCALE) {
      return nodeObject(clone(node), layerWeight);
    },
    departureManifestHash,
    errorMessage,
    growlSchedule,
    createRasterBuildGate,
    normalizePlayerUpdate,
    rasterBatchDescriptor,
    rasterPlan,
    readyMessage,
    shapeeExtrusion,
  });

  if (typeof document === "undefined") return;

  const configElement = document.getElementById("hologram-config");
  const canvas = document.getElementById("hologram-canvas");
  const title = document.getElementById("hologram-title");
  const subtitle = document.getElementById("hologram-subtitle");
  const kind = document.getElementById("hologram-kind");
  const facts = document.getElementById("hologram-facts");
  const tipText = document.getElementById("hologram-tip-text");
  const growlButton = document.getElementById("hologram-growl");
  const config = JSON.parse(configElement.textContent);

  function isHoloPlayerConfig(value) {
    return value?.mode === "holo/1"
      || value?.player_mode === "holo/1"
      || value?.schema === "rapp-holo-player-update/1"
      || value?.schema === "rapp-holo-output/1"
      || value?.record?.payload?.schema === "rapp-holo-record/1"
      || value?.record?.schema === "rapp-holo-record/1"
      || value?.holo_update;
  }

  function colorChannels(value) {
    if (Array.isArray(value)) {
      return {
        red: value[0],
        green: value[1],
        blue: value[2],
        alpha: value[3] ?? 255,
      };
    }
    const raw = String(value).slice(1);
    return {
      red: Number.parseInt(raw.slice(0, 2), 16),
      green: Number.parseInt(raw.slice(2, 4), 16),
      blue: Number.parseInt(raw.slice(4, 6), 16),
      alpha: raw.length === 8 ? Number.parseInt(raw.slice(6, 8), 16) : 255,
    };
  }

  function roundedDivide(numerator, denominator) {
    const sign = numerator < 0 ? -1 : 1;
    const absolute = Math.abs(numerator);
    const quotient = Math.floor(absolute / denominator);
    const remainder = absolute % denominator;
    return sign * (quotient + (2 * remainder >= denominator ? 1 : 0));
  }

  function threeColor(channels) {
    return new THREE.Color(
      channels.red / 255,
      channels.green / 255,
      channels.blue / 255,
    );
  }

  function vector3(values) {
    return new THREE.Vector3(
      values[0] / 1000,
      values[1] / 1000,
      values[2] / 1000,
    );
  }

  function applyTransform(object, transform) {
    object.position.copy(vector3(transform.position));
    object.rotation.set(
      transform.rotation[0] * Math.PI / 180000,
      transform.rotation[1] * Math.PI / 180000,
      transform.rotation[2] * Math.PI / 180000,
      "XYZ",
    );
    object.scale.set(
      transform.scale[0] / 1000,
      transform.scale[1] / 1000,
      transform.scale[2] / 1000,
    );
  }

  function blendMode(material, blend) {
    if (blend === "additive") material.blending = THREE.AdditiveBlending;
    else if (blend === "multiply") material.blending = THREE.MultiplyBlending;
    else material.blending = THREE.NormalBlending;
    material.depthTest = true;
    material.depthWrite = blend === "normal";
  }

  function makeMaterial(declared, nodeType, layerWeight) {
    const base = colorChannels(declared.color);
    const emissive = colorChannels(declared.emissive);
    const opacity = roundedDivide(declared.opacity * base.alpha, 255);
    const weightedOpacity = roundedDivide(opacity * layerWeight, HOLO_SCALE) / 1000;
    let material;
    if (declared.presentation === "solid") {
      material = new THREE.MeshStandardMaterial({
        color: threeColor(base),
        emissive: threeColor(emissive),
        emissiveIntensity: declared.emissive_strength / 10000,
        metalness: declared.metallic / 1000,
        roughness: declared.roughness / 1000,
        opacity: weightedOpacity,
        transparent: weightedOpacity < 1 || declared.blend !== "normal",
        side: declared.side === "double" ? THREE.DoubleSide : THREE.FrontSide,
      });
    } else {
      const strength = declared.emissive_strength;
      const unlit = {
        red: Math.min(
          255,
          base.red + roundedDivide(emissive.red * strength, 10000),
        ),
        green: Math.min(
          255,
          base.green + roundedDivide(emissive.green * strength, 10000),
        ),
        blue: Math.min(
          255,
          base.blue + roundedDivide(emissive.blue * strength, 10000),
        ),
      };
      const options = {
        color: threeColor(unlit),
        opacity: weightedOpacity,
        transparent: weightedOpacity < 1 || declared.blend !== "normal",
        side: declared.side === "double" ? THREE.DoubleSide : THREE.FrontSide,
      };
      if (nodeType === "points") {
        material = new THREE.ShaderMaterial({
          uniforms: {
            holoColor: { value: options.color },
            holoOpacity: { value: options.opacity },
            holoPerspective: { value: 1 },
            holoViewportHeight: { value: 1 },
          },
          vertexShader: [
            "attribute float holoSize;",
            "uniform float holoPerspective;",
            "uniform float holoViewportHeight;",
            "void main() {",
            "  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);",
            "  gl_Position = projectionMatrix * viewPosition;",
            "  float pointSize = holoSize * holoViewportHeight",
            "    * projectionMatrix[1][1] * 0.5;",
            "  if (holoPerspective > 0.5) pointSize /= -viewPosition.z;",
            "  gl_PointSize = pointSize;",
            "}",
          ].join("\n"),
          fragmentShader: [
            "uniform vec3 holoColor;",
            "uniform float holoOpacity;",
            "void main() {",
            "  gl_FragColor = vec4(holoColor, holoOpacity);",
            "}",
          ].join("\n"),
          transparent: options.transparent,
        });
        material.userData.holoPointMaterial = true;
      } else if (nodeType === "polyline") {
        material = new THREE.LineBasicMaterial(options);
      } else {
        material = new THREE.MeshBasicMaterial({
          ...options,
          wireframe: declared.presentation === "wire",
        });
      }
    }
    blendMode(material, declared.blend);
    return material;
  }

  function primitiveGeometry(declared) {
    const geometry = declared.parameters || declared;
    const shape = declared.shape || geometry.shape;
    if (shape === "sphere") {
      return new THREE.SphereGeometry(
        geometry.radius / 1000,
        declared.longitude_segments || 8 * (2 ** geometry.detail),
        declared.latitude_segments || 4 * (2 ** geometry.detail),
      );
    }
    if (shape === "tetrahedron") {
      return new THREE.TetrahedronGeometry(geometry.radius / 1000, geometry.detail);
    }
    if (shape === "octahedron") {
      return new THREE.OctahedronGeometry(geometry.radius / 1000, geometry.detail);
    }
    if (shape === "icosahedron") {
      return new THREE.IcosahedronGeometry(geometry.radius / 1000, geometry.detail);
    }
    if (shape === "box") {
      return new THREE.BoxGeometry(
        geometry.size[0] / 1000,
        geometry.size[1] / 1000,
        geometry.size[2] / 1000,
      );
    }
    if (shape === "cylinder") {
      return new THREE.CylinderGeometry(
        geometry.radius / 1000,
        geometry.radius / 1000,
        geometry.height / 1000,
        geometry.detail,
      );
    }
    if (shape === "cone") {
      return new THREE.ConeGeometry(
        geometry.radius / 1000,
        geometry.height / 1000,
        geometry.detail,
      );
    }
    if (shape === "torus") {
      return new THREE.TorusGeometry(
        geometry.major_radius / 1000,
        geometry.minor_radius / 1000,
        geometry.detail,
        geometry.detail * 2,
      );
    }
    if (shape === "ring") {
      return new THREE.RingGeometry(
        (geometry.major_radius - geometry.minor_radius) / 1000,
        (geometry.major_radius + geometry.minor_radius) / 1000,
        geometry.detail * 2,
      );
    }
    if (shape === "plane") {
      return new THREE.PlaneGeometry(
        geometry.width / 1000,
        geometry.height / 1000,
      );
    }
    if (shape === "shapee") {
      const extrusion = shapeeExtrusion(geometry);
      const shapePath = new THREE.Shape();
      extrusion.outline.slice(0, -1).forEach((point, index) => {
        const x = point[0] / 1000;
        const y = point[1] / 1000;
        if (index === 0) shapePath.moveTo(x, y);
        else shapePath.lineTo(x, y);
      });
      shapePath.closePath();
      const depth = extrusion.depth / 1000;
      const output = new THREE.ExtrudeGeometry(shapePath, {
        bevelEnabled: false,
        curveSegments: 1,
        depth,
        steps: 1,
      });
      output.translate(0, 0, -depth / 2);
      return output;
    }
    throw new Error(`Unsupported Holo/1 primitive ${shape}.`);
  }

  function capsuleObject(geometry, material) {
    const object = new THREE.Group();
    const radius = geometry.radius / 1000;
    const cylinderHeight = geometry.height / 1000 - 2 * radius;
    const rings = Math.max(2, Math.trunc(geometry.detail / 2));
    if (cylinderHeight > 0) {
      object.add(new THREE.Mesh(
        new THREE.CylinderGeometry(
          radius,
          radius,
          cylinderHeight,
          geometry.detail,
        ),
        material,
      ));
    }
    const top = new THREE.Mesh(
      new THREE.SphereGeometry(
        radius,
        geometry.detail,
        rings,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      ),
      material,
    );
    top.position.y = cylinderHeight / 2;
    object.add(top);
    const bottom = new THREE.Mesh(
      new THREE.SphereGeometry(
        radius,
        geometry.detail,
        rings,
        0,
        Math.PI * 2,
        Math.PI / 2,
        Math.PI / 2,
      ),
      material,
    );
    bottom.position.y = -cylinderHeight / 2;
    object.add(bottom);
    return object;
  }

  function meshGeometry(declared) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(declared.vertices.flat().map(
        (value) => value / 1000,
      ), 3),
    );
    geometry.setIndex(declared.triangles.flat());
    geometry.computeVertexNormals();
    return geometry;
  }

  function polylineObject(declared, material) {
    const points = declared.points.map(vector3);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    material.linewidth = declared.width / 1000;
    return declared.closed
      ? new THREE.LineLoop(geometry, material)
      : new THREE.Line(geometry, material);
  }

  function pointsObject(declared, material) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(declared.points.flatMap(
        (point) => point.position.map((value) => value / 1000),
      ), 3),
    );
    geometry.setAttribute(
      "holoSize",
      new THREE.Float32BufferAttribute(declared.points.map(
        (point) => point.size / 1000,
      ), 1),
    );
    return new THREE.Points(geometry, material);
  }

  function lightObject(declared, layerWeight) {
    const object = new THREE.Group();
    const color = threeColor(colorChannels(declared.color));
    const intensity = declared.intensity / 10000 * layerWeight / HOLO_SCALE;
    if (declared.kind === "ambient") {
      object.add(new THREE.AmbientLight(color, intensity));
      return object;
    }
    if (declared.kind === "point") {
      const light = new THREE.PointLight(
        color,
        intensity,
        declared.range / 1000,
        1,
      );
      object.add(light);
      return object;
    }
    const direction = new THREE.Vector3(
      -declared.direction[0],
      -declared.direction[1],
      -declared.direction[2],
    ).normalize();
    const target = new THREE.Object3D();
    target.position.copy(direction);
    let light;
    if (declared.kind === "directional") {
      light = new THREE.DirectionalLight(color, intensity);
    } else {
      light = new THREE.SpotLight(
        color,
        intensity,
        declared.range / 1000,
        declared.angle_mdeg * Math.PI / 360000,
        0,
        1,
      );
    }
    light.target = target;
    object.add(light, target);
    return object;
  }

  function nodeObject(node, layerWeight) {
    const effectiveWeight = roundedDivide(
      layerWeight * (node.render_weight ?? HOLO_SCALE),
      HOLO_SCALE,
    );
    if (node.type === "group") return new THREE.Group();
    if (node.type === "light") return lightObject(node.geometry, effectiveWeight);
    const material = makeMaterial(node.material, node.type, effectiveWeight);
    if (node.type === "primitive") {
      const geometry = node.geometry.parameters || node.geometry;
      return (node.geometry.shape || geometry.shape) === "capsule"
        ? capsuleObject(geometry, material)
        : new THREE.Mesh(primitiveGeometry(node.geometry), material);
    }
    if (node.type === "mesh") {
      return new THREE.Mesh(meshGeometry(node.geometry), material);
    }
    if (node.type === "polyline") {
      return polylineObject(node.geometry, material);
    }
    if (node.type === "points") {
      return pointsObject(node.geometry, material);
    }
    throw new Error(`Unsupported Holo/1 node type ${node.type}.`);
  }

  function cameraFor(declared) {
    let output;
    if (declared.projection === "perspective") {
      output = new THREE.PerspectiveCamera(
        declared.fov_mdeg / 1000,
        innerWidth / innerHeight,
        declared.near / 1000,
        declared.far / 1000,
      );
    } else {
      const height = declared.ortho_height / 1000;
      const width = height * innerWidth / innerHeight;
      output = new THREE.OrthographicCamera(
        -width / 2,
        width / 2,
        height / 2,
        -height / 2,
        declared.near / 1000,
        declared.far / 1000,
      );
      output.userData.holoOrthoHeight = height;
    }
    output.position.copy(vector3(declared.position));
    output.up.set(
      declared.up[0] / HOLO_SCALE,
      declared.up[1] / HOLO_SCALE,
      declared.up[2] / HOLO_SCALE,
    ).normalize();
    output.lookAt(vector3(declared.target));
    return output;
  }

  function createHoloRasterizer() {
    if (String(THREE.REVISION) !== "128") {
      throw new Error("Holo/1 requires the fixed local Three.js r128 interpreter.");
    }
    const holoRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
    });
    holoRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    holoRenderer.outputEncoding = THREE.sRGBEncoding;
    holoRenderer.toneMapping = THREE.NoToneMapping;
    holoRenderer.physicallyCorrectLights = false;
    holoRenderer.shadowMap.enabled = false;
    holoRenderer.autoClear = false;
    let activeLayers = [];
    let activeClear = { red: 0, green: 0, blue: 0, alpha: 0 };
    const buildGate = createRasterBuildGate(
      (plan) => root.RappHoloProtocol.canonical(plan),
    );

    function disposeLayers() {
      const geometries = new Set();
      const materials = new Set();
      for (const layer of activeLayers) {
        layer.scene.traverse((object) => {
          if (object.geometry) geometries.add(object.geometry);
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => materials.add(material));
          } else if (object.material) {
            materials.add(object.material);
          }
        });
      }
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    }

    function buildLayer(layer, initialRenderOrder) {
      const scene = new THREE.Scene();
      scene.background = null;
      if (layer.environment.fog) {
        scene.fog = new THREE.Fog(
          threeColor(colorChannels(layer.environment.fog.color)),
          layer.environment.fog.near / 1000,
          layer.environment.fog.far / 1000,
        );
      }
      let renderOrder = 0;
      const objects = new Map();
      for (const node of layer.nodes) {
        const object = nodeObject(node, layer.weight);
        object.name = node.id;
        object.visible = node.type === "group"
          ? node.visible
          : node.visible && (node.render_weight ?? HOLO_SCALE) > 0;
        object.renderOrder = initialRenderOrder + renderOrder;
        object.traverse((descendant) => {
          descendant.renderOrder = initialRenderOrder + renderOrder;
        });
        renderOrder += 1;
        applyTransform(object, node.transform);
        if (node.parent) {
          const parentObject = objects.get(node.parent);
          if (!parentObject) {
            throw new Error(`Holo/1 parent ${node.parent} is unavailable.`);
          }
          parentObject.add(object);
        } else {
          scene.add(object);
        }
        objects.set(node.id, object);
      }
      return {
        scene,
        camera: cameraFor(layer.camera),
        render_count: renderOrder,
      };
    }

    function renderLayers() {
      holoRenderer.setClearColor(
        threeColor(activeClear),
        activeClear.alpha / 255,
      );
      holoRenderer.clear(true, true, true);
      activeLayers.forEach((layer, index) => {
        if (index > 0) holoRenderer.clearDepth();
        layer.scene.traverse((object) => {
          if (!object.material?.userData?.holoPointMaterial) return;
          object.material.uniforms.holoPerspective.value = (
            layer.camera.isPerspectiveCamera ? 1 : 0
          );
          object.material.uniforms.holoViewportHeight.value = (
            holoRenderer.domElement.height
          );
        });
        holoRenderer.render(layer.scene, layer.camera);
      });
    }

    function draw(evaluation) {
      const plan = rasterPlan(evaluation);
      const pending = buildGate.inspect(plan);
      if (!pending.rebuild) return false;
      let renderOrder = 0;
      const nextLayers = plan.layers.map((layer) => {
        const built = buildLayer(layer, renderOrder);
        renderOrder += built.render_count;
        return built;
      });
      const clearTotal = {
        red: 0,
        green: 0,
        blue: 0,
        alpha: 0,
      };
      for (const layer of plan.layers) {
        const channels = colorChannels(layer.environment.clear_color);
        const weight = layer.environment_weight;
        clearTotal.red += channels.red * weight;
        clearTotal.green += channels.green * weight;
        clearTotal.blue += channels.blue * weight;
        clearTotal.alpha += channels.alpha * weight;
      }
      const nextClear = {
        red: roundedDivide(clearTotal.red, HOLO_SCALE),
        green: roundedDivide(clearTotal.green, HOLO_SCALE),
        blue: roundedDivide(clearTotal.blue, HOLO_SCALE),
        alpha: roundedDivide(clearTotal.alpha, HOLO_SCALE),
      };
      disposeLayers();
      activeLayers = nextLayers;
      activeClear = nextClear;
      buildGate.commit(pending.key);
      renderLayers();
      return true;
    }

    function resizeCamera(camera) {
      if (camera.isPerspectiveCamera) {
        camera.aspect = innerWidth / innerHeight;
      } else {
        const height = camera.userData.holoOrthoHeight;
        const width = height * innerWidth / innerHeight;
        camera.left = -width / 2;
        camera.right = width / 2;
        camera.top = height / 2;
        camera.bottom = -height / 2;
      }
      camera.updateProjectionMatrix();
    }

    function resizeHolo() {
      holoRenderer.setSize(innerWidth, innerHeight);
      activeLayers.forEach((layer) => resizeCamera(layer.camera));
      if (activeLayers.length) renderLayers();
    }

    resizeHolo();
    return Object.freeze({
      draw,
      resize: resizeHolo,
      stats: buildGate.stats,
    });
  }

  function initialHoloUpdate(value) {
    if (value?.holo_update) return value.holo_update;
    if (value?.update) return value.update;
    if (
      value?.schema === "rapp-holo-player-update/1"
      || value?.schema === "rapp-holo-output/1"
      || value?.authored
      || value?.output
      || value?.payload?.schema === "rapp-holo-record/1"
      || value?.record
    ) {
      return value;
    }
    return null;
  }

  function runHoloPlayer() {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    canvas.dataset.mode = "holo-1";
    tipText.textContent = "local capsule · offline playback · import/export/re-upload ready";
    growlButton.hidden = false;
    growlButton.disabled = true;
    kind.textContent = "ROLLING CORE CAPSULE · HOLO/1";
    title.textContent = "No capsule frame active";
    subtitle.textContent = "Import or re-upload a signed local capsule delivered by Rapterbox.";
    facts.replaceChildren();
    let rasterizer = null;
    let animationStarted = false;
    let lastFrameError = null;
    let activationMessageQueue = Promise.resolve();
    const growlPlayer = createGrowlPlayer({
      protocol: root.RappHoloProtocol,
    });

    function postHoloError(error) {
      const state = controller?.metadata() || {
        authoritative_holo_id: authoritativeHoloId(config)
          || announcedHoloId(config),
        player_active_holo_id: null,
      };
      parent.postMessage(errorMessage(error, state), "*");
    }

    function queueActiveMessage(evidence) {
      activationMessageQueue = activationMessageQueue.then(async () => {
        const manifestHash = evidence.previous_active_holo_id === null
          ? null
          : await departureManifestHash(evidence.departure_manifest);
        parent.postMessage(activeMessage(evidence, manifestHash), "*");
      }).catch((error) => {
        postHoloError(error);
      });
    }

    function sendStatus(error = null) {
      const state = controller
        ? (error ? controller.metadata() : controller.snapshot())
        : {
          authoritative_holo_id: null,
          player_active_holo_id: null,
          logical_ms: 0,
          errors: error ? [{ message: error }] : [],
        };
      parent.postMessage({
        schema: "rapp-holo-player-status/1",
        player_id: config.id || null,
        authoritative_holo_id: state.authoritative_holo_id,
        player_active_holo_id: state.player_active_holo_id,
        logical_ms: state.logical_ms,
        error: error || state.errors.at(-1)?.message || null,
      }, "*");
    }

    function renderStatus(existingState = null) {
      const state = existingState || controller.snapshot();
      canvas.dataset.ready = state.player_active_holo_id ? "true" : "false";
      canvas.dataset.status = state.errors.length ? "refused" : (
        state.player_active_holo_id ? "active" : "empty"
      );
      title.textContent = state.player_active_holo_id || "No capsule frame active";
      subtitle.textContent = controllerActiveDescription
        || "Import or re-upload a signed local capsule delivered by Rapterbox.";
      renderFacts([
        ["mode", "local Rolling Core Capsule"],
        ["ownership", "one-time purchase · local use"],
        ["storefront", "Rapterbox · outside this player"],
        ["substrate", "RAPP/1"],
        ["cloud compute", "optional · not required"],
        ["authoritative holo", state.authoritative_holo_id || "none"],
        ["player active", state.player_active_holo_id || "none"],
        ["logical ms", state.logical_ms],
        ["renderer", "rapp-holo-renderer/1"],
        ["status", state.errors.at(-1)?.message || (
          state.player_active_holo_id ? "active" : "empty"
        )],
      ]);
    }

    function animationFrame() {
      requestAnimationFrame(animationFrame);
      try {
        const state = controller.snapshot();
        if (!state.player_active_holo_id || !rasterizer) return;
        rasterizer.draw(state.evaluated_manifest);
        lastFrameError = null;
        renderStatus(state);
      } catch (error) {
        const message = String(error.message || error);
        if (message !== lastFrameError) {
          lastFrameError = message;
          sendStatus(message);
          postHoloError(message);
        }
      }
    }

    function accept(update) {
      const previousDescription = controllerActiveDescription;
      const proposedDescription = update?.authored?.accessibility?.description
        || materializedRecord(update)?.authored?.accessibility?.description
        || "";
      const accepted = controller.acceptUpdate(update, {
        activate(candidate, evaluation) {
          rasterizer ||= createHoloRasterizer();
          rasterizer.draw(evaluation);
          controllerActiveDescription = candidate.authored.accessibility.description;
        },
      });
      if (!accepted) controllerActiveDescription = previousDescription;
      else {
        controllerActiveDescription = proposedDescription;
        growlButton.disabled = false;
      }
      renderStatus();
      sendStatus();
      if (accepted && !animationStarted) {
        animationStarted = true;
        requestAnimationFrame(animationFrame);
      }
    }

    growlButton.addEventListener("click", async () => {
      const growl = controller?.activeGrowl();
      if (!growl) return;
      let playbackMs = 0;
      try {
        growlButton.disabled = true;
        const schedule = await growlPlayer.play(growl, { user_gesture: true });
        playbackMs = Math.ceil(schedule.duration_us / 1000);
      } catch (error) {
        postHoloError(error);
      } finally {
        if (playbackMs > 0) {
          setTimeout(() => {
            growlButton.disabled = !controller?.activeGrowl();
          }, playbackMs);
        } else {
          growlButton.disabled = !controller?.activeGrowl();
        }
      }
    });

    let controller = null;
    let controllerActiveDescription = "";
    try {
      controller = createHoloController({
        protocol: root.RappHoloProtocol,
        authoritative_holo_id: authoritativeHoloId(config)
          || announcedHoloId(config),
        onError(error) {
          sendStatus(error.message);
          postHoloError(error.message);
        },
        onAccepted: queueActiveMessage,
      });
      addEventListener("resize", () => rasterizer?.resize());
      addEventListener("message", (event) => {
        if (event.source !== parent) return;
        const message = event.data;
        if (message?.schema !== "rapp-holo-player-update/1") return;
        if (
          message.player_id
          && config.id
          && message.player_id !== config.id
        ) {
          return;
        }
        accept(message);
      });
      renderStatus();
      parent.postMessage(
        readyMessage(config.id, controller.metadata()),
        "*",
      );
      parent.postMessage({
        schema: "rapp-zoo-hologram-ready/1.0",
        hologram_id: config.id || null,
        mode: "holo/1",
      }, "*");
      const initial = initialHoloUpdate(config);
      if (initial) accept(initial);
      else sendStatus();
    } catch (error) {
      const message = String(error.message || error);
      canvas.dataset.ready = "false";
      canvas.dataset.status = "refused";
      subtitle.textContent = message;
      renderFacts([["status", message]]);
      sendStatus(message);
      postHoloError(message);
    }
  }

  if (isHoloPlayerConfig(config)) {
    runHoloPlayer();
    return;
  }

  let renderer;
  let scene;
  let camera;
  let subject;
  let animated = [];
  let rotation = .45;
  let tilt = .12;
  let distance = 6;
  let dragging = false;
  let pointerX = 0;
  let pointerY = 0;
  let liveContext = null;

  function hashUnit(seed, salt) {
    const text = `${seed}|${salt}`;
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      value ^= text.charCodeAt(index);
      value = Math.imul(value, 16777619);
    }
    return (value >>> 0) / 0xffffffff;
  }

  function colorFor(accent, lightness = .7) {
    const hue = accent === "violet" ? .74 : accent === "ice" ? .54 : .52;
    return new THREE.Color().setHSL(hue, .86, lightness);
  }

  function hologramMaterial(accent, opacity = .55) {
    return new THREE.MeshBasicMaterial({
      color: colorFor(accent),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  function edgeFor(geometry, accent, opacity = .3) {
    return new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: colorFor(accent, .84),
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
  }

  function projector(group, accent, width = .55, height = 2.2) {
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(width * .82, width, .08, 32),
      new THREE.MeshBasicMaterial({ color: 0x26394a }),
    );
    base.position.y = -.38;
    group.add(base);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(width * .35, width * .78, 32),
      new THREE.MeshBasicMaterial({
        color: colorFor(accent, .82),
        transparent: true,
        opacity: .7,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -.33;
    group.add(ring);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(width, height, 36, 1, true),
      hologramMaterial(accent, .055),
    );
    cone.position.y = height / 2 - .25;
    group.add(cone);
    animated.push({ type: "ring", object: ring });
    animated.push({ type: "cone", object: cone });
  }

  function clearSubject() {
    if (subject) scene.remove(subject);
    subject = new THREE.Group();
    animated = [];
    scene.add(subject);
  }

  function identitySeed() {
    const sloshFrame = liveContext?.data_slosh?.frame;
    const lineage = liveContext?.lineages?.[0]?.artifact_rappid;
    const egg = liveContext?.eggs?.[0]?.egg_hash;
    const candidate = sloshFrame?.frame_hash
      || lineage?.split(":").pop()
      || egg
      || config.default_seed;
    return /^[0-9a-f]{64}$/.test(candidate) ? candidate : config.default_seed;
  }

  function renderFacts(items) {
    facts.replaceChildren();
    for (const [label, value] of items) {
      const row = document.createElement("div");
      row.className = "hologram-fact";
      const bold = document.createElement("b");
      bold.textContent = `${label} `;
      row.append(bold, document.createTextNode(String(value)));
      facts.append(row);
    }
  }

  function buildCharacter() {
    clearSubject();
    const seed = identitySeed();
    const accent = config.accent;
    const material = hologramMaterial(accent, .52);
    const breadth = .82 + hashUnit(seed, "breadth") * .38;
    const headSize = .14 + hashUnit(seed, "head") * .045;
    const shoulder = .24 * breadth;

    const torsoGeometry = new THREE.CylinderGeometry(
      .19 * breadth,
      .25 * breadth,
      .66,
      16,
      1,
      true,
    );
    const torso = new THREE.Mesh(torsoGeometry, material);
    torso.position.y = .94;
    subject.add(torso);
    const torsoEdge = edgeFor(torsoGeometry, accent);
    torsoEdge.position.copy(torso.position);
    subject.add(torsoEdge);

    const headGeometry = new THREE.SphereGeometry(headSize, 18, 14);
    const head = new THREE.Group();
    head.add(new THREE.Mesh(headGeometry, material));
    head.add(edgeFor(headGeometry, accent, .4));
    head.position.y = 1.45;
    subject.add(head);
    animated.push({ type: "head", object: head });

    const eyeMaterial = new THREE.MeshBasicMaterial({
      color: colorFor(accent, .94),
      transparent: true,
      opacity: .96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(.021, 8, 8),
        eyeMaterial,
      );
      eye.position.set(side * .055, .01, headSize * .87);
      head.add(eye);
      animated.push({ type: "eye", object: eye });
    }

    const limb = (top, bottom, length) => (
      new THREE.CylinderGeometry(top, bottom, length, 10, 1, true)
    );
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(limb(.052, .044, .58), material);
      arm.position.set(side * shoulder, .92, 0);
      arm.rotation.z = side * .1;
      subject.add(arm);
      animated.push({ type: "arm", object: arm, side });
      const leg = new THREE.Mesh(limb(.07, .047, .72), material);
      leg.position.set(side * .09, .21, 0);
      subject.add(leg);
    }

    const aura = new THREE.Mesh(
      new THREE.CylinderGeometry(.42 * breadth, .52 * breadth, 2.1, 24, 1, true),
      hologramMaterial(accent, .045),
    );
    aura.position.y = .72;
    subject.add(aura);
    animated.push({ type: "aura", object: aura });
    projector(subject, accent);

    const species = ["Sable", "Nix", "Quill", "Wren", "Mirek", "Pell"];
    const suffixes = ["kin", "ling", "ra", "eth", "ox"];
    const name = species[Math.floor(hashUnit(seed, "name") * species.length)]
      + "-"
      + suffixes[Math.floor(hashUnit(seed, "suffix") * suffixes.length)];
    title.textContent = name;
    subtitle.textContent = config.scene.subtitle;
    kind.textContent = liveContext
      ? "LEGACY LIVE-BINDING PROJECTION — NOT A ROLLING CORE"
      : "LEGACY CHARACTER BOTTLE — NOT A ROLLING CORE";
    renderFacts([
      ["artifact", liveContext?.lineages?.[0]?.artifact_rappid || config.rappid],
      ["bottle", config.bottle ? "caught and reusable" : "ephemeral"],
      ["seed", `${seed.slice(0, 28)}…`],
      ["body", breadth > 1.08 ? "broad" : breadth < .94 ? "slight" : "balanced"],
      ["binding", liveContext ? "live zoo identity" : "captured frame seed"],
    ]);
  }

  function wrapText(context, text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(/\s+/);
    let line = "";
    let cursor = y;
    for (const word of words) {
      const candidate = `${line}${word} `;
      if (line && context.measureText(candidate).width > maxWidth) {
        context.fillText(line, x, cursor);
        line = `${word} `;
        cursor += lineHeight;
      } else {
        line = candidate;
      }
    }
    context.fillText(line, x, cursor);
  }

  function projectionPayload() {
    if (!liveContext) return config.scene;
    const sloshFrame = liveContext.data_slosh?.frame;
    const sloshPayload = sloshFrame?.payload || {};
    const health = liveContext.health || {};
    if (
      typeof sloshPayload.prompt === "string"
      && Array.isArray(sloshPayload.options)
      && sloshPayload.options.length >= 3
    ) {
      return {
        prompt: sloshPayload.prompt,
        options: sloshPayload.options.slice(0, 3).map((option) => ({
          label: String(option.label || "Dimension"),
          value: String(option.value || ""),
        })),
        briefing: {
          trust: "FRAME",
          revision: sloshFrame.spec,
          residents: health.lineage_count || 0,
          instances: health.instance_count || 0,
          eggs: health.egg_count || 0,
        },
      };
    }
    return {
      prompt: String(
        sloshPayload.query
        || sloshPayload.prompt
        || `RAPP Zoo is holding ${health.instance_count || 0} instances and ${health.egg_count || 0} verified eggs.`,
      ),
      options: [
        {
          label: "Open collection",
          value: `${health.lineage_count || 0} artifact lineages are currently visible.`,
        },
        {
          label: "Inspect recoverability",
          value: `${health.egg_count || 0} verified eggs are available for resurrection.`,
        },
        {
          label: "Ask Copilot",
          value: "Use the Frontier intelligence panel for the next safe move.",
        },
      ],
      briefing: {
        trust: "LIVE",
        revision: "rev-6",
        residents: health.lineage_count || 0,
        instances: health.instance_count || 0,
        eggs: health.egg_count || 0,
      },
    };
  }

  function panelTexture(payload) {
    const panel = document.createElement("canvas");
    panel.width = 1024;
    panel.height = 576;
    const context = panel.getContext("2d");
    context.fillStyle = "rgba(2,10,18,.82)";
    context.fillRect(0, 0, panel.width, panel.height);
    context.strokeStyle = "rgba(150,225,255,.56)";
    context.lineWidth = 2;
    context.strokeRect(10, 10, panel.width - 20, panel.height - 20);
    context.fillStyle = "#aee7ff";
    context.font = "600 21px ui-monospace,Menlo,monospace";
    context.fillText(liveContext ? "LIVE ZOO PROJECTION" : "CAPTURED FRAME PROJECTION", 38, 58);
    context.fillStyle = "#effaff";
    context.font = '600 38px "Segoe UI",system-ui,sans-serif';
    wrapText(context, payload.prompt, 38, 122, panel.width - 76, 44);
    let y = 238;
    for (const option of payload.options.slice(0, 3)) {
      context.strokeStyle = "rgba(150,225,255,.34)";
      context.strokeRect(38, y - 34, panel.width - 76, 88);
      context.fillStyle = "#e7f8ff";
      context.font = '600 27px "Segoe UI",system-ui,sans-serif';
      context.fillText(option.label, 58, y);
      context.fillStyle = "rgba(170,225,250,.76)";
      context.font = "17px ui-monospace,Menlo,monospace";
      wrapText(context, `→ ${option.value}`, 58, y + 32, panel.width - 116, 22);
      y += 104;
    }
    for (let scan = 0; scan < panel.height; scan += 3) {
      context.fillStyle = "rgba(0,0,0,.38)";
      context.fillRect(0, scan, panel.width, 1);
    }
    return new THREE.CanvasTexture(panel);
  }

  function buildProjection() {
    clearSubject();
    const payload = projectionPayload();
    if (
      typeof payload?.prompt !== "string"
      || !Array.isArray(payload.options)
      || payload.options.length !== 3
      || payload.options.some((option) => (
        !option
        || typeof option.label !== "string"
        || typeof option.value !== "string"
      ))
    ) {
      throw new Error("The hologram bottle has an invalid projection scene.");
    }
    const accent = config.accent;
    const material = new THREE.MeshBasicMaterial({
      map: panelTexture(payload),
      color: colorFor(accent, .72),
      transparent: true,
      opacity: .92,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.6), material);
    panel.position.set(1.7, .65, 0);
    subject.add(panel);
    animated.push({ type: "panel", object: panel });
    projector(subject, accent, 2.65, 4.8);

    const points = new THREE.BufferGeometry();
    const positions = new Float32Array(700 * 3);
    for (let index = 0; index < 700; index += 1) {
      const angle = hashUnit(config.default_seed, `angle-${index}`) * Math.PI * 2;
      const radius = 2.1 + hashUnit(config.default_seed, `radius-${index}`) * 3.5;
      positions[index * 3] = 1.7 + Math.cos(angle) * radius;
      positions[index * 3 + 1] = (hashUnit(config.default_seed, `y-${index}`) - .5) * 4.3;
      positions[index * 3 + 2] = Math.sin(angle) * radius * .38;
    }
    points.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const dust = new THREE.Points(
      points,
      new THREE.PointsMaterial({
        color: colorFor(accent, .78),
        size: .04,
        transparent: true,
        opacity: .58,
        blending: THREE.AdditiveBlending,
      }),
    );
    subject.add(dust);
    animated.push({ type: "dust", object: dust });

    title.textContent = config.name;
    subtitle.textContent = liveContext
      ? "Bound to the current path-free zoo snapshot."
      : config.description;
    kind.textContent = liveContext
      ? "LEGACY LIVE-BINDING PROJECTION — NOT A ROLLING CORE"
      : "LEGACY DATA BOTTLE — NOT A ROLLING CORE";
    const briefing = payload.briefing || {};
    renderFacts([
      ["dogg", config.rappid],
      ["bottle", config.bottle ? "caught and reusable" : "ephemeral"],
      ["trust", briefing.trust || (liveContext ? "LIVE" : "CAPTURED")],
      ["revision", briefing.revision || "rev-6"],
      ["lineages", briefing.residents ?? liveContext?.health?.lineage_count ?? "—"],
      ["instances", briefing.instances ?? liveContext?.health?.instance_count ?? "—"],
      ["eggs", briefing.eggs ?? liveContext?.health?.egg_count ?? "—"],
      ["tick", liveContext?.data_slosh?.frame?.seq ?? "ambient"],
      ["frame", liveContext?.data_slosh?.frame?.frame_hash
        ? `${liveContext.data_slosh.frame.frame_hash.slice(0, 24)}…`
        : "none"],
    ]);
  }

  function build() {
    distance = config.kind === "character" ? 4.25 : 7;
    if (config.kind === "character") buildCharacter();
    else buildProjection();
    canvas.dataset.ready = "true";
  }

  function reportError(error) {
    canvas.dataset.ready = "false";
    title.textContent = "Projection failed";
    subtitle.textContent = error.message;
    facts.innerHTML = '<div class="hologram-error">This bottle cannot be rendered.</div>';
    parent.postMessage({
      schema: "rapp-zoo-hologram-error/1.0",
      hologram_id: config.id,
      error: String(error.message || error),
    }, "*");
  }

  function resize() {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }

  function tick() {
    requestAnimationFrame(tick);
    const time = performance.now() * .001;
    if (subject) {
      subject.position.y = Math.sin(time * .8) * .025;
      for (const item of animated) {
        if (item.type === "head") item.object.rotation.y = Math.sin(time * .55) * .18;
        if (item.type === "eye") item.object.scale.y = time % 4.2 > 4.08 ? .1 : 1;
        if (item.type === "arm") item.object.rotation.z = item.side * (.1 + Math.sin(time * .7) * .035);
        if (item.type === "aura") item.object.material.opacity = .038 + Math.sin(time * 1.7) * .012;
        if (item.type === "ring") item.object.material.opacity = .55 + Math.sin(time * 5) * .18;
        if (item.type === "cone") item.object.material.opacity = .05 + Math.sin(time * 2.6) * .014;
        if (item.type === "panel") {
          item.object.material.opacity = .84 + Math.sin(time * 41) * .055;
          const glitchTick = Math.floor(time * 12);
          const glitch = hashUnit(config.default_seed, `glitch-${glitchTick}`);
          item.object.position.x = glitch < .008
            ? 1.7 + (hashUnit(config.default_seed, `offset-${glitchTick}`) - .5) * .12
            : 1.7;
        }
        if (item.type === "dust") item.object.rotation.y = time * .08;
      }
    }
    camera.position.set(
      Math.sin(rotation) * distance * Math.cos(tilt),
      1 + Math.sin(tilt) * distance,
      Math.cos(rotation) * distance * Math.cos(tilt),
    );
    camera.lookAt(config.kind === "character" ? 0 : 1.4, .72, 0);
    renderer.render(scene, camera);
  }

  function initialize() {
    canvas.dataset.mode = "legacy";
    title.textContent = config.name;
    subtitle.textContent = config.description;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x03070c, .045);
    camera = new THREE.PerspectiveCamera(50, 1, .1, 160);
    const grid = new THREE.GridHelper(60, 60, 0x17384a, 0x0a202b);
    grid.position.y = -.65;
    scene.add(grid);
    scene.add(new THREE.AmbientLight(0x7fd4ff, .18));
    canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointerup", () => { dragging = false; });
    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      rotation += (event.clientX - pointerX) * .006;
      tilt = Math.max(-.55, Math.min(.75, tilt + (event.clientY - pointerY) * .004));
      pointerX = event.clientX;
      pointerY = event.clientY;
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      distance = Math.max(2.8, Math.min(14, distance + event.deltaY * .01));
    }, { passive: false });
    addEventListener("resize", resize);
    resize();
    build();
    tick();
    parent.postMessage({
      schema: "rapp-zoo-hologram-ready/1.0",
      hologram_id: config.id,
    }, "*");
  }

  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (
      message?.schema !== "rapp-zoo-hologram-context/1.0"
      || message.hologram_id !== config.id
    ) {
      return;
    }
    try {
      liveContext = message.data_slosh || message.context || null;
      build();
      parent.postMessage({
        schema: "rapp-zoo-hologram-bound/1.0",
        hologram_id: config.id,
        live: Boolean(liveContext),
      }, "*");
    } catch (error) {
      reportError(error);
    }
  });

  try {
    initialize();
  } catch (error) {
    reportError(error);
  }
})();
