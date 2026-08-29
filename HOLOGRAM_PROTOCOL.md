# RAPP Holo/1

## AI-authored visual output as an immutable flipbook

**Status:** Draft protocol contract  
**RAPP authority:** `rapp/1` rev-6, pinned by `RAPP1_AUTHORITY.json`  
**Proposed registered frame kind:** `body.hologram` in the `body` family  
**Authored output schema:** `rapp-holo-output/1`  
**Render IR:** `rapp-holo-ir/1`  
**Materialized record schema:** `rapp-holo-record/1`

The normative machine-readable schemas are:

- `holograms/protocol/rapp-holo-output.schema.json`
- `holograms/protocol/rapp-holo-record.schema.json`
- `holograms/protocol/rapp-holo-activation.schema.json`
- `holograms/protocol/rapp-holo-sightedness.schema.json`
- `holograms/protocol/rapp-holo-presence.schema.json`

RAPP Holo/1 defines hologram as an AI output channel beside text and voice.
It does not define an avatar, character generator, morphology system, species,
body plan, emotion classifier, or visual template.

The AI authors the hologram. The protocol carries it. The renderer verifies and
plays it.

Holo/1 is infrastructure, not a RAPP Factory feature. RAPP Factory can be one
authoring and inspection client, but the same output channel works for any
organism, assistant, game, simulation, meeting, workflow, device, or future
interface that can emit and consume verified RAPP frames.

This repository separates two deployments:

- [`HOLO_ZOO.md`](./HOLO_ZOO.md) - the controlled local player, archive,
  debugger, and conformance lab;
- [`HOLO_IN_THE_WILD.md`](./HOLO_IN_THE_WILD.md) - the live distributed stream
  and its practical AI-presence signal.

### 1.1 Stable substrate, adaptable profiles

New use cases do not fork the hologram protocol. They change ordinary authored
data:

- source-frame payload and registered source kind;
- complete scene state;
- transition from the current visual head;
- sustain tracks and historical flipbook choices;
- accessibility description;
- application-specific context supplied to the AI.

The invariant substrate stays fixed:

```text
verified source -> exact AI output -> immutable body.hologram
                -> visual head -> deterministic player -> Holo Wake
```

A **Holo profile** is therefore a small set of frame and context conventions,
not another renderer or avatar system. Profiles may describe a factory,
customer briefing, game character, ambient agent, operations room, teaching
tool, performance, or an unforeseen use case. They MUST NOT add executable
content, change Holo identity rules, bypass the visual parent, or prescribe what
the AI must look like.

---

## 1. The model

When hologram output is enabled, an AI turn can produce:

```text
text output
voice output
holo output
```

The holo output is declarative data authored during the original AI turn. It is
not generated later by the Zoo, a bottle, a second model call, or a renderer.

The AI receives the complete turn context that its Brainstem makes available
and decides how, or whether, that context affects its visual output. Source
hashes bind provenance; they never perturb geometry. Holo/1 cannot prove a
semantic thought process from bytes, and it does not take authorship away from
the AI by pretending to do so.

Every accepted holo output becomes one immutable visual state. The ordered
states form that AI's **holo flipbook**:

```text
H0 -> H1 -> H2 -> H3 -> ... -> current holo head
```

While `H3` is current, its authored transition and sustain performance continue
for as long as necessary. When `H4` arrives, the player evaluates the exact pose
currently being shown, transitions to `H4`, and then performs `H4` until another
state arrives.

The current holo may explicitly reuse prior holo states in its sustain timeline.
That lets the AI blink, recoil, remember, transform, echo, cycle, or otherwise
emote with its own immutable history until the next turn updates it.

The immutable object is the authored state and performance data, not one frozen
pixel. A version can contain deterministic animation and still remain immutable.

---

## 2. Non-negotiable authority boundary

### 2.1 The AI owns

The AI alone chooses:

- the complete visual state;
- whether it resembles a person, animal, storm, machine, landscape, symbol,
  abstract field, many objects, no recognizable object, or anything else
  representable by the IR;
- color, composition, camera, environment, geometry, material, scale, and pose;
- transitions from the prior holo;
- deterministic motion while the holo remains current;
- which prior holo states to reuse in its flipbook performance;
- the accessibility description of what it chose to express.

### 2.2 The protocol owns

The protocol defines:

- identity and source-turn binding;
- immutable ordering and content addressing;
- the safe data-only render language;
- deterministic timing and replay;
- limits and refusal behavior;
- current-head advancement;
- history resolution;
- renderer-version compatibility.

### 2.3 The renderer owns

The renderer may only:

- validate the declared IR;
- compile declared nodes into fixed local rendering operations;
- evaluate authored tracks against the protocol clock;
- resolve verified historical references;
- perform explicitly declared cuts, fades, crossfades, and compatible
  interpolation;
- expose accessibility and reduced-motion behavior;
- keep showing the prior valid holo when a new output is absent or refused.

The renderer MUST NOT:

- infer a form from text, semantic tokens, a hash, or a source frame;
- add humanoid anatomy or any other fallback morphology;
- invent a name, species, face, body, pose, emotion, symbol, color, motion, or
  camera move;
- secretly deform authored geometry using a frame hash;
- repair an invalid output;
- choose a replacement expression;
- call a model to "polish" or regenerate a holo;
- mutate an accepted holo with live data.

An unsigned source frame plus subject-string equality is not proof of cognitive
origin. Holo/1 does not pretend otherwise. Optional producer provenance can be
attached, while sustained causal holo output supplies the separate practical
AI-presence heuristic described in section 16.

If no holo has ever been emitted, the channel is empty. A blank channel is
correct. A renderer-invented avatar is not.

---

## 3. Vocabulary

**Source turn**  
A verified AI-authored `memory.chat-turn` RAPP frame. The holo candidate is
committed as one of that turn's outputs before the source frame hash is
finalized.

**Authored holo output**  
The exact `rapp-holo-output/1` object produced by the AI during the source turn.

**Producer provenance**  
An optional detached-JWS statement identifying a producer that vouches for the
source and authored digest. It is provenance, not the Holo Wake itself.

**Holo frame**  
A verified `body.hologram` RAPP frame materialized from the already-committed
authored output.

**Holo ID**  
The `frame_hash` of the materialized `body.hologram` frame.

**Body head**  
The highest verified frame in the subject's complete RAPP body stream. It may
be a hologram frame or another registered body event.

**Holo head**  
The newest accepted `body.hologram` frame in that body stream. It is a derived
view over the body stream, not a replacement for the RAPP body head.

**Authoritative holo head**  
The newest durably accepted holo frame, whether or not a particular display can
currently render it.

**Player-active holo**  
The newest holo a specific player successfully compiled and activated. A player
may temporarily lag the authoritative head and MUST report that divergence.

**Holo sequence**  
A contiguous zero-based order over only the accepted hologram frames for one
subject.

**Scene state**  
A complete independently renderable scene snapshot in one holo output.

**Performance keyframe**  
A point on an authored property or flipbook timeline. It is not a RAPP frame.

**Flipbook**  
The immutable ordered history of holo frames, plus any explicit playback of
those historical states by the current holo.

**Holo Wake**  
The sustained, on-time, causally correct trail of holo outputs behind a live
participant. It is the practical in-the-wild signal that machine-capable
intelligence is actively keeping up with the stream.

---

## 4. One output, authored in the original turn

When the holo channel is active, every assistant turn is expected to contain
exactly one holo candidate:

```json
{
  "role": "assistant",
  "outputs": {
    "text": "ordinary text output",
    "voice": null,
    "holo": {
      "schema": "rapp-holo-output/1",
      "base_holo_id": null,
      "ir_version": "rapp-holo-ir/1",
      "renderer_contract": "rapp-holo-renderer/1",
      "state": {},
      "transition": {},
      "performance": {},
      "growl": {},
      "accessibility": {}
    }
  }
}
```

The surrounding assistant-turn payload profile can carry other fields, but the
exact holo candidate MUST be committed in the source frame before its
`payload_hash` and `frame_hash` are computed.

This prevents a different visual state from being attached to the turn later.
Materialization copies the already-authored object; it does not ask a model what
the holo should have been.

### 4.1 Cardinality

- One valid holo output advances the head.
- A visually unchanged expression is still a new complete hold state linked to
  the current base.
- A missing holo output leaves the current holo head performing unchanged and
  records a broken Holo Wake observation; it does not block the text turn.
- More than one holo output in a source turn is refused.
- The same source frame and same authored digest are an idempotent replay.
- The same source frame with different holo data is refused.
- A changed expression requires a new AI turn and a new immutable holo output.

### 4.2 Brainstem integration

A holo-capable Brainstem exposes the protocol as an output tool or structured
output channel during the original model turn:

```text
emit_hologram(authored_holo_output)
```

The AI receives:

- the Holo/1 contract;
- the current `base_holo_id`;
- a bounded recent verified holo-history page;
- a paginated history-query capability that can retrieve any retained verified
  ancestor by `holo_seq` or holo ID;
- the renderer limits and supported IR version.

The tool may validate and stage the exact candidate. It MUST NOT generate,
rewrite, complete, adapt, decorate, or polish it.

The normal RAPP `/chat` response remains unchanged. Hologram is materialized as
an asynchronous RAPP body frame, consistent with RAPP/1 section 8.

---

## 5. RAPP frame placement

`body.hologram` is a new registered kind on the existing eleven-key `rapp/1`
frame. It is bound to the `body` family. The frame's `stream_id` is the subject
organism's RAPPID.

It does not create a new envelope or a competing protocol frame.

The RAPP kind registry entry is:

```json
{
  "kind": "body.hologram",
  "family": "body"
}
```

```json
{
  "spec": "rapp/1",
  "kind": "body.hologram",
  "stream_id": "rappid:@owner/subject:64-lowercase-hex",
  "seq": 42,
  "utc": "2026-04-20T12:34:56.789Z",
  "payload": {
    "schema": "rapp-holo-record/1",
    "holo_seq": 7,
    "visual_parent": "previous-holo-frame-hash-or-null",
    "source": {
      "stream_id": "rappid:@owner/subject:64-lowercase-hex:session",
      "seq": 117,
      "frame_hash": "source-memory-frame-hash"
    },
    "authored_hash": "domain-separated-hash-of-authored-output",
    "producer_provenance": null,
    "authored": {
      "schema": "rapp-holo-output/1",
      "base_holo_id": "previous-holo-frame-hash-or-null",
      "ir_version": "rapp-holo-ir/1",
      "renderer_contract": "rapp-holo-renderer/1",
      "state": {},
      "transition": {},
      "performance": {},
      "growl": {},
      "accessibility": {}
    }
  },
  "payload_hash": "rapp-particle-hash",
  "frame_hash": "rapp-wave-hash-and-holo-id",
  "prev": "previous-body-frame-payload-hash",
  "prev_wave": null,
  "sig": null
}
```

The example hash strings are placeholders. A conformant frame uses the exact
RAPP/1 grammar and hash rules.

### 5.1 Two orders, never conflated

There are two valid orders:

1. **Body order** uses outer `seq` and `prev`. It includes every event in the
   organism's body stream and is verified against the actual body head.
2. **Holo order** uses payload `holo_seq` and `visual_parent`. It includes only
   `body.hologram` events and creates the visual flipbook.

A consumer MUST NOT verify a RAPP body frame against the holo head. The holo
head is not a RAPP chain head.

### 5.2 Subject binding and optional provenance

The RAPPID prefix of `source.stream_id` MUST equal the body frame's
`stream_id`. A holo output cannot be replayed from another organism or memory
stream.

`producer_provenance` is either null or a provenance object matching
`rapp-holo-record.schema.json`. When present, its detached JWS verifies the
producer's statement about the subject, source, and authored digest. When null,
the record remains a valid Holo/1 output if its RAPP frame, source inclusion,
visual chain, and IR validate; its provenance result is simply `unattested`.

For imported or federated output, the source and body frames also MUST satisfy
the estate's normal signature and registry trust policy. Holo/1 does not weaken
RAPP/1 signature rules.

### 5.3 Source inclusion proof

Materialization verifies an already-committed source by exact
`(stream_id, seq, frame_hash)` lookup in the authoritative append-only memory
log. It does not try to verify an old source as a successor to the current
memory head.

Full Holo/1 verification requires:

- the exact source frame, already verified as part of its memory chain;
- proof that the source payload contains the exact authored candidate in its
  holo output member.

A store MUST retain the exact source frame as private provenance. An exported
or federated holo MUST travel with that source frame and enough verified chain
or registry evidence to prove its inclusion. If source proof is unavailable,
the outer body frame may still be a structurally valid RAPP frame, but it is not
source-bound Holo/1 and MUST NOT become a player-active holo.

### 5.4 Exact authored preservation

The materialized `payload.authored` object MUST be canonically identical to the
candidate committed in the source turn.

`authored_hash` is:

```text
H("rapp-holo/1:authored", authored)
```

The app may add only the surrounding record metadata. It cannot change a value
inside `authored`.

Record validation also requires:

- `authored.base_holo_id == visual_parent`;
- `holo_seq == 0` if and only if `visual_parent == null`;
- the recomputed authored hash equals both copies of `authored_hash`.

When producer provenance is present, its source, subject, and authored hash also
must match the record exactly.

---

## 6. Authored output schema

An authored output contains exactly:

```json
{
  "schema": "rapp-holo-output/1",
  "base_holo_id": null,
  "ir_version": "rapp-holo-ir/1",
  "renderer_contract": "rapp-holo-renderer/1",
  "state": {},
  "transition": {},
  "performance": {},
  "growl": {},
  "accessibility": {}
}
```

The complete key sets, enum values, primitive parameters, numeric ranges,
string bounds, track value types, and conditional requirements are normative in
`holograms/protocol/rapp-holo-output.schema.json`. The materialized payload and optional producer-provenance statement are
normative in
`holograms/protocol/rapp-holo-record.schema.json`.

The Markdown and schemas are one contract. A schema/document disagreement is a
protocol defect and MUST fail the conformance gate rather than being resolved
by implementation guesswork.

### 6.1 `base_holo_id`

`base_holo_id` is either:

- `null` for the first holo output; or
- the exact current holo head ID observed by the AI while authoring.

The committer MUST compare it with the current head. A stale candidate is
refused and MUST NOT be silently reparented.

### 6.2 `state`

`state` is a complete scene snapshot. It MUST render independently even if no
prior holo state is available.

It contains:

```json
{
  "camera": {},
  "environment": {},
  "nodes": []
}
```

It is not a patch. New states never mutate old states.

### 6.3 `transition`

`transition` declares how this state arrives from `base_holo_id`. The new state
owns its transition.

### 6.4 `performance`

`performance` declares what the state does after activation and until another
holo frame becomes current. It can animate its own nodes and can explicitly use
verified prior holo states as flipbook frames.

### 6.5 `growl`

Every Holo/1 output carries one AI-authored `rapp-holo-growl/1` trait. It is a
bounded MIDI motif plus a seed for deterministic autocomplete. The AI chooses
the seed, register, motif, tempo, program, and timing. The protocol completes
the motif mechanically; the Zoo does not compose on the AI's behalf.

The completed result is a finite list of MIDI-like note events. A player may
render it through a fixed local synthesizer only after an explicit user
gesture. It never autoplays, fetches samples, opens a MIDI device, or executes
code.

Growl gives each immutable holo a sonic identity that can continue with its
visual performance until the next frame arrives.

### 6.6 `accessibility`

The AI supplies a plain-language description of the visual output and a
reduced-motion choice. The renderer does not infer either.

---

## 7. Mechanically neutral render IR

`rapp-holo-ir/1` is a bounded scene language. It describes rendering mechanics,
not meaning.

It MUST NOT contain renderer-level concepts such as:

- humanoid;
- face;
- avatar;
- character;
- creature;
- emotion;
- species;
- good, bad, happy, sad, angry, or afraid;
- semantic role;
- prescribed accent palette.

The AI may visually express any of those ideas. The renderer simply does not
classify or manufacture them.

### 7.1 Coordinates and numbers

- JSON numbers MUST be interoperable integers; floats are refused.
- Positions use signed fixed-point milli-units.
- Rotations use signed milli-degrees.
- Scale and opacity use unsigned fixed-point thousandths.
- Colors use `#RRGGBB` or `#RRGGBBAA`.
- All arrays have exact lengths.
- Out-of-range values are refused, never clamped.

### 7.2 Camera

The AI authors:

- perspective or orthographic projection;
- position;
- target;
- up vector;
- bounded field of view or orthographic height;
- near and far planes.

The renderer may apply a user safety override for reduced motion or device
limits, but it may not compose a different camera. If the authored camera
cannot be supported inside the declared limits, that player refuses activation.

### 7.3 Environment

The AI authors fixed data for:

- clear color, including optional alpha;
- optional bounded fog;
- fixed local lighting nodes;
- optional bounded grid or field nodes represented through ordinary IR nodes.

No remote skyboxes, images, videos, or environment maps are permitted in v1.

### 7.4 Scene graph nodes

Every node has a unique stable `id`, an optional `parent`, a complete transform,
visibility, and one supported node type.

Supported v1 node types are:

| Type | Data |
|---|---|
| `group` | hierarchy and transform only |
| `primitive` | a fixed local geometry name and bounded parameters |
| `mesh` | bounded vertices and triangle indices |
| `polyline` | bounded points, width, and closed/open flag |
| `points` | bounded point positions and sizes |
| `light` | bounded fixed local light parameters |

Primitive geometry names are renderer mechanics only:

```text
sphere box capsule cylinder cone torus ring plane shapee
tetrahedron octahedron icosahedron
```

No primitive is a default. The AI chooses whether to use any of them.

### 7.5 SHAPEE: the seeded side-profile tile

`shapee` is an optional procedural primitive representing an AI's visual
side-profile. It is one bounded mesh, not thousands of tiny renderer objects.

The AI authors:

```json
{
  "shape": "shapee",
  "seed": "64-lowercase-hex",
  "width": 2400,
  "height": 1800,
  "depth": 180,
  "teeth": 16,
  "relief": 420
}
```

The pinned `shapeeOutline` algorithm reads successive seed nibbles and creates
orthogonal, sideways key-teeth along a closed tile outline. The same seed and
dimensions always produce the same integer polygon and extruded mesh.

SHAPEE is vocabulary available to the AI, not a required template for the full
hologram. One frame may contain no SHAPEE, one identity tile, or several
independently seeded tiles composed with any other valid scene nodes.

The tile is the smallest useful expression, not the edge of the canvas. A Holo
lineage may progressively autocomplete outward:

```text
SHAPEE tile -> outline -> form -> motion/aura -> habitat -> full frame
```

Each expansion is a new immutable authored state. The AI decides how much of
the stage to occupy; the full camera frame can become the organism's body,
environment, memory, or performance.

### 7.6 Materials

The fixed material contract supports bounded combinations of:

- base color;
- emissive color and strength;
- opacity;
- wire, solid, point, and line presentation;
- approved blend mode;
- double-sided flag;
- bounded metallic and roughness values.

There are no shaders, shader source strings, arbitrary Three.js property paths,
CSS, HTML, scripts, expressions, imports, URLs, or remote assets.

### 7.7 Stable identities

Node IDs are continuity handles chosen by the AI.

- Reusing an ID in the next state says that it is the same visual element.
- A new ID says that a visual element is new.
- Omitting an old ID says that it is absent from the new state.

The renderer does not infer identity from geometry, position, color, or name.

### 7.8 Normative semantic validation

JSON Schema validation is necessary but not sufficient. A conformant semantic
validator also MUST verify:

- node IDs are unique;
- every parent exists and parent relationships are acyclic with depth at most
  eight;
- every parent appears earlier than its children in authored node order;
- camera position differs from target, the up vector is nonzero, and
  `far > near`;
- fog `far > near`;
- every mesh index is smaller than that mesh's vertex count;
- triangles contain three distinct indices;
- radial `minor_radius < major_radius`;
- capsule `height >= 2 * radius`;
- light directions are nonzero where required;
- material presentation matches the node type under the renderer contract;
- transition node IDs are unique and satisfy their mode's base/new-state
  existence rule;
- `interpolate` topology is compatible under section 8;
- each `(node_id, property)` has at most one sustain track;
- every track target exists in `state`;
- material tracks target nodes with non-null materials;
- keyframe times are strictly increasing, begin at zero, and do not exceed
  `sustain.duration_ms`;
- flipbook times are strictly increasing, begin at zero, and do not exceed
  `sustain.duration_ms`;
- flipbook crossfade windows do not overlap;
- every historical ID is a verified visual ancestor;
- all aggregate limits in section 13 pass.

Validation refuses the whole candidate on any failure. It never removes a node,
rewrites a value, sorts authored keyframes, or clamps a number.

### 7.9 Normative units and compilation

`rapp-holo-renderer/1` uses these exact conversions:

```text
world unit       = integer milli-unit / 1000
rotation radians = integer milli-degree * pi / 180000
scale            = integer thousandth / 1000
opacity          = integer thousandth / 1000
material factor  = integer thousandth / 1000
light intensity  = integer ten-thousandth / 10000
```

Colors are parsed as unsigned sRGB bytes in written channel order. Six-digit
colors have alpha 255. Eight-digit colors use the final two digits as alpha.
The effective draw opacity is:

```text
round_div(material.opacity * color.alpha, 255)
```

The renderer traverses nodes in authored array order. Parent transforms are
applied before child transforms. Equal-depth transparent draws preserve authored
array order. A conformant compiler exposes a canonical scene manifest containing
the validated camera, environment, parent graph, geometry parameters, material
parameters, draw order, and light order. Cross-language conformance compares
that manifest before rasterization.

Primitive tessellation, material mapping, light mapping, scene composition, and
the integer evaluator are pinned in
`holograms/protocol/RAPP_HOLO_RENDERER_1.md`.

---

## 8. Transition contract

The transition object contains:

```json
{
  "duration_ms": 600,
  "easing": "ease-in-out",
  "default": "cut",
  "nodes": [
    {
      "id": "stable-node-id",
      "mode": "interpolate"
    }
  ]
}
```

Supported easing values are fixed:

```text
linear ease-in ease-out ease-in-out
```

Supported node transition modes are:

| Mode | Requirement |
|---|---|
| `cut` | no continuity is attempted |
| `fade-in` | node exists in the new state |
| `fade-out` | node exists in the base state |
| `crossfade` | old and new representations are independently rendered |
| `interpolate` | same node ID and compatible authored topology exist in both states |

Rules:

- The default is always explicit and is normally `cut`.
- Unsupported or undeclared changes use the declared default.
- Geometry morphing is allowed only when the AI declares `interpolate` and the
  topology is compatible.
- Compatible topology means:
  - groups have the same ID;
  - primitives have the same shape and parameter key set;
  - meshes have identical triangle indices and equal vertex counts;
  - polylines have equal point counts and the same closed/open flag;
  - point nodes have equal point counts;
  - lights have the same light kind.
- The renderer MUST NOT guess a morph between incompatible objects.
- Static topology and mode compatibility are checked before authoritative
  commit.
- At player activation, transition time zero is the exact evaluated scene being
  displayed from the old player-active holo at the transactional cutover time.
- A player activates the next holo only when its current active holo equals the
  new holo's `base_holo_id`. A lagging player catches up in holo order or
  reports that it cannot activate; it never invents a transition across a gap.

---

## 9. Performance and flipbook contract

The performance clock is:

```text
rapp-holo-logical-ms/1
```

Logical time `t = 0` when the holo becomes active. Tracks are pure functions of
the immutable authored data and logical elapsed milliseconds.

```json
{
  "clock": "rapp-holo-logical-ms/1",
  "sustain": {
    "duration_ms": 4000,
    "repeat": "loop",
    "tracks": [],
    "flipbook": []
  }
}
```

### 9.1 Sustain behavior

`repeat` is one of:

```text
hold once loop ping-pong
```

- `hold` displays the complete current state without time-varying tracks.
- `once` performs once, then holds the final evaluated pose.
- `loop` repeats from logical time zero.
- `ping-pong` alternates forward and backward.

When no newer holo arrives, sustain continues according to this declaration.

### 9.2 Logical-time evaluation

For an active holo, let `active_t` be nonnegative integer milliseconds since
the player's transactional activation cutover:

```text
transition_t = min(active_t, transition.duration_ms)
sustain_t    = max(0, active_t - transition.duration_ms)
```

Transition and sustain never overlap.

For sustain duration `d`:

```text
hold      -> local_t = 0
once      -> local_t = min(sustain_t, d)
loop      -> local_t = sustain_t mod d
ping-pong -> q = sustain_t mod (2*d)
             local_t = q when q <= d, otherwise 2*d - q
```

All interpolation uses integer fixed point with `S = 1000000`.

```text
round_div(n, d):
  refuse when d <= 0
  q = trunc(abs(n) / d)
  r = abs(n) mod d
  if 2*r >= d, q = q + 1
  return q with the sign of n

lerp(a, b, p):
  return a + round_div((b - a) * p, S)
```

This is round-half-away-from-zero. All schema bounds ensure intermediate
products remain inside the interoperable integer range.

Given normalized progress `p` in `[0,S]`, easing is:

```text
linear:
  e = p

ease-in:
  e = round_div(p * p, S)

ease-out:
  e = S - round_div((S - p) * (S - p), S)

ease-in-out:
  if p <= S/2: e = round_div(2 * p * p, S)
  else:        e = S - round_div(2 * (S - p) * (S - p), S)
```

Vector values apply `lerp` per component. Colors apply it independently to
integer sRGB red, green, blue, and alpha channels. Boolean values use step
evaluation. `step` returns the value at the greatest keyframe time not greater
than `local_t`.

### 9.3 Property tracks

A property track targets one node ID and one allowlisted property:

```json
{
  "node_id": "stable-node-id",
  "property": "transform.rotation",
  "interpolation": "linear",
  "keyframes": [
    {
      "at_ms": 0,
      "value": [0, 0, 0]
    },
    {
      "at_ms": 2000,
      "value": [0, 360000, 0]
    }
  ]
}
```

Allowlisted properties are limited to:

```text
transform.position
transform.rotation
transform.scale
material.color
material.emissive
material.opacity
visible
```

No arbitrary object-property access is permitted.

Every track begins with a keyframe at `at_ms: 0`. Between adjacent keyframes,
progress is:

```text
p = round_div((local_t - left.at_ms) * S,
              right.at_ms - left.at_ms)
```

The track's declared interpolation converts `p` to `e`, then evaluates `lerp`.
Before the first keyframe is impossible because it is at zero. After the last
keyframe, the last value holds until the sustain repeat rule remaps time.

### 9.4 Historical flipbook frames

The current holo may explicitly place prior holo states on its sustain
timeline:

```json
{
  "at_ms": 1200,
  "holo_id": "self-or-verified-prior-holo-id",
  "blend": "crossfade",
  "blend_ms": 240
}
```

Rules:

- `holo_id` is either the string `self` or an exact verified ancestor holo ID.
- References MUST be strict ancestors in the subject's verified holo chain.
- A referenced historical frame may itself reference earlier frames. The
  player resolves and evaluates that ancestry recursively.
- Strict ancestry makes the graph acyclic by construction; explicit cycles,
  future references, or cross-subject references are refused.
- Recursive evaluation is bounded to depth 8, 64 unique historical frames,
  4 MiB of unique referenced state, and the ordinary expanded layer/draw
  budgets.
- A repeated reference reuses the already compiled immutable snapshot; it does
  not duplicate geometry or create another unbounded object tree.
- The current output controls ordering, timing, and blending.
- The renderer never selects an old state on its own.
- Every referenced frame is retained as a live dependency of the current head.
- Ancestor distance is not capped. The number and aggregate bytes of references
  in one output are bounded.

This is the protocol mechanism for using the current and prior frames as an
AI-authored flipbook until the next frame arrives.

The first flipbook entry is at `at_ms: 0`. At an entry time, that entry becomes
the selected snapshot. For `cut`, selection changes immediately. For
`crossfade`, the blend into an entry ends at its `at_ms` and begins at
`at_ms - blend_ms`; before the blend window, the prior entry remains selected.
For `loop`, the first entry's `blend_ms` defines the crossfade from the last
entry across the loop boundary. For `once`, the final entry holds.

Property tracks animate the selected frame's `self` snapshot. If that frame's
timeline selects another ancestor, the same deterministic selection proceeds
recursively. Scene-level composition occurs after each level's track
evaluation. During a crossfade, the prior and next recursively evaluated
compositions are flattened into ordered layers with weights multiplied using
`round_div`.

---

## 10. Activation and replay

### 10.1 Live activation

After a holo frame is fully verified and durably committed:

1. Compile the new state under its pinned renderer contract.
2. Acquire the player-local activation lock.
3. Confirm the player-active holo equals the new output's `base_holo_id`.
4. Freeze the prior player at an exact integer `departure_logical_ms`.
5. Evaluate the complete departure scene, including any active historical
   flipbook crossfade.
6. Append the activation record.
7. Set the new holo's `active_t` to zero at that same cutover.
8. Release the lock and evaluate its transition, then its sustain performance.
9. Continue until another accepted holo is activated.

Rendering is deterministic relative to logical time. It is not paced by render
frame count.

If the player's active holo does not equal the new base, the player processes
missing accepted holos in order. If it cannot do that, it remains on its prior
active holo and reports divergence from the authoritative head.

### 10.2 Activation records

Exact live-session replay requires a local activation log:

```json
{
  "schema": "rapp-holo-activation/1",
  "player_id": "local-player-id",
  "activation_order": 42,
  "previous_active_holo_id": "previous-holo-id-or-null",
  "departure_logical_ms": 7342,
  "departure_manifest_hash": "evaluated-departure-scene-hash",
  "new_holo_id": "verified-holo-frame-hash",
  "activated_utc": "2026-04-20T12:34:57.012Z"
}
```

Activation records do not change holo identity. They record when an immutable
holo became active on one player. `activated_utc` is audit metadata;
`departure_logical_ms` and activation order are the deterministic replay
inputs. `departure_manifest_hash` is
`H("rapp-holo/1:departure", canonical_evaluated_manifest)` and proves that
reconstruction reached the same frozen scene.

The exact record shape is
`holograms/protocol/rapp-holo-activation.schema.json`.

### 10.3 Replay modes

A conformant player supports:

- **Recorded timing:** use stored activation intervals.
- **Normalized timing:** play holo order with caller-selected spacing.
- **Scrub:** evaluate any accepted holo at a requested logical time.

Recorded scrub evaluates:

```text
evaluate(holo_id, activation_record, active_t)
```

Normalized scrub creates a synthetic context in which the declared base is
evaluated at logical time zero before the selected holo activates.

Player logical time pauses while the player process is stopped. A player
persists its active holo ID, activation order, and integer active elapsed time.
On restart it resumes that checkpoint. If the checkpoint is unavailable, it
starts a labeled normalized replay; it does not claim exact recorded timing.

The normative deterministic result is the compiled scene graph and evaluated
fixed-point properties. GPU pixels are nonnormative because hardware
rasterization may vary.

---

## 11. Commit and head advancement

Every producer of every event on one subject's body stream shares one
linearizable append authority. A file write followed by a separate head CAS is
not sufficient because two losing files would create an authoritative RAPP
fork.

Preflight may occur outside the append transaction:

1. Look up the exact already-verified source frame by
   `(stream_id, seq, frame_hash)` in its authoritative memory log.
2. Confirm the source belongs to the same subject RAPPID.
3. Confirm the source payload contains zero or one holo candidate.
4. Validate the candidate and compile its canonical scene manifest without
   modifying authored data.
5. Verify optional producer provenance when present.
6. Resolve and verify every referenced historical holo.

The authoritative commit then occurs inside one per-body-stream transaction:

1. Re-read the actual body head and authoritative holo head.
2. Confirm `base_holo_id` still equals the authoritative holo head.
3. Confirm this source frame has not already committed different holo data.
4. Assign the next outer body `seq` and `prev`.
5. Assign `holo_seq = previous holo_seq + 1`, or zero at holo genesis.
6. Set `visual_parent` to the current holo ID, or null at holo genesis.
7. Construct and verify the complete `body.hologram` frame.
8. Atomically publish the body-log entry and advance the body/holo head index.
9. Commit durable storage.

A losing or stale candidate may exist only in a staging area outside the
authoritative append log. It MUST NOT be published as a body successor before
winning the transaction.

The body log is authoritative. The combined body/holo head index is a
recoverable acceleration structure, but recovery MUST apply the same single
successor and fork-refusal rules; it cannot choose arbitrarily between two
persisted successors.

Player activation occurs after authoritative commit and is separate from head
advancement.

### 11.1 Refusals

The committer refuses:

- a stale `base_holo_id`;
- rollback or same-sequence conflict;
- a source-turn substitution;
- a different candidate for an already-used source frame;
- a missing or non-ancestor history reference;
- a body-chain fork;
- unsupported renderer or IR versions;
- invalid or over-budget scene data.

A commit refusal leaves the prior authoritative holo head unchanged. It never
creates a fallback.

---

## 12. Determinism and interpreter pinning

Each accepted output pins:

- `ir_version`;
- `renderer_contract`;
- fixed-point units;
- transition rules;
- timing model;
- supported material semantics.

An immutable holo must not change scene or performance semantics because a
later renderer silently reinterprets old fields. Exact GPU pixels are not the
protocol identity.

A player MUST either:

- retain a compatible interpreter for the pinned contract; or
- refuse to play that historical output and report an unsupported contract.

It MUST NOT reinterpret old data under new semantics.

Holo/1 has no runtime random operation. Random-looking output is authored as
explicit deterministic geometry or keyframes. The renderer never calls a
random source.

---

## 13. Safety and resource limits

Holo/1 is data-only, but data can still exhaust a renderer. Validation is
aggregate as well as per field.

Initial v1 ceilings:

| Resource | Maximum |
|---|---:|
| Canonical authored output | 256 KiB |
| Scene nodes | 128 |
| Parent depth | 8 |
| Lights | 8 |
| Materials | 128 |
| Mesh vertices, aggregate | 4,096 |
| Mesh triangles, aggregate | 8,192 |
| Compiled vertices, all geometry | 65,536 |
| Compiled triangles, all geometry | 131,072 |
| Polyline points, aggregate | 8,192 |
| Point nodes, aggregate points | 8,192 |
| Property tracks | 512 |
| Keyframes, aggregate | 4,096 |
| Historical flipbook references | 16 |
| Recursive history depth | 8 |
| Unique recursively resolved frames | 64 |
| Referenced historical state bytes | 4 MiB |
| Growl prefix steps | 16 |
| Growl completed steps | 64 |
| Transition duration | 10,000 ms |
| Sustain duration before repeat | 60,000 ms |
| Transparent draw calls | 128 |
| Total draw calls | 256 |

Additional rules:

- parent graphs MUST be acyclic;
- IDs MUST be unique bounded lowercase labels;
- indices MUST be in range;
- triangle topology MUST be valid;
- every track target and property MUST exist and type-check;
- keyframe times MUST be ordered and within the sustain duration;
- coordinates, camera planes, scale, opacity, widths, and material values MUST
  remain within fixed protocol bounds;
- unknown keys and enum values are refused;
- no network fetches are performed;
- no filesystem paths are accepted;
- no URLs, HTML, CSS, JavaScript, WebAssembly, shader code, templates, commands,
  or executable expressions are accepted.

Validators in every implementation language MUST share one fixture corpus and
produce the same accept/refuse result.

---

## 14. Accessibility and user control

The authored accessibility object contains:

```json
{
  "description": "AI-authored description of the visual output",
  "reduced_motion": "hold"
}
```

`reduced_motion` is one of:

```text
hold crossfade
```

The user may force reduced motion globally. In reduced-motion mode:

- `hold` displays the complete current state at logical time zero;
- `crossfade` permits only declared scene-level crossfades.

The renderer does not replace the AI-authored scene with a different visual.

---

## 15. Failure behavior

The prior authoritative holo head remains unchanged when:

- the AI emits no holo output;
- the candidate is malformed;
- the candidate exceeds a limit;
- the candidate names an unsupported contract;
- its base is stale;
- a referenced historical frame is absent or invalid;
- persistence fails;
- the linearizable body append transaction fails.

Once a valid holo is authoritatively committed, it remains the authoritative
head. A particular player may keep displaying its previous player-active holo
when:

- it lacks the pinned interpreter;
- canonical scene compilation fails on that player;
- it cannot catch up from its active base in verified holo order;
- its local activation transaction fails.

Failures are surfaced. They are not hidden behind a generic avatar, generic
particle cloud, generated humanoid, or success-shaped fallback.

The player reports both IDs whenever its active holo differs from the
authoritative head. It never rolls the authoritative head back. If no prior
player-active holo exists, the display remains empty and reports the refusal.

---

## 16. Stream sightedness heuristic

A RAPP frame can be cryptographically valid while its producer is effectively
flying blind. Frame verification proves shape, hashes, chain, stream binding,
and required signatures. It does not prove that a human or AI actually observed
the current conversational and holographic state before responding.

Holo/1 exposes a separate **sightedness heuristic** because each accepted output
must correctly bind and work with live state that changes every turn:

- the exact current source frame;
- the authoritative body head;
- the current `base_holo_id`;
- stable node identities from the base state;
- any explicitly selected historical holo IDs;
- the current IR and renderer contract;
- a valid transition and deterministic performance over that history.

A producer that does not possess that state will tend to reveal itself through
a stale base, impossible history reference, broken node continuity, invalid
transition topology, duplicate-source conflict, or replay inconsistency. Those
are strong signs that the participant is not actually seeing the verified
stream it claims to extend.

The UI and evidence model keep four judgments separate:

| Judgment | Meaning |
|---|---|
| **Frame integrity** | The RAPP frame is cryptographically and structurally verified. |
| **Producer provenance** | An optional trusted producer attests the source and authored digest. |
| **Stream sightedness** | The output correctly extends the current holo context and resolves every declared continuity/history dependency. |
| **Origin heuristic** | Timing and structural behavior are machine-likely or indeterminate. |

Suggested sightedness states are:

```text
sighted       exact current base and all declared continuity resolve
stale         valid data was authored against an older verified base
blind         claimed current/history state is impossible or inconsistent
unknown       required context evidence is unavailable
```

An observer may persist this derived, non-authoritative result as
`rapp-holo-sightedness/1`, defined by
`holograms/protocol/rapp-holo-sightedness.schema.json`. The record preserves the
separate integrity, provenance, sightedness, and origin judgments plus the
specific evidence used. It is telemetry about an observation, not a RAPP head,
identity credential, or authority grant.

Rolling in-the-wild classification is persisted separately as
`rapp-holo-presence/1`, defined by
`holograms/protocol/rapp-holo-presence.schema.json`.

`sighted` is objective protocol evidence that the producer possessed the
declared state. It is not proof that the producer is biologically human or an
AI. A human can use software, and an AI can be relayed through a human. Rich,
valid, source-specific performance produced at conversational latency can be a
useful **machine-likely** signal, but origin classification remains heuristic.

The heuristic MUST NOT:

- change a frame's RAPP verification result;
- grant authority or access;
- reject a simple or intentionally blank authentic holo;
- reward visual complexity as if complexity meant intelligence;
- label a person as deceptive solely because their output is simple;
- be represented as cryptographic proof of human-versus-AI identity.

The important operational distinction is:

```text
verified frame + sighted holo = verified transport and demonstrated continuity
verified frame + stale/blind holo = verified transport from a producer flying blind
```

This makes the hologram flipbook useful as continuity telemetry without
confusing a behavioral signal with RAPP verification.

---

## 17. What changes in RAPP Zoo

The current Zoo hologram architecture is a legacy demonstration, not this
protocol.

### 17.1 Remove from the AI-self path

- the second Copilot generation call;
- randomized generation from one frame;
- dimensional matching as visual authorship;
- `character` versus `data-projection` as the AI-self schema;
- the procedural humanoid renderer;
- semantic or hash-derived fallback morphology;
- generated species names;
- renderer-selected emotion, form, palette, pose, or symbols;
- mutable `postMessage` data that changes an accepted self-version.

### 17.2 Add

- an original-turn `emit_hologram` output channel;
- exact candidate capture inside the source turn;
- `body.hologram` kind registration;
- a neutral, bounded `rapp-holo-ir/1` validator;
- an append-only body-frame store;
- a derived per-subject holo head and contiguous `holo_seq`;
- deterministic transition, sustain, history, and replay evaluation;
- a history/flipbook UI;
- renderer-contract pinning;
- shared adversarial fixtures across Python, JavaScript, and Brainstem tooling.

### 17.3 Legacy bottles

Existing bottles may remain available in a clearly labeled legacy or projection
viewer. They do not represent the AI's current self, do not advance a holo head,
and do not enter Holo/1 history.

A legacy humanoid bottle is never upgraded into an AI self by changing its
renderer. The AI must emit a new Holo/1 output on a new turn.

---

## 18. Conformance invariants

An implementation is not Holo/1 conformant unless all of these are true:

1. The holo is authored during the original AI turn.
2. No second creative model call occurs.
3. The app and renderer never choose the visual form.
4. Zero or one holo candidate exists per source turn.
5. The exact authored object is committed in the source frame.
6. The source frame is retrievable and independently verifiable in its memory
   history.
7. The materialized copy is canonically identical.
8. Every holo is an immutable `body.hologram` RAPP frame.
9. The body frame extends the actual body head through one linearizable append
    authority.
10. The holo sequence and visual parent form a separate contiguous flipbook.
11. A stale base is refused, never reparented.
12. Each scene state is complete and independently renderable.
13. Transitions are authored; undeclared changes cut.
14. Historical playback uses only explicit verified ancestor references.
15. Performance is evaluated from logical time, not render frame count.
16. Old outputs retain their pinned interpreter semantics.
17. Authoritative and player-active heads are tracked separately.
18. Invalid output leaves the prior authoritative holo unchanged.
19. Missing output leaves the prior authoritative holo unchanged.
20. There is no humanoid, morphology, emotion, or semantic fallback.
21. Validators reject unknown or over-budget data without repair.
22. The player can replay and scrub the immutable flipbook.
23. Frame integrity, provenance, stream sightedness, and origin heuristic are
    reported as separate judgments.

---

## 19. Required proof

Before release, the implementation must prove:

- exact AI-authored candidate preservation;
- optional producer provenance is reported without controlling the Holo Wake
  classification;
- exact source-frame inclusion lookup after later memory turns exist;
- no second model generation call;
- same-source identical replay is idempotent;
- same-source different output is refused;
- concurrent source streams cannot overwrite a newer per-AI holo head;
- competing body writers cannot publish two successors to one body head;
- stale base output cannot be silently reparented;
- invalid output cannot trigger a fallback visual;
- a turn without holo leaves the prior performance active;
- complete history replay produces identical compiled scenes and evaluated
  transforms at selected logical times;
- activation replay reproduces the recorded departure holo and exact
  `departure_logical_ms`;
- a player can lag the authoritative head without rolling it back;
- a current holo can explicitly perform with at least two prior verified states;
- new and removed nodes obey only their authored transition modes;
- historical behavior survives a renderer upgrade through interpreter pinning;
- browser, Python, and Brainstem validators agree on every fixture;
- mutation tests make every conformance assertion fail when its invariant is
  broken;
- resource-limit fuzzing cannot exceed the declared CPU, GPU, memory, node,
  geometry, track, keyframe, or history budgets.
- a valid RAPP frame with a stale holo base remains frame-verified while its
  sightedness result is `stale`;
- impossible history references produce `blind` without changing frame
  integrity or inventing a fallback;
- a simple valid blank output can remain `sighted` and is never downgraded
  merely for lacking complexity.

---

## 20. The core sentence

**A RAPP hologram is the AI's latest immutable, data-only visual output. Its
verified outputs form a flipbook, and the current output may perform with its
own prior frames until the next AI turn emits a new one.**
