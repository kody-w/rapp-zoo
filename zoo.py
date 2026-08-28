"""
zoo.py — local-first Pokédex for digital organisms.

A single small Flask process at localhost:7070 (configurable). Sits
above the per-twin brainstems; never replaces them. The zoo's job is
to list, pack, verify, summon, bond, start, stop, IMPORT, and EXPORT
RAPP/1 artifacts and instances on this device.

Design constraints:
- Local-first: reads ~/.config/rapp/peers.json + ~/.rapp/{eggs,twins}/.
  No cloud API, no telemetry, no auth (bound to localhost).
- Stateless: source of truth lives in peer_registry + filesystem.
  The zoo doesn't keep its own database; restart at any time.
- One file: zoo.py is the entire app. The UI is static/. Vendored
  utils/{egg,peer_registry,bond}.py are the only code dependencies.
- Pure stdlib + flask: nothing else.

Routes:
    GET  /                          → the zoo UI (static/index.html)
    GET  /static/<path>             → static assets
    GET  /starters/dist/<path>      → bundled starter .egg downloads

    GET  /api/health                → zoo liveness + per-twin liveness
    GET  /api/twins                 → list grouped by rappid
    GET  /api/eggs                  → list local egg backups
    GET  /api/eggs/manifest         → peek a single egg's manifest
                                      body: { egg_path }
    GET  /api/starters              → list bundled starter rapplications
    GET  /api/discover              → upstream rapp_store URL + (future) cache

    POST /api/import-egg            → multipart upload of a .egg file →
                                      saves to ~/.rapp/eggs/imported/
                                      body: multipart with 'egg' file
    GET  /api/export-egg            → stream an existing egg back as
                                      a download (Content-Disposition: attachment)
                                      query: ?path=<abs path inside ~/.rapp/eggs/>

    POST /api/lay-egg               → pack a twin's repo into a fresh egg
                                      body: { repo_path }
    POST /api/summon                → materialize an egg into a workspace
                                      body: { egg_path, host_root?, keep_existing_kernel? }
    POST /api/bond                  → in-place kernel update with identity preservation
                                      body: { instance_rappid, new_kernel }
    POST /api/hatch                 → compatibility alias for /api/bond
    POST /api/start                 → start a twin's brainstem
    POST /api/stop                  → stop a running twin
    POST /api/reveal                → open a workspace dir in the OS file manager
                                      body: { path }
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

from flask import Flask, jsonify, request, send_from_directory, abort


_HERE = os.path.dirname(os.path.abspath(__file__))
_UTILS_DIR = os.path.join(_HERE, "utils")
_STATIC_DIR = os.path.join(_HERE, "static")

# Vendored modules: egg.py + peer_registry.py + bond.py
sys.path.insert(0, _UTILS_DIR)
import egg                # noqa: E402
import peer_registry      # noqa: E402
import bond               # noqa: E402
import rapp_protocol      # noqa: E402


# ── Local file conventions ──────────────────────────────────────────────


def rapp_home() -> str:
    return os.environ.get("RAPP_HOME") or os.path.join(os.path.expanduser("~"), ".rapp")


def eggs_dir() -> str:
    return os.path.join(rapp_home(), "eggs")


def twins_dir() -> str:
    return os.path.join(rapp_home(), "twins")


def pids_dir() -> str:
    """Where we record zoo-started twin PIDs so /api/stop can find them."""
    return os.path.join(rapp_home(), "pids")


# ── Process control: track twins we started ────────────────────────────


def _pid_file(rappid_uuid: str) -> str:
    key = hashlib.sha256(rappid_uuid.encode("utf-8")).hexdigest()
    return os.path.join(pids_dir(), f"{key}.pid")


def _read_pid(rappid_uuid: str) -> int | None:
    path = _pid_file(rappid_uuid)
    if not os.path.exists(path):
        return None
    try:
        return int(pathlib.Path(path).read_text().strip())
    except (ValueError, OSError):
        return None


def _write_pid(rappid_uuid: str, pid: int) -> None:
    os.makedirs(pids_dir(), exist_ok=True)
    pathlib.Path(_pid_file(rappid_uuid)).write_text(str(pid))


def _clear_pid(rappid_uuid: str) -> None:
    path = _pid_file(rappid_uuid)
    if os.path.exists(path):
        try:
            os.remove(path)
        except OSError:
            pass


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False
    except OSError:
        return False


# ── Twin liveness probe ─────────────────────────────────────────────────


def _probe_health(port: int, timeout: float = 0.6) -> dict:
    if not port:
        return {"live": False}
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/health",
            headers={"User-Agent": "rapp-zoo"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", errors="replace")
            try:
                h = json.loads(body)
                return {"live": True, "version": h.get("version")}
            except Exception:
                return {"live": r.status == 200}
    except (urllib.error.URLError, OSError, TimeoutError):
        return {"live": False}


def _signature_verifier():
    return rapp_protocol.signature_verifier_from_environment()


def _verified_egg(blob: bytes) -> dict:
    return rapp_protocol.inspect_egg(
        blob,
        signature_verifier=_signature_verifier(),
    )


def _find_peer(instance_rappid: str) -> dict | None:
    for peer in peer_registry.load()["peers"]:
        if peer.get("instance_rappid") == instance_rappid:
            return peer
        if peer.get("rappid_uuid") == instance_rappid:
            return peer
    return None


# ── Flask app ───────────────────────────────────────────────────────────


def create_app() -> Flask:
    """Build the Flask app. Factory pattern so tests can spin up isolated apps."""
    app = Flask(__name__, static_folder=None)

    @app.route("/")
    def index():
        idx = os.path.join(_STATIC_DIR, "index.html")
        if os.path.exists(idx):
            return send_from_directory(_STATIC_DIR, "index.html")
        return jsonify({"name": "rapp-zoo", "status": "ok",
                        "note": "static/index.html missing"}), 200

    @app.route("/static/<path:rest>")
    def static_files(rest: str):
        full = os.path.normpath(os.path.join(_STATIC_DIR, rest))
        if not full.startswith(_STATIC_DIR + os.sep) and full != _STATIC_DIR:
            return abort(403)
        if not os.path.isfile(full):
            return abort(404)
        return send_from_directory(os.path.dirname(full), os.path.basename(full))

    @app.route("/manifest.webmanifest")
    def web_manifest():
        return send_from_directory(
            _STATIC_DIR,
            "manifest.webmanifest",
            mimetype="application/manifest+json",
        )

    @app.route("/sw.js")
    def service_worker():
        response = send_from_directory(
            _STATIC_DIR,
            "sw.js",
            mimetype="application/javascript",
        )
        response.headers["Service-Worker-Allowed"] = "/"
        return response

    @app.after_request
    def security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self' http://127.0.0.1:* http://localhost:* "
            "https://raw.githubusercontent.com; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
        )
        return response

    @app.route("/api/health")
    def health():
        peers = peer_registry.load()["peers"]
        live_count = sum(1 for p in peers if _probe_health(p.get("port") or 0)["live"])
        response = jsonify({
            "name": "rapp-zoo",
            "status": "ok",
            "rapp_home": rapp_home(),
            "peer_count": len(peers),
            "live_count": live_count,
            "schema": "rapp-zoo-health/1.0",
        })
        desktop_token = os.environ.get("RAPP_ZOO_DESKTOP_TOKEN")
        if desktop_token:
            response.headers["X-RAPP-Zoo-Desktop"] = desktop_token
        return response, 200

    @app.route("/api/intelligence-context")
    def intelligence_context():
        """Path-free semantic state for the bounded desktop Copilot process."""
        lineages = []
        for artifact_rappid, peers in sorted(
            peer_registry.group_by_lineage().items()
        ):
            lineages.append({
                "artifact_rappid": artifact_rappid,
                "name": next(
                    (
                        peer.get("twin_name")
                        for peer in peers
                        if peer.get("twin_name")
                    ),
                    rapp_protocol.rappid_parts(artifact_rappid)["slug"]
                    if rapp_protocol.rappid_valid(artifact_rappid)
                    else "unknown",
                ),
                "instances": [
                    {
                        "instance_rappid": (
                            peer.get("instance_rappid")
                            or peer.get("rappid_uuid")
                        ),
                        "scope": (
                            "global"
                            if peer.get("is_global")
                            else "standalone"
                            if peer.get("is_twin_only")
                            else "project"
                        ),
                        "live": _probe_health(peer.get("port") or 0)["live"],
                        "version": peer.get("version") or None,
                    }
                    for peer in peers
                ],
            })

        egg_summaries = []
        root = eggs_dir()
        if os.path.isdir(root):
            for directory, _, filenames in os.walk(root):
                for filename in sorted(filenames):
                    if not filename.endswith(".egg"):
                        continue
                    try:
                        with open(os.path.join(directory, filename), "rb") as handle:
                            details = _verified_egg(handle.read())
                        manifest = details["manifest"]
                        egg_summaries.append({
                            "egg_hash": details["egg_hash"],
                            "artifact_rappid": manifest["rappid"],
                            "variant": manifest["variant"],
                        })
                    except Exception:
                        continue
        return jsonify({
            "schema": "rapp-zoo-intelligence-context/1.0",
            "health": {
                "lineage_count": len(lineages),
                "instance_count": sum(
                    len(item["instances"]) for item in lineages
                ),
                "egg_count": len(egg_summaries),
            },
            "lineages": lineages,
            "eggs": egg_summaries,
            "visible_controls": [
                "nav.collection",
                "nav.starters",
                "nav.holocards",
                "nav.discover",
                "collection.refresh",
                "egg.import",
                "copilot.open",
            ],
        }), 200

    @app.route("/api/twins")
    def list_twins():
        grouped = peer_registry.group_by_lineage()
        twins = []
        for artifact_rappid, peers in sorted(grouped.items()):
            display_name = next(
                (p.get("twin_name") for p in peers if p.get("twin_name")),
                artifact_rappid[:8],
            )
            parent_repo = next(
                (p.get("parent_repo") for p in peers if p.get("parent_repo")),
                None,
            )
            instances = []
            for p in peers:
                port = p.get("port") or 0
                probe = _probe_health(port) if port else {"live": False}
                instance_rappid = p.get("instance_rappid") or p.get("rappid_uuid")
                pid = _read_pid(instance_rappid) if instance_rappid else None
                instances.append({
                    "id": p.get("id"),
                    "instance_rappid": instance_rappid,
                    "artifact_rappid": p.get("artifact_rappid") or artifact_rappid,
                    "grown_from": p.get("grown_from"),
                    "brainstem_dir": p.get("brainstem_dir"),
                    "port": port,
                    "is_global": bool(p.get("is_global")),
                    "is_twin_only": bool(p.get("is_twin_only")),
                    "project_name": p.get("project_name"),
                    "version": p.get("version"),
                    "summoned_from": p.get("summoned_from"),
                    "live": probe["live"],
                    "pid": pid if pid and _pid_alive(pid) else None,
                })
            twins.append({
                "artifact_rappid": artifact_rappid,
                "rappid_uuid": artifact_rappid,
                "name": display_name,
                "parent_repo": parent_repo,
                "instance_count": len(peers),
                "incarnation_count": len(peers),
                "instances": instances,
                "incarnations": instances,
            })
        return jsonify({"schema": "rapp-zoo-twins/1.0", "twins": twins}), 200

    @app.route("/api/eggs")
    def list_eggs():
        root = eggs_dir()
        out = []
        if os.path.isdir(root):
            for rid in sorted(os.listdir(root)):
                rd = os.path.join(root, rid)
                if not os.path.isdir(rd):
                    continue
                for fn in sorted(os.listdir(rd), reverse=True):
                    if not fn.endswith(".egg"):
                        continue
                    full = os.path.join(rd, fn)
                    try:
                        st = os.stat(full)
                    except OSError:
                        continue
                    schema = None
                    variant = None
                    kernel_version = None
                    artifact_rappid = None
                    egg_hash = None
                    valid = False
                    verification_error = None
                    try:
                        with open(full, "rb") as f:
                            blob = f.read()
                        details = _verified_egg(blob)
                        m = details["manifest"]
                        schema = m["schema"]
                        variant = m["variant"]
                        artifact_rappid = m["rappid"]
                        egg_hash = details["egg_hash"]
                        kernel_version = m["payload"].get("kernel_version")
                        valid = True
                    except Exception as exc:
                        verification_error = str(exc)
                    out.append({
                        "rappid_uuid": artifact_rappid or rid,
                        "artifact_rappid": artifact_rappid,
                        "filename": fn,
                        "path": full,
                        "size_bytes": st.st_size,
                        "schema": schema,
                        "variant": variant,
                        "kernel_version": kernel_version,
                        "egg_hash": egg_hash,
                        "valid": valid,
                        "verification_error": verification_error,
                        "mtime": time.strftime(
                            "%Y-%m-%dT%H:%M:%SZ",
                            time.gmtime(st.st_mtime),
                        ),
                    })
        return jsonify({"schema": "rapp-zoo-eggs/1.0",
                        "eggs_dir": root, "eggs": out}), 200

    @app.route("/api/lay-egg", methods=["POST"])
    def lay_egg():
        body = request.get_json(silent=True) or {}
        repo_path = body.get("repo_path")
        if not repo_path or not os.path.isdir(repo_path):
            return jsonify({"error": "repo_path missing or not a directory"}), 400

        rappid_at_root = os.path.exists(os.path.join(repo_path, "rappid.json"))
        kernel_at_root = os.path.exists(os.path.join(repo_path, "brainstem.py"))
        instance_src = os.path.join(repo_path, "src", "rapp_brainstem")

        try:
            if rappid_at_root and not kernel_at_root and os.path.isdir(instance_src):
                kver_file = os.path.join(instance_src, "VERSION")
                kver = "?"
                if os.path.exists(kver_file):
                    with open(kver_file) as _vf:
                        kver = _vf.read().strip()
                blob = bond.pack_organism(repo_path, instance_src,
                                          kernel_version=kver)
            else:
                blob = egg.pack_twin_from_repo(repo_path)
        except Exception as e:
            return jsonify({"error": f"pack failed: {e}"}), 500

        try:
            details = _verified_egg(blob)
            rid = details["manifest"]["rappid"]
            egg_hash = details["egg_hash"]
        except Exception as e:
            return jsonify({"error": f"emitted egg failed RAPP/1 verification: {e}"}), 500

        slug = rid.rsplit(":", 1)[-1] if ":" in rid else rid
        out_dir = os.path.join(eggs_dir(), slug)
        os.makedirs(out_dir, exist_ok=True)
        ts = time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime())
        out_path = os.path.join(out_dir, f"{ts}.egg")
        with open(out_path, "wb") as f:
            f.write(blob)
        return jsonify({
            "ok": True, "egg_path": out_path,
            "rappid_uuid": rid,
            "artifact_rappid": rid,
            "egg_hash": egg_hash,
            "schema": rapp_protocol.EGG_SCHEMA,
            "variant": details["manifest"]["variant"],
            "size_bytes": len(blob),
        }), 200

    @app.route("/api/summon", methods=["POST"])
    def summon():
        body = request.get_json(silent=True) or {}
        ep = body.get("egg_path")
        if not ep or not os.path.isfile(ep):
            return jsonify({"error": "egg_path missing or not a file"}), 400
        host_root = body.get("host_root") or twins_dir()
        keep = bool(body.get("keep_existing_kernel"))
        owner = body.get("owner") or os.environ.get("RAPP_OWNER")
        try:
            with open(ep, "rb") as f:
                blob = f.read()
        except Exception as e:
            return jsonify({"error": f"egg read failed: {e}"}), 500

        try:
            details = _verified_egg(blob)
        except Exception as e:
            return jsonify({"error": f"RAPP/1 egg refused: {e}"}), 422

        manifest = details["manifest"]
        variant = manifest["variant"]
        verifier = _signature_verifier()
        if variant == "rapplication":
            if not body.get("host_root") or not os.path.isdir(host_root):
                return jsonify({
                    "error": "rapplication summon requires host_root pointing at a brainstem src directory"
                }), 400
            try:
                result = bond.unpack_rapplication(
                    blob,
                    host_root,
                    instance_owner=owner,
                    signature_verifier=verifier,
                )
            except Exception as e:
                return jsonify({"error": f"rapplication summon failed: {e}"}), 500
            return jsonify({
                "ok": result["ok"],
                "workspace": host_root,
                "schema": manifest["schema"],
                "variant": variant,
                "artifact_rappid": result["artifact_rappid"],
                "instance_rappid": result["instance_rappid"],
                "grown_from": result["grown_from"],
                "egg_hash": result["egg_hash"],
            }), 200 if result["ok"] else 500
        if variant != "organism":
            return jsonify({
                "error": (
                    f"verified {variant} egg is inspectable/importable but is not "
                    "a standalone organism"
                )
            }), 422

        os.makedirs(host_root, exist_ok=True)
        layout = manifest["payload"].get("layout")
        try:
            if layout == "brainstem-instance":
                ws, result = _summon_organism(
                    blob,
                    host_root,
                    instance_owner=owner,
                    signature_verifier=verifier,
                )
            else:
                ws = egg.summon_twin_egg(
                    blob,
                    host_root,
                    keep_existing_kernel=keep,
                    instance_owner=owner,
                    signature_verifier=verifier,
                )
                with open(os.path.join(ws, "rappid.json"), encoding="utf-8") as handle:
                    live_identity = json.load(handle)
                result = {
                    "artifact_rappid": manifest["rappid"],
                    "instance_rappid": live_identity["rappid"],
                    "grown_from": live_identity["grown_from"],
                    "egg_hash": details["egg_hash"],
                }
        except Exception as e:
            return jsonify({"error": f"organism summon failed: {e}"}), 500

        try:
            with open(os.path.join(ws, "rappid.json"), encoding="utf-8") as handle:
                live_identity = json.load(handle)
            claimed = peer_registry.claimed_ports()
            port = next((p for p in range(7081, 7200) if p not in claimed), 0)
            peer_registry.upsert(
                ws, port,
                version=manifest["payload"].get("kernel_version")
                or live_identity.get("kind"),
                instance_rappid=result["instance_rappid"],
                artifact_rappid=result["artifact_rappid"],
                grown_from=result["grown_from"],
                egg_hash=result["egg_hash"],
                twin_name=live_identity.get("name"),
                parent_repo=manifest["payload"].get("parent_repo")
                or (manifest["payload"].get("source") or {}).get("repo"),
                summoned_from=ep,
            )
        except Exception as e:
            return jsonify({
                "error": f"organism materialized but registry update failed: {e}",
                "workspace": ws,
            }), 500

        return jsonify({
            "ok": True,
            "workspace": ws,
            "schema": manifest["schema"],
            "variant": variant,
            "artifact_rappid": result["artifact_rappid"],
            "instance_rappid": result["instance_rappid"],
            "grown_from": result["grown_from"],
            "egg_hash": result["egg_hash"],
        }), 200

    @app.route("/api/bond", methods=["POST"])
    @app.route("/api/hatch", methods=["POST"])
    def bond_in_place():
        body = request.get_json(silent=True) or {}
        rid = body.get("instance_rappid") or body.get("rappid_uuid")
        new_kernel = body.get("new_kernel")
        if not rid or not new_kernel:
            return jsonify({"error": "instance_rappid and new_kernel required"}), 400

        # Resolve new_kernel to a brainstem.py file
        if os.path.isfile(new_kernel) and new_kernel.endswith("brainstem.py"):
            kernel_file = new_kernel
        elif os.path.isdir(new_kernel) and os.path.isfile(
                os.path.join(new_kernel, "brainstem.py")):
            kernel_file = os.path.join(new_kernel, "brainstem.py")
        elif os.path.isdir(new_kernel) and os.path.isfile(
                os.path.join(new_kernel, "rapp_brainstem", "brainstem.py")):
            kernel_file = os.path.join(new_kernel, "rapp_brainstem", "brainstem.py")
        else:
            return jsonify({"error": f"cannot locate brainstem.py from {new_kernel}"}), 400

        peer = _find_peer(rid)
        if not peer:
            return jsonify({"error": f"no peer for instance_rappid {rid}"}), 404
        ws = peer.get("brainstem_dir")
        if not ws or not os.path.isdir(ws):
            return jsonify({"error": f"workspace not found: {ws}"}), 404

        instance_src = os.path.join(ws, "src", "rapp_brainstem")
        is_brainstem_instance = os.path.isdir(instance_src)
        try:
            if is_brainstem_instance:
                version_path = os.path.join(instance_src, "VERSION")
                version = (
                    pathlib.Path(version_path).read_text().strip()
                    if os.path.isfile(version_path)
                    else "?"
                )
                blob = bond.pack_organism(ws, instance_src, version)
                target_kernel = os.path.join(instance_src, "brainstem.py")
            else:
                blob = egg.pack_twin_from_repo(ws)
                target_kernel = os.path.join(ws, "brainstem.py")
            details = _verified_egg(blob)
            ts = time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime())
            out_dir = os.path.join(
                eggs_dir(), details["manifest"]["rappid"].rsplit(":", 1)[-1]
            )
            os.makedirs(out_dir, exist_ok=True)
            ep = os.path.join(out_dir, f"{ts}.egg")
            with open(ep, "wb") as f:
                f.write(blob)
        except Exception as e:
            return jsonify({"error": f"lay-egg step failed: {e}"}), 500

        try:
            previous_kernel = (
                pathlib.Path(target_kernel).read_bytes()
                if os.path.isfile(target_kernel)
                else None
            )
            os.makedirs(os.path.dirname(target_kernel), exist_ok=True)
            shutil.copy2(kernel_file, target_kernel)
        except Exception as e:
            return jsonify({"error": f"kernel swap failed: {e}"}), 500

        try:
            if is_brainstem_instance:
                result = bond.unpack_organism(
                    blob,
                    ws,
                    instance_src,
                    preserve_instance_identity=True,
                    signature_verifier=_signature_verifier(),
                )
                ws_after = ws
            else:
                ws_after = egg.summon_twin_egg(
                    blob,
                    os.path.dirname(ws),
                    keep_existing_kernel=True,
                    existing_workspace=ws,
                    signature_verifier=_signature_verifier(),
                )
                result = {"ok": True}
        except Exception as e:
            if previous_kernel is not None:
                pathlib.Path(target_kernel).write_bytes(previous_kernel)
            return jsonify({"error": f"bond restore failed; kernel rolled back: {e}"}), 500
        if not result.get("ok"):
            if previous_kernel is not None:
                pathlib.Path(target_kernel).write_bytes(previous_kernel)
            return jsonify({
                "error": f"bond restore failed; kernel rolled back: {result.get('errors')}"
            }), 500

        return jsonify({
            "ok": True, "egg_path": ep,
            "workspace": ws_after,
            "instance_rappid": rid,
            "egg_hash": details["egg_hash"],
            "kernel_swapped_from": kernel_file,
        }), 200

    @app.route("/api/start", methods=["POST"])
    def start_twin():
        body = request.get_json(silent=True) or {}
        rid = body.get("instance_rappid") or body.get("rappid_uuid")
        if not rid:
            return jsonify({"error": "instance_rappid required"}), 400

        existing_pid = _read_pid(rid)
        if existing_pid and _pid_alive(existing_pid):
            return jsonify({"ok": True, "already_running": True,
                            "pid": existing_pid}), 200

        peer = _find_peer(rid)
        if not peer:
            return jsonify({"error": f"no peer for {rid}"}), 404
        ws = peer.get("brainstem_dir")
        if not ws or not os.path.isdir(ws):
            return jsonify({"error": f"workspace not found: {ws}"}), 404

        start_script = os.path.join(ws, "installer", "start.sh")
        if not os.path.isfile(start_script):
            return jsonify({"error": f"no start.sh at {start_script}"}), 404

        try:
            proc = subprocess.Popen(
                ["bash", start_script],
                cwd=ws,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            _write_pid(rid, proc.pid)
        except Exception as e:
            return jsonify({"error": f"start failed: {e}"}), 500
        return jsonify({"ok": True, "pid": proc.pid, "workspace": ws}), 200

    @app.route("/api/stop", methods=["POST"])
    def stop_twin():
        body = request.get_json(silent=True) or {}
        rid = body.get("instance_rappid") or body.get("rappid_uuid")
        if not rid:
            return jsonify({"error": "instance_rappid required"}), 400
        pid = _read_pid(rid)
        if not pid or not _pid_alive(pid):
            _clear_pid(rid)
            return jsonify({"ok": True, "was_running": False}), 200
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except (ProcessLookupError, OSError):
            try:
                os.kill(pid, signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass
        # Best-effort wait for shutdown
        for _ in range(20):
            if not _pid_alive(pid):
                break
            time.sleep(0.1)
        _clear_pid(rid)
        return jsonify({"ok": True, "was_running": True, "pid": pid}), 200

    # ── Pokédex tier — egg import / export / inspect / starters / discover ──

    @app.route("/api/import-egg", methods=["POST"])
    def import_egg():
        """Drag-drop / file-picker upload of a .egg file. Saves to
        ~/.rapp/eggs/imported/<sha8>-<filename>.egg, peeks the manifest,
        returns the saved path + manifest summary so the UI can react.
        """
        if "egg" not in request.files:
            return jsonify({"error": "no 'egg' file in upload"}), 400
        f = request.files["egg"]
        if not f or not f.filename:
            return jsonify({"error": "empty upload"}), 400

        blob = f.read()
        try:
            details = _verified_egg(blob)
        except Exception as e:
            return jsonify({"error": f"RAPP/1 egg refused: {e}"}), 422
        manifest = details["manifest"]

        hash_prefix = details["egg_hash"][:12]
        safe_name = re.sub(r"[^\w.-]", "_", f.filename or "upload.egg")
        if not safe_name.endswith(".egg"):
            safe_name += ".egg"
        out_dir = os.path.join(eggs_dir(), "imported")
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, f"{hash_prefix}-{safe_name}")
        with open(out_path, "wb") as o:
            o.write(blob)

        return jsonify({
            "ok": True,
            "egg_path": out_path,
            "size_bytes": len(blob),
            "manifest": manifest,
            "egg_hash": details["egg_hash"],
        }), 200

    @app.route("/api/export-egg")
    def export_egg():
        """Stream an existing egg as an attachment so the user can save
        it anywhere (Downloads, AirDrop targets, USB, etc).

        ?path=<absolute path> — must be inside ~/.rapp/eggs/ for safety.
        """
        path = request.args.get("path", "")
        if not path:
            return jsonify({"error": "?path= required"}), 400
        path = os.path.abspath(path)
        eggs_root = os.path.abspath(eggs_dir())
        # Path-traversal guard: only serve eggs that live under ~/.rapp/eggs/.
        if not path.startswith(eggs_root + os.sep):
            return jsonify({"error": "path must be inside eggs dir"}), 403
        if not os.path.isfile(path):
            return jsonify({"error": "not found"}), 404
        from flask import send_file
        return send_file(path, mimetype="application/zip",
                         as_attachment=True,
                         download_name=os.path.basename(path))

    @app.route("/api/eggs/manifest")
    def egg_manifest():
        """Peek a single egg's manifest without unpacking. Used by the
        UI's inspect-modal flow."""
        path = request.args.get("path", "")
        if not path or not os.path.isfile(path):
            return jsonify({"error": "?path= must point at an existing file"}), 400
        path = os.path.abspath(path)
        eggs_root = os.path.abspath(eggs_dir())
        if not path.startswith(eggs_root + os.sep):
            return jsonify({"error": "path must be inside eggs dir"}), 403
        try:
            with open(path, "rb") as f:
                blob = f.read()
            details = _verified_egg(blob)
        except Exception as e:
            return jsonify({"error": str(e)}), 422
        names = ["manifest.json", *sorted(details["files"])]
        return jsonify({
            "ok": True,
            "manifest": details["manifest"],
            "egg_hash": details["egg_hash"],
            "file_tree": names,
            "size_bytes": len(blob),
        }), 200

    @app.route("/api/starters")
    def list_starters():
        """List the bundled starter rapplications (the 3 archetype eggs
        that ship inside this rapp-zoo install). Each entry includes the
        URL the UI can fetch to download / inspect the egg.
        """
        starters_root = os.path.join(_HERE, "starters", "dist")
        out = []
        if not os.path.isdir(starters_root):
            return jsonify({"schema": "rapp-zoo-starters/1.0",
                            "starters": []}), 200
        for fn in sorted(os.listdir(starters_root)):
            if not fn.endswith(".egg"):
                continue
            path = os.path.join(starters_root, fn)
            try:
                with open(path, "rb") as f:
                    details = _verified_egg(f.read())
                manifest = details["manifest"]
            except Exception:
                continue
            payload = manifest["payload"]
            # Type derived from the rapp_id → matches the source dir name
            # (work / play / regular). Hardcoded mapping is fine; only
            # 3 starters and they're stable.
            type_map = {"workday": "work", "playtime": "play", "journal": "regular"}
            rapp_id = payload.get("rapp_id") or fn.replace(".egg", "")
            out.append({
                "rapp_id":   rapp_id,
                "type":      type_map.get(rapp_id, "regular"),
                "name":      payload.get("name") or rapp_id,
                "version":   payload.get("version"),
                "publisher": payload.get("publisher"),
                "rappid":    manifest["rappid"],
                "has_skin":  payload.get("has_skin"),
                "egg_hash":  details["egg_hash"],
                "egg_url":   f"/starters/dist/{fn}",
                "size_bytes": os.path.getsize(path),
            })
        return jsonify({"schema": "rapp-zoo-starters/1.0",
                        "starters": out}), 200

    @app.route("/starters/dist/<path:fname>")
    def serve_starter(fname: str):
        """Serve a starter .egg as a download (lets the UI offer one-click
        export of any starter to the user's Downloads folder)."""
        starters_root = os.path.join(_HERE, "starters", "dist")
        full = os.path.normpath(os.path.join(starters_root, fname))
        if not full.startswith(starters_root + os.sep):
            return abort(403)
        if not os.path.isfile(full):
            return abort(404)
        from flask import send_file
        return send_file(full, mimetype="application/zip",
                         as_attachment=True, download_name=os.path.basename(full))

    @app.route("/api/holocards")
    def list_holocards():
        """Holocards are playable cards bound to specific agent invocations
        (or .egg hatch URLs). Many cards per underlying agent, like 151
        Pokémon × N printings = thousands of TCG cards.

        Reads two locations and merges:
            <repo>/holocards/*.json   ← bundled sets that ship with rapp-zoo
            ~/.rapp/holocards/*.json  ← user's personal deck

        Each file is a set: { schema, set_id, set_name, cards: [...] }.
        Cards inherit set_id / set_name / edition / publisher when those
        fields are missing on the card itself, so authors don't have to
        repeat them per-card.
        """
        out_cards = []
        seen_set_ids = set()

        def _ingest(root: str, source: str) -> None:
            if not os.path.isdir(root):
                return
            for fn in sorted(os.listdir(root)):
                if not fn.endswith(".json"):
                    continue
                full = os.path.join(root, fn)
                try:
                    with open(full, "r", encoding="utf-8") as f:
                        data = json.load(f)
                except (OSError, json.JSONDecodeError):
                    continue
                set_id   = data.get("set_id")   or fn[:-5]
                set_name = data.get("set_name") or set_id
                edition  = data.get("edition")
                publisher = data.get("publisher")
                seen_set_ids.add(set_id)
                for card in (data.get("cards") or []):
                    card = dict(card)
                    card.setdefault("set_id",   set_id)
                    card.setdefault("set_name", set_name)
                    if edition:   card.setdefault("edition",   edition)
                    if publisher: card.setdefault("publisher", publisher)
                    card.setdefault("source", source)
                    out_cards.append(card)

        _ingest(os.path.join(_HERE, "holocards"), "bundled")
        _ingest(os.path.join(rapp_home(), "holocards"), "user")

        return jsonify({
            "schema":   "rapp-zoo-holocards/1.0",
            "sets":     sorted(seen_set_ids),
            "cards":    out_cards,
        }), 200

    @app.route("/api/discover")
    def discover():
        """Pointer to the global rapp_store Pokédex API. The actual
        catalog index lives at the upstream URL; the zoo proxies the
        URL and (future) caches the response. Today this just hands the
        URL back so the UI can fetch directly via the user's browser.
        """
        upstream = os.environ.get(
            "RAPPSTORE_API_URL",
            "https://raw.githubusercontent.com/kody-w/RAPP_Store/main/api/v1/index.json",
        )
        return jsonify({
            "schema": "rapp-zoo-discover/1.0",
            "upstream_url": upstream,
            "note": "Static API hosted from kody-w/RAPP_Store via raw.githubusercontent.com — fetch upstream_url for the catalog.",
        }), 200

    @app.route("/api/reveal", methods=["POST"])
    def reveal():
        """Open a workspace dir in the OS file manager (Finder / Explorer
        / xdg-open). Path must be inside ~/.rapp/ for safety.
        """
        body = request.get_json(silent=True) or {}
        path = body.get("path", "")
        if not path:
            return jsonify({"error": "path required"}), 400
        path = os.path.abspath(path)
        rapp_root = os.path.abspath(rapp_home())
        if not path.startswith(rapp_root + os.sep) and path != rapp_root:
            return jsonify({"error": "path must be inside ~/.rapp/"}), 403
        if not os.path.exists(path):
            return jsonify({"error": "not found"}), 404
        try:
            if sys.platform == "darwin":
                subprocess.Popen(["open", path])
            elif sys.platform.startswith("win"):
                subprocess.Popen(["explorer", path])
            else:
                subprocess.Popen(["xdg-open", path])
        except Exception as e:
            return jsonify({"error": f"reveal failed: {e}"}), 500
        return jsonify({"ok": True, "revealed": path}), 200

    return app


def _summon_organism(
    blob: bytes,
    host_root: str,
    *,
    instance_owner: str | None,
    signature_verifier=None,
) -> tuple[str, dict]:
    """Materialize a verified brainstem-instance organism as a fresh instance.

    Workspace layout matches a locally-hatched brainstem instance:
        <ws>/rappid.json                      ← organism identity
        <ws>/bonds.json                       ← (created on next bond)
        <ws>/src/rapp_brainstem/soul.md
        <ws>/src/rapp_brainstem/.env          ← sanitized — re-enter creds
        <ws>/src/rapp_brainstem/agents/<f>
        <ws>/src/rapp_brainstem/utils/{organs,senses,services}/<f>
        <ws>/src/rapp_brainstem/.brainstem_data/<...>

    The workspace does NOT include the brainstem kernel files (brainstem.py,
    utils/llm.py, etc) — the egg only carries the *organism*. To run the
    summoned organism, install the RAPP brainstem framework into that
    workspace's src/rapp_brainstem/ via the one-liner. The egg-on-fresh-
    kernel pattern is bond.py's whole reason for existing.
    """
    workspace = os.path.join(host_root, os.urandom(16).hex())
    src = os.path.join(workspace, "src", "rapp_brainstem")
    os.makedirs(src, exist_ok=True)
    result = bond.unpack_organism(
        blob,
        workspace,
        src,
        instance_owner=instance_owner,
        signature_verifier=signature_verifier,
    )
    if not result.get("ok"):
        raise RuntimeError(f"unpack errors: {result.get('errors')}")
    return workspace, result


def main() -> None:
    app = create_app()
    port = int(os.environ.get("RAPP_ZOO_PORT", "7070"))
    host = os.environ.get("RAPP_ZOO_HOST", "127.0.0.1")
    print(f"[rapp-zoo] listening on http://{host}:{port}")
    print(f"[rapp-zoo] RAPP_HOME = {rapp_home()}")
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
