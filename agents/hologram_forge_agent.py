"""Validate Copilot-authored scene data for the RAPP Zoo hologram foundry."""

from __future__ import annotations

import json
import unicodedata

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
    "version": "1.0.0",
    "display_name": "HologramForge",
    "description": (
        "Validates a proposed data-only hologram design against the RAPP Zoo "
        "closed scene schema. The calling model supplies the creative polish; "
        "the forge refuses executable, remote, malformed, or overlong content."
    ),
    "author": "Kody Wildfeuer",
    "tags": ["hologram", "forge", "frame", "validation", "three-js", "dogg"],
    "category": "creative",
    "quality_tier": "community",
    "requires_env": [],
    "dependencies": ["@rapp/basic_agent"],
}


FRAME_KEYS = {
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
}
ACCENTS = {"violet", "cyan", "ice"}


def _text(value, label, limit):
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > limit
        or value != unicodedata.normalize("NFC", value)
    ):
        raise ValueError(f"{label} must be a non-empty NFC string up to {limit} characters")
    return value


def _validate_design(value):
    if not isinstance(value, dict) or set(value) != {
        "name",
        "kind",
        "accent",
        "description",
        "scene",
    }:
        raise ValueError("design must contain exactly name, kind, accent, description, scene")
    _text(value["name"], "name", 60)
    _text(value["description"], "description", 500)
    if value["kind"] not in {"character", "data-projection"}:
        raise ValueError("kind must be character or data-projection")
    if value["accent"] not in ACCENTS:
        raise ValueError("accent must be violet, cyan, or ice")
    scene = value["scene"]
    if not isinstance(scene, dict):
        raise ValueError("scene must be an object")
    if value["kind"] == "character":
        if set(scene) != {"title", "subtitle"}:
            raise ValueError("character scene must contain exactly title and subtitle")
        _text(scene["title"], "scene.title", 120)
        _text(scene["subtitle"], "scene.subtitle", 240)
    else:
        if set(scene) != {"prompt", "options"}:
            raise ValueError("data projection scene must contain exactly prompt and options")
        _text(scene["prompt"], "scene.prompt", 300)
        if not isinstance(scene["options"], list) or len(scene["options"]) != 3:
            raise ValueError("data projection must contain exactly three options")
        for option in scene["options"]:
            if not isinstance(option, dict) or set(option) != {"label", "value"}:
                raise ValueError("each option must contain exactly label and value")
            _text(option["label"], "option.label", 100)
            _text(option["value"], "option.value", 240)
    encoded = json.dumps(value, ensure_ascii=False).lower()
    if any(
        token in encoded
        for token in (
            "<script",
            "javascript:",
            "http://",
            "https://",
            "shader",
            "eval(",
            "subprocess",
            "shell",
        )
    ):
        raise ValueError("design contains executable, remote, or shell content")
    return value


class HologramForgeAgent(BasicAgent):
    def __init__(self):
        self.name = "HologramForge"
        self.metadata = {
            "name": self.name,
            "display_name": __manifest__["display_name"],
            "description": __manifest__["description"],
            "parameters": {
                "type": "object",
                "properties": {
                    "frame_json": {
                        "type": "string",
                        "description": "The exact verified RAPP/1 frame as JSON.",
                    },
                    "design_json": {
                        "type": "string",
                        "description": "The proposed closed hologram design as JSON.",
                    },
                },
                "required": ["frame_json", "design_json"],
            },
        }
        super().__init__(self.name, self.metadata)

    def perform(self, **kwargs):
        try:
            frame = json.loads(kwargs.get("frame_json") or "")
            design = json.loads(kwargs.get("design_json") or "")
            if not isinstance(frame, dict) or set(frame) != FRAME_KEYS:
                raise ValueError("frame must contain exactly the eleven RAPP/1 keys")
            if frame.get("spec") != "rapp/1" or not isinstance(frame.get("payload"), dict):
                raise ValueError("frame spec or payload is invalid")
            for field in ("payload_hash", "frame_hash"):
                value = frame.get(field)
                if (
                    not isinstance(value, str)
                    or len(value) != 64
                    or any(char not in "0123456789abcdef" for char in value)
                ):
                    raise ValueError(f"frame {field} is invalid")
            accepted = _validate_design(design)
            return json.dumps({
                "status": "ok",
                "source_frame_hash": frame["frame_hash"],
                "design": accepted,
            }, ensure_ascii=False)
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            return json.dumps({
                "status": "refused",
                "message": str(exc),
            })


if __name__ == "__main__":
    print(HologramForgeAgent().perform())
