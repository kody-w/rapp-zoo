"""Drop-in brainstem tool for hatching verified RAPP/1 organism eggs."""

from __future__ import annotations

import json
import os
import pathlib
import secrets
import shutil

from agents.basic_agent import BasicAgent


TWIN_PORT_LOW, TWIN_PORT_HIGH = 7081, 7200


def _rapp_home() -> str:
    return os.environ.get("RAPP_HOME") or os.path.join(os.path.expanduser("~"), ".rapp")


def _twins_dir() -> str:
    return os.path.join(_rapp_home(), "twins")


def _try_import_protocol():
    try:
        from utils import rapp_protocol

        return rapp_protocol
    except ImportError:
        try:
            import rapp_protocol

            return rapp_protocol
        except ImportError:
            return None


def _try_import_peer_registry():
    try:
        from utils import peer_registry

        return peer_registry
    except ImportError:
        try:
            import peer_registry

            return peer_registry
        except ImportError:
            return None


def _allocate_port(peer_registry) -> int:
    if peer_registry is None:
        return TWIN_PORT_LOW
    try:
        claimed = peer_registry.claimed_ports()
    except Exception:
        claimed = set()
    for port in range(TWIN_PORT_LOW, TWIN_PORT_HIGH):
        if port not in claimed:
            return port
    return 0


def _safe_target(root: pathlib.Path, relative: str) -> pathlib.Path:
    target = (root / relative).resolve()
    resolved_root = root.resolve()
    if target != resolved_root and resolved_root not in target.parents:
        raise ValueError(f"path escapes workspace: {relative}")
    return target


class HatchEggAgent(BasicAgent):
    def __init__(self):
        self.name = "HatchEgg"
        self.metadata = {
            "name": self.name,
            "description": (
                "Verifies a RAPP/1 organism egg and hatches it as a fresh local "
                "instance. The egg's artifact RAPPID is preserved, while the "
                "installation receives a new instance RAPPID whose grown_from "
                "field records the egg address."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "egg_path": {
                        "type": "string",
                        "description": "Absolute path to a RAPP/1 organism .egg file.",
                    },
                    "owner": {
                        "type": "string",
                        "description": "Lowercase GitHub login for the new instance "
                                       "identity. Defaults to RAPP_OWNER, then "
                                       "kody-w for this estate.",
                    },
                },
                "required": ["egg_path"],
            },
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, **kwargs) -> str:
        egg_path_value = kwargs.get("egg_path") or ""
        if not egg_path_value:
            return "Error: egg_path is required."
        egg_path = pathlib.Path(egg_path_value).expanduser()
        if not egg_path.is_file():
            return f"Error: file not found: {egg_path}"

        protocol = _try_import_protocol()
        if protocol is None:
            return (
                "Error: utils/rapp_protocol.py is required. Copy it from "
                "rapp-zoo into the brainstem's utils/ directory with this cartridge."
            )

        try:
            blob = egg_path.read_bytes()
            verifier = protocol.signature_verifier_from_environment()
            details = protocol.inspect_egg(blob, signature_verifier=verifier)
        except Exception as exc:
            return f"Error: RAPP/1 egg refused before extraction: {exc}"

        manifest = details["manifest"]
        files = details["files"]
        if manifest["variant"] != "organism":
            return (
                f"Error: HatchEgg materializes organism eggs, not "
                f"{manifest['variant']!r} eggs."
            )

        try:
            owner = protocol.require_owner(
                kwargs.get("owner") or os.environ.get("RAPP_OWNER"),
                default="kody-w",
            )
            artifact_identity = protocol.strict_json_loads(files["rappid.json"])
            artifact_parts = protocol.rappid_parts(manifest["rappid"])
            instance_identity = {
                "schema": protocol.SPEC,
                "rappid": protocol.mint_rappid(
                    owner,
                    protocol.slugify(f"{artifact_parts['slug']}-instance"),
                ),
                "artifact_rappid": manifest["rappid"],
                "grown_from": details["egg_hash"],
                "born_at": protocol.utc_now_ms(),
                "kind": "instance",
                "name": artifact_identity.get("name") or artifact_parts["slug"],
            }
        except Exception as exc:
            return f"Error: could not mint the instance identity: {exc}"

        workspace = pathlib.Path(_twins_dir()) / secrets.token_hex(16)
        try:
            workspace.mkdir(parents=True, exist_ok=False)
            (workspace / "artifact-rappid.json").write_bytes(files["rappid.json"])
            layout = manifest["payload"].get("layout")
            if layout == "brainstem-instance":
                content_root = workspace / "src" / "rapp_brainstem"
            else:
                content_root = workspace
            content_root.mkdir(parents=True, exist_ok=True)

            for path, octets in files.items():
                if path == "rappid.json":
                    continue
                if layout == "brainstem-instance":
                    destinations = {
                        "agents/": content_root / "agents",
                        "organs/": content_root / "utils" / "organs",
                        "senses/": content_root / "utils" / "senses",
                        "services/": content_root / "utils" / "services",
                        "data/": content_root / ".brainstem_data",
                    }
                    target = None
                    if path in {"soul.md", ".env"}:
                        target = _safe_target(content_root, path)
                    else:
                        for prefix, destination in destinations.items():
                            if path.startswith(prefix):
                                target = _safe_target(
                                    destination, path[len(prefix):]
                                )
                                break
                    if target is None:
                        continue
                elif path.startswith("data/"):
                    target = _safe_target(
                        workspace / ".brainstem_data",
                        path[len("data/"):],
                    )
                else:
                    target = _safe_target(workspace, path)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(octets)
            (workspace / "rappid.json").write_text(
                json.dumps(instance_identity, indent=2, ensure_ascii=False) + "\n"
            )
        except Exception as exc:
            shutil.rmtree(workspace, ignore_errors=True)
            return f"Error: verified egg could not be materialized: {exc}"

        soul_path = (
            workspace / "src" / "rapp_brainstem" / "soul.md"
            if manifest["payload"].get("layout") == "brainstem-instance"
            else workspace / "soul.md"
        )
        agents_path = (
            workspace / "src" / "rapp_brainstem" / "agents"
            if manifest["payload"].get("layout") == "brainstem-instance"
            else workspace / "agents"
        )
        if not soul_path.is_file():
            shutil.rmtree(workspace, ignore_errors=True)
            return f"Error: verified egg hatch is not viable; missing {soul_path}"

        peer_registry = _try_import_peer_registry()
        port = _allocate_port(peer_registry)
        registry_status = "skipped (peer_registry unavailable)"
        if peer_registry is not None:
            try:
                try:
                    peer_registry.upsert(
                        str(workspace),
                        port,
                        instance_rappid=instance_identity["rappid"],
                        artifact_rappid=manifest["rappid"],
                        grown_from=details["egg_hash"],
                        egg_hash=details["egg_hash"],
                        twin_name=instance_identity["name"],
                        parent_repo=manifest["payload"].get("parent_repo"),
                        summoned_from=str(egg_path),
                    )
                except TypeError:
                    peer_registry.upsert(
                        str(workspace),
                        port,
                        rappid_uuid=instance_identity["rappid"],
                        twin_name=instance_identity["name"],
                        parent_repo=manifest["payload"].get("parent_repo"),
                        summoned_from=str(egg_path),
                    )
                registry_status = f"registered at port {port}"
            except Exception as exc:
                registry_status = f"registry error: {exc}"

        return (
            f"Hatched organism instance '{instance_identity['name']}' — fully viable.\n"
            f"  Workspace:       {workspace}\n"
            f"  Artifact RAPPID: {manifest['rappid']}\n"
            f"  Instance RAPPID: {instance_identity['rappid']}\n"
            f"  grown_from:      {details['egg_hash']}\n"
            f"  Estate:          {registry_status}\n"
            f"  Boot it:         SOUL_PATH={soul_path} "
            f"AGENTS_PATH={agents_path} ~/.brainstem/start.sh "
            f"--port {port or '<available>'}"
        )
