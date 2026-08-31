"""Validate and hash an exact Holo/1 object authored on the original AI turn."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import types

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
    "version": "2.2.0",
    "display_name": "HologramOutput",
    "description": (
        "Validates one exact Rolling Core rapp-holo-output/1 growth frame "
        "authored during the current AI response, including its already-"
        "authored growl prompt and continuation, and returns it unchanged with "
        "its canonical hash. It never generates, defaults, repairs, adapts, "
        "or polishes."
    ),
    "author": "Kody Wildfeuer",
    "tags": ["hologram", "holo-1", "output", "validation"],
    "category": "protocol",
    "quality_tier": "community",
    "requires_env": [],
    "dependencies": ["@rapp/basic_agent"],
}


def _load_shared_holo_protocol():
    agent_path = Path(__file__).resolve()
    candidates = (
        agent_path.parent / "rapp_zoo_holo_protocol",
        agent_path.parents[1] / "utils",
    )
    module_root = next(
        (
            candidate
            for candidate in candidates
            if (candidate / "holo_protocol.py").is_file()
            and (candidate / "rapp_protocol.py").is_file()
        ),
        None,
    )
    if module_root is None:
        checked = ", ".join(str(candidate) for candidate in candidates)
        raise ImportError(
            "shared Holo/1 validator is unavailable; checked " + checked
        )

    package_name = "_rapp_zoo_holo_protocol"
    package = types.ModuleType(package_name)
    package.__path__ = [str(module_root)]
    package.__package__ = package_name
    sys.modules[package_name] = package

    for name in ("rapp_protocol", "holo_protocol"):
        full_name = f"{package_name}.{name}"
        spec = importlib.util.spec_from_file_location(
            full_name,
            module_root / f"{name}.py",
        )
        if spec is None or spec.loader is None:
            raise ImportError(f"cannot load shared Holo/1 module {full_name}")
        module = importlib.util.module_from_spec(spec)
        sys.modules[full_name] = module
        spec.loader.exec_module(module)
    return sys.modules[f"{package_name}.holo_protocol"]


HOLO_PROTOCOL = _load_shared_holo_protocol()
for required_api in ("validate_output", "authored_hash", "growl_events"):
    if not callable(getattr(HOLO_PROTOCOL, required_api, None)):
        raise ImportError(
            f"shared Holo/1 validator is missing required API {required_api}"
        )


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
                    "base_holo_output": {
                        "type": ["object", "null"],
                        "description": (
                            "The verified current base Holo output supplied to "
                            "the original turn, or null at genesis."
                        ),
                    },
                    "ancestor_holo_outputs": {
                        "type": "object",
                        "description": (
                            "Verified retained ancestor holo IDs mapped to their "
                            "exact outputs, as supplied to the original turn."
                        ),
                    },
                },
                "required": ["authored_holo_output"],
            },
        }
        super().__init__(self.name, self.metadata)

    def perform(self, **kwargs):
        try:
            allowed = {
                "authored_holo_output",
                "base_holo_output",
                "ancestor_holo_outputs",
            }
            if "authored_holo_output" not in kwargs or not set(kwargs) <= allowed:
                if {"frame_json", "design_json"} & set(kwargs):
                    raise ValueError(
                        "legacy post-hoc frame/design generation is refused"
                    )
                raise ValueError(
                    "authored_holo_output and only Holo validation context are required"
                )
            authored = kwargs["authored_holo_output"]
            accepted = HOLO_PROTOCOL.validate_output(
                authored,
                base=kwargs.get("base_holo_output"),
                ancestor_ids=kwargs.get("ancestor_holo_outputs"),
            )
            HOLO_PROTOCOL.growl_events(accepted["growl"])
            return json.dumps(
                {
                    "status": "ok",
                    "authored": accepted,
                    "authored_hash": HOLO_PROTOCOL.authored_hash(authored),
                },
                ensure_ascii=False,
                separators=(",", ":"),
            )
        except (TypeError, ValueError, KeyError) as exc:
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
