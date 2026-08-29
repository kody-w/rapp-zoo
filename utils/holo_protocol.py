"""Dependency-free validation and deterministic helpers for RAPP Holo/1."""

from __future__ import annotations

import copy
import math
import re
from typing import Callable, Mapping, Optional

try:
    from .rapp_protocol import (
        H,
        ProtocolError,
        canonical,
        parse_detached_jws,
        rappid_valid,
        strict_json_loads,
        utc_valid,
    )
except ImportError:
    from rapp_protocol import (  # type: ignore
        H,
        ProtocolError,
        canonical,
        parse_detached_jws,
        rappid_valid,
        strict_json_loads,
        utc_valid,
    )


S = 1_000_000
MAX_SAFE_INTEGER = 9_007_199_254_740_991
MAX_AUTHORED_BYTES = 256 * 1024
MAX_REFERENCED_STATE_BYTES = 4 * 1024 * 1024

OUTPUT_KEYS = {
    "schema",
    "base_holo_id",
    "ir_version",
    "renderer_contract",
    "state",
    "transition",
    "performance",
    "accessibility",
}
RECORD_KEYS = {
    "schema",
    "holo_seq",
    "visual_parent",
    "source",
    "authored_hash",
    "producer_provenance",
    "authored",
}
NODE_KEYS = {
    "id",
    "parent",
    "type",
    "visible",
    "transform",
    "geometry",
    "material",
}
TRACK_PROPERTIES = {
    "transform.position",
    "transform.rotation",
    "transform.scale",
    "material.color",
    "material.emissive",
    "material.opacity",
    "visible",
}
EASINGS = {"linear", "ease-in", "ease-out", "ease-in-out"}
TRACK_EASINGS = {"step", *EASINGS}
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
NODE_ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$")
MEMORY_STREAM_RE = re.compile(
    r"^(rappid:@[a-z0-9]+(?:-[a-z0-9]+)*/"
    r"[a-z0-9]+(?:-[a-z0-9]+)*:[0-9a-f]{64}):"
    r"([a-z0-9]+(?:-[a-z0-9]+)*)$"
)


class HoloProtocolError(ProtocolError):
    """A Holo/1 value must be refused without alteration."""


def _fail(path: str, reason: str):
    raise HoloProtocolError(f"{path}: {reason}")


def _object(value, keys: set[str], path: str) -> dict:
    if type(value) is not dict:
        _fail(path, "must be an object")
    if set(value) != keys:
        missing = sorted(keys - set(value), key=str)
        extra = sorted(set(value) - keys, key=str)
        _fail(path, f"must contain exactly {sorted(keys)}; missing={missing}, extra={extra}")
    return value


def _array(value, path: str, minimum: int = 0, maximum: Optional[int] = None) -> list:
    if type(value) is not list:
        _fail(path, "must be an array")
    if len(value) < minimum or (maximum is not None and len(value) > maximum):
        _fail(path, f"length must be between {minimum} and {maximum}")
    return value


def _integer(value, path: str, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        _fail(path, f"must be an integer between {minimum} and {maximum}")
    return value


def _string(value, path: str, minimum: int = 0, maximum: Optional[int] = None) -> str:
    if type(value) is not str:
        _fail(path, "must be a string")
    if len(value) < minimum or (maximum is not None and len(value) > maximum):
        _fail(path, f"length must be between {minimum} and {maximum}")
    return value


def _enum(value, choices: set[str], path: str) -> str:
    if type(value) is not str or value not in choices:
        _fail(path, f"must be one of {sorted(choices)}")
    return value


def _boolean(value, path: str) -> bool:
    if type(value) is not bool:
        _fail(path, "must be a boolean")
    return value


def _hex64(value, path: str) -> str:
    if type(value) is not str or not HEX64_RE.fullmatch(value):
        _fail(path, "must be 64 lowercase hexadecimal characters")
    return value


def _node_id(value, path: str) -> str:
    if (
        type(value) is not str
        or not 1 <= len(value) <= 64
        or not NODE_ID_RE.fullmatch(value)
    ):
        _fail(path, "must be a bounded lowercase label")
    return value


def _color(value, path: str) -> str:
    if type(value) is not str or not COLOR_RE.fullmatch(value):
        _fail(path, "must be #RRGGBB or #RRGGBBAA")
    return value


def _vec(value, path: str, minimum: int, maximum: int) -> list[int]:
    items = _array(value, path, 3, 3)
    return [
        _integer(item, f"{path}[{index}]", minimum, maximum)
        for index, item in enumerate(items)
    ]


def _nonzero(value: list[int]) -> bool:
    return any(component != 0 for component in value)


def _color_channels(value: str) -> list[int]:
    raw = value[1:]
    if len(raw) == 6:
        raw += "FF"
    return [int(raw[index : index + 2], 16) for index in range(0, 8, 2)]


def round_div(numerator: int, denominator: int) -> int:
    """Round an integer ratio half away from zero."""
    if type(numerator) is not int or type(denominator) is not int:
        raise HoloProtocolError("round_div requires integers")
    if denominator <= 0:
        raise HoloProtocolError("round_div denominator must be positive")
    quotient, remainder = divmod(abs(numerator), denominator)
    if 2 * remainder >= denominator:
        quotient += 1
    return -quotient if numerator < 0 else quotient


def easing(name: str, progress: int) -> int:
    """Evaluate one pinned Holo/1 easing at fixed-point progress."""
    _enum(name, EASINGS, "easing")
    _integer(progress, "progress", 0, S)
    if name == "linear":
        return progress
    if name == "ease-in":
        return round_div(progress * progress, S)
    if name == "ease-out":
        remainder = S - progress
        return S - round_div(remainder * remainder, S)
    if progress <= S // 2:
        return round_div(2 * progress * progress, S)
    remainder = S - progress
    return S - round_div(2 * remainder * remainder, S)


def local_sustain_time(
    active_t: int,
    transition_duration_ms: int,
    duration_ms: int,
    repeat: str,
) -> int:
    """Map active logical time to the authored sustain timeline."""
    _integer(active_t, "active_t", 0, MAX_SAFE_INTEGER)
    _integer(transition_duration_ms, "transition_duration_ms", 0, 10_000)
    _integer(duration_ms, "duration_ms", 0, 60_000)
    _enum(repeat, {"hold", "once", "loop", "ping-pong"}, "repeat")
    sustain_t = max(0, active_t - transition_duration_ms)
    if repeat == "hold":
        if duration_ms != 0:
            raise HoloProtocolError("hold sustain duration must be zero")
        return 0
    if duration_ms <= 0:
        raise HoloProtocolError("non-hold sustain duration must be positive")
    if repeat == "once":
        return min(sustain_t, duration_ms)
    if repeat == "loop":
        return sustain_t % duration_ms
    phase = sustain_t % (2 * duration_ms)
    return phase if phase <= duration_ms else 2 * duration_ms - phase


def _lerp(left: int, right: int, progress: int) -> int:
    return left + round_div((right - left) * progress, S)


def evaluate_property_track(track: dict, local_t: int):
    """Evaluate one already-valid property track without mutating it."""
    _integer(local_t, "local_t", 0, MAX_SAFE_INTEGER)
    _validate_track_shape(track, None, 60_000, "track")
    keyframes = track["keyframes"]
    if local_t >= keyframes[-1]["at_ms"]:
        value = keyframes[-1]["value"]
        return _evaluated_value(track["property"], value)
    right_index = next(
        index
        for index, keyframe in enumerate(keyframes)
        if keyframe["at_ms"] > local_t
    )
    left = keyframes[right_index - 1]
    right = keyframes[right_index]
    if track["interpolation"] == "step":
        return _evaluated_value(track["property"], left["value"])
    progress = round_div(
        (local_t - left["at_ms"]) * S,
        right["at_ms"] - left["at_ms"],
    )
    eased = easing(track["interpolation"], progress)
    if track["property"].startswith("material.") and track["property"] != "material.opacity":
        left_value = _color_channels(left["value"])
        right_value = _color_channels(right["value"])
    else:
        left_value = left["value"]
        right_value = right["value"]
    if type(left_value) is list:
        return [
            _lerp(a, b, eased)
            for a, b in zip(left_value, right_value)
        ]
    return _lerp(left_value, right_value, eased)


def _evaluated_value(prop: str, value):
    if prop in {"material.color", "material.emissive"}:
        return _color_channels(value)
    return copy.deepcopy(value)


def select_flipbook(
    flipbook: list[dict],
    local_t: int,
    duration_ms: int,
    repeat: str,
) -> list[dict]:
    """Return selected snapshot layers and fixed-point weights."""
    _integer(local_t, "local_t", 0, MAX_SAFE_INTEGER)
    _integer(duration_ms, "duration_ms", 0, 60_000)
    _enum(repeat, {"hold", "once", "loop", "ping-pong"}, "repeat")
    entries = _array(flipbook, "flipbook", 0, 16)
    if not entries:
        return [{"holo_id": "self", "weight": S}]
    _validate_flipbook(entries, duration_ms, repeat, None, require_resolver=False)
    timeline_t = min(local_t, duration_ms)
    first = entries[0]
    if (
        repeat == "loop"
        and first["blend"] == "crossfade"
        and first["blend_ms"] > 0
        and timeline_t >= duration_ms - first["blend_ms"]
    ):
        progress = round_div(
            (timeline_t - (duration_ms - first["blend_ms"])) * S,
            first["blend_ms"],
        )
        return _weighted_layers(entries[-1]["holo_id"], first["holo_id"], progress)
    current_index = max(
        index for index, entry in enumerate(entries) if entry["at_ms"] <= timeline_t
    )
    if current_index + 1 < len(entries):
        following = entries[current_index + 1]
        if (
            following["blend"] == "crossfade"
            and following["blend_ms"] > 0
            and timeline_t >= following["at_ms"] - following["blend_ms"]
        ):
            progress = round_div(
                (timeline_t - (following["at_ms"] - following["blend_ms"])) * S,
                following["blend_ms"],
            )
            return _weighted_layers(
                entries[current_index]["holo_id"],
                following["holo_id"],
                progress,
            )
    return [{"holo_id": entries[current_index]["holo_id"], "weight": S}]


def _weighted_layers(previous: str, following: str, progress: int) -> list[dict]:
    if progress <= 0:
        return [{"holo_id": previous, "weight": S}]
    if progress >= S:
        return [{"holo_id": following, "weight": S}]
    return [
        {"holo_id": previous, "weight": S - progress},
        {"holo_id": following, "weight": progress},
    ]


def parse_json(raw: bytes | str):
    """Parse the strict integer-only I-JSON profile shared with RAPP/1."""
    return strict_json_loads(raw)


def canonical_authored_bytes(authored: dict) -> bytes:
    try:
        encoded = canonical(authored).encode("utf-8")
    except ProtocolError as exc:
        raise HoloProtocolError(str(exc)) from exc
    if len(encoded) > MAX_AUTHORED_BYTES:
        raise HoloProtocolError("authored output exceeds 256 KiB")
    return encoded


def authored_hash(value: dict) -> str:
    canonical_authored_bytes(value)
    return H("rapp-holo/1:authored", value)


def domain_hash(space: str, value) -> str:
    """Return a RAPP canonical domain-separated SHA-256 hash."""
    if type(space) is not str or not space.isascii():
        raise HoloProtocolError("hash domain must be an ASCII string")
    try:
        return H(space, value)
    except ProtocolError as exc:
        raise HoloProtocolError(str(exc)) from exc


def _validate_transform(value, path: str) -> None:
    obj = _object(value, {"position", "rotation", "scale"}, path)
    _vec(obj["position"], f"{path}.position", -1_000_000, 1_000_000)
    _vec(obj["rotation"], f"{path}.rotation", -360_000, 360_000)
    _vec(obj["scale"], f"{path}.scale", 1, 100_000)


def _validate_camera(value, path: str) -> None:
    keys = {
        "projection",
        "position",
        "target",
        "up",
        "near",
        "far",
        "fov_mdeg",
        "ortho_height",
    }
    obj = _object(value, keys, path)
    projection = _enum(obj["projection"], {"perspective", "orthographic"}, f"{path}.projection")
    position = _vec(obj["position"], f"{path}.position", -1_000_000, 1_000_000)
    target = _vec(obj["target"], f"{path}.target", -1_000_000, 1_000_000)
    up = _vec(obj["up"], f"{path}.up", -1000, 1000)
    near = _integer(obj["near"], f"{path}.near", 1, 1_000_000)
    far = _integer(obj["far"], f"{path}.far", 2, 10_000_000)
    if position == target:
        _fail(path, "camera position must differ from target")
    if not _nonzero(up):
        _fail(path, "camera up vector must be nonzero")
    if far <= near:
        _fail(path, "camera far must be greater than near")
    if projection == "perspective":
        _integer(obj["fov_mdeg"], f"{path}.fov_mdeg", 1000, 179_000)
        if obj["ortho_height"] is not None:
            _fail(f"{path}.ortho_height", "must be null for perspective")
    else:
        if obj["fov_mdeg"] is not None:
            _fail(f"{path}.fov_mdeg", "must be null for orthographic")
        _integer(obj["ortho_height"], f"{path}.ortho_height", 1, 2_000_000)


def _validate_environment(value, path: str) -> None:
    obj = _object(value, {"clear_color", "fog"}, path)
    _color(obj["clear_color"], f"{path}.clear_color")
    if obj["fog"] is None:
        return
    fog = _object(obj["fog"], {"color", "near", "far"}, f"{path}.fog")
    _color(fog["color"], f"{path}.fog.color")
    near = _integer(fog["near"], f"{path}.fog.near", 1, 10_000_000)
    far = _integer(fog["far"], f"{path}.fog.far", 2, 10_000_000)
    if far <= near:
        _fail(f"{path}.fog", "fog far must be greater than near")


def _validate_material(value, node_type: str, path: str) -> None:
    keys = {
        "color",
        "emissive",
        "emissive_strength",
        "opacity",
        "presentation",
        "blend",
        "side",
        "metallic",
        "roughness",
    }
    obj = _object(value, keys, path)
    _color(obj["color"], f"{path}.color")
    _color(obj["emissive"], f"{path}.emissive")
    _integer(obj["emissive_strength"], f"{path}.emissive_strength", 0, 10_000)
    _integer(obj["opacity"], f"{path}.opacity", 0, 1000)
    presentation = _enum(
        obj["presentation"],
        {"solid", "wire", "points", "line"},
        f"{path}.presentation",
    )
    _enum(obj["blend"], {"normal", "additive", "multiply"}, f"{path}.blend")
    _enum(obj["side"], {"front", "double"}, f"{path}.side")
    metallic = _integer(obj["metallic"], f"{path}.metallic", 0, 1000)
    roughness = _integer(obj["roughness"], f"{path}.roughness", 0, 1000)
    allowed = {
        "primitive": {"solid", "wire"},
        "mesh": {"solid", "wire"},
        "polyline": {"line"},
        "points": {"points"},
    }[node_type]
    if presentation not in allowed:
        _fail(path, f"{presentation} presentation is incompatible with {node_type}")
    if presentation != "solid" and (metallic != 0 or roughness != 1000):
        _fail(path, "non-solid material requires metallic 0 and roughness 1000")


def _validate_primitive(value, path: str) -> None:
    if type(value) is not dict or type(value.get("shape")) is not str:
        _fail(path, "primitive geometry must declare a shape")
    shape = value["shape"]
    if shape in {"sphere", "tetrahedron", "octahedron", "icosahedron"}:
        obj = _object(value, {"shape", "radius", "detail"}, path)
        _integer(obj["radius"], f"{path}.radius", 1, 1_000_000)
        _integer(obj["detail"], f"{path}.detail", 0, 5)
    elif shape == "box":
        obj = _object(value, {"shape", "size"}, path)
        _vec(obj["size"], f"{path}.size", 1, 2_000_000)
    elif shape in {"capsule", "cylinder", "cone"}:
        obj = _object(value, {"shape", "radius", "height", "detail"}, path)
        radius = _integer(obj["radius"], f"{path}.radius", 1, 1_000_000)
        height = _integer(obj["height"], f"{path}.height", 1, 2_000_000)
        _integer(obj["detail"], f"{path}.detail", 3, 128)
        if shape == "capsule" and height < 2 * radius:
            _fail(path, "capsule height must be at least twice its radius")
    elif shape in {"torus", "ring"}:
        obj = _object(value, {"shape", "major_radius", "minor_radius", "detail"}, path)
        major = _integer(obj["major_radius"], f"{path}.major_radius", 2, 1_000_000)
        minor = _integer(obj["minor_radius"], f"{path}.minor_radius", 1, 999_999)
        _integer(obj["detail"], f"{path}.detail", 3, 128)
        if minor >= major:
            _fail(path, "minor_radius must be less than major_radius")
    elif shape == "plane":
        obj = _object(value, {"shape", "width", "height"}, path)
        _integer(obj["width"], f"{path}.width", 1, 2_000_000)
        _integer(obj["height"], f"{path}.height", 1, 2_000_000)
    else:
        _fail(f"{path}.shape", "unsupported primitive shape")


def _validate_mesh(value, path: str) -> None:
    obj = _object(value, {"vertices", "triangles"}, path)
    vertices = _array(obj["vertices"], f"{path}.vertices", 3, 4096)
    for index, vertex in enumerate(vertices):
        _vec(vertex, f"{path}.vertices[{index}]", -1_000_000, 1_000_000)
    triangles = _array(obj["triangles"], f"{path}.triangles", 1, 8192)
    for index, triangle in enumerate(triangles):
        tri = _array(triangle, f"{path}.triangles[{index}]", 3, 3)
        indices = [
            _integer(item, f"{path}.triangles[{index}][{offset}]", 0, 4095)
            for offset, item in enumerate(tri)
        ]
        if len(set(indices)) != 3:
            _fail(f"{path}.triangles[{index}]", "triangle indices must be distinct")
        if any(item >= len(vertices) for item in indices):
            _fail(f"{path}.triangles[{index}]", "triangle index exceeds vertex count")
        a, b, c = (vertices[item] for item in indices)
        ab = [b[axis] - a[axis] for axis in range(3)]
        ac = [c[axis] - a[axis] for axis in range(3)]
        cross = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        ]
        if not _nonzero(cross):
            _fail(f"{path}.triangles[{index}]", "zero-area triangle")


def _validate_polyline(value, path: str) -> None:
    obj = _object(value, {"points", "closed", "width"}, path)
    points = _array(obj["points"], f"{path}.points", 2, 8192)
    for index, point in enumerate(points):
        _vec(point, f"{path}.points[{index}]", -1_000_000, 1_000_000)
        if index and point == points[index - 1]:
            _fail(f"{path}.points[{index}]", "adjacent points must differ")
    closed = _boolean(obj["closed"], f"{path}.closed")
    if closed and points[0] == points[-1]:
        _fail(path, "closed polyline final segment must be nonzero")
    _integer(obj["width"], f"{path}.width", 1, 100_000)


def _validate_points(value, path: str) -> None:
    obj = _object(value, {"points"}, path)
    points = _array(obj["points"], f"{path}.points", 1, 8192)
    for index, point in enumerate(points):
        item = _object(point, {"position", "size"}, f"{path}.points[{index}]")
        _vec(item["position"], f"{path}.points[{index}].position", -1_000_000, 1_000_000)
        _integer(item["size"], f"{path}.points[{index}].size", 1, 100_000)


def _validate_light(value, path: str) -> None:
    keys = {"kind", "color", "intensity", "range", "angle_mdeg", "direction"}
    obj = _object(value, keys, path)
    kind = _enum(obj["kind"], {"ambient", "directional", "point", "spot"}, f"{path}.kind")
    _color(obj["color"], f"{path}.color")
    _integer(obj["intensity"], f"{path}.intensity", 0, 10_000)
    if kind in {"point", "spot"}:
        _integer(obj["range"], f"{path}.range", 1, 10_000_000)
    elif obj["range"] is not None:
        _fail(f"{path}.range", f"must be null for {kind}")
    if kind == "spot":
        _integer(obj["angle_mdeg"], f"{path}.angle_mdeg", 1, 179_000)
    elif obj["angle_mdeg"] is not None:
        _fail(f"{path}.angle_mdeg", f"must be null for {kind}")
    if kind in {"directional", "spot"}:
        direction = _vec(obj["direction"], f"{path}.direction", -1000, 1000)
        if not _nonzero(direction):
            _fail(f"{path}.direction", "must be nonzero")
    elif obj["direction"] is not None:
        _fail(f"{path}.direction", f"must be null for {kind}")


def _primitive_counts(geometry: dict) -> tuple[int, int, dict]:
    shape = geometry["shape"]
    derived: dict[str, int] = {}
    if shape == "sphere":
        longitude = 8 * (2 ** geometry["detail"])
        latitude = 4 * (2 ** geometry["detail"])
        derived = {"longitude_segments": longitude, "latitude_segments": latitude}
        return (longitude + 1) * (latitude + 1), 2 * longitude * (latitude - 1), derived
    if shape in {"tetrahedron", "octahedron", "icosahedron"}:
        faces = {"tetrahedron": 4, "octahedron": 8, "icosahedron": 20}[shape]
        triangles = faces * (4 ** geometry["detail"])
        return 3 * triangles, triangles, {"subdivision_detail": geometry["detail"]}
    if shape == "box":
        return 24, 12, {"segments_x": 1, "segments_y": 1, "segments_z": 1}
    if shape == "cylinder":
        detail = geometry["detail"]
        return 6 * detail + 4, 4 * detail, {"radial_segments": detail}
    if shape == "cone":
        detail = geometry["detail"]
        return 4 * detail + 3, 2 * detail, {"radial_segments": detail}
    if shape == "capsule":
        detail = geometry["detail"]
        rings = max(2, detail // 2)
        vertices = 2 * (detail + 1) + 2 * (rings + 1) * (detail + 1)
        triangles = 2 * detail + 2 * detail * (2 * rings - 1)
        return vertices, triangles, {
            "radial_segments": detail,
            "hemisphere_rings": rings,
        }
    if shape == "torus":
        minor = geometry["detail"]
        major = 2 * minor
        return (minor + 1) * (major + 1), 2 * minor * major, {
            "major_segments": major,
            "minor_segments": minor,
        }
    if shape == "ring":
        radial = 2 * geometry["detail"]
        return 2 * (radial + 1), 2 * radial, {"radial_segments": radial}
    return 4, 2, {"segments_x": 1, "segments_y": 1}


def _geometry_counts(node: dict) -> tuple[int, int]:
    geometry = node["geometry"]
    if node["type"] == "primitive":
        vertices, triangles, _ = _primitive_counts(geometry)
        return vertices, triangles
    if node["type"] == "mesh":
        return len(geometry["vertices"]), len(geometry["triangles"])
    if node["type"] == "polyline":
        count = len(geometry["points"])
        segments = count if geometry["closed"] else count - 1
        joints = count if geometry["closed"] else max(0, count - 2)
        return segments * 52 + joints * 45, segments * 32 + joints * 48
    if node["type"] == "points":
        count = len(geometry["points"])
        return 4 * count, 2 * count
    return 0, 0


def _validate_state(value, path: str = "state") -> dict:
    obj = _object(value, {"camera", "environment", "nodes"}, path)
    _validate_camera(obj["camera"], f"{path}.camera")
    _validate_environment(obj["environment"], f"{path}.environment")
    nodes = _array(obj["nodes"], f"{path}.nodes", 0, 128)
    seen: dict[str, dict] = {}
    depths: dict[str, int] = {}
    totals = {
        "lights": 0,
        "materials": 0,
        "mesh_vertices": 0,
        "mesh_triangles": 0,
        "compiled_vertices": 0,
        "compiled_triangles": 0,
        "polyline_points": 0,
        "point_points": 0,
        "draws": 0,
        "transparent_draws": 0,
    }
    for index, node in enumerate(nodes):
        node_path = f"{path}.nodes[{index}]"
        item = _object(node, NODE_KEYS, node_path)
        node_id = _node_id(item["id"], f"{node_path}.id")
        if node_id in seen:
            _fail(f"{node_path}.id", "node IDs must be unique")
        parent = item["parent"]
        if parent is not None:
            _node_id(parent, f"{node_path}.parent")
            if parent not in seen:
                _fail(f"{node_path}.parent", "parent must exist earlier in authored order")
            depth = depths[parent] + 1
        else:
            depth = 0
        if depth > 8:
            _fail(node_path, "parent depth exceeds eight")
        node_type = _enum(
            item["type"],
            {"group", "primitive", "mesh", "polyline", "points", "light"},
            f"{node_path}.type",
        )
        _boolean(item["visible"], f"{node_path}.visible")
        _validate_transform(item["transform"], f"{node_path}.transform")
        if node_type == "group":
            if item["geometry"] is not None or item["material"] is not None:
                _fail(node_path, "group geometry and material must be null")
        elif node_type == "light":
            _validate_light(item["geometry"], f"{node_path}.geometry")
            if item["material"] is not None:
                _fail(f"{node_path}.material", "light material must be null")
            totals["lights"] += 1
        else:
            if node_type == "primitive":
                _validate_primitive(item["geometry"], f"{node_path}.geometry")
            elif node_type == "mesh":
                _validate_mesh(item["geometry"], f"{node_path}.geometry")
                totals["mesh_vertices"] += len(item["geometry"]["vertices"])
                totals["mesh_triangles"] += len(item["geometry"]["triangles"])
            elif node_type == "polyline":
                _validate_polyline(item["geometry"], f"{node_path}.geometry")
                totals["polyline_points"] += len(item["geometry"]["points"])
            else:
                _validate_points(item["geometry"], f"{node_path}.geometry")
                totals["point_points"] += len(item["geometry"]["points"])
            _validate_material(item["material"], node_type, f"{node_path}.material")
            totals["materials"] += 1
            totals["draws"] += 1
            alpha = _color_channels(item["material"]["color"])[3]
            effective = round_div(item["material"]["opacity"] * alpha, 255)
            if effective < 1000 or item["material"]["blend"] != "normal":
                totals["transparent_draws"] += 1
            vertices, triangles = _geometry_counts(item)
            totals["compiled_vertices"] += vertices
            totals["compiled_triangles"] += triangles
        seen[node_id] = item
        depths[node_id] = depth
    ceilings = {
        "lights": 8,
        "materials": 128,
        "mesh_vertices": 4096,
        "mesh_triangles": 8192,
        "compiled_vertices": 65_536,
        "compiled_triangles": 131_072,
        "polyline_points": 8192,
        "point_points": 8192,
        "draws": 256,
        "transparent_draws": 128,
    }
    for name, ceiling in ceilings.items():
        if totals[name] > ceiling:
            _fail(path, f"aggregate {name} budget exceeds {ceiling}")
    return {"nodes": seen, "depths": depths, "totals": totals}


def _compatible_topology(old: dict, new: dict) -> bool:
    if old["type"] != new["type"]:
        return False
    kind = old["type"]
    if kind == "group":
        return old["id"] == new["id"]
    if kind == "primitive":
        return (
            old["geometry"]["shape"] == new["geometry"]["shape"]
            and set(old["geometry"]) == set(new["geometry"])
        )
    if kind == "mesh":
        return (
            len(old["geometry"]["vertices"]) == len(new["geometry"]["vertices"])
            and old["geometry"]["triangles"] == new["geometry"]["triangles"]
        )
    if kind == "polyline":
        return (
            len(old["geometry"]["points"]) == len(new["geometry"]["points"])
            and old["geometry"]["closed"] == new["geometry"]["closed"]
        )
    if kind == "points":
        return len(old["geometry"]["points"]) == len(new["geometry"]["points"])
    return old["geometry"]["kind"] == new["geometry"]["kind"]


def _validate_transition(
    value,
    new_nodes: Mapping[str, dict],
    base_nodes: Optional[Mapping[str, dict]],
    base_is_genesis: bool,
    path: str,
) -> None:
    obj = _object(value, {"duration_ms", "easing", "default", "nodes"}, path)
    _integer(obj["duration_ms"], f"{path}.duration_ms", 0, 10_000)
    _enum(obj["easing"], EASINGS, f"{path}.easing")
    _enum(obj["default"], {"cut", "crossfade"}, f"{path}.default")
    nodes = _array(obj["nodes"], f"{path}.nodes", 0, 128)
    seen = set()
    base_known = base_is_genesis or base_nodes is not None
    effective_base = {} if base_nodes is None else base_nodes
    for index, item in enumerate(nodes):
        item_path = f"{path}.nodes[{index}]"
        rule = _object(item, {"id", "mode"}, item_path)
        node_id = _node_id(rule["id"], f"{item_path}.id")
        if node_id in seen:
            _fail(f"{item_path}.id", "transition node IDs must be unique")
        seen.add(node_id)
        mode = _enum(
            rule["mode"],
            {"cut", "fade-in", "fade-out", "crossfade", "interpolate"},
            f"{item_path}.mode",
        )
        in_new = node_id in new_nodes
        in_base = node_id in effective_base
        if mode == "fade-in" and not in_new:
            _fail(item_path, "fade-in node must exist in the new state")
        if base_known:
            if mode == "cut" and not (in_new or in_base):
                _fail(item_path, "cut node must exist in the base or new state")
            if mode == "fade-out" and not in_base:
                _fail(item_path, "fade-out node must exist in the base state")
            if mode in {"crossfade", "interpolate"} and not (in_base and in_new):
                _fail(item_path, f"{mode} node must exist in both states")
        if mode == "interpolate" and base_known:
            if not _compatible_topology(effective_base[node_id], new_nodes[node_id]):
                _fail(item_path, "interpolate topology is incompatible")


def _validate_track_shape(
    track,
    nodes: Optional[Mapping[str, dict]],
    duration_ms: int,
    path: str,
) -> tuple[str, str]:
    obj = _object(track, {"node_id", "property", "interpolation", "keyframes"}, path)
    node_id = _node_id(obj["node_id"], f"{path}.node_id")
    prop = _enum(obj["property"], TRACK_PROPERTIES, f"{path}.property")
    interpolation = _enum(obj["interpolation"], TRACK_EASINGS, f"{path}.interpolation")
    if prop == "visible" and interpolation != "step":
        _fail(path, "visible tracks require step interpolation")
    if nodes is not None:
        if node_id not in nodes:
            _fail(path, "track target does not exist")
        if prop.startswith("material.") and nodes[node_id]["material"] is None:
            _fail(path, "material track requires a non-null node material")
    frames = _array(obj["keyframes"], f"{path}.keyframes", 1, 64)
    previous = None
    for index, frame in enumerate(frames):
        frame_path = f"{path}.keyframes[{index}]"
        keyframe = _object(frame, {"at_ms", "value"}, frame_path)
        at_ms = _integer(keyframe["at_ms"], f"{frame_path}.at_ms", 0, 60_000)
        if previous is not None and at_ms <= previous:
            _fail(f"{frame_path}.at_ms", "keyframe times must be strictly increasing")
        if index == 0 and at_ms != 0:
            _fail(f"{frame_path}.at_ms", "first keyframe must begin at zero")
        if at_ms > duration_ms:
            _fail(f"{frame_path}.at_ms", "keyframe exceeds sustain duration")
        previous = at_ms
        if prop == "transform.position":
            _vec(keyframe["value"], f"{frame_path}.value", -1_000_000, 1_000_000)
        elif prop == "transform.rotation":
            _vec(keyframe["value"], f"{frame_path}.value", -360_000, 360_000)
        elif prop == "transform.scale":
            _vec(keyframe["value"], f"{frame_path}.value", 1, 100_000)
        elif prop in {"material.color", "material.emissive"}:
            _color(keyframe["value"], f"{frame_path}.value")
        elif prop == "material.opacity":
            _integer(keyframe["value"], f"{frame_path}.value", 0, 1000)
        else:
            _boolean(keyframe["value"], f"{frame_path}.value")
    return node_id, prop


def _resolver_value(
    holo_id: str,
    resolver: Optional[Callable[[str], Optional[dict]] | Mapping[str, dict]],
) -> dict:
    if resolver is None:
        _fail("performance.sustain.flipbook", f"ancestor {holo_id} cannot be resolved")
    try:
        value = resolver(holo_id) if callable(resolver) else resolver.get(holo_id)
    except Exception as exc:
        raise HoloProtocolError(f"ancestor resolver failed for {holo_id}: {exc}") from exc
    if value is None:
        _fail("performance.sustain.flipbook", f"ancestor {holo_id} is unavailable")
    if type(value) is not dict or set(value) not in (
        {"verified_ancestor"},
        {"state", "verified_ancestor"},
    ):
        _fail(
            f"ancestor[{holo_id}]",
            "must contain verified_ancestor and optional state",
        )
    result = value
    if result["verified_ancestor"] is not True:
        _fail(f"ancestor[{holo_id}]", "must be a verified strict visual ancestor")
    if "state" in result:
        _validate_state(result["state"], f"ancestor[{holo_id}].state")
    return result


def _validate_flipbook(
    entries: list,
    duration_ms: int,
    repeat: str,
    resolver: Optional[Callable[[str], Optional[dict]] | Mapping[str, dict]],
    require_resolver: bool = True,
) -> None:
    previous_time = None
    referenced: dict[str, int] = {}
    for index, entry in enumerate(entries):
        path = f"performance.sustain.flipbook[{index}]"
        item = _object(entry, {"at_ms", "holo_id", "blend", "blend_ms"}, path)
        at_ms = _integer(item["at_ms"], f"{path}.at_ms", 0, 60_000)
        if index == 0 and at_ms != 0:
            _fail(f"{path}.at_ms", "first flipbook entry must begin at zero")
        if previous_time is not None and at_ms <= previous_time:
            _fail(f"{path}.at_ms", "flipbook times must be strictly increasing")
        if at_ms > duration_ms:
            _fail(f"{path}.at_ms", "flipbook entry exceeds sustain duration")
        holo_id = item["holo_id"]
        if holo_id != "self":
            _hex64(holo_id, f"{path}.holo_id")
        blend = _enum(item["blend"], {"cut", "crossfade"}, f"{path}.blend")
        blend_ms = _integer(item["blend_ms"], f"{path}.blend_ms", 0, 10_000)
        if blend == "cut" and blend_ms != 0:
            _fail(path, "cut entries require blend_ms zero")
        if blend == "crossfade" and blend_ms > 0:
            if index == 0:
                if repeat != "loop":
                    _fail(path, "only loop may crossfade the first entry")
            elif at_ms - blend_ms < previous_time:
                _fail(path, "crossfade window overlaps the prior entry")
        previous_time = at_ms
        if holo_id != "self" and holo_id not in referenced and resolver is not None:
            resolved = _resolver_value(holo_id, resolver)
            size = 0
            if "state" in resolved:
                try:
                    size = len(canonical(resolved["state"]).encode("utf-8"))
                except ProtocolError as exc:
                    raise HoloProtocolError(str(exc)) from exc
            referenced[holo_id] = size
    if entries and repeat == "loop":
        first = entries[0]
        if (
            first["blend"] == "crossfade"
            and first["blend_ms"] > 0
            and duration_ms - first["blend_ms"] < entries[-1]["at_ms"]
        ):
            _fail(
                "performance.sustain.flipbook[0]",
                "loop-boundary crossfade overlaps the final entry",
            )
    historical_ids = {
        entry["holo_id"] for entry in entries if entry["holo_id"] != "self"
    }
    if require_resolver and historical_ids and resolver is None:
        missing = sorted(historical_ids)[0]
        _fail("performance.sustain.flipbook", f"ancestor {missing} cannot be resolved")
    if sum(referenced.values()) > MAX_REFERENCED_STATE_BYTES:
        _fail("performance.sustain.flipbook", "referenced state bytes exceed 4 MiB")


def _validate_performance(
    value,
    nodes: Mapping[str, dict],
    ancestor_resolver,
    path: str,
) -> None:
    obj = _object(value, {"clock", "sustain"}, path)
    if obj["clock"] != "rapp-holo-logical-ms/1":
        _fail(f"{path}.clock", "unsupported performance clock")
    sustain = _object(
        obj["sustain"],
        {"duration_ms", "repeat", "tracks", "flipbook"},
        f"{path}.sustain",
    )
    duration = _integer(sustain["duration_ms"], f"{path}.sustain.duration_ms", 0, 60_000)
    repeat = _enum(
        sustain["repeat"],
        {"hold", "once", "loop", "ping-pong"},
        f"{path}.sustain.repeat",
    )
    tracks = _array(sustain["tracks"], f"{path}.sustain.tracks", 0, 512)
    flipbook = _array(sustain["flipbook"], f"{path}.sustain.flipbook", 0, 16)
    if repeat == "hold":
        if duration != 0 or tracks or flipbook:
            _fail(f"{path}.sustain", "hold requires zero duration and empty timelines")
    elif duration == 0:
        _fail(f"{path}.sustain.duration_ms", "non-hold sustain requires positive duration")
    pairs = set()
    keyframe_count = 0
    for index, track in enumerate(tracks):
        pair = _validate_track_shape(
            track,
            nodes,
            duration,
            f"{path}.sustain.tracks[{index}]",
        )
        if pair in pairs:
            _fail(
                f"{path}.sustain.tracks[{index}]",
                "duplicate node/property sustain track",
            )
        pairs.add(pair)
        keyframe_count += len(track["keyframes"])
    if keyframe_count > 4096:
        _fail(f"{path}.sustain.tracks", "aggregate keyframes exceed 4096")
    _validate_flipbook(flipbook, duration, repeat, ancestor_resolver)


def _validate_accessibility(value, path: str) -> None:
    obj = _object(value, {"description", "reduced_motion"}, path)
    _string(obj["description"], f"{path}.description", 1, 1024)
    _enum(obj["reduced_motion"], {"hold", "crossfade"}, f"{path}.reduced_motion")


def _validate_output_manifest(
    authored: dict,
    *,
    base_state: Optional[dict] = None,
    ancestor_resolver: Optional[
        Callable[[str], Optional[dict]] | Mapping[str, dict]
    ] = None,
) -> dict:
    """Validate an exact authored output and return its compiled manifest."""
    canonical_authored_bytes(authored)
    obj = _object(authored, OUTPUT_KEYS, "authored")
    if obj["schema"] != "rapp-holo-output/1":
        _fail("authored.schema", "must be rapp-holo-output/1")
    base_holo_id = obj["base_holo_id"]
    if base_holo_id is not None:
        _hex64(base_holo_id, "authored.base_holo_id")
    if obj["ir_version"] != "rapp-holo-ir/1":
        _fail("authored.ir_version", "unsupported IR version")
    if obj["renderer_contract"] != "rapp-holo-renderer/1":
        _fail("authored.renderer_contract", "unsupported renderer contract")
    state_info = _validate_state(obj["state"])
    base_nodes = None
    if base_state is not None:
        if base_holo_id is None:
            _fail("base_state", "cannot be supplied for holo genesis")
        base_nodes = _validate_state(base_state, "base_state")["nodes"]
    _validate_transition(
        obj["transition"],
        state_info["nodes"],
        base_nodes,
        base_holo_id is None,
        "transition",
    )
    _validate_performance(
        obj["performance"],
        state_info["nodes"],
        ancestor_resolver,
        "performance",
    )
    _validate_accessibility(obj["accessibility"], "accessibility")
    return compile_scene_manifest(obj, _validated=True)


def _base_state(base) -> Optional[dict]:
    if base is None:
        return None
    if type(base) is not dict:
        _fail("base", "must be a Holo output, record, or scene state")
    keys = set(base)
    if keys == OUTPUT_KEYS:
        return base["state"]
    if keys == RECORD_KEYS:
        authored = _object(base["authored"], OUTPUT_KEYS, "base.authored")
        return authored["state"]
    if keys == {"camera", "environment", "nodes"}:
        return base
    _fail("base", "must be a Holo output, record, or scene state")


def _ancestor_payload(value, path: str) -> dict:
    if value is True:
        return {"verified_ancestor": True}
    if type(value) is not dict:
        _fail(path, "must identify a verified ancestor")
    keys = set(value)
    if keys in ({"verified_ancestor"}, {"state", "verified_ancestor"}):
        return value
    if keys == OUTPUT_KEYS:
        return {"state": value["state"], "verified_ancestor": True}
    if keys == RECORD_KEYS:
        authored = _object(value["authored"], OUTPUT_KEYS, f"{path}.authored")
        return {"state": authored["state"], "verified_ancestor": True}
    if keys == {"camera", "environment", "nodes"}:
        return {"state": value, "verified_ancestor": True}
    _fail(path, "must identify a verified ancestor")


def _ancestor_resolver(ancestor_ids):
    if ancestor_ids is None or callable(ancestor_ids):
        return ancestor_ids
    if isinstance(ancestor_ids, Mapping):
        resolved = {}
        for holo_id, value in ancestor_ids.items():
            _hex64(holo_id, "ancestor_ids key")
            resolved[holo_id] = _ancestor_payload(
                value,
                f"ancestor_ids[{holo_id}]",
            )
        return resolved
    if isinstance(ancestor_ids, (str, bytes)):
        _fail("ancestor_ids", "must be an iterable of holo IDs or a mapping")
    try:
        values = list(ancestor_ids)
    except TypeError:
        _fail("ancestor_ids", "must be an iterable of holo IDs or a mapping")
    resolved = {}
    for index, holo_id in enumerate(values):
        _hex64(holo_id, f"ancestor_ids[{index}]")
        resolved[holo_id] = {"verified_ancestor": True}
    return resolved


def compile_manifest(
    value: dict,
    *,
    base=None,
    ancestor_ids=None,
) -> dict:
    """Validate one authored output and compile its canonical scene manifest."""
    return _validate_output_manifest(
        value,
        base_state=_base_state(base),
        ancestor_resolver=_ancestor_resolver(ancestor_ids),
    )


def validate_output(
    value: dict,
    *,
    base=None,
    ancestor_ids=None,
) -> dict:
    """Validate one authored output and return that exact object unchanged."""
    compile_manifest(value, base=base, ancestor_ids=ancestor_ids)
    return value


def _normalize_vector(value: list[int]) -> list[int]:
    length = math.isqrt(sum(component * component for component in value))
    if length == 0:
        raise HoloProtocolError("cannot normalize a zero vector")
    return [round_div(component * S, length) for component in value]


def _mesh_normals(geometry: dict) -> list[list[int]]:
    vertices = geometry["vertices"]
    accumulators = [[0, 0, 0] for _ in vertices]
    for triangle in geometry["triangles"]:
        a, b, c = (vertices[index] for index in triangle)
        ab = [b[axis] - a[axis] for axis in range(3)]
        ac = [c[axis] - a[axis] for axis in range(3)]
        normal = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
        ]
        for index in triangle:
            for axis in range(3):
                accumulators[index][axis] += normal[axis]
    return [
        _normalize_vector(value) if _nonzero(value) else [0, 0, S]
        for value in accumulators
    ]


def _compiled_geometry(node: dict):
    geometry = node["geometry"]
    node_type = node["type"]
    if node_type == "group":
        return None
    if node_type == "primitive":
        vertices, triangles, derived = _primitive_counts(geometry)
        return {
            "kind": "primitive",
            "authored": copy.deepcopy(geometry),
            "derived": derived,
            "vertex_count": vertices,
            "triangle_count": triangles,
        }
    if node_type == "mesh":
        return {
            "kind": "mesh",
            "vertices": copy.deepcopy(geometry["vertices"]),
            "triangles": copy.deepcopy(geometry["triangles"]),
            "normals": _mesh_normals(geometry),
            "vertex_count": len(geometry["vertices"]),
            "triangle_count": len(geometry["triangles"]),
        }
    if node_type == "polyline":
        vertices, triangles = _geometry_counts(node)
        return {
            "kind": "polyline",
            "authored": copy.deepcopy(geometry),
            "radial_segments": 8,
            "vertex_count": vertices,
            "triangle_count": triangles,
        }
    if node_type == "points":
        vertices, triangles = _geometry_counts(node)
        return {
            "kind": "points",
            "authored": copy.deepcopy(geometry),
            "billboard": "camera-facing-square",
            "vertex_count": vertices,
            "triangle_count": triangles,
        }
    light = copy.deepcopy(geometry)
    if light["direction"] is not None:
        light["normalized_direction"] = _normalize_vector(light["direction"])
    return {"kind": "light", "authored": light}


def compile_scene_manifest(authored: dict, *, _validated: bool = False) -> dict:
    """Compile a canonical, fixed-point logical scene manifest."""
    if not _validated:
        _validate_output_manifest(authored)
    state = authored["state"]
    camera = copy.deepcopy(state["camera"])
    camera["normalized_up"] = _normalize_vector(camera["up"])
    nodes = []
    draws = []
    lights = []
    for node in state["nodes"]:
        geometry = _compiled_geometry(node)
        compiled_node = {
            "node_id": node["id"],
            "parent": node["parent"],
            "type": node["type"],
            "visible": node["visible"],
            "transform": copy.deepcopy(node["transform"]),
            "geometry": geometry,
            "material": copy.deepcopy(node["material"]),
        }
        nodes.append(compiled_node)
        if node["type"] in {"primitive", "mesh", "polyline", "points"}:
            alpha = _color_channels(node["material"]["color"])[3]
            effective = round_div(node["material"]["opacity"] * alpha, 255)
            draws.append(
                {
                    "draw_order": len(draws),
                    "node_id": node["id"],
                    "parent": node["parent"],
                    "node_type": node["type"],
                    "visible": node["visible"],
                    "transform": copy.deepcopy(node["transform"]),
                    "geometry": copy.deepcopy(geometry),
                    "material": copy.deepcopy(node["material"]),
                    "effective_opacity": effective,
                    "transparent": effective < 1000
                    or node["material"]["blend"] != "normal",
                }
            )
        elif node["type"] == "light" and node["visible"]:
            lights.append(
                {
                    "light_order": len(lights),
                    "node_id": node["id"],
                    "parent": node["parent"],
                    "transform": copy.deepcopy(node["transform"]),
                    "light": copy.deepcopy(geometry),
                }
            )
    manifest = {
        "schema": "rapp-holo-compiled/1",
        "camera": camera,
        "environment": copy.deepcopy(state["environment"]),
        "nodes": nodes,
        "draws": draws,
        "lights": lights,
    }
    canonical(manifest)
    return manifest


def _memory_stream(value: str, path: str) -> tuple[str, str]:
    if type(value) is not str:
        _fail(path, "must be a memory stream ID")
    match = MEMORY_STREAM_RE.fullmatch(value)
    if not match or not rappid_valid(match.group(1)):
        _fail(path, "must be a valid RAPPID memory stream")
    return match.group(1), match.group(2)


def _validate_source(value, path: str) -> dict:
    obj = _object(value, {"stream_id", "seq", "frame_hash"}, path)
    _memory_stream(obj["stream_id"], f"{path}.stream_id")
    _integer(obj["seq"], f"{path}.seq", 0, MAX_SAFE_INTEGER)
    _hex64(obj["frame_hash"], f"{path}.frame_hash")
    return obj


def _validate_provenance(value, record: dict, subject_rappid: str, path: str) -> None:
    obj = _object(value, {"statement", "sig"}, path)
    statement = _object(
        obj["statement"],
        {
            "schema",
            "subject_rappid",
            "producer_rappid",
            "source_stream_id",
            "source_seq",
            "source_frame_hash",
            "authored_hash",
            "issued_utc",
        },
        f"{path}.statement",
    )
    if statement["schema"] != "rapp-holo-provenance/1":
        _fail(f"{path}.statement.schema", "must be rapp-holo-provenance/1")
    if not rappid_valid(statement["subject_rappid"]):
        _fail(f"{path}.statement.subject_rappid", "invalid subject RAPPID")
    if not rappid_valid(statement["producer_rappid"]):
        _fail(f"{path}.statement.producer_rappid", "invalid producer RAPPID")
    _memory_stream(statement["source_stream_id"], f"{path}.statement.source_stream_id")
    _integer(statement["source_seq"], f"{path}.statement.source_seq", 0, MAX_SAFE_INTEGER)
    _hex64(statement["source_frame_hash"], f"{path}.statement.source_frame_hash")
    _hex64(statement["authored_hash"], f"{path}.statement.authored_hash")
    if not utc_valid(statement["issued_utc"]):
        _fail(f"{path}.statement.issued_utc", "invalid fixed-form UTC")
    sig = _string(obj["sig"], f"{path}.sig", 1, 16_384)
    try:
        header, _, _ = parse_detached_jws(sig)
    except ProtocolError as exc:
        _fail(f"{path}.sig", f"invalid detached JWS: {exc}")
    if header["kid"] != statement["producer_rappid"]:
        _fail(f"{path}.sig", "JWS kid must equal producer_rappid")
    expected = {
        "subject_rappid": subject_rappid,
        "source_stream_id": record["source"]["stream_id"],
        "source_seq": record["source"]["seq"],
        "source_frame_hash": record["source"]["frame_hash"],
        "authored_hash": record["authored_hash"],
    }
    for key, expected_value in expected.items():
        if statement[key] != expected_value:
            _fail(f"{path}.statement.{key}", "does not match the materialized record")


_UNSET = object()


def validate_record(
    record: dict,
    *,
    subject_rappid: str,
    source_binding: dict,
    expected_visual_parent=_UNSET,
    base_state: Optional[dict] = None,
    ancestor_resolver: Optional[
        Callable[[str], Optional[dict]] | Mapping[str, dict]
    ] = None,
) -> dict:
    """Validate a source-bound materialized Holo/1 record without persistence."""
    if not rappid_valid(subject_rappid):
        _fail("subject_rappid", "must be a valid RAPPID")
    obj = _object(record, RECORD_KEYS, "record")
    if obj["schema"] != "rapp-holo-record/1":
        _fail("record.schema", "must be rapp-holo-record/1")
    holo_seq = _integer(obj["holo_seq"], "record.holo_seq", 0, MAX_SAFE_INTEGER)
    visual_parent = obj["visual_parent"]
    if visual_parent is not None:
        _hex64(visual_parent, "record.visual_parent")
    if (holo_seq == 0) != (visual_parent is None):
        _fail("record", "holo genesis and visual_parent rules disagree")
    source = _validate_source(obj["source"], "record.source")
    source_subject, _ = _memory_stream(source["stream_id"], "record.source.stream_id")
    if source_subject != subject_rappid:
        _fail("record.source.stream_id", "source subject must equal body subject")
    _hex64(obj["authored_hash"], "record.authored_hash")
    _object(obj["authored"], OUTPUT_KEYS, "record.authored")
    if obj["authored_hash"] != authored_hash(obj["authored"]):
        _fail("record.authored_hash", "does not match H(rapp-holo/1:authored, authored)")
    if obj["authored"]["base_holo_id"] != visual_parent:
        _fail("record.authored.base_holo_id", "must equal visual_parent")
    binding = _object(
        source_binding,
        {"stream_id", "seq", "frame_hash", "authored"},
        "source_binding",
    )
    expected_source = _validate_source(
        {key: binding[key] for key in ("stream_id", "seq", "frame_hash")},
        "source_binding",
    )
    if source != expected_source:
        _fail("record.source", "does not match the exact verified source binding")
    try:
        same_authored = canonical(binding["authored"]) == canonical(obj["authored"])
    except ProtocolError as exc:
        raise HoloProtocolError(str(exc)) from exc
    if not same_authored:
        _fail("record.authored", "differs from the exact source candidate")
    if expected_visual_parent is not _UNSET and visual_parent != expected_visual_parent:
        _fail("record.visual_parent", "is stale relative to the authoritative holo head")
    if obj["producer_provenance"] is not None:
        _validate_provenance(
            obj["producer_provenance"],
            obj,
            subject_rappid,
            "record.producer_provenance",
        )
    return _validate_output_manifest(
        obj["authored"],
        base_state=base_state,
        ancestor_resolver=ancestor_resolver,
    )


__all__ = [
    "HoloProtocolError",
    "MAX_AUTHORED_BYTES",
    "MAX_REFERENCED_STATE_BYTES",
    "S",
    "authored_hash",
    "canonical_authored_bytes",
    "compile_manifest",
    "compile_scene_manifest",
    "domain_hash",
    "easing",
    "evaluate_property_track",
    "local_sustain_time",
    "parse_json",
    "round_div",
    "select_flipbook",
    "validate_output",
    "validate_record",
]
