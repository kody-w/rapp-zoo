"""Validate and hash an exact Holo/1 object authored on the original AI turn."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re

try:
    from agents.basic_agent import BasicAgent
except Exception:
    try:
        from basic_agent import BasicAgent
    except Exception:
        class BasicAgent:
            def __init__(self, name=None, metadata=None):
                if name is not None:
                    self.name = name
                if metadata is not None:
                    self.metadata = metadata

            def perform(self, **kwargs):
                del kwargs
                return "Not implemented."

            def to_tool(self):
                return {
                    "type": "function",
                    "function": {
                        "name": self.name,
                        "description": self.metadata.get("description", ""),
                        "parameters": self.metadata.get("parameters", {}),
                    },
                }


__manifest__ = {
    "schema": "rapp-agent/1.0",
    "name": "@kody-w/hologram_forge",
    "version": "2.0.0",
    "display_name": "HologramOutput",
    "description": (
        "Validates the exact rapp-holo-output/1 object authored during the "
        "current AI response and returns it unchanged with its canonical hash. "
        "It never designs, defaults, repairs, adapts, or polishes a hologram."
    ),
    "author": "Kody Wildfeuer",
    "tags": ["hologram", "holo-1", "output", "validation"],
    "category": "protocol",
    "quality_tier": "community",
    "requires_env": [],
    "dependencies": ["@rapp/basic_agent"],
}


MAX_CANONICAL_BYTES = 256 * 1024
FORBIDDEN_CONTENT = (
    re.compile(r"<\s*/?\s*[a-z][^>]*>", re.IGNORECASE),
    re.compile(r"\bjavascript\s*:", re.IGNORECASE),
    re.compile(r"\bdata\s*:\s*text/html", re.IGNORECASE),
    re.compile(r"\b(?:https?|file)\s*://", re.IGNORECASE),
    re.compile(r"\beval\s*\(", re.IGNORECASE),
    re.compile(r"\bnew\s+Function\s*\(", re.IGNORECASE),
    re.compile(r"\brequire\s*\(", re.IGNORECASE),
    re.compile(r"\bimport\s*\(", re.IGNORECASE),
)
_SCHEMA = None


def _schema_paths():
    explicit = os.environ.get("RAPP_HOLO_OUTPUT_SCHEMA")
    if explicit:
        yield Path(explicit)
    soul = os.environ.get("SOUL_PATH")
    if soul:
        yield Path(soul).resolve().parent / "protocol" / "rapp-holo-output.schema.json"
    yield (
        Path(__file__).resolve().parents[1]
        / "holograms"
        / "protocol"
        / "rapp-holo-output.schema.json"
    )


def _load_schema():
    global _SCHEMA
    if _SCHEMA is not None:
        return _SCHEMA
    for candidate in _schema_paths():
        if candidate.is_file():
            with candidate.open("r", encoding="utf-8") as handle:
                _SCHEMA = json.load(handle)
            return _SCHEMA
    raise ValueError("the pinned rapp-holo-output/1 schema is unavailable")


def _resolve_ref(reference, root):
    if not reference.startswith("#/"):
        raise ValueError(f"unsupported Holo schema reference: {reference}")
    value = root
    for part in reference[2:].split("/"):
        value = value[part.replace("~1", "/").replace("~0", "~")]
    return value


def _type_matches(value, expected):
    if expected == "null":
        return value is None
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "string":
        return isinstance(value, str)
    if expected == "boolean":
        return isinstance(value, bool)
    return False


def _assert_schema(value, schema, root, path="Holo output"):
    if "$ref" in schema:
        _assert_schema(value, _resolve_ref(schema["$ref"], root), root, path)
        return
    if "oneOf" in schema:
        matches = 0
        for choice in schema["oneOf"]:
            try:
                _assert_schema(value, choice, root, path)
                matches += 1
            except (TypeError, ValueError, KeyError):
                pass
        if matches != 1:
            raise ValueError(f"{path} must match exactly one allowed Holo shape")
    expected_type = schema.get("type")
    if expected_type and not _type_matches(value, expected_type):
        raise ValueError(f"{path} must be {expected_type}")
    if "const" in schema and value != schema["const"]:
        raise ValueError(f"{path} must equal {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{path} has an unsupported value")
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            raise ValueError(f"{path} is shorter than the Holo limit")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            raise ValueError(f"{path} exceeds the Holo limit")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            raise ValueError(f"{path} has an invalid format")
    if isinstance(value, int) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            raise ValueError(f"{path} is below the Holo limit")
        if "maximum" in schema and value > schema["maximum"]:
            raise ValueError(f"{path} exceeds the Holo limit")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            raise ValueError(f"{path} has too few items")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            raise ValueError(f"{path} has too many items")
        if "items" in schema:
            for index, item in enumerate(value):
                _assert_schema(item, schema["items"], root, f"{path}[{index}]")
    if isinstance(value, dict):
        for required in schema.get("required", []):
            if required not in value:
                raise ValueError(f"{path}.{required} is required")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in properties:
                    raise ValueError(f"{path}.{key} is not part of Holo/1")
        for key, property_schema in properties.items():
            if key in value:
                _assert_schema(value[key], property_schema, root, f"{path}.{key}")
    for member in schema.get("allOf", []):
        _assert_schema(value, member, root, path)
    if "if" in schema:
        try:
            _assert_schema(value, schema["if"], root, path)
            condition_matches = True
        except (TypeError, ValueError, KeyError):
            condition_matches = False
        if condition_matches and "then" in schema:
            _assert_schema(value, schema["then"], root, path)
        if not condition_matches and "else" in schema:
            _assert_schema(value, schema["else"], root, path)


def _assert_json_value(value, depth=1):
    if depth > 64:
        raise ValueError("Holo output exceeds the JSON depth limit")
    if value is None or isinstance(value, bool):
        return
    if isinstance(value, int):
        if abs(value) > 2**53 - 1:
            raise ValueError("Holo output integer is outside the interoperable range")
        return
    if isinstance(value, float):
        raise ValueError("Holo output numbers must be interoperable integers")
    if isinstance(value, str):
        if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            raise ValueError("Holo output contains an unpaired UTF-16 surrogate")
        return
    if isinstance(value, list):
        for item in value:
            _assert_json_value(item, depth + 1)
        return
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise ValueError("Holo output object keys must be strings")
        for key, item in value.items():
            _assert_json_value(key, depth + 1)
            _assert_json_value(item, depth + 1)
        return
    raise ValueError(f"Holo output contains non-JSON data: {type(value).__name__}")


def _assert_data_only(value, path="Holo output"):
    if isinstance(value, str):
        if any(pattern.search(value) for pattern in FORBIDDEN_CONTENT):
            raise ValueError(
                f"{path} contains executable or remote content"
            )
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _assert_data_only(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            _assert_data_only(item, f"{path}.{key}")


def _canonical(value, depth=1):
    if depth > 64:
        raise ValueError("Holo output exceeds the JSON depth limit")
    if value is None or isinstance(value, bool) or isinstance(value, int):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(_canonical(item, depth + 1) for item in value) + "]"
    keys = sorted(value, key=lambda key: key.encode("utf-16-be"))
    return (
        "{"
        + ",".join(
            json.dumps(key, ensure_ascii=False, separators=(",", ":"))
            + ":"
            + _canonical(value[key], depth + 1)
            for key in keys
        )
        + "}"
    )


def _validate_holo_output(value):
    _assert_json_value(value)
    schema = _load_schema()
    _assert_schema(value, schema, schema)
    _assert_data_only(value)
    canonical = _canonical(value)
    if len(canonical.encode("utf-8")) > MAX_CANONICAL_BYTES:
        raise ValueError("Holo output exceeds the canonical byte limit")
    return value, canonical


class HologramForgeAgent(BasicAgent):
    def __init__(self):
        self.name = "HologramForge"
        self.metadata = {
            "name": self.name,
            "display_name": __manifest__["display_name"],
            "description": __manifest__["description"],
            "parameters": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "authored_holo_output": {
                        "type": "object",
                        "description": (
                            "The exact complete rapp-holo-output/1 object authored "
                            "during this original response."
                        ),
                    },
                },
                "required": ["authored_holo_output"],
            },
        }
        super().__init__(self.name, self.metadata)

    def perform(self, **kwargs):
        try:
            if set(kwargs) != {"authored_holo_output"}:
                if {"frame_json", "design_json"} & set(kwargs):
                    raise ValueError(
                        "legacy post-hoc frame/design generation is refused"
                    )
                raise ValueError(
                    "exactly authored_holo_output is required"
                )
            authored = kwargs["authored_holo_output"]
            accepted, canonical = _validate_holo_output(authored)
            authored_hash = hashlib.sha256(
                b"rapp-holo/1:authored\n" + canonical.encode("utf-8")
            ).hexdigest()
            return json.dumps(
                {
                    "status": "ok",
                    "authored": accepted,
                    "authored_hash": authored_hash,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        except (TypeError, ValueError, KeyError, json.JSONDecodeError) as exc:
            return json.dumps(
                {
                    "status": "refused",
                    "message": str(exc),
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )


if __name__ == "__main__":
    print(HologramForgeAgent().perform())
