(() => {
  "use strict";

  const configElement = document.getElementById("hologram-config");
  const canvas = document.getElementById("hologram-canvas");
  const title = document.getElementById("hologram-title");
  const subtitle = document.getElementById("hologram-subtitle");
  const kind = document.getElementById("hologram-kind");
  const facts = document.getElementById("hologram-facts");
  const config = JSON.parse(configElement.textContent);

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
    kind.textContent = liveContext ? "LIVE IDENTITY HOLOGRAM" : "DEMO CHARACTER HOLOGRAM";
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
    kind.textContent = liveContext ? "LIVE DATA HOLOGRAM" : "DEMO DATA HOLOGRAM";
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
