# RAPP Holo Renderer/1

## Normative interpreter contract for `rapp-holo-renderer/1`

This document pins how `rapp-holo-ir/1` data is compiled and evaluated. It is
part of RAPP Holo/1. Records contain no executable code.

## 1. Processing order

A conformant interpreter performs these phases in order:

1. Parse strict UTF-8 I-JSON with no duplicate object members.
2. Verify the RAPP frame and Holo/1 provenance.
3. Validate `rapp-holo-output.schema.json`.
4. Apply the semantic validation rules in `HOLOGRAM_PROTOCOL.md`.
5. Compile a canonical scene manifest.
6. Resolve the base and explicitly referenced ancestor holos.
7. Evaluate the player activation, transition, sustain clock, tracks, and
   flipbook.
8. Submit the evaluated manifest to the local rasterizer.

An error in phases 1 through 7 is a refusal. Implementations do not clamp,
repair, drop, reorder, or replace authored data.

## 2. Canonical compiled manifest

The compiler exposes this logical structure for conformance comparison:

```json
{
  "schema": "rapp-holo-compiled/1",
  "camera": {},
  "environment": {},
  "nodes": [],
  "draws": [],
  "lights": []
}
```

All values remain in their authored fixed-point integer representation.
Compilation may add only deterministic derived fields specified here.

- `nodes` preserve authored array order.
- `draws` preserve the order of renderable nodes in `nodes`.
- `lights` preserve the order of visible light nodes in `nodes`.
- A child always appears after its declared parent in the compiled traversal.
  A source array that requires any other order is rejected rather than sorted.
- Each compiled entry includes its `node_id`, `parent`, node type, authored
  local transform, and deterministic geometry/material descriptor.

Conformance compares canonical JSON manifests and evaluated integer property
values, not GPU pixels.

## 3. Transform semantics

Local transforms are evaluated in this order:

```text
local = translate * rotate-X * rotate-Y * rotate-Z * scale
world = parent-world * local
```

Rotations use right-handed axes. Positive rotation follows the right-hand rule.
The camera looks from `position` toward `target`. The authored `up` vector
establishes roll.

The exact unit conversions are defined in `HOLOGRAM_PROTOCOL.md` section 7.8.

Camera-up and light-direction vectors are normalized with signed arbitrary-
precision integer arithmetic:

```text
isqrt(n) = greatest integer r such that r*r <= n
length   = isqrt(x*x + y*y + z*z)
unit(c)  = round_div(c * 1000000, length)
```

A zero length is refused. The normalized fixed-point vector is recorded in the
canonical manifest.

## 4. Primitive compilation

Every primitive compiles to one logical draw. Tessellation is deterministic:

For interoperability, the reference topology and orientation are the
corresponding Three.js r128 geometry constructors with omitted constructor
arguments fixed to their r128 defaults. The table below overrides segment
counts and defines the one composite shape not supplied by r128.

| Shape | Compilation |
|---|---|
| `sphere` | radius `r`; longitude segments `8 * 2^detail`; latitude segments `4 * 2^detail` |
| `tetrahedron` | regular tetrahedron at radius `r`, recursively subdivided `detail` times |
| `octahedron` | regular octahedron at radius `r`, recursively subdivided `detail` times |
| `icosahedron` | regular icosahedron at radius `r`, recursively subdivided `detail` times |
| `box` | centered box with exact authored X/Y/Z extents; one segment per axis |
| `cylinder` | centered Y-axis cylinder with equal top/bottom radius, authored height, and `detail` radial segments |
| `cone` | centered Y-axis cone with authored base radius, authored height, and `detail` radial segments |
| `capsule` | centered Y-axis cylinder plus two hemispherical ends; `height` is total end-to-end height and MUST be at least `2 * radius`; radial segments are `detail`; hemisphere rings are `max(2, detail / 2)` using integer truncation |
| `torus` | centered in the XY plane; major and minor radii as authored; major segments `2 * detail`; minor segments `detail` |
| `ring` | centered in the XY plane; inner radius `major_radius - minor_radius`; outer radius `major_radius + minor_radius`; radial segments `2 * detail` |
| `plane` | centered XY rectangle with authored width and height; two triangles |

Angles begin on positive X and advance counter-clockwise when viewed from
positive Z. Triangle winding is counter-clockwise from the visible front.
Recursive polyhedron subdivision normalizes each new midpoint back to the
authored radius.

The canonical manifest records shape, authored parameters, and the derived
segment counts. A renderer may use equivalent native geometry only when those
values match.

## 5. Authored mesh compilation

- Vertices preserve authored order.
- Triangles preserve authored order.
- Triangle indices are zero-based.
- Front faces use counter-clockwise winding.
- Face cross-products and adjacent-face accumulators use signed arbitrary-
  precision integers.
- Vertex normals are the normalized sum of adjacent unnormalized face normals
  using the `isqrt` and `round_div` algorithm from section 3.
- A zero-area triangle is refused.
- A vertex with a zero summed normal receives `[0,0,1000000]` in fixed-point
  manifest form.
- Mesh topology is compatible for transition interpolation only when vertex
  counts and the complete ordered triangle-index arrays are identical.

Rasterizers may calculate floating-point normals after the canonical integer
manifest has been compared.

## 6. Polyline compilation

A polyline compiles as a world-space round tube:

- authored `width` is the tube diameter;
- each point becomes a joint center;
- each nonzero-length segment becomes a Y-axis cylinder rotated onto the
  segment vector;
- radial segments are fixed at eight;
- each interior joint becomes an eight-segment sphere of radius `width / 2`;
- a closed polyline adds the final segment from last point to first;
- adjacent duplicate points are refused.

All pieces remain one logical node and one instanced logical draw in the
compiled manifest. Polyline topology is compatible only when point counts and
the `closed` flag match.

## 7. Point compilation

Each authored point compiles to a camera-facing square billboard:

- center is the authored position;
- width and height are the authored `size`;
- orientation faces the active camera without changing the point's authored
  local transform;
- points preserve authored array order;
- all points in one node share its material;
- a points node is one instanced logical draw.

Point topology is compatible only when point counts match.

## 8. Light compilation

Light values use the exact authored color and integer intensity.

| Kind | Semantics |
|---|---|
| `ambient` | directionless scene contribution |
| `directional` | parallel rays traveling opposite the authored direction |
| `point` | isotropic light at node world position, linearly attenuated to zero at range |
| `spot` | point light limited to the authored full cone angle around the authored direction, linearly attenuated to zero at range |

There is no hidden default light. A scene with no light can still show
emissive, wire, line, or point material output exactly as authored.

## 9. Material compilation

Node type constrains `presentation`:

| Node type | Allowed presentation |
|---|---|
| `primitive`, `mesh` | `solid`, `wire` |
| `polyline` | `line` |
| `points` | `points` |

For `wire`, `line`, and `points`, `metallic` MUST be zero and `roughness` MUST
be 1000. Other combinations are refused because those fields would otherwise
have undefined effect.

`solid` uses Three.js r128 `MeshStandardMaterial` with:

- authored base sRGB color;
- authored emissive sRGB color multiplied by `emissive_strength / 10000`;
- metallic and roughness divided by 1000;
- effective opacity from `HOLOGRAM_PROTOCOL.md` section 7.8.

`wire`, `line`, and `points` are unlit except for authored emissive output. Base
color and emissive output are added channel-wise and saturated at 255.

Blend modes are:

- `normal`: source-over alpha composition;
- `additive`: source RGB multiplied by source alpha and added to destination;
- `multiply`: linear interpolation from destination RGB to
  `destination * source / 255` by source alpha.

All channel multiplication and interpolation uses `round_div`.

The reference rasterizer settings are:

```text
Three.js revision       128
output encoding         sRGBEncoding
tone mapping            NoToneMapping
physically correct light false
shadows                 disabled
depth test              enabled
depth write             enabled for normal blend
premultiplied alpha     false
```

Fog uses Three.js r128 linear `Fog`. Geometry, material, light, blending, fog,
depth, and color interpretation are therefore pinned to this renderer contract.
GPU pixels remain nonnormative because hardware rasterization can vary; the
canonical manifest and evaluated fixed-point properties are normative.

## 10. Transition evaluation

The new holo owns the transition from its declared base.

At activation, the player freezes the complete evaluated departure composition.
That composition may contain:

- the base holo's evaluated `self` layer;
- one or two historical flipbook layers;
- property-track modifications;
- current layer weights.

Departure layers are identified by `(holo_id, node_id)`. The node transition
table addresses the base holo's `self` node IDs. Historical layers are never
mistaken for the base `self` layer merely because they reuse the same node ID.

For transition progress `e`:

```text
p = S                                      when duration_ms is zero
p = round_div(transition_t * S, duration_ms) otherwise
e = transition.easing(p)
```

- `cut`: old contribution is zero and new contribution is full at `e = 0`;
- `fade-in`: new node opacity is multiplied by `e`;
- `fade-out`: old node opacity is multiplied by `S - e`;
- `crossfade`: old opacity is multiplied by `S - e`; new opacity by `e`;
- `interpolate`: compatible old/new numeric properties use `lerp`; visibility
  remains old until `e = S`, then becomes new.

For a compatible geometry interpolation:

- primitive numeric parameters interpolate by key;
- mesh vertex coordinates interpolate by ordered vertex index;
- polyline point coordinates and width interpolate by ordered point index;
- point positions and sizes interpolate by ordered point index;
- light color, intensity, range, angle, and direction interpolate where both
  sides carry that value;
- group nodes interpolate transform and visibility only.

Any base departure layer not consumed by an explicit node rule follows the
transition `default`. Any new node not consumed by a rule also follows the
default. `cut` removes or introduces it at transition time zero. `crossfade`
fades the departure contribution out and the new contribution in.

After `transition.duration_ms`, only the new holo's sustain composition remains.

## 11. Sustain-track evaluation

The logical clock, repeat mapping, easing equations, `round_div`, and property
allowlist are normative in `HOLOGRAM_PROTOCOL.md` section 9.

- Each track begins at `at_ms: 0`.
- The value at an exact keyframe time is that keyframe's value.
- Between keyframes, the left track's declared interpolation applies.
- `step` holds the left value until the right keyframe time.
- Multiple tracks for one `(node_id, property)` are refused.
- Tracks apply only to the current holo's `self` snapshot.

## 12. Historical flipbook evaluation

When no flipbook entries exist, the sustain composition is the evaluated
`self` snapshot at weight `S`.

When entries exist:

- the first entry is at zero;
- each entry selects `self` or one verified ancestor base snapshot;
- historical snapshots never execute their own tracks or flipbooks;
- a `cut` changes selection at the entry time;
- a `crossfade` into an entry occupies the interval
  `[entry.at_ms - entry.blend_ms, entry.at_ms]`;
- if `blend_ms` is zero, `crossfade` is equivalent to `cut`;
- overlapping blend intervals are refused;
- for `loop`, the first entry is treated again at `duration_ms`, so its
  `blend_ms` controls the last-to-first boundary;
- for `once`, the final selected entry holds;
- for `ping-pong`, the fully evaluated timeline is traversed backward.

The current `self` layer is evaluated with its property tracks before its
flipbook weight is applied. Ancestor layers use immutable base state. Layer
order is prior snapshot first, next snapshot second.

## 13. Reduced motion

- `hold` compiles only the current complete base state at logical time zero.
- `crossfade` disables node interpolation and sustain tracks, but permits
  authored scene-level crossfades.

Reduced motion changes timing behavior, not authored geometry, camera, color,
or composition.

## 14. Version retention

A player claiming support for `rapp-holo-renderer/1` implements this contract
without reinterpretation. A later incompatible mapping uses a new
`renderer_contract` token. Historical players retain or bundle the old
interpreter; they never run an old record under a new contract.
