"""Identity, deterministic RAPP/1 eggs, and instance-safe hatching.

This is the runtime side of the bonding lifecycle the install one-liner uses:

  birth   — fresh install on a machine that has no organism yet
  egg     — pack the full organism into a portable .egg cartridge
  bond    — egg + apply new framework + hatch (in-place kernel evolution)
  hatch   — extract a .egg over the local kernel (in-place restore, or
            adoption when the egg arrived from elsewhere)

Why bond.py exists separate from the older egg.py:

  egg.py packs *parts* of an organism — a single rapplication, the twin
  agent set, a full snapshot — into a /catalog/-shaped egg. Useful, but
  the layout assumes the active brainstem instance owns the rappid in
  .brainstem_data/identity.json, and the eggs land in a per-rappid
  workspace under a host root.

  Locally-hatched organisms want a different shape: ONE organism per
  brainstem install, identity at ~/.brainstem/rappid.json (above the
  kernel src tree, so kernel overlays can never touch it), and eggs that
  resurrect the *whole* organism (agents/organs/senses/services + soul
  + .env + data + identity) on any kernel that knows how to hatch them.

  bond.py is the CLI the installer drives. All emitted cartridges use the
  single RAPP/1 §9 egg format; a hatch preserves the artifact identity and
  gives a newly-created live instance its own §6.2 identity.

Usage (run as `python -m utils.bond <cmd>` from inside rapp_brainstem/):

  python -m utils.bond mint-rappid /path/to/brainstem_home [--parent-commit SHA]
  python -m utils.bond egg /path/to/brainstem_home /path/to/out.egg --kernel-version X.Y.Z
  python -m utils.bond hatch /path/to/brainstem_home /path/to/in.egg
  python -m utils.bond record-bond /path/to/brainstem_home <kind> [--from-version V] [--to-version V] [--from-commit SHA] [--to-commit SHA]
  python -m utils.bond bump-incarnations /path/to/brainstem_home
  python -m utils.bond inspect /path/to/in.egg

The egg is a zip at the byte level (PK header) — `unzip foo.egg` works,
recovery from a broken bond is `unzip -o egg -d ~/.brainstem/src/rapp_brainstem`.

Stdlib only — must be importable on a fresh venv before any other deps.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import socket
import sys
import time
from typing import Optional

try:
    from . import rapp_protocol as rapp
except ImportError:
    import rapp_protocol as rapp

SCHEMA = rapp.EGG_SCHEMA
SCHEMA_RAPP = rapp.EGG_SCHEMA
VARIANT_ORGANISM = "organism"
VARIANT_RAPPLICATION = "rapplication"
SPECIES_ROOT_RAPPID = "rappid:@kody-w/rapp:9a8f0a4b5a710e20f4d819a0f37d2a4c9f113b5e78fb3c29e70b54fff48a38f9"

# Files under brainstem-src that are part of the *organism*, not the
# *kernel*. The kernel ships defaults at install time; the organism's
# customizations to these files are what the egg captures.
ORGANISM_TOP_FILES = ("soul.md", ".env")

# Subtrees under brainstem-src that the egg packs in full (subject to
# per-file exclusions below). Filename layout is mirrored inside the egg.
ORGANISM_TREES = {
    # zip arcname prefix → path inside brainstem-src
    "agents":   "agents",
    "organs":   "utils/organs",
    "senses":   "utils/senses",
    "services": "utils/services",
    "data":     ".brainstem_data",
}

# Files that travel as kernel-shipped infrastructure, not as organism
# state. Skip them on egg AND ignore them on hatch.
INFRA_FILES = {"basic_agent.py", "__init__.py"}

# Names that must never enter an egg under any circumstances. Secrets,
# environment artifacts, OS noise, explicit "no-share" namespaces.
SECRETS_FILES = {
    ".copilot_token", ".copilot_session", ".copilot_pending",
    "voice.zip", ".DS_Store", "Thumbs.db",
}
SECRETS_DIRS = {
    "__pycache__", ".pytest_cache", "venv", ".venv", "node_modules",
    "private",  # explicit no-share namespace inside .brainstem_data/
}

# Substrings — if any path component matches a regex below, skip.
_SECRET_PATTERNS = [
    re.compile(r".*\.(token|session|secret|key)$", re.IGNORECASE),
]


# ── small helpers ────────────────────────────────────────────────────────

def _now_iso() -> str:
    return rapp.utc_now_ms()


def _short_host() -> str:
    raw = socket.gethostname() or "local"
    short = raw.split(".")[0].lower()
    short = re.sub(r"[^\w-]", "-", short).strip("-")
    return short or "local"


def _organism_slug() -> str:
    return rapp.slugify(f"{_short_host()}-brainstem")


def _excluded(rel_path: str) -> bool:
    """True if a path component would leak secrets or environment noise."""
    parts = rel_path.replace("\\", "/").split("/")
    for p in parts:
        if not p:
            continue
        if p in SECRETS_FILES or p in SECRETS_DIRS:
            return True
        for pat in _SECRET_PATTERNS:
            if pat.match(p):
                return True
    return False


def _read_json(path: str) -> Optional[dict]:
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _write_json(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ── identity ─────────────────────────────────────────────────────────────

def _rappid_path(home: str) -> str:
    return os.path.join(home, "rappid.json")


def _bonds_path(home: str) -> str:
    return os.path.join(home, "bonds.json")


def mint_rappid(
    home: str,
    parent_commit: Optional[str] = None,
    owner: Optional[str] = None,
) -> dict:
    """Mint ~/.brainstem/rappid.json if missing. Idempotent.

    Returns the rappid dict (existing or freshly-minted). Includes the
    parent_commit (the framework SHA at hatching time) when known so the
    organism's lineage points at the exact upstream snapshot it was born
    from. Re-running this is a no-op once an identity exists — the egg
    is the only thing that should ever overwrite it.
    """
    os.makedirs(home, exist_ok=True)
    path = _rappid_path(home)
    existing = _read_json(path)
    if existing and existing.get("rappid"):
        if existing.get("schema") != rapp.SPEC or not rapp.rappid_valid(
            existing.get("rappid")
        ):
            raise ValueError(
                "existing rappid.json is not emit-safe RAPP/1; migrate it before packing"
            )
        return existing

    name = _organism_slug()
    owner = rapp.require_owner(owner, default="kody-w")
    data = {
        "schema": rapp.SPEC,
        "rappid": rapp.mint_rappid(owner, name),
        "parent_rappid": SPECIES_ROOT_RAPPID,
        "parent_repo": "github.com/kody-w/RAPP",
        "parent_commit": parent_commit or "",
        "born_at": _now_iso(),
        "kind": "brainstem-instance",
        "name": name,
        "host": _short_host(),
        "platform": platform.system().lower(),
        "incarnations": 1,
        "_note": (
            "Locally-hatched digital organism. Identity is preserved across "
            "kernel upgrades by the egg/hatch bonding cycle — the kernel "
            "evolves under the organism, not the other way around."
        ),
    }
    _write_json(path, data)
    return data


def bump_incarnations(home: str) -> int:
    """Increment incarnations counter after a successful bond. Returns new count."""
    path = _rappid_path(home)
    data = _read_json(path)
    if not data:
        return 0
    data["incarnations"] = int(data.get("incarnations", 1)) + 1
    _write_json(path, data)
    return data["incarnations"]


def record_bond(home: str, kind: str,
                from_version: Optional[str] = None,
                to_version: Optional[str] = None,
                from_commit: Optional[str] = None,
                to_commit: Optional[str] = None,
                note: Optional[str] = None) -> dict:
    """Append an event to ~/.brainstem/bonds.json. Returns the event dict.

    Event kinds:
      birth       — fresh install on this machine
      bond        — kernel upgrade-in-place (egg → overlay → hatch)
      adoption    — legacy install detected, identity minted retroactively
      hatch       — egg arrived from another machine and was applied
    """
    os.makedirs(home, exist_ok=True)
    path = _bonds_path(home)
    data = _read_json(path) or {"events": []}
    if "events" not in data or not isinstance(data["events"], list):
        data["events"] = []
    event = {
        "at": _now_iso(),
        "kind": kind,
        "from_version": from_version or None,
        "to_version": to_version or None,
        "from_commit": from_commit or None,
        "to_commit": to_commit or None,
        "note": note or None,
    }
    data["events"].append(event)
    _write_json(path, data)
    return event


# ── egg / hatch ──────────────────────────────────────────────────────────

def _collect_subtree(src_dir: str, arcname_prefix: str) -> dict[str, bytes]:
    """Collect every non-excluded file under a deterministic POSIX prefix."""
    if not os.path.isdir(src_dir):
        return {}
    collected: dict[str, bytes] = {}
    for root, dirs, files in os.walk(src_dir):
        dirs[:] = [d for d in dirs if d not in SECRETS_DIRS]
        for fname in sorted(files):
            if fname in INFRA_FILES:
                continue
            if fname in SECRETS_FILES:
                continue
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, src_dir).replace(os.sep, "/")
            if _excluded(rel):
                continue
            with open(full, "rb") as handle:
                collected[f"{arcname_prefix}/{rel}"] = handle.read()
    return collected


def _sanitize_env(env_text: str) -> str:
    """Strip secret values from a .env so the egg is shareable.

    Keys are kept (so the destination knows the shape), but the values
    of anything that smells like a credential are blanked. The user re-
    enters their own credentials on the destination machine.
    """
    out_lines = []
    secret_re = re.compile(
        r"^\s*(?P<k>[A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASS|CREDENTIAL|PAT|API_KEY))\s*=",
        re.IGNORECASE,
    )
    for line in env_text.splitlines():
        if secret_re.match(line):
            key = line.split("=", 1)[0]
            out_lines.append(f"{key}=")
        else:
            out_lines.append(line)
    return "\n".join(out_lines) + ("\n" if env_text.endswith("\n") else "")


def pack_organism(home: str, src: str, kernel_version: str) -> bytes:
    """Pack a full brainstem instance as a deterministic RAPP/1 organism egg."""
    if not os.path.isdir(src):
        raise FileNotFoundError(f"brainstem src not found: {src}")
    identity = _read_json(_rappid_path(home)) or {}
    if identity.get("schema") != rapp.SPEC or not rapp.rappid_valid(
        identity.get("rappid")
    ):
        raise ValueError("home/rappid.json must contain an emit-safe RAPP/1 identity")

    files: dict[str, bytes] = {
        "rappid.json": (
            json.dumps(identity, indent=2, ensure_ascii=False) + "\n"
        ).encode("utf-8")
    }
    counts = {"agents": 0, "organs": 0, "senses": 0, "services": 0, "data": 0,
              "soul": 0, "env": 0, "rappid": 1}

    for fname in ORGANISM_TOP_FILES:
        full = os.path.join(src, fname)
        if not os.path.isfile(full):
            continue
        with open(full, "r", encoding="utf-8", errors="strict") as handle:
            contents = handle.read()
        if fname == ".env":
            contents = _sanitize_env(contents)
        files[fname] = contents.encode("utf-8")
        counts["soul" if fname == "soul.md" else "env"] = 1

    if "soul.md" not in files:
        raise ValueError("an organism egg requires src/soul.md")

    for arc_prefix, rel_path in ORGANISM_TREES.items():
        subtree = _collect_subtree(os.path.join(src, rel_path), arc_prefix)
        files.update(subtree)
        counts[arc_prefix] = len(subtree)

    payload = {
        "layout": "brainstem-instance",
        "kernel_version": kernel_version,
        "host": _short_host(),
        "parent_rappid": identity.get("parent_rappid"),
        "parent_repo": identity.get("parent_repo"),
        "incarnations_at_egg": identity.get("incarnations"),
        "counts": counts,
    }
    return rapp.pack_egg(
        VARIANT_ORGANISM,
        identity["rappid"],
        rapp.utc_now_ms(),
        files=files,
        payload=payload,
    )


# ── rapplication-scope packing ────────────────────────────────────────────
# A rapplication is an organism with smaller scope: one agent (+ its
# optional UI / organ / per-rapp state) instead of a whole brainstem
# instance. Same egg layout as an organism egg, just a tighter include
# set. The unification: rapps and organisms are the same kind of thing
# at different scales (see pages/vault/Architecture/Rapplications Are Organisms.md).

def pack_rapplication(src: str, rapp_id: str,
                      agent_filename: Optional[str] = None,
                      organ_filename: Optional[str] = None,
                      include_state: bool = True,
                      include_ui: bool = True,
                      name: Optional[str] = None,
                      version: str = "0.0.0",
                      publisher: str = "@kody-w",
                      parent_rappid: Optional[str] = None,
                      soul_filename: Optional[str] = None,
                      artifact_rappid: Optional[str] = None,
                      born_at: Optional[str] = None,
                      created_utc: Optional[str] = None) -> bytes:
    """Pack one rapp as a deterministic RAPP/1 rapplication egg."""
    if not os.path.isdir(src):
        raise FileNotFoundError(f"brainstem src not found: {src}")
    if not rapp.lclabel_valid(rapp_id, 100):
        raise ValueError("rapp_id must be a lowercase RAPP label")
    owner = rapp.require_owner(publisher, default="kody-w")
    identity_path = os.path.join(
        src, ".brainstem_data", rapp_id, "rappid.json"
    )
    existing = _read_json(identity_path)
    if artifact_rappid is not None:
        if not rapp.rappid_valid(artifact_rappid):
            raise ValueError("artifact_rappid is not valid RAPP/1")
        if existing and existing.get("rappid") not in (None, artifact_rappid):
            raise ValueError("artifact_rappid conflicts with the stored rapp identity")
        rapp_rappid = artifact_rappid
    elif existing and existing.get("schema") == rapp.SPEC and rapp.rappid_valid(
        existing.get("rappid")
    ):
        rapp_rappid = existing["rappid"]
    else:
        rapp_rappid = rapp.mint_rappid(owner, rapp_id)

    identity = {
        "schema": rapp.SPEC,
        "rappid": rapp_rappid,
        "parent_rappid": parent_rappid or SPECIES_ROOT_RAPPID,
        "kind": "rapplication",
        "name": name or rapp_id,
        "version": version,
        "publisher": f"@{owner}",
        "rapp_id": rapp_id,
        "born_at": (existing or {}).get("born_at") or born_at or rapp.utc_now_ms(),
    }
    _write_json(identity_path, identity)

    if not agent_filename:
        raise ValueError("a RAPP/1 rapplication requires agent_filename")
    agent_path = os.path.join(src, "agents", agent_filename)
    if not os.path.isfile(agent_path):
        raise FileNotFoundError(f"rapplication agent not found: {agent_path}")

    files: dict[str, bytes] = {
        "rappid.json": (
            json.dumps(identity, indent=2, ensure_ascii=False) + "\n"
        ).encode("utf-8")
    }
    counts = {"agent": 0, "organ": 0, "ui": 0, "data": 0, "soul": 0}
    with open(agent_path, "rb") as handle:
        files["agent.py"] = handle.read()
    counts["agent"] = 1

    if soul_filename:
        soul_path = os.path.join(src, soul_filename)
        if os.path.isfile(soul_path):
            with open(soul_path, "rb") as handle:
                files["soul.md"] = handle.read()
            counts["soul"] = 1

    if organ_filename:
        organ_path = os.path.join(src, "utils", "organs", organ_filename)
        if os.path.isfile(organ_path):
            with open(organ_path, "rb") as handle:
                files[f"src/organs/{organ_filename}"] = handle.read()
            counts["organ"] = 1

    ui_filename = None
    if include_ui:
        ui_dir = os.path.join(src, ".brainstem_data", "rapp_ui", rapp_id)
        index_path = os.path.join(ui_dir, "index.html")
        if os.path.isfile(index_path):
            with open(index_path, "rb") as handle:
                files["ui.html"] = handle.read()
            ui_filename = "index.html"
            counts["ui"] += 1
        if os.path.isdir(ui_dir):
            for path, octets in _collect_subtree(ui_dir, "state/ui").items():
                if path == "state/ui/index.html":
                    continue
                files[path] = octets
                counts["ui"] += 1

    if include_state:
        state_dir = os.path.join(src, ".brainstem_data", rapp_id)
        for path, octets in _collect_subtree(state_dir, "state").items():
            if path in {
                "state/rappid.json",
                "state/artifact-rappid.json",
            }:
                continue
            files[path] = octets
            counts["data"] += 1

    payload = {
        "layout": "rapplication",
        "rapp_id": rapp_id,
        "name": name or rapp_id,
        "version": version,
        "publisher": f"@{owner}",
        "agent_filename": agent_filename,
        "organ_filename": organ_filename,
        "ui_filename": ui_filename,
        "has_skin": "ui.html" in files,
        "counts": counts,
    }
    return rapp.pack_egg(
        VARIANT_RAPPLICATION,
        rapp_rappid,
        created_utc or rapp.utc_now_ms(),
        files=files,
        payload=payload,
    )


def _instance_identity(
    artifact_identity: dict,
    egg_hash: str,
    owner: Optional[str],
) -> dict:
    artifact_rappid = artifact_identity["rappid"]
    parts = rapp.rappid_parts(artifact_rappid)
    owner = rapp.require_owner(owner, default="kody-w")
    slug = rapp.slugify(f"{parts['slug']}-instance")
    return {
        "schema": rapp.SPEC,
        "rappid": rapp.mint_rappid(owner, slug),
        "artifact_rappid": artifact_rappid,
        "grown_from": egg_hash,
        "born_at": rapp.utc_now_ms(),
        "kind": "instance",
        "name": artifact_identity.get("name") or parts["slug"],
    }


def _write_bytes(target: str, octets: bytes, errors: list[str]) -> bool:
    try:
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as handle:
            handle.write(octets)
        return True
    except OSError as exc:
        errors.append(f"{target}: {exc}")
        return False


def unpack_rapplication(
    blob: bytes,
    src: str,
    overwrite_state: bool = False,
    *,
    instance_owner: Optional[str] = None,
    signature_verifier=None,
) -> dict:
    """Verify and install one rapplication, minting identity only on first install."""
    details = rapp.inspect_egg(blob, signature_verifier=signature_verifier)
    manifest, files = details["manifest"], details["files"]
    if manifest["variant"] != VARIANT_RAPPLICATION:
        raise ValueError("egg is not a rapplication")
    payload = manifest["payload"]
    rapp_id = payload.get("rapp_id")
    if not rapp.lclabel_valid(rapp_id, 100):
        raise ValueError("rapplication payload has no valid rapp_id")
    os.makedirs(src, exist_ok=True)

    artifact_identity = rapp.strict_json_loads(files["rappid.json"])
    data_dir = os.path.join(src, ".brainstem_data", rapp_id)
    instance_path = os.path.join(data_dir, "rappid.json")
    artifact_path = os.path.join(data_dir, "artifact-rappid.json")
    existing = _read_json(instance_path)
    if existing and existing.get("schema") == rapp.SPEC and rapp.rappid_valid(
        existing.get("rappid")
    ):
        instance_identity = existing
    else:
        instance_identity = _instance_identity(
            artifact_identity, details["egg_hash"], instance_owner
        )

    restored = {
        "agent": 0,
        "organ": 0,
        "ui": 0,
        "data": 0,
        "soul": 0,
        "rappid": 0,
        "skipped": 0,
    }
    errors: list[str] = []
    _write_bytes(artifact_path, files["rappid.json"], errors)
    _write_json(instance_path, instance_identity)
    restored["rappid"] = 1

    agent_filename = payload.get("agent_filename") or f"{rapp_id}_agent.py"
    if _write_bytes(
        os.path.join(src, "agents", os.path.basename(agent_filename)),
        files["agent.py"],
        errors,
    ):
        restored["agent"] = 1
    if "soul.md" in files and _write_bytes(
        os.path.join(data_dir, "soul.md"), files["soul.md"], errors
    ):
        restored["soul"] = 1
    if "ui.html" in files and _write_bytes(
        os.path.join(src, ".brainstem_data", "rapp_ui", rapp_id, "index.html"),
        files["ui.html"],
        errors,
    ):
        restored["ui"] += 1

    for path, octets in files.items():
        if path.startswith("src/organs/"):
            rel = path[len("src/organs/"):]
            if _write_bytes(os.path.join(src, "utils", "organs", rel), octets, errors):
                restored["organ"] += 1
        elif path.startswith("state/ui/"):
            rel = path[len("state/ui/"):]
            if _write_bytes(
                os.path.join(src, ".brainstem_data", "rapp_ui", rapp_id, rel),
                octets,
                errors,
            ):
                restored["ui"] += 1
        elif path.startswith("state/"):
            rel = path[len("state/"):]
            target = os.path.join(data_dir, rel)
            if os.path.exists(target) and not overwrite_state:
                restored["skipped"] += 1
            elif _write_bytes(target, octets, errors):
                restored["data"] += 1

    return {
        "ok": not errors,
        "restored": restored,
        "errors": errors,
        "manifest": manifest,
        "rapp_id": rapp_id,
        "artifact_rappid": manifest["rappid"],
        "instance_rappid": instance_identity["rappid"],
        "grown_from": instance_identity.get("grown_from"),
        "egg_hash": details["egg_hash"],
    }


def unpack_organism(
    blob: bytes,
    home: str,
    src: str,
    preserve_instance_identity: bool = False,
    *,
    instance_owner: Optional[str] = None,
    signature_verifier=None,
) -> dict:
    """Verify and hatch an organism without conflating artifact and instance IDs."""
    details = rapp.inspect_egg(blob, signature_verifier=signature_verifier)
    manifest, files = details["manifest"], details["files"]
    if manifest["variant"] != VARIANT_ORGANISM:
        raise ValueError("egg is not an organism")
    if manifest["payload"].get("layout") not in (None, "brainstem-instance"):
        raise ValueError("organism layout must be materialized by its matching consumer")
    os.makedirs(home, exist_ok=True)
    os.makedirs(src, exist_ok=True)

    restored = {"rappid": 0, "soul": 0, "env": 0,
                "agents": 0, "organs": 0, "senses": 0, "services": 0,
                "data": 0, "skipped": 0}
    errors: list[str] = []
    artifact_identity = rapp.strict_json_loads(files["rappid.json"])
    identity_path = _rappid_path(home)
    existing = _read_json(identity_path)
    if preserve_instance_identity:
        if not (
            existing
            and existing.get("schema") == rapp.SPEC
            and rapp.rappid_valid(existing.get("rappid"))
        ):
            raise ValueError("in-place bond requires an existing valid instance identity")
        instance_identity = existing
    else:
        instance_identity = _instance_identity(
            artifact_identity, details["egg_hash"], instance_owner
        )
        _write_bytes(
            os.path.join(home, "artifact-rappid.json"),
            files["rappid.json"],
            errors,
        )
        _write_json(identity_path, instance_identity)
        restored["rappid"] = 1

    subtree_dest = {
        "agents/": os.path.join(src, "agents"),
        "organs/": os.path.join(src, "utils", "organs"),
        "senses/": os.path.join(src, "utils", "senses"),
        "services/": os.path.join(src, "utils", "services"),
        "data/": os.path.join(src, ".brainstem_data"),
    }
    for path, octets in files.items():
        if path == "rappid.json":
            continue
        if path in ORGANISM_TOP_FILES:
            target = os.path.join(src, path)
            if path == ".env" and os.path.exists(target):
                restored["skipped"] += 1
            elif _write_bytes(target, octets, errors):
                restored["soul" if path == "soul.md" else "env"] += 1
            continue
        matched = False
        for prefix, dest_root in subtree_dest.items():
            if not path.startswith(prefix):
                continue
            rel = path[len(prefix):]
            target = os.path.join(dest_root, rel)
            if _write_bytes(target, octets, errors):
                restored[prefix.rstrip("/")] += 1
            matched = True
            break
        if not matched:
            restored["skipped"] += 1

    return {
        "ok": not errors,
        "restored": restored,
        "errors": errors,
        "manifest": manifest,
        "artifact_rappid": manifest["rappid"],
        "instance_rappid": instance_identity["rappid"],
        "grown_from": instance_identity.get("grown_from"),
        "egg_hash": details["egg_hash"],
    }


def inspect_egg(blob: bytes, *, signature_verifier=None) -> dict:
    """Verify an egg and return its canonical seven-member manifest."""
    return rapp.inspect_egg(
        blob, signature_verifier=signature_verifier
    )["manifest"]


# ── CLI ──────────────────────────────────────────────────────────────────

def _cmd_mint(args):
    data = mint_rappid(
        args.home,
        parent_commit=args.parent_commit,
        owner=args.owner,
    )
    print(json.dumps({"rappid": data.get("rappid"),
                      "born_at": data.get("born_at"),
                      "incarnations": data.get("incarnations")},
                     indent=2))


def _cmd_egg(args):
    blob = pack_organism(args.home, args.src, args.kernel_version)
    with open(args.output, "wb") as f:
        f.write(blob)
    size_kb = round(len(blob) / 1024, 1)
    print(json.dumps({"egg": args.output,
                      "size_kb": size_kb,
                      "kernel_version": args.kernel_version}, indent=2))


def _cmd_hatch(args):
    with open(args.egg, "rb") as f:
        blob = f.read()
    manifest = inspect_egg(blob)
    variant = manifest.get("variant")
    if variant == VARIANT_RAPPLICATION:
        result = unpack_rapplication(blob, args.src,
                                     overwrite_state=getattr(args, 'overwrite_state', False),
                                     instance_owner=args.owner)
    elif variant == VARIANT_ORGANISM:
        result = unpack_organism(blob, args.home, args.src,
                                 preserve_instance_identity=args.preserve_rappid,
                                 instance_owner=args.owner)
    else:
        result = {"ok": False, "errors": [f"unsupported variant: {variant!r}"]}
    print(json.dumps(result, indent=2))
    if not result.get("ok"):
        sys.exit(1)


def _cmd_pack_rapp(args):
    blob = pack_rapplication(
        args.src, args.rapp_id,
        agent_filename=args.agent,
        organ_filename=args.organ,
        include_state=not args.no_state,
        include_ui=not args.no_ui,
        name=args.name,
        version=args.version,
        publisher=args.publisher,
        soul_filename=args.soul,
        artifact_rappid=args.rappid,
    )
    with open(args.output, "wb") as f:
        f.write(blob)
    print(json.dumps({
        "egg": args.output,
        "size_kb": round(len(blob) / 1024, 1),
        "rappid": inspect_egg(blob).get("rappid"),
    }, indent=2))


def _cmd_record_bond(args):
    event = record_bond(args.home, args.kind,
                        from_version=args.from_version,
                        to_version=args.to_version,
                        from_commit=args.from_commit,
                        to_commit=args.to_commit,
                        note=args.note)
    print(json.dumps(event, indent=2))


def _cmd_bump(args):
    n = bump_incarnations(args.home)
    print(json.dumps({"incarnations": n}, indent=2))


def _cmd_inspect(args):
    with open(args.egg, "rb") as f:
        blob = f.read()
    print(json.dumps(inspect_egg(blob), indent=2))


def main(argv=None):
    p = argparse.ArgumentParser(prog="bond")
    sub = p.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("mint-rappid", help="Mint ~/.brainstem/rappid.json if missing")
    m.add_argument("home")
    m.add_argument("--parent-commit", default=None)
    m.add_argument("--owner", default=None,
                   help="Lowercase GitHub login (or set RAPP_OWNER)")
    m.set_defaults(func=_cmd_mint)

    e = sub.add_parser("egg", help="Pack the organism into a portable .egg")
    e.add_argument("home")
    e.add_argument("output")
    e.add_argument("--kernel-version", required=True)
    e.add_argument("--src", default=None,
                   help="brainstem src dir (default: <home>/src/rapp_brainstem)")
    e.set_defaults(func=lambda a: _cmd_egg(_with_src(a)))

    h = sub.add_parser("hatch", help="Hatch a .egg over the local kernel (auto-detects schema)")
    h.add_argument("home")
    h.add_argument("egg")
    h.add_argument("--src", default=None)
    h.add_argument("--owner", default=None,
                   help="Owner for a newly-created instance identity")
    h.add_argument("--preserve-rappid", action="store_true",
                   help="In-place bond: keep the existing instance identity")
    h.add_argument("--overwrite-state", action="store_true",
                   help="(rapplication eggs) Replace existing per-rapp state on conflict")
    h.set_defaults(func=lambda a: _cmd_hatch(_with_src(a)))

    pr = sub.add_parser("pack-rapp", help="Pack one RAPP/1 rapplication egg")
    pr.add_argument("src", help="brainstem src dir (e.g. ~/.brainstem/src/rapp_brainstem)")
    pr.add_argument("rapp_id", help="The rapp's id — also the dir name under .brainstem_data/rapp_ui/")
    pr.add_argument("output", help="Output .egg path")
    pr.add_argument("--agent", default=None, help="Filename under agents/ (e.g. bookfactory_agent.py)")
    pr.add_argument("--organ", default=None, help="Optional filename under utils/organs/")
    pr.add_argument("--soul", default=None, help="Optional rapp-specific soul.md path (relative to src)")
    pr.add_argument("--name", default=None)
    pr.add_argument("--version", default="0.0.0")
    pr.add_argument("--publisher", default="@kody-w")
    pr.add_argument("--rappid", default=None,
                    help="Pre-minted artifact RAPPID; otherwise reuse stored identity or mint once")
    pr.add_argument("--no-state", action="store_true", help="Skip the per-rapp state cartridge")
    pr.add_argument("--no-ui", action="store_true", help="Skip the UI bundle")
    pr.set_defaults(func=_cmd_pack_rapp)

    rb = sub.add_parser("record-bond", help="Append an event to bonds.json")
    rb.add_argument("home")
    rb.add_argument("kind", choices=["birth", "bond", "adoption", "hatch"])
    rb.add_argument("--from-version", default=None)
    rb.add_argument("--to-version", default=None)
    rb.add_argument("--from-commit", default=None)
    rb.add_argument("--to-commit", default=None)
    rb.add_argument("--note", default=None)
    rb.set_defaults(func=_cmd_record_bond)

    b = sub.add_parser("bump-incarnations",
                       help="Increment incarnations counter in rappid.json")
    b.add_argument("home")
    b.set_defaults(func=_cmd_bump)

    i = sub.add_parser("inspect", help="Print an egg's manifest without unpacking")
    i.add_argument("egg")
    i.set_defaults(func=_cmd_inspect)

    args = p.parse_args(argv)
    args.func(args)


def _with_src(args):
    if args.src is None:
        args.src = os.path.join(args.home, "src", "rapp_brainstem")
    return args


if __name__ == "__main__":
    main()
