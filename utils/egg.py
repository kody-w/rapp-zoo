"""Adapters that map brainstem layouts onto the single RAPP/1 egg format.

Packing delegates canonicalization, identity validation, deterministic ZIP
serialization, and verification to ``rapp_protocol``. Normal consumers refuse
retired egg schemas rather than silently repairing or reparenting them.
"""

from __future__ import annotations

import json
import os
import pathlib
import re
import secrets
import time
from typing import Optional

try:
    from . import rapp_protocol as rapp
except ImportError:
    import rapp_protocol as rapp

# ── Paths (resolved relative to this file's brainstem root) ─────────────
# utils/egg.py lives at .../rapp_brainstem/utils/egg.py — two dirname
# walks reach the brainstem root.
_BRAINSTEM_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_AGENTS_DIR = os.path.join(_BRAINSTEM_ROOT, "agents")
_SERVICES_DIR = os.path.join(_BRAINSTEM_ROOT, "utils", "services")
_DATA_DIR = os.path.join(_BRAINSTEM_ROOT, ".brainstem_data")
_UI_BASE_DIR = os.path.join(_DATA_DIR, "rapp_ui")

EGG_SCHEMA = rapp.EGG_SCHEMA


class _EggCollector:
    def __init__(self):
        self.files: dict[str, bytes] = {}
        self.meta: dict = {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def writestr(self, name, data):
        octets = data.encode("utf-8") if isinstance(data, str) else data
        if name == "manifest.json":
            self.meta = json.loads(octets)
            return
        self.files[name] = octets

    def write(self, filename, arcname):
        with open(filename, "rb") as handle:
            self.files[arcname] = handle.read()


def _identity_octets(rappid: str, meta: dict, kind: str) -> bytes:
    identity = {
        "schema": rapp.SPEC,
        "rappid": rappid,
        "parent_rappid": meta.get("parent_rappid")
        or (meta.get("lineage") or {}).get("parent_rappid"),
        "kind": kind,
        "name": meta.get("name") or meta.get("id") or rapp.rappid_parts(rappid)["slug"],
    }
    return (json.dumps(identity, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def _finalize_egg(collector: _EggCollector, variant: str) -> bytes:
    meta = dict(collector.meta)
    files = dict(collector.files)
    rid = meta.get("rappid") or (meta.get("source") or {}).get("rappid_uuid")
    if not rapp.rappid_valid(rid):
        raise ValueError("egg producer requires a stored, valid RAPP/1 artifact identity")

    if variant == "rapplication":
        candidates = [
            path
            for path in sorted(files)
            if path.endswith("_agent.py") or path.split("/")[-1] == "agent.py"
        ]
        if len(candidates) != 1:
            raise ValueError("rapplication requires exactly one source agent")
        files["agent.py"] = files.pop(candidates[0])
        for path in list(files):
            if path.startswith("rapp_ui/") and path.endswith("/index.html"):
                files["ui.html"] = files.pop(path)
            elif path.startswith("rapp_ui/"):
                files["state/ui/" + path.split("/", 2)[-1]] = files.pop(path)
            elif path.startswith("data/"):
                parts = path.split("/", 2)
                files["state/" + (parts[2] if len(parts) > 2 else parts[-1])] = files.pop(path)
            elif path.startswith("services/"):
                files["src/" + path] = files.pop(path)
        files.setdefault("rappid.json", _identity_octets(rid, meta, "rapplication"))
    else:
        for path in list(files):
            if path.startswith("repo/"):
                stripped = path[len("repo/"):]
                if stripped in files:
                    raise ValueError(f"duplicate organism path after repo/ removal: {stripped}")
                files[stripped] = files.pop(path)
        files.setdefault("rappid.json", _identity_octets(rid, meta, "organism"))
        files.setdefault(
            "soul.md",
            f"# {meta.get('name') or rapp.rappid_parts(rid)['slug']}\n".encode("utf-8"),
        )

    payload = {
        key: value
        for key, value in meta.items()
        if key
        not in {
            "schema",
            "type",
            "rappid",
            "exported_at",
            "created_at",
            "created_utc",
        }
    }
    payload.setdefault("layout", "variant-repo" if variant == "organism" else "rapplication")
    return rapp.pack_egg(
        variant,
        rid,
        rapp.utc_now_ms(),
        files=files,
        payload=payload,
    )



# ── Artifact identities used when packing ───────────────────────────────
#
# These mint-once records name the packed artifact. RAPP/1 rev-6 requires a
# consumer to mint a separate live instance identity on each fresh hatch.

_IDENTITY_FILE = os.path.join(_DATA_DIR, "identity.json")


def _read_identity() -> dict:
    if not os.path.exists(_IDENTITY_FILE):
        return {"twin": None, "rapps": {}}
    try:
        with open(_IDENTITY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"twin": None, "rapps": {}}
        data.setdefault("twin", None)
        data.setdefault("rapps", {})
        return data
    except Exception:
        return {"twin": None, "rapps": {}}


def _write_identity(data: dict) -> None:
    os.makedirs(os.path.dirname(_IDENTITY_FILE), exist_ok=True)
    with open(_IDENTITY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _make_rappid(type_: str, publisher: str, slug: str) -> str:
    """Generate a fresh RAPPID. Called ONCE per organism, ever."""
    del type_
    owner = rapp.require_owner(publisher, default="kody-w")
    return rapp.mint_rappid(owner, rapp.slugify(slug or "unnamed"))


def get_or_create_twin_rappid(publisher: str = "@kody-w",
                              slug: str = "personal") -> str:
    """Return this brainstem's twin RAPPID, minting one on first call."""
    ident = _read_identity()
    if ident.get("twin"):
        if not rapp.rappid_valid(ident["twin"]):
            raise ValueError("stored twin identity is legacy; re-anchor it before emitting an egg")
        return ident["twin"]
    new = _make_rappid("twin", publisher, slug)
    ident["twin"] = new
    _write_identity(ident)
    return new


def get_or_create_rapp_rappid(rapp_id: str, publisher: str = "@kody-w") -> str:
    """Return a rapp's RAPPID, minting one on first call. Per-rapp scope."""
    ident = _read_identity()
    rapps = ident.setdefault("rapps", {})
    if rapps.get(rapp_id):
        if not rapp.rappid_valid(rapps[rapp_id]):
            raise ValueError(
                f"stored identity for {rapp_id} is legacy; re-anchor it before emitting an egg"
            )
        return rapps[rapp_id]
    new = _make_rappid("rapp", publisher, rapp_id)
    rapps[rapp_id] = new
    _write_identity(ident)
    return new


def parse_rappid(rappid: str) -> Optional[dict]:
    """Decompose a RAPPID string into its components, or None if invalid."""
    if not rapp.rappid_valid(rappid):
        return None
    parts = rapp.rappid_parts(rappid)
    return {
        "type": None,
        "publisher": f"@{parts['owner']}",
        "slug": parts["slug"],
        "entropy": parts["hash"],
        "rappid": rappid,
    }

# Filenames / paths that NEVER enter an egg, regardless of type
_NEVER_PACK = (
    ".copilot_token",
    ".copilot_session",
    "voice.zip",
    ".DS_Store",
    "Thumbs.db",
    # Runtime stream state is instance-local and is not part of the artifact.
    "stream.json",
)
_NEVER_PACK_DIRS = (
    "venv",
    "__pycache__",
    ".pytest_cache",
    "private",  # .brainstem_data/private/
)

# Agent files that ship as part of the brainstem core (not user-installed
# skills) and should not be re-packed in a snapshot — the destination
# brainstem already has them.
_CORE_AGENT_FILES = ("basic_agent.py",)


# ── Path safety ─────────────────────────────────────────────────────────

def _safe_join(base: str, rel: str) -> Optional[str]:
    """Return abs path under `base`, or None on traversal attempt."""
    if not rel or ".." in rel.split("/") or os.path.isabs(rel):
        return None
    target = os.path.abspath(os.path.join(base, rel))
    if not target.startswith(os.path.abspath(base) + os.sep) and target != os.path.abspath(base):
        return None
    return target


def _is_excluded(path_inside_brainstem: str) -> bool:
    """Skip secrets, environment artifacts, OS noise, private namespace."""
    parts = path_inside_brainstem.replace("\\", "/").split("/")
    if any(p in _NEVER_PACK for p in parts):
        return True
    if any(p in _NEVER_PACK_DIRS for p in parts):
        return True
    return False


# ── Pack helpers ────────────────────────────────────────────────────────

def _add_tree(z: _EggCollector, src_root: str, arcname_prefix: str,
              file_filter=None) -> int:
    """Recursively add src_root → arcname_prefix/<rel>. Returns file count."""
    if not os.path.isdir(src_root):
        return 0
    n = 0
    for root, _dirs, files in os.walk(src_root):
        # prune excluded directories so we don't even enter them
        _dirs[:] = [d for d in _dirs if not _is_excluded(d)]
        for fname in files:
            full = os.path.join(root, fname)
            rel_to_root = os.path.relpath(full, src_root).replace(os.sep, "/")
            if _is_excluded(rel_to_root) or _is_excluded(fname):
                continue
            if file_filter and not file_filter(rel_to_root):
                continue
            arcname = f"{arcname_prefix}/{rel_to_root}" if arcname_prefix else rel_to_root
            z.write(full, arcname)
            n += 1
    return n


def _bytes_size_kb(blob: bytes) -> float:
    return round(len(blob) / 1024, 1)


# ── Pack: rapplication ──────────────────────────────────────────────────

def pack_rapplication(rapp_id: str, agent_filename: str,
                      service_filename: Optional[str] = None,
                      ui_filename: Optional[str] = None,
                      version: str = "?", name: Optional[str] = None,
                      publisher: str = "@kody-w",
                      parent_rappid: Optional[str] = None) -> bytes:
    """Pack a single installed rapplication into an egg."""
    rappid = get_or_create_rapp_rappid(rapp_id, publisher=publisher)
    with _EggCollector() as z:
        # agent.py
        if agent_filename:
            agent_path = os.path.join(_AGENTS_DIR, agent_filename)
            if os.path.exists(agent_path):
                z.write(agent_path, f"agents/{agent_filename}")

        # service.py (optional)
        if service_filename:
            svc_path = os.path.join(_SERVICES_DIR, service_filename)
            if os.path.exists(svc_path):
                z.write(svc_path, f"services/{service_filename}")

        # ui bundle (optional)
        ui_dir = os.path.join(_UI_BASE_DIR, rapp_id)
        ui_count = _add_tree(z, ui_dir, f"rapp_ui/{rapp_id}")

        # state cartridge (optional) — .brainstem_data/<rapp_id>/...
        state_dir = os.path.join(_DATA_DIR, rapp_id)
        state_count = _add_tree(z, state_dir, f"data/{rapp_id}")

        manifest = {
            "schema": EGG_SCHEMA,
            "type": "rapplication",
            "rappid": rappid,
            "id": rapp_id,
            "name": name or rapp_id,
            "version": version,
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "agent_filename": agent_filename,
            "service_filename": service_filename,
            "ui_filename": ui_filename,
            "ui_file_count": ui_count,
            "state_file_count": state_count,
            "lineage": {
                "publisher": publisher,
                "parent_rappid": parent_rappid,
                "hatched_on": "rapp-brainstem",
            },
        }
        z.writestr("manifest.json", json.dumps(manifest, indent=2))

    return _finalize_egg(z, "organism" if manifest.get("type") in ("twin","organism",None) else "rapplication")


# ── Pack: twin ──────────────────────────────────────────────────────────
# A twin is the user-as-digital-organism: every installed agent + the
# cross-agent shared state (memory, chat tabs, soul) but NOT per-rapp
# state cartridges or rapp UI bundles. That's the "self" without the
# tooling. For tooling-included, use snapshot.

def pack_twin(twin_id: str, name: Optional[str] = None,
              publisher: str = "@kody-w",
              parent_rappid: Optional[str] = None) -> bytes:
    """Pack the brainstem's agent set + cross-agent state into a twin egg.

    The stored RAPPID names the resulting artifact. A fresh hatch mints a
    separate instance RAPPID and records this egg's address in grown_from.
    """
    rappid = get_or_create_twin_rappid(publisher=publisher, slug=twin_id)
    ident = _read_identity()
    egg_exports = int(ident.get("egg_exports", 0)) + 1
    ident["egg_exports"] = egg_exports
    _write_identity(ident)

    agent_count = 0
    state_count = 0
    with _EggCollector() as z:
        # All user-installed agents (skip core)
        if os.path.isdir(_AGENTS_DIR):
            for fname in sorted(os.listdir(_AGENTS_DIR)):
                if fname in _CORE_AGENT_FILES:
                    continue
                if not fname.endswith(".py"):
                    continue
                full = os.path.join(_AGENTS_DIR, fname)
                if os.path.isfile(full):
                    z.write(full, f"agents/{fname}")
                    agent_count += 1

        # Cross-agent state — top-level files in .brainstem_data/
        # (not subdirectories, which are per-rapp state cartridges)
        if os.path.isdir(_DATA_DIR):
            for fname in sorted(os.listdir(_DATA_DIR)):
                full = os.path.join(_DATA_DIR, fname)
                if not os.path.isfile(full):
                    continue
                if _is_excluded(fname):
                    continue
                z.write(full, f"data/{fname}")
                state_count += 1

        manifest = {
            "schema": EGG_SCHEMA,
            "type": "twin",
            "rappid": rappid,
            "id": twin_id,
            "name": name or twin_id,
            "version": "1.0.0",
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "agent_count": agent_count,
            "state_file_count": state_count,
            "lineage": {
                "publisher": publisher,
                "parent_rappid": parent_rappid,
                "hatched_on": "rapp-brainstem",
                "egg_exports": egg_exports,
            },
        }
        z.writestr("manifest.json", json.dumps(manifest, indent=2))

    return _finalize_egg(z, "organism" if manifest.get("type") in ("twin","organism",None) else "rapplication")


# ── Pack: snapshot ──────────────────────────────────────────────────────
# Snapshot is a full dump: every agent, every service, every rapp UI,
# every state cartridge. The destination brainstem becomes a clone
# (modulo secrets and env).

def pack_snapshot(snapshot_id: str, name: Optional[str] = None,
                  publisher: str = "@kody-w",
                  parent_rappid: Optional[str] = None) -> bytes:
    """Pack the entire brainstem (sans secrets/env) into a snapshot egg.

    The source identity names the artifact. Every fresh installation still
    receives its own instance identity under RAPP/1 §9.4.
    """
    twin_rappid = get_or_create_twin_rappid(publisher=publisher, slug=snapshot_id)
    counts = {"agents": 0, "services": 0, "ui": 0, "data": 0}
    with _EggCollector() as z:
        # All agents (incl. core — destination might not have them)
        if os.path.isdir(_AGENTS_DIR):
            for fname in sorted(os.listdir(_AGENTS_DIR)):
                if not fname.endswith(".py"):
                    continue
                full = os.path.join(_AGENTS_DIR, fname)
                if os.path.isfile(full):
                    z.write(full, f"agents/{fname}")
                    counts["agents"] += 1

        # All services
        if os.path.isdir(_SERVICES_DIR):
            for fname in sorted(os.listdir(_SERVICES_DIR)):
                if not fname.endswith(".py"):
                    continue
                full = os.path.join(_SERVICES_DIR, fname)
                if os.path.isfile(full):
                    z.write(full, f"services/{fname}")
                    counts["services"] += 1

        # All rapp UI bundles
        counts["ui"] = _add_tree(z, _UI_BASE_DIR, "rapp_ui")

        # All .brainstem_data — recursively, with exclusions
        counts["data"] = _add_tree(z, _DATA_DIR, "data",
                                   file_filter=lambda rel: not _is_excluded(rel))

        manifest = {
            "schema": EGG_SCHEMA,
            "type": "snapshot",
            "rappid": twin_rappid,
            "id": snapshot_id,
            "name": name or snapshot_id,
            "version": "1.0.0",
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "agent_count": counts["agents"],
            "service_count": counts["services"],
            "ui_file_count": counts["ui"],
            "state_file_count": counts["data"],
            "lineage": {
                "publisher": publisher,
                "parent_rappid": parent_rappid,
                "hatched_on": "rapp-brainstem",
            },
        }
        z.writestr("manifest.json", json.dumps(manifest, indent=2))

    return _finalize_egg(z, "organism" if manifest.get("type") in ("twin","organism",None) else "rapplication")


# ── Unpack ──────────────────────────────────────────────────────────────

def is_egg_blob(blob: bytes) -> bool:
    """Return whether bytes parse as one of the six RAPP/1 egg variants."""
    try:
        rapp.read_egg(blob)
        return True
    except (rapp.ProtocolError, ValueError):
        return False


def unpack(blob: bytes, mode: str = "merge") -> dict:
    """Verify an egg and install a rapplication into this brainstem."""
    del mode
    try:
        verifier = rapp.signature_verifier_from_environment()
        details = rapp.inspect_egg(blob, signature_verifier=verifier)
    except (OSError, rapp.ProtocolError) as exc:
        return {"ok": False, "error": str(exc)}
    manifest = details["manifest"]
    if manifest["variant"] != "rapplication":
        return {
            "ok": False,
            "error": (
                f"variant {manifest['variant']!r} is valid but cannot be installed "
                "into an already-running brainstem"
            ),
            "manifest": manifest,
        }
    try:
        try:
            from . import bond
        except ImportError:
            import bond

        return bond.unpack_rapplication(
            blob,
            _BRAINSTEM_ROOT,
            instance_owner=os.environ.get("RAPP_OWNER"),
            signature_verifier=verifier,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc), "manifest": manifest}


# ── Convenience: introspect without unpacking ───────────────────────────

def inspect(blob: bytes) -> dict:
    """Verify and inspect an egg without extracting it."""
    try:
        details = rapp.inspect_egg(
            blob,
            signature_verifier=rapp.signature_verifier_from_environment(),
        )
        return {
            "ok": True,
            "manifest": details["manifest"],
            "egg_hash": details["egg_hash"],
        }
    except (OSError, rapp.ProtocolError) as exc:
        return {"ok": False, "error": str(exc)}


# ── Variant-repo organism eggs ──────────────────────────────────────────
#
# A variant-repo egg captures the entire local-first twin layout: the
# kernel snapshot at root, the agents dir, utils, installer, content
# files (soul.md, MANIFEST.md, README.md, LICENSE, vbrainstem.html), and
# .brainstem_data state. The egg is self-sufficient — it can materialize
# the twin onto any host with just a kernel runtime, no upstream fetch
# required (though the manifest carries source pointers for verification
# and optional re-sync).
#
# This is the cartridge the user names "rappid.egg" — pack on device A,
# transport, summon on device B with a vanilla brainstem, twin appears.

# Top-level files at the variant-repo root that are part of the organism
# and must travel in the egg. Anything else at root is excluded unless
# explicitly listed.
_REPO_ROOT_FILES = {
    "brainstem.py",       # kernel snapshot
    "rappid.json",        # lineage anchor + brainstem pin
    "soul.md",            # voice
    "MANIFEST.md",        # vision doc
    "README.md",          # public-facing intro
    "LICENSE",            # license posture
    "SUMMON.md",          # summon URL convention
    "TEMPLATE.md",        # template usage doc
    "index.html",         # GitHub Pages landing
    "vbrainstem.html",    # browser simulator
    "summon.svg",         # QR code
    ".gitignore",
}

# Subdirectories at the variant-repo root that travel as full trees.
_REPO_ROOT_DIRS = ("agents", "utils", "installer", "app")

# Path pieces that are NEVER packed (mirror _NEVER_PACK_DIRS but applied
# to the variant-repo tree, not the brainstem-instance tree).
_REPO_NEVER_DIRS = ("__pycache__", ".pytest_cache", "venv", ".git", "node_modules")
_REPO_NEVER_FILES = (".DS_Store", "Thumbs.db", ".env", ".env.local")


def _is_repo_excluded(rel_path: str) -> bool:
    parts = rel_path.replace("\\", "/").split("/")
    if any(p in _REPO_NEVER_DIRS for p in parts):
        return True
    if any(p in _REPO_NEVER_FILES for p in parts):
        return True
    if "private" in parts:
        # .brainstem_data/private/ — explicit no-share
        return True
    return False


def _walk_repo_tree(src: str, arc_prefix: str, z: _EggCollector) -> int:
    """Add every non-excluded file under src to the zip at arc_prefix/. Returns count."""
    if not os.path.isdir(src):
        return 0
    n = 0
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if d not in _REPO_NEVER_DIRS]
        for fn in files:
            if fn in _REPO_NEVER_FILES:
                continue
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, src).replace(os.sep, "/")
            if _is_repo_excluded(rel):
                continue
            z.write(full, f"{arc_prefix}/{rel}" if arc_prefix else rel)
            n += 1
    return n


def pack_twin_from_repo(repo_path: str,
                        bundled_repo: bool = True,
                        bundled_state: bool = True,
                        attestation: Optional[dict] = None) -> bytes:
    """Pack a hatched variant repo into a RAPP/1 organism egg.

    Layout produced inside the zip:
        manifest.json                  — schema 2.1, source + brainstem pin
        repo/<rel>                     — the variant-repo tree (if bundled_repo)
        data/<rel>                     — .brainstem_data tree (if bundled_state)

    The repo MUST have rappid.json at its root and SHOULD have brainstem.py
    + an agents/ dir + a utils/ dir. Unbundled fields are recorded in the
    manifest but their tree is omitted (smaller egg, requires online fetch
    on summon — not implemented yet, reserved).
    """
    repo = os.path.abspath(repo_path)
    rappid_json_path = os.path.join(repo, "rappid.json")
    if not os.path.exists(rappid_json_path):
        raise ValueError(f"no rappid.json at {repo} — not a variant repo")

    with open(rappid_json_path, "r", encoding="utf-8") as f:
        rj = json.load(f)

    rappid_uuid = rj.get("rappid")
    if not rappid_uuid:
        raise ValueError("rappid.json has no 'rappid' field")

    bs_block = rj.get("brainstem") or {}

    with _EggCollector() as z:
        repo_files = 0
        data_files = 0

        if bundled_repo:
            # Top-level files at root
            for fname in _REPO_ROOT_FILES:
                full = os.path.join(repo, fname)
                if os.path.exists(full) and os.path.isfile(full):
                    z.write(full, f"repo/{fname}")
                    repo_files += 1
            # Subdirs as full trees
            for d in _REPO_ROOT_DIRS:
                src = os.path.join(repo, d)
                repo_files += _walk_repo_tree(src, f"repo/{d}", z)

        if bundled_state:
            data_src = os.path.join(repo, ".brainstem_data")
            data_files = _walk_repo_tree(data_src, "data", z)

        manifest = {
            "schema": EGG_SCHEMA,
            "type": "twin",
            "rappid": rappid_uuid,
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": {
                "rappid_uuid": rappid_uuid,
                "parent_rappid_uuid": rj.get("parent_rappid"),
                "repo": rj.get("parent_repo"),
                "commit": rj.get("parent_commit"),
                "name": rj.get("name"),
            },
            "brainstem": {
                "version": bs_block.get("version"),
                "source_repo": bs_block.get("source_repo"),
                "source_commit": bs_block.get("source_commit"),
            },
            "bundled_repo": bool(bundled_repo),
            "bundled_state": bool(bundled_state),
            "repo_file_count": repo_files,
            "data_file_count": data_files,
            "attestation": attestation or rj.get("attestation"),
            "size_kb_approx": None,  # filled below
        }
        z.writestr("manifest.json", json.dumps(manifest, indent=2))

    return _finalize_egg(z, "organism")


def summon_twin_egg(
    blob: bytes,
    host_root: str,
    keep_existing_kernel: bool = False,
    *,
    instance_owner: Optional[str] = None,
    existing_workspace: Optional[str] = None,
    signature_verifier=None,
) -> str:
    """Hatch a variant-repo organism with a fresh instance identity.

    Passing ``existing_workspace`` performs an in-place bond and preserves that
    workspace's existing instance identity.
    """
    details = rapp.inspect_egg(blob, signature_verifier=signature_verifier)
    manifest, files = details["manifest"], details["files"]
    if manifest["variant"] != "organism":
        raise ValueError("only organism eggs can be summoned as standalone twins")
    if manifest["payload"].get("layout") not in (None, "variant-repo"):
        raise ValueError("this organism egg uses the brainstem-instance layout")

    host = os.path.abspath(host_root)
    os.makedirs(host, exist_ok=True)
    if existing_workspace:
        workspace = os.path.abspath(existing_workspace)
        os.makedirs(workspace, exist_ok=True)
        instance_path = os.path.join(workspace, "rappid.json")
        try:
            existing_identity = json.loads(pathlib.Path(instance_path).read_text())
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("in-place bond requires an existing instance identity") from exc
        if existing_identity.get("schema") != rapp.SPEC or not rapp.rappid_valid(
            existing_identity.get("rappid")
        ):
            raise ValueError("in-place bond found a non-RAPP/1 instance identity")
        instance_identity = existing_identity
    else:
        workspace = os.path.join(host, secrets.token_hex(16))
        os.makedirs(workspace, exist_ok=False)
        artifact_identity = rapp.strict_json_loads(files["rappid.json"])
        parts = rapp.rappid_parts(manifest["rappid"])
        owner = rapp.require_owner(instance_owner, default="kody-w")
        instance_identity = {
            "schema": rapp.SPEC,
            "rappid": rapp.mint_rappid(
                owner, rapp.slugify(f"{parts['slug']}-instance")
            ),
            "artifact_rappid": manifest["rappid"],
            "grown_from": details["egg_hash"],
            "born_at": rapp.utc_now_ms(),
            "kind": "instance",
            "name": artifact_identity.get("name") or parts["slug"],
        }
        pathlib.Path(workspace, "artifact-rappid.json").write_bytes(
            files["rappid.json"]
        )

    preserved_kernel: Optional[bytes] = None
    kernel_path = os.path.join(workspace, "brainstem.py")
    if keep_existing_kernel and os.path.isfile(kernel_path):
        with open(kernel_path, "rb") as handle:
            preserved_kernel = handle.read()

    for path, octets in files.items():
        if path == "rappid.json":
            continue
        if path.startswith("data/"):
            target = _safe_join(
                os.path.join(workspace, ".brainstem_data"),
                path[len("data/"):],
            )
        else:
            target = _safe_join(workspace, path)
        if target is None:
            raise ValueError(f"verified egg path could not be materialized: {path}")
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as handle:
            handle.write(octets)

    if keep_existing_kernel and preserved_kernel is not None:
        with open(kernel_path, "wb") as handle:
            handle.write(preserved_kernel)
    pathlib.Path(workspace, "rappid.json").write_text(
        json.dumps(instance_identity, indent=2, ensure_ascii=False) + "\n"
    )
    return workspace
