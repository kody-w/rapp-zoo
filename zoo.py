"""
zoo.py — local-first keeper for the twin estate.

A single small Flask process at localhost:7070 (configurable). Sits
above the per-twin brainstems; never replaces them. The zoo's job is
to list, lay-egg, summon, hatch, start, and stop twins on this device.

Design constraints:
- Local-first: reads ~/.config/rapp/peers.json + ~/.rapp/{eggs,twins}/.
  No cloud API, no telemetry, no auth (it's bound to localhost).
- Stateless: the source of truth lives in peer_registry + filesystem.
  The zoo doesn't keep its own database; restart at any time.
- One file: zoo.py is the entire app. The UI is static/. Vendored
  utils/{egg,peer_registry}.py are the only code dependencies.
- Pure stdlib + flask: nothing else.

Routes:
    GET  /                  → the zoo UI (static/index.html)
    GET  /static/<path>     → static assets
    GET  /api/health        → zoo liveness + per-twin liveness
    GET  /api/twins         → list grouped by rappid (parallel-omniscience aware)
    GET  /api/eggs          → list local egg backups
    POST /api/lay-egg       → pack a twin's repo into a fresh egg
                              body: { repo_path }
    POST /api/summon        → materialize an egg into ~/.rapp/twins/<rappid>/
                              body: { egg_path, host_root?, keep_existing_kernel? }
    POST /api/hatch         → egg-based kernel update
                              body: { rappid_uuid, new_kernel }
                              (new_kernel = path to brainstem.py file or
                               directory containing one)
    POST /api/start         → start a twin's brainstem
                              body: { rappid_uuid }
    POST /api/stop          → stop a running twin
                              body: { rappid_uuid }
"""

from __future__ import annotations

import json
import os
import pathlib
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

# Vendored modules: egg.py + peer_registry.py
sys.path.insert(0, _UTILS_DIR)
import egg                # noqa: E402
import peer_registry      # noqa: E402


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
    return os.path.join(pids_dir(), f"{rappid_uuid}.pid")


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

    @app.route("/api/health")
    def health():
        peers = peer_registry.load()["peers"]
        live_count = sum(1 for p in peers if _probe_health(p.get("port") or 0)["live"])
        return jsonify({
            "name": "rapp-zoo",
            "status": "ok",
            "rapp_home": rapp_home(),
            "peer_count": len(peers),
            "live_count": live_count,
            "schema": "rapp-zoo-health/1.0",
        }), 200

    @app.route("/api/twins")
    def list_twins():
        grouped = peer_registry.group_by_twin()
        twins = []
        for rappid_uuid, peers in sorted(grouped.items()):
            display_name = next(
                (p.get("twin_name") for p in peers if p.get("twin_name")),
                rappid_uuid[:8],
            )
            parent_repo = next(
                (p.get("parent_repo") for p in peers if p.get("parent_repo")),
                None,
            )
            incarnations = []
            for p in peers:
                port = p.get("port") or 0
                probe = _probe_health(port) if port else {"live": False}
                pid = _read_pid(rappid_uuid)
                incarnations.append({
                    "id": p.get("id"),
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
                "rappid_uuid": rappid_uuid,
                "name": display_name,
                "parent_repo": parent_repo,
                "incarnation_count": len(peers),
                "incarnations": incarnations,
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
                    out.append({
                        "rappid_uuid": rid,
                        "filename": fn,
                        "path": full,
                        "size_bytes": st.st_size,
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
        try:
            blob = egg.pack_twin_from_repo(repo_path)
        except Exception as e:
            return jsonify({"error": f"pack failed: {e}"}), 500
        try:
            with open(os.path.join(repo_path, "rappid.json")) as f:
                rj = json.load(f)
            rid = rj["rappid"]
        except Exception as e:
            return jsonify({"error": f"could not read rappid.json: {e}"}), 500

        out_dir = os.path.join(eggs_dir(), rid)
        os.makedirs(out_dir, exist_ok=True)
        ts = time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime())
        out_path = os.path.join(out_dir, f"{ts}.egg")
        with open(out_path, "wb") as f:
            f.write(blob)
        return jsonify({
            "ok": True, "egg_path": out_path,
            "rappid_uuid": rid, "size_bytes": len(blob),
        }), 200

    @app.route("/api/summon", methods=["POST"])
    def summon():
        body = request.get_json(silent=True) or {}
        ep = body.get("egg_path")
        if not ep or not os.path.isfile(ep):
            return jsonify({"error": "egg_path missing or not a file"}), 400
        host_root = body.get("host_root") or twins_dir()
        keep = bool(body.get("keep_existing_kernel"))
        os.makedirs(host_root, exist_ok=True)
        try:
            with open(ep, "rb") as f:
                blob = f.read()
            ws = egg.summon_twin_egg(blob, host_root, keep_existing_kernel=keep)
        except Exception as e:
            return jsonify({"error": f"summon failed: {e}"}), 500

        # Best-effort registration in the neighborhood
        try:
            with open(os.path.join(ws, "rappid.json")) as f:
                rj = json.load(f)
            claimed = peer_registry.claimed_ports()
            port = next((p for p in range(7081, 7200) if p not in claimed), 0)
            peer_registry.upsert(
                ws, port,
                version=(rj.get("brainstem") or {}).get("version"),
                rappid_uuid=rj["rappid"],
                twin_name=rj.get("name"),
                parent_repo=rj.get("parent_repo"),
                summoned_from=ep,
            )
        except Exception:
            pass

        return jsonify({"ok": True, "workspace": ws}), 200

    @app.route("/api/hatch", methods=["POST"])
    def hatch():
        body = request.get_json(silent=True) or {}
        rid = body.get("rappid_uuid")
        new_kernel = body.get("new_kernel")
        if not rid or not new_kernel:
            return jsonify({"error": "rappid_uuid and new_kernel required"}), 400

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

        grouped = peer_registry.group_by_twin()
        peers = grouped.get(rid) or []
        if not peers:
            return jsonify({"error": f"no peer for rappid_uuid {rid}"}), 404
        # Prefer twin-only incarnation; fall back to first
        peer = next((p for p in peers if p.get("is_twin_only")), peers[0])
        ws = peer.get("brainstem_dir")
        if not ws or not os.path.isdir(ws):
            return jsonify({"error": f"workspace not found: {ws}"}), 404

        # Step 1: lay an egg
        try:
            blob = egg.pack_twin_from_repo(ws)
            ts = time.strftime("%Y-%m-%dT%H-%M-%SZ", time.gmtime())
            out_dir = os.path.join(eggs_dir(), rid)
            os.makedirs(out_dir, exist_ok=True)
            ep = os.path.join(out_dir, f"{ts}.egg")
            with open(ep, "wb") as f:
                f.write(blob)
        except Exception as e:
            return jsonify({"error": f"lay-egg step failed: {e}"}), 500

        # Step 2: swap the kernel in place
        try:
            shutil.copy2(kernel_file, os.path.join(ws, "brainstem.py"))
        except Exception as e:
            return jsonify({"error": f"kernel swap failed: {e}"}), 500

        # Step 3: re-summon with --keep-kernel
        try:
            ws_after = egg.summon_twin_egg(
                blob, os.path.dirname(ws),
                keep_existing_kernel=True,
            )
        except Exception as e:
            return jsonify({"error": f"summon-back failed: {e}"}), 500

        return jsonify({
            "ok": True, "egg_path": ep,
            "workspace": ws_after, "kernel_swapped_from": kernel_file,
        }), 200

    @app.route("/api/start", methods=["POST"])
    def start_twin():
        body = request.get_json(silent=True) or {}
        rid = body.get("rappid_uuid")
        if not rid:
            return jsonify({"error": "rappid_uuid required"}), 400

        existing_pid = _read_pid(rid)
        if existing_pid and _pid_alive(existing_pid):
            return jsonify({"ok": True, "already_running": True,
                            "pid": existing_pid}), 200

        grouped = peer_registry.group_by_twin()
        peers = grouped.get(rid) or []
        if not peers:
            return jsonify({"error": f"no peer for {rid}"}), 404
        peer = next((p for p in peers if p.get("is_twin_only")), peers[0])
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
        rid = body.get("rappid_uuid")
        if not rid:
            return jsonify({"error": "rappid_uuid required"}), 400
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

    return app


def main() -> None:
    app = create_app()
    port = int(os.environ.get("RAPP_ZOO_PORT", "7070"))
    host = os.environ.get("RAPP_ZOO_HOST", "127.0.0.1")
    print(f"[rapp-zoo] listening on http://{host}:{port}")
    print(f"[rapp-zoo] RAPP_HOME = {rapp_home()}")
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
