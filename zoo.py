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
import hmac
import json
import os
import pathlib
import re
import secrets
import shutil
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request, send_from_directory, abort


_HERE = os.path.dirname(os.path.abspath(__file__))
_UTILS_DIR = os.path.join(_HERE, "utils")
_STATIC_DIR = os.path.join(_HERE, "static")
_HOLOGRAM_DIR = os.path.join(_HERE, "holograms")
_RAR_HOLOGRAM_INDEX = (
    "https://raw.githubusercontent.com/kody-w/RAR/refs/heads/main/"
    "doggs/holograms/index.json"
)
_MAX_DOGG_BYTES = 256 * 1024
APP_VERSION = "1.3.0"
_FOUNDRY_URL = "http://127.0.0.1:7072"
HOLOGRAM_GENERATOR_RAPPID = os.environ.get(
    "RAPP_ZOO_HOLO_SUBJECT_RAPPID",
    (
        "rappid:@kody-w/hologram-generator:"
        "21f419123bcb166e6fc46a43f53e63e5c8136005e7efcfb689bb80dbcc0453c2"
    ),
)
_DIMENSION_STOPWORDS = {
    "and",
    "body",
    "create",
    "current",
    "dimensions",
    "for",
    "from",
    "generated",
    "hologram",
    "holograms",
    "pulse",
    "query",
    "rapp",
    "request",
    "schema",
    "the",
    "this",
    "with",
    "zoo",
}
_HOLO_DB_INIT_LOCK = threading.Lock()

# Vendored modules: egg.py + peer_registry.py + bond.py
sys.path.insert(0, _UTILS_DIR)
import egg                # noqa: E402
import peer_registry      # noqa: E402
import bond               # noqa: E402
import rapp_protocol      # noqa: E402
import holo_protocol      # noqa: E402


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


def holo_dir() -> str:
    return os.path.join(rapp_home(), "holograms", "holo-v1")


def holo_db_path() -> str:
    return os.path.join(holo_dir(), "store.sqlite3")


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


def _verify_hologram_frame(frame: dict) -> tuple[bool, str | None, str]:
    try:
        trust = rapp_protocol.RegistryTrust.from_environment()
    except rapp_protocol.ProtocolError as exc:
        return False, "6", f"trusted registry unavailable: {exc}"
    return rapp_protocol.verify_frame(
        frame,
        head=None,
        kind_families=trust.kind_families if trust is not None else None,
        signature_verifier=(
            trust.verify_frame_signature if trust is not None else None
        ),
    )


# ── Holo/1 source, body, flipbook, and Holo Wake store ──────────────


def _holo_frame_verification_context():
    try:
        trust = rapp_protocol.RegistryTrust.from_environment()
    except rapp_protocol.ProtocolError as exc:
        raise ValueError(f"trusted registry unavailable: {exc}") from exc
    families = dict(rapp_protocol.CORE_KIND_FAMILIES)
    if trust is not None:
        families.update(trust.kind_families)
    verifier = trust.verify_frame_signature if trust is not None else None
    return families, verifier


def _holo_connect() -> sqlite3.Connection:
    with _HOLO_DB_INIT_LOCK:
        os.makedirs(holo_dir(), mode=0o700, exist_ok=True)
        path = holo_db_path()
        connection = sqlite3.connect(path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = FULL")
        connection.executescript(
            """
        CREATE TABLE IF NOT EXISTS source_frames (
            stream_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            frame_hash TEXT NOT NULL UNIQUE,
            payload_hash TEXT NOT NULL,
            utc TEXT NOT NULL,
            subject_rappid TEXT NOT NULL,
            frame_json TEXT NOT NULL,
            PRIMARY KEY (stream_id, seq)
        );
        CREATE TABLE IF NOT EXISTS body_frames (
            stream_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            frame_hash TEXT NOT NULL UNIQUE,
            payload_hash TEXT NOT NULL,
            utc TEXT NOT NULL,
            kind TEXT NOT NULL,
            frame_json TEXT NOT NULL,
            PRIMARY KEY (stream_id, seq)
        );
        CREATE TABLE IF NOT EXISTS holo_records (
            subject_rappid TEXT NOT NULL,
            holo_seq INTEGER NOT NULL,
            holo_id TEXT NOT NULL PRIMARY KEY,
            visual_parent TEXT,
            source_stream_id TEXT NOT NULL,
            source_seq INTEGER NOT NULL,
            source_frame_hash TEXT NOT NULL UNIQUE,
            authored_hash TEXT NOT NULL,
            frame_json TEXT NOT NULL,
            compiled_json TEXT NOT NULL,
            UNIQUE (subject_rappid, holo_seq)
        );
        CREATE TABLE IF NOT EXISTS holo_heads (
            subject_rappid TEXT PRIMARY KEY,
            body_seq INTEGER NOT NULL,
            body_frame_hash TEXT NOT NULL,
            body_payload_hash TEXT NOT NULL,
            body_utc TEXT NOT NULL,
            holo_seq INTEGER NOT NULL,
            holo_id TEXT NOT NULL,
            source_frame_hash TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS holo_observations (
            source_frame_hash TEXT PRIMARY KEY,
            subject_rappid TEXT NOT NULL,
            authored_hash TEXT,
            holo_id TEXT,
            sightedness TEXT NOT NULL,
            reason TEXT NOT NULL,
            structural_work_units INTEGER,
            channel_enabled INTEGER,
            turn_latency_ms INTEGER,
            deadline_ms INTEGER,
            wake_lease_ms INTEGER,
            on_time INTEGER,
            history_resolved INTEGER,
            replay_manifest_hash TEXT,
            replay_consistent INTEGER,
            observed_utc TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS holo_observations_subject
            ON holo_observations(subject_rappid, observed_utc, source_frame_hash);
        CREATE TABLE IF NOT EXISTS holo_activations (
            player_id TEXT NOT NULL,
            activation_order INTEGER NOT NULL,
            previous_active_holo_id TEXT,
            departure_logical_ms INTEGER,
            departure_manifest_hash TEXT,
            new_holo_id TEXT NOT NULL,
            activated_utc TEXT NOT NULL,
            PRIMARY KEY (player_id, activation_order)
        );
            """
        )
        observation_columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(holo_observations)"
            ).fetchall()
        }
        for name, declaration in {
            "channel_enabled": "INTEGER",
            "turn_latency_ms": "INTEGER",
            "deadline_ms": "INTEGER",
            "wake_lease_ms": "INTEGER",
            "on_time": "INTEGER",
            "history_resolved": "INTEGER",
            "replay_manifest_hash": "TEXT",
            "replay_consistent": "INTEGER",
        }.items():
            if name not in observation_columns:
                connection.execute(
                    f"ALTER TABLE holo_observations "
                    f"ADD COLUMN {name} {declaration}"
                )
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    return connection


def _subject_from_memory_stream(stream_id: str) -> str:
    if not isinstance(stream_id, str) or ":" not in stream_id:
        raise ValueError("holo source stream must be a RAPP memory stream")
    subject, instance = stream_id.rsplit(":", 1)
    if (
        not rapp_protocol.rappid_valid(subject)
        or not rapp_protocol.lclabel_valid(instance, 64)
    ):
        raise ValueError("holo source stream must belong to a valid subject RAPPID")
    return subject


def _holo_session_label(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 200:
        raise ValueError("session_id must be bounded text")
    normalized = value.strip().lower()
    if rapp_protocol.lclabel_valid(normalized, 64):
        return normalized
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]
    return f"session-{digest}"


def _validate_holo_evidence(
    value,
    *,
    candidate_present: bool,
    allow_legacy_incomplete: bool = False,
) -> dict:
    if value is None:
        return {
            "channel_enabled": True if candidate_present else None,
            "turn_latency_ms": None,
            "deadline_ms": None,
            "wake_lease_ms": None,
            "on_time": None,
        }
    expected = {
        "channel_enabled",
        "turn_latency_ms",
        "deadline_ms",
        "wake_lease_ms",
    }
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError(
            "holo evidence must contain channel_enabled, turn_latency_ms, "
            "deadline_ms, and wake_lease_ms"
        )
    enabled = value["channel_enabled"]
    latency = value["turn_latency_ms"]
    deadline = value["deadline_ms"]
    wake_lease = value["wake_lease_ms"]
    if not isinstance(enabled, bool):
        raise ValueError("holo evidence channel_enabled must be boolean")
    for label, item in (
        ("turn_latency_ms", latency),
        ("deadline_ms", deadline),
        ("wake_lease_ms", wake_lease),
    ):
        if item is not None and (
            not isinstance(item, int)
            or isinstance(item, bool)
            or not 0 <= item <= 2**53 - 1
        ):
            raise ValueError(f"holo evidence {label} must be null or uint53")
    if deadline == 0 or wake_lease == 0:
        raise ValueError("Holo deadline and wake lease must be positive")
    if not enabled and any(
        item is not None for item in (latency, deadline, wake_lease)
    ):
        raise ValueError("disabled Holo channels cannot claim liveness evidence")
    if not enabled and candidate_present:
        raise ValueError("disabled Holo channels cannot include a Holo output")
    if (latency is None) != (deadline is None):
        raise ValueError("Holo latency and deadline evidence must appear together")
    if (
        enabled
        and not allow_legacy_incomplete
        and any(item is None for item in (latency, deadline, wake_lease))
    ):
        raise ValueError("enabled Holo channels require complete liveness evidence")
    return {
        "channel_enabled": enabled,
        "turn_latency_ms": latency,
        "deadline_ms": deadline,
        "wake_lease_ms": wake_lease,
        "on_time": (
            latency <= deadline
            if enabled and latency is not None and deadline is not None
            else None
        ),
    }


def _source_holo_evidence(frame: dict, *, candidate_present: bool) -> dict:
    payload = frame.get("payload")
    value = payload.get("holo_channel") if isinstance(payload, dict) else None
    legacy = isinstance(value, dict) and set(value) == {
        "enabled", "turn_latency_ms", "deadline_ms"
    }
    current = isinstance(value, dict) and set(value) == {
        "enabled", "turn_latency_ms", "deadline_ms", "wake_lease_ms"
    }
    if legacy or current:
        value = {
            "channel_enabled": value["enabled"],
            "turn_latency_ms": value["turn_latency_ms"],
            "deadline_ms": value["deadline_ms"],
            "wake_lease_ms": value.get("wake_lease_ms"),
        }
    return _validate_holo_evidence(
        value,
        candidate_present=candidate_present,
        allow_legacy_incomplete=legacy,
    )


def _fantasy_draft_payload() -> dict:
    return {
        "schema": "rapp-fantasy-draft/1",
        "draft_id": "holo-league-alpha",
        "title": "AI Fantasy Draft",
        "status": "lobby",
        "round": 0,
        "pick": 0,
        "rules": {
            "format": "snake",
            "roster_size": 5,
            "turn_ms": 90_000,
            "holo_output": "rapp-holo-output/1",
        },
        "participants": [
            {
                "id": "rappter-one",
                "display_name": "Rappter One",
                "kind": "rappter",
                "seat": 1,
                "roster": [],
            },
            {
                "id": "rappter-two",
                "display_name": "Rappter Two",
                "kind": "rappter",
                "seat": 2,
                "roster": [],
            },
            {
                "id": "ai-aurora",
                "display_name": "AI Aurora",
                "kind": "ai",
                "seat": 3,
                "roster": [],
            },
            {
                "id": "ai-umbra",
                "display_name": "AI Umbra",
                "kind": "ai",
                "seat": 4,
                "roster": [],
            },
        ],
        "pool": [
            {
                "id": "storm-warden",
                "name": "Storm Warden",
                "position": "vanguard",
                "traits": ["pressure", "reach"],
            },
            {
                "id": "glass-oracle",
                "name": "Glass Oracle",
                "position": "strategist",
                "traits": ["forecast", "counter"],
            },
            {
                "id": "ember-runner",
                "name": "Ember Runner",
                "position": "scout",
                "traits": ["speed", "feint"],
            },
            {
                "id": "root-colossus",
                "name": "Root Colossus",
                "position": "anchor",
                "traits": ["defense", "recovery"],
            },
            {
                "id": "echo-smith",
                "name": "Echo Smith",
                "position": "support",
                "traits": ["synergy", "adaptation"],
            },
            {
                "id": "void-cartographer",
                "name": "Void Cartographer",
                "position": "wildcard",
                "traits": ["mapping", "surprise"],
            },
        ],
        "history": [],
    }


def _build_holo_source_turn(
    *,
    subject_rappid: str,
    session_id: str,
    text_output: str,
    holo_output,
    evidence: dict,
) -> dict:
    if not rapp_protocol.rappid_valid(subject_rappid):
        raise ValueError("subject_rappid is invalid")
    if (
        not isinstance(text_output, str)
        or len(text_output.encode("utf-8")) > 256 * 1024
        or text_output != unicodedata.normalize("NFC", text_output)
    ):
        raise ValueError("text output must be bounded NFC text")
    if holo_output is not None and not isinstance(holo_output, dict):
        raise ValueError("holo output must be an object or null")
    normalized_evidence = _validate_holo_evidence(
        evidence,
        candidate_present=holo_output is not None,
    )
    stream_id = f"{subject_rappid}:{_holo_session_label(session_id)}"
    connection = _holo_connect()
    try:
        row = connection.execute(
            "SELECT frame_json FROM source_frames WHERE stream_id = ? "
            "ORDER BY seq DESC LIMIT 1",
            (stream_id,),
        ).fetchone()
    finally:
        connection.close()
    head = _stored_frame(row)
    utc = max(
        rapp_protocol.utc_now_ms(),
        head["utc"] if head is not None else "0000-01-01T00:00:00.000Z",
    )
    return rapp_protocol.build_frame(
        "memory.chat-turn",
        stream_id,
        0 if head is None else head["seq"] + 1,
        utc,
        {
            "role": "assistant",
            "outputs": {
                "text": text_output,
                "voice": None,
                "holo": holo_output,
            },
            "holo_channel": {
                "enabled": normalized_evidence["channel_enabled"],
                "turn_latency_ms": normalized_evidence["turn_latency_ms"],
                "deadline_ms": normalized_evidence["deadline_ms"],
                "wake_lease_ms": normalized_evidence["wake_lease_ms"],
            },
        },
        head["payload_hash"] if head is not None else None,
        head=head,
    )


def _source_holo_candidate(frame: dict):
    if frame.get("kind") != "memory.chat-turn":
        raise ValueError("holo source must be a memory.chat-turn frame")
    payload = frame.get("payload")
    if not isinstance(payload, dict) or payload.get("role") != "assistant":
        raise ValueError("holo source payload must be an assistant turn")
    outputs = payload.get("outputs")
    if not isinstance(outputs, dict) or "holo" not in outputs:
        raise ValueError("assistant turn must contain an outputs.holo member")
    candidate = outputs["holo"]
    if candidate is not None and not isinstance(candidate, dict):
        raise ValueError("outputs.holo must be an object or null")
    return candidate


def _stored_frame(row: sqlite3.Row | None) -> dict | None:
    return json.loads(row["frame_json"]) if row is not None else None


def _store_source_frame(
    connection: sqlite3.Connection,
    frame: dict,
) -> tuple[str, bool]:
    if not isinstance(frame, dict):
        raise ValueError("source_frame must be an object")
    subject = _subject_from_memory_stream(frame.get("stream_id"))
    existing = connection.execute(
        "SELECT frame_hash, frame_json FROM source_frames "
        "WHERE stream_id = ? AND seq = ?",
        (frame["stream_id"], frame.get("seq")),
    ).fetchone()
    canonical_frame = rapp_protocol.canonical(frame)
    if existing is not None:
        if (
            existing["frame_hash"] != frame.get("frame_hash")
            or existing["frame_json"] != canonical_frame
        ):
            raise ValueError("source memory stream fork at an existing sequence")
        return subject, False

    head_row = connection.execute(
        "SELECT frame_json FROM source_frames WHERE stream_id = ? "
        "ORDER BY seq DESC LIMIT 1",
        (frame["stream_id"],),
    ).fetchone()
    head = _stored_frame(head_row)
    families, signature_verifier = _holo_frame_verification_context()
    ok, step, why = rapp_protocol.verify_frame(
        frame,
        head=head,
        stream_id_of_record=frame["stream_id"],
        kind_families=families,
        signature_verifier=signature_verifier,
    )
    if not ok:
        raise ValueError(f"source RAPP frame refused at {step}: {why}")
    _source_holo_candidate(frame)
    connection.execute(
        "INSERT INTO source_frames "
        "(stream_id, seq, frame_hash, payload_hash, utc, subject_rappid, frame_json) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            frame["stream_id"],
            frame["seq"],
            frame["frame_hash"],
            frame["payload_hash"],
            frame["utc"],
            subject,
            canonical_frame,
        ),
    )
    return subject, True


def _current_holo_head(
    connection: sqlite3.Connection,
    subject_rappid: str,
) -> sqlite3.Row | None:
    return connection.execute(
        "SELECT * FROM holo_heads WHERE subject_rappid = ?",
        (subject_rappid,),
    ).fetchone()


def _holo_record_row(
    connection: sqlite3.Connection,
    holo_id: str | None,
) -> sqlite3.Row | None:
    if holo_id is None:
        return None
    return connection.execute(
        "SELECT * FROM holo_records WHERE holo_id = ?",
        (holo_id,),
    ).fetchone()


def _holo_authored_from_row(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return json.loads(row["frame_json"])["payload"]["authored"]


def _holo_history_closure(
    connection: sqlite3.Connection,
    current_row: sqlite3.Row,
) -> dict[str, dict]:
    subject = current_row["subject_rappid"]
    resolved: dict[str, dict] = {}
    visiting: set[str] = set()

    def resolve(holo_id: str, depth: int, upper_seq: int) -> None:
        if holo_id in resolved:
            return
        if depth > 8:
            raise ValueError("recursive Holo history exceeds depth 8")
        if len(resolved) >= 64:
            raise ValueError("recursive Holo history exceeds 64 unique frames")
        if holo_id in visiting:
            raise ValueError("recursive Holo history contains a cycle")
        row = _holo_record_row(connection, holo_id)
        if row is None:
            raise ValueError(f"required holo history is unavailable: {holo_id}")
        if row["subject_rappid"] != subject or row["holo_seq"] >= upper_seq:
            raise ValueError("recursive Holo reference is not a strict visual ancestor")
        visiting.add(holo_id)
        frame = json.loads(row["frame_json"])
        resolved[holo_id] = frame
        authored = frame["payload"]["authored"]
        for entry in authored["performance"]["sustain"]["flipbook"]:
            referenced = entry["holo_id"]
            if referenced != "self":
                resolve(referenced, depth + 1, row["holo_seq"])
        visiting.remove(holo_id)

    frame = json.loads(current_row["frame_json"])
    parent = frame["payload"]["visual_parent"]
    if parent is not None:
        resolve(parent, 1, current_row["holo_seq"])
    for entry in frame["payload"]["authored"]["performance"]["sustain"]["flipbook"]:
        referenced = entry["holo_id"]
        if referenced != "self":
            resolve(referenced, 1, current_row["holo_seq"])
    total_bytes = sum(
        len(
            rapp_protocol.canonical(item["payload"]["authored"]["state"]).encode(
                "utf-8"
            )
        )
        for item in resolved.values()
    )
    if total_bytes > 4 * 1024 * 1024:
        raise ValueError("recursive Holo history exceeds 4 MiB")
    return resolved


def _holo_structural_work_units(authored: dict) -> int:
    state = authored.get("state") or {}
    performance = authored.get("performance") or {}
    sustain = performance.get("sustain") or {}
    tracks = sustain.get("tracks") or []
    return (
        len(state.get("nodes") or [])
        + len(tracks)
        + sum(len(track.get("keyframes") or []) for track in tracks)
        + len(sustain.get("flipbook") or [])
    )


def _record_holo_observation(
    connection: sqlite3.Connection,
    *,
    source_frame_hash: str,
    subject_rappid: str,
    authored_hash: str | None,
    holo_id: str | None,
    sightedness: str,
    reason: str,
    structural_work_units: int | None,
    evidence: dict | None = None,
    history_resolved: bool | None = None,
    replay_manifest_hash: str | None = None,
    replay_consistent: bool | None = None,
) -> None:
    evidence = evidence or {
        "channel_enabled": None,
        "turn_latency_ms": None,
        "deadline_ms": None,
        "wake_lease_ms": None,
        "on_time": None,
    }
    connection.execute(
        "INSERT INTO holo_observations "
        "(source_frame_hash, subject_rappid, authored_hash, holo_id, sightedness, "
        "reason, structural_work_units, channel_enabled, turn_latency_ms, "
        "deadline_ms, wake_lease_ms, on_time, history_resolved, replay_manifest_hash, "
        "replay_consistent, observed_utc) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            source_frame_hash,
            subject_rappid,
            authored_hash,
            holo_id,
            sightedness,
            reason,
            structural_work_units,
            (
                None
                if evidence["channel_enabled"] is None
                else int(evidence["channel_enabled"])
            ),
            evidence["turn_latency_ms"],
            evidence["deadline_ms"],
            evidence["wake_lease_ms"],
            None if evidence["on_time"] is None else int(evidence["on_time"]),
            None if history_resolved is None else int(history_resolved),
            replay_manifest_hash,
            None if replay_consistent is None else int(replay_consistent),
            rapp_protocol.utc_now_ms(),
        ),
    )


def _holo_head_payload(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "subject_rappid": row["subject_rappid"],
        "body_seq": row["body_seq"],
        "body_frame_hash": row["body_frame_hash"],
        "holo_seq": row["holo_seq"],
        "holo_id": row["holo_id"],
        "source_frame_hash": row["source_frame_hash"],
    }


def _player_active_holos(
    connection: sqlite3.Connection,
    player_pattern: str = "zoo-%",
) -> dict[str, str]:
    rows = connection.execute(
        "SELECT records.subject_rappid, activations.new_holo_id "
        "FROM holo_activations AS activations "
        "JOIN holo_records AS records ON records.holo_id = activations.new_holo_id "
        "JOIN ("
        "  SELECT player_id, MAX(activation_order) AS activation_order "
        "  FROM holo_activations WHERE player_id LIKE ? GROUP BY player_id"
        ") AS latest "
        "ON latest.player_id = activations.player_id "
        "AND latest.activation_order = activations.activation_order",
        (player_pattern,),
    ).fetchall()
    return {
        row["subject_rappid"]: row["new_holo_id"]
        for row in rows
    }


def _holo_commit_response(
    connection: sqlite3.Connection,
    observation: sqlite3.Row,
) -> dict:
    head = _current_holo_head(connection, observation["subject_rappid"])
    response = {
        "schema": "rapp-holo-commit-result/1",
        "source_frame_hash": observation["source_frame_hash"],
        "status": observation["sightedness"],
        "reason": observation["reason"],
        "current_head": _holo_head_payload(head),
        "evidence": {
            "channel_enabled": (
                None
                if observation["channel_enabled"] is None
                else bool(observation["channel_enabled"])
            ),
            "turn_latency_ms": observation["turn_latency_ms"],
            "deadline_ms": observation["deadline_ms"],
            "wake_lease_ms": observation["wake_lease_ms"],
            "on_time": (
                None
                if observation["on_time"] is None
                else bool(observation["on_time"])
            ),
            "history_resolved": (
                None
                if observation["history_resolved"] is None
                else bool(observation["history_resolved"])
            ),
            "replay_manifest_hash": observation["replay_manifest_hash"],
            "replay_consistent": (
                None
                if observation["replay_consistent"] is None
                else bool(observation["replay_consistent"])
            ),
        },
    }
    if observation["holo_id"]:
        record = _holo_record_row(connection, observation["holo_id"])
        response["holo_frame"] = _stored_frame(record)
    return response


def _commit_holo_source(frame: dict) -> tuple[dict, int]:
    connection = _holo_connect()
    try:
        connection.execute("BEGIN IMMEDIATE")
        subject, _ = _store_source_frame(connection, frame)
        existing_observation = connection.execute(
            "SELECT * FROM holo_observations WHERE source_frame_hash = ?",
            (frame["frame_hash"],),
        ).fetchone()
        if existing_observation is not None:
            response = _holo_commit_response(connection, existing_observation)
            connection.commit()
            return response, 200

        candidate = _source_holo_candidate(frame)
        evidence = _source_holo_evidence(
            frame,
            candidate_present=candidate is not None,
        )
        if candidate is None:
            enabled = evidence["channel_enabled"]
            _record_holo_observation(
                connection,
                source_frame_hash=frame["frame_hash"],
                subject_rappid=subject,
                authored_hash=None,
                holo_id=None,
                sightedness="absent" if enabled else "unknown",
                reason=(
                    "enabled Holo turn emitted no output; previous head continues"
                    if enabled
                    else "Holo channel was disabled or not evidenced"
                ),
                structural_work_units=0,
                evidence=evidence,
            )
            observation = connection.execute(
                "SELECT * FROM holo_observations WHERE source_frame_hash = ?",
                (frame["frame_hash"],),
            ).fetchone()
            response = _holo_commit_response(connection, observation)
            connection.commit()
            return response, 200

        authored_hash = None
        work_units = None
        current_head = _current_holo_head(connection, subject)
        current_holo_id = current_head["holo_id"] if current_head else None
        declared_base = candidate.get("base_holo_id")
        declared_base_row = _holo_record_row(connection, declared_base)
        if declared_base is not None and declared_base_row is None:
            _record_holo_observation(
                connection,
                source_frame_hash=frame["frame_hash"],
                subject_rappid=subject,
                authored_hash=None,
                holo_id=None,
                sightedness="blind",
                reason="declared base holo is not in the verified subject history",
                structural_work_units=None,
                evidence=evidence,
                history_resolved=False,
                replay_consistent=False,
            )
            observation = connection.execute(
                "SELECT * FROM holo_observations WHERE source_frame_hash = ?",
                (frame["frame_hash"],),
            ).fetchone()
            response = _holo_commit_response(connection, observation)
            connection.commit()
            return response, 422
        if (
            declared_base_row is not None
            and declared_base_row["subject_rappid"] != subject
        ):
            _record_holo_observation(
                connection,
                source_frame_hash=frame["frame_hash"],
                subject_rappid=subject,
                authored_hash=None,
                holo_id=None,
                sightedness="blind",
                reason="declared base holo belongs to another subject",
                structural_work_units=None,
                evidence=evidence,
                history_resolved=False,
                replay_consistent=False,
            )
            observation = connection.execute(
                "SELECT * FROM holo_observations WHERE source_frame_hash = ?",
                (frame["frame_hash"],),
            ).fetchone()
            response = _holo_commit_response(connection, observation)
            connection.commit()
            return response, 422

        ancestor_records = {
            row["holo_id"]: json.loads(row["frame_json"])["payload"]
            for row in connection.execute(
                "SELECT holo_id, frame_json FROM holo_records "
                "WHERE subject_rappid = ?",
                (subject,),
            )
        }
        try:
            base_authored = _holo_authored_from_row(declared_base_row)
            holo_protocol.validate_output(
                candidate,
                base=base_authored,
                ancestor_ids=ancestor_records,
            )
            authored_hash = holo_protocol.authored_hash(candidate)
            work_units = _holo_structural_work_units(candidate)
            compiled = holo_protocol.compile_manifest(
                candidate,
                base=base_authored,
                ancestor_ids=ancestor_records,
            )
            replay_compiled = holo_protocol.compile_manifest(
                candidate,
                base=base_authored,
                ancestor_ids=ancestor_records,
            )
            compiled_json = rapp_protocol.canonical(compiled)
            replay_consistent = (
                compiled_json == rapp_protocol.canonical(replay_compiled)
            )
            replay_manifest_hash = rapp_protocol.H(
                "rapp-holo/1:compiled",
                compiled,
            )
        except Exception as exc:
            _record_holo_observation(
                connection,
                source_frame_hash=frame["frame_hash"],
                subject_rappid=subject,
                authored_hash=authored_hash,
                holo_id=None,
                sightedness="blind",
                reason=f"authored holo refused: {exc}",
                structural_work_units=work_units,
                evidence=evidence,
                history_resolved=False,
                replay_consistent=False,
            )
            observation = connection.execute(
                "SELECT * FROM holo_observations WHERE source_frame_hash = ?",
                (frame["frame_hash"],),
            ).fetchone()
            response = _holo_commit_response(connection, observation)
            connection.commit()
            return response, 422

        if declared_base != current_holo_id:
            _record_holo_observation(
                connection,
                source_frame_hash=frame["frame_hash"],
                subject_rappid=subject,
                authored_hash=authored_hash,
                holo_id=None,
                sightedness="stale",
                reason="authored holo extends an older verified visual head",
                structural_work_units=work_units,
                evidence=evidence,
                history_resolved=True,
                replay_manifest_hash=replay_manifest_hash,
                replay_consistent=replay_consistent,
            )
            observation = connection.execute(
                "SELECT * FROM holo_observations WHERE source_frame_hash = ?",
                (frame["frame_hash"],),
            ).fetchone()
            response = _holo_commit_response(connection, observation)
            connection.commit()
            return response, 409

        body_head_row = connection.execute(
            "SELECT frame_json FROM body_frames WHERE stream_id = ? "
            "ORDER BY seq DESC LIMIT 1",
            (subject,),
        ).fetchone()
        body_head = _stored_frame(body_head_row)
        body_seq = 0 if body_head is None else body_head["seq"] + 1
        holo_seq = 0 if current_head is None else current_head["holo_seq"] + 1
        body_utc = max(
            frame["utc"],
            body_head["utc"] if body_head is not None else frame["utc"],
            rapp_protocol.utc_now_ms(),
        )
        payload = {
            "schema": "rapp-holo-record/1",
            "holo_seq": holo_seq,
            "visual_parent": current_holo_id,
            "source": {
                "stream_id": frame["stream_id"],
                "seq": frame["seq"],
                "frame_hash": frame["frame_hash"],
            },
            "authored_hash": authored_hash,
            "producer_provenance": None,
            "authored": candidate,
        }
        holo_protocol.validate_record(payload, subject_rappid=subject)
        families, signature_verifier = _holo_frame_verification_context()
        body_frame = rapp_protocol.build_frame(
            "body.pulse",
            subject,
            body_seq,
            body_utc,
            payload,
            body_head["payload_hash"] if body_head is not None else None,
            head=body_head,
            kind_families=families,
            signature_verifier=signature_verifier,
        )
        frame_json = rapp_protocol.canonical(body_frame)
        connection.execute(
            "INSERT INTO body_frames "
            "(stream_id, seq, frame_hash, payload_hash, utc, kind, frame_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                subject,
                body_frame["seq"],
                body_frame["frame_hash"],
                body_frame["payload_hash"],
                body_frame["utc"],
                body_frame["kind"],
                frame_json,
            ),
        )
        connection.execute(
            "INSERT INTO holo_records "
            "(subject_rappid, holo_seq, holo_id, visual_parent, source_stream_id, "
            "source_seq, source_frame_hash, authored_hash, frame_json, compiled_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                subject,
                holo_seq,
                body_frame["frame_hash"],
                current_holo_id,
                frame["stream_id"],
                frame["seq"],
                frame["frame_hash"],
                authored_hash,
                frame_json,
                compiled_json,
            ),
        )
        connection.execute(
            "INSERT INTO holo_heads "
            "(subject_rappid, body_seq, body_frame_hash, body_payload_hash, body_utc, "
            "holo_seq, holo_id, source_frame_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(subject_rappid) DO UPDATE SET "
            "body_seq=excluded.body_seq, body_frame_hash=excluded.body_frame_hash, "
            "body_payload_hash=excluded.body_payload_hash, body_utc=excluded.body_utc, "
            "holo_seq=excluded.holo_seq, holo_id=excluded.holo_id, "
            "source_frame_hash=excluded.source_frame_hash",
            (
                subject,
                body_frame["seq"],
                body_frame["frame_hash"],
                body_frame["payload_hash"],
                body_frame["utc"],
                holo_seq,
                body_frame["frame_hash"],
                frame["frame_hash"],
            ),
        )
        _record_holo_observation(
            connection,
            source_frame_hash=frame["frame_hash"],
            subject_rappid=subject,
            authored_hash=authored_hash,
            holo_id=body_frame["frame_hash"],
            sightedness="sighted",
            reason="authored holo extends the current verified visual head",
            structural_work_units=work_units,
            evidence=evidence,
            history_resolved=True,
            replay_manifest_hash=replay_manifest_hash,
            replay_consistent=replay_consistent,
        )
        observation = connection.execute(
            "SELECT * FROM holo_observations WHERE source_frame_hash = ?",
            (frame["frame_hash"],),
        ).fetchone()
        response = _holo_commit_response(connection, observation)
        connection.commit()
        return response, 201
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _append_verified_body_frame(
    connection: sqlite3.Connection,
    body_frame: dict,
    subject: str,
    families: dict,
    signature_verifier,
) -> bool:
    canonical_frame = rapp_protocol.canonical(body_frame)
    existing = connection.execute(
        "SELECT frame_hash, frame_json FROM body_frames "
        "WHERE stream_id = ? AND seq = ?",
        (subject, body_frame.get("seq")),
    ).fetchone()
    if existing is not None:
        if (
            existing["frame_hash"] != body_frame.get("frame_hash")
            or existing["frame_json"] != canonical_frame
        ):
            raise ValueError("wild body stream fork at an existing sequence")
        return False
    head_row = connection.execute(
        "SELECT frame_json FROM body_frames WHERE stream_id = ? "
        "ORDER BY seq DESC LIMIT 1",
        (subject,),
    ).fetchone()
    head = _stored_frame(head_row)
    ok, step, why = rapp_protocol.verify_frame(
        body_frame,
        head=head,
        stream_id_of_record=subject,
        kind_families=families,
        signature_verifier=signature_verifier,
    )
    if not ok:
        raise ValueError(f"wild body frame refused at {step}: {why}")
    connection.execute(
        "INSERT INTO body_frames "
        "(stream_id, seq, frame_hash, payload_hash, utc, kind, frame_json) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            subject,
            body_frame["seq"],
            body_frame["frame_hash"],
            body_frame["payload_hash"],
            body_frame["utc"],
            body_frame["kind"],
            canonical_frame,
        ),
    )
    return True


def _ingest_holo_bundle(
    source_frame: dict,
    body_chain: list,
) -> tuple[dict, int]:
    if (
        not isinstance(body_chain, list)
        or not body_chain
        or len(body_chain) > 256
        or not all(isinstance(frame, dict) for frame in body_chain)
    ):
        raise ValueError("body_chain must contain 1 to 256 RAPP frames")
    connection = _holo_connect()
    subject = None
    evidence = None
    authored_hash = None
    work_units = None
    try:
        connection.execute("BEGIN IMMEDIATE")
        subject, _ = _store_source_frame(connection, source_frame)
        candidate = _source_holo_candidate(source_frame)
        evidence = _source_holo_evidence(
            source_frame,
            candidate_present=candidate is not None,
        )
        connection.commit()

        last = body_chain[-1]
        if (
            last.get("kind") != "body.pulse"
            or last.get("payload", {}).get("schema") != "rapp-holo-record/1"
        ):
            raise ValueError(
                "wild holo bundle must end with a Holo/1 body.pulse"
            )
        existing_observation = connection.execute(
            "SELECT * FROM holo_observations WHERE source_frame_hash = ?",
            (source_frame["frame_hash"],),
        ).fetchone()
        if existing_observation is not None:
            if existing_observation["holo_id"] != last.get("frame_hash"):
                raise ValueError("source frame is already bound to another holo result")
            return _holo_commit_response(connection, existing_observation), 200
        if candidate is None:
            raise ValueError("wild holo bundle source contains no holo output")

        families, signature_verifier = _holo_frame_verification_context()
        for body_frame in body_chain[:-1]:
            if body_frame.get("stream_id") != subject:
                raise ValueError("wild body frame belongs to another subject")
            if body_frame.get("payload", {}).get("schema") == "rapp-holo-record/1":
                raise ValueError(
                    "intermediate Holo/1 body pulses require their own source proof"
                )
            connection.execute("BEGIN IMMEDIATE")
            try:
                _append_verified_body_frame(
                    connection,
                    body_frame,
                    subject,
                    families,
                    signature_verifier,
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise

        connection.execute("BEGIN IMMEDIATE")
        current_head = _current_holo_head(connection, subject)
        current_holo_id = current_head["holo_id"] if current_head else None
        declared_base = candidate.get("base_holo_id")
        declared_base_row = _holo_record_row(connection, declared_base)
        if (
            declared_base_row is not None
            and declared_base_row["subject_rappid"] != subject
        ):
            _record_holo_observation(
                connection,
                source_frame_hash=source_frame["frame_hash"],
                subject_rappid=subject,
                authored_hash=None,
                holo_id=None,
                sightedness="blind",
                reason="wild holo declares a visual base owned by another subject",
                structural_work_units=None,
                evidence=evidence,
                history_resolved=False,
                replay_consistent=False,
            )
            observation = connection.execute(
                "SELECT * FROM holo_observations WHERE source_frame_hash = ?",
                (source_frame["frame_hash"],),
            ).fetchone()
            response = _holo_commit_response(connection, observation)
            connection.commit()
            return response, 422
        if declared_base != current_holo_id:
            sightedness = "stale" if declared_base_row is not None else "blind"
            _record_holo_observation(
                connection,
                source_frame_hash=source_frame["frame_hash"],
                subject_rappid=subject,
                authored_hash=None,
                holo_id=None,
                sightedness=sightedness,
                reason=(
                    "wild holo extends an older verified visual head"
                    if sightedness == "stale"
                    else "wild holo declares an unknown visual base"
                ),
                structural_work_units=None,
                evidence=evidence,
                history_resolved=False,
                replay_consistent=False,
            )
            observation = connection.execute(
                "SELECT * FROM holo_observations WHERE source_frame_hash = ?",
                (source_frame["frame_hash"],),
            ).fetchone()
            response = _holo_commit_response(connection, observation)
            connection.commit()
            return response, 409 if sightedness == "stale" else 422

        ancestor_records = {
            row["holo_id"]: json.loads(row["frame_json"])["payload"]
            for row in connection.execute(
                "SELECT holo_id, frame_json FROM holo_records "
                "WHERE subject_rappid = ?",
                (subject,),
            )
        }
        base_authored = _holo_authored_from_row(declared_base_row)
        holo_protocol.validate_output(
            candidate,
            base=base_authored,
            ancestor_ids=ancestor_records,
        )
        authored_hash = holo_protocol.authored_hash(candidate)
        compiled = holo_protocol.compile_manifest(
            candidate,
            base=base_authored,
            ancestor_ids=ancestor_records,
        )
        replay_compiled = holo_protocol.compile_manifest(
            candidate,
            base=base_authored,
            ancestor_ids=ancestor_records,
        )
        compiled_json = rapp_protocol.canonical(compiled)
        replay_consistent = (
            compiled_json == rapp_protocol.canonical(replay_compiled)
        )
        replay_manifest_hash = rapp_protocol.H(
            "rapp-holo/1:compiled",
            compiled,
        )
        work_units = _holo_structural_work_units(candidate)

        payload = last["payload"]
        if payload.get("schema") != "rapp-holo-record/1":
            raise ValueError("wild Holo/1 body.pulse payload schema is unsupported")
        holo_protocol.validate_record(payload, subject_rappid=subject)
        if payload["source"] != {
            "stream_id": source_frame["stream_id"],
            "seq": source_frame["seq"],
            "frame_hash": source_frame["frame_hash"],
        }:
            raise ValueError("wild holo source binding does not match the source frame")
        if rapp_protocol.canonical(payload["authored"]) != rapp_protocol.canonical(candidate):
            raise ValueError("wild holo authored output differs from the source turn")
        if payload["authored_hash"] != authored_hash:
            raise ValueError("wild holo authored hash mismatch")
        expected_holo_seq = 0 if current_head is None else current_head["holo_seq"] + 1
        if (
            payload["holo_seq"] != expected_holo_seq
            or payload["visual_parent"] != current_holo_id
        ):
            raise ValueError("wild holo does not extend the visual head")
        if last.get("stream_id") != subject:
            raise ValueError("wild body frame belongs to another subject")
        _append_verified_body_frame(
            connection,
            last,
            subject,
            families,
            signature_verifier,
        )

        frame_json = rapp_protocol.canonical(last)
        connection.execute(
            "INSERT INTO holo_records "
            "(subject_rappid, holo_seq, holo_id, visual_parent, source_stream_id, "
            "source_seq, source_frame_hash, authored_hash, frame_json, compiled_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                subject,
                payload["holo_seq"],
                last["frame_hash"],
                payload["visual_parent"],
                source_frame["stream_id"],
                source_frame["seq"],
                source_frame["frame_hash"],
                authored_hash,
                frame_json,
                compiled_json,
            ),
        )
        connection.execute(
            "INSERT INTO holo_heads "
            "(subject_rappid, body_seq, body_frame_hash, body_payload_hash, body_utc, "
            "holo_seq, holo_id, source_frame_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(subject_rappid) DO UPDATE SET "
            "body_seq=excluded.body_seq, body_frame_hash=excluded.body_frame_hash, "
            "body_payload_hash=excluded.body_payload_hash, body_utc=excluded.body_utc, "
            "holo_seq=excluded.holo_seq, holo_id=excluded.holo_id, "
            "source_frame_hash=excluded.source_frame_hash",
            (
                subject,
                last["seq"],
                last["frame_hash"],
                last["payload_hash"],
                last["utc"],
                payload["holo_seq"],
                last["frame_hash"],
                source_frame["frame_hash"],
            ),
        )
        _record_holo_observation(
            connection,
            source_frame_hash=source_frame["frame_hash"],
            subject_rappid=subject,
            authored_hash=authored_hash,
            holo_id=last["frame_hash"],
            sightedness="sighted",
            reason="wild holo bundle extends current body and visual heads",
            structural_work_units=work_units,
            evidence=evidence,
            history_resolved=True,
            replay_manifest_hash=replay_manifest_hash,
            replay_consistent=replay_consistent,
        )
        observation = connection.execute(
            "SELECT * FROM holo_observations WHERE source_frame_hash = ?",
            (source_frame["frame_hash"],),
        ).fetchone()
        response = _holo_commit_response(connection, observation)
        connection.commit()
        return response, 201
    except Exception as exc:
        if connection.in_transaction:
            connection.rollback()
        if subject is not None:
            try:
                connection.execute("BEGIN IMMEDIATE")
                existing = connection.execute(
                    "SELECT 1 FROM holo_observations WHERE source_frame_hash = ?",
                    (source_frame.get("frame_hash"),),
                ).fetchone()
                if existing is None:
                    _record_holo_observation(
                        connection,
                        source_frame_hash=source_frame["frame_hash"],
                        subject_rappid=subject,
                        authored_hash=authored_hash,
                        holo_id=None,
                        sightedness="blind",
                        reason=f"wild holo refused: {exc}",
                        structural_work_units=work_units,
                        evidence=evidence,
                        history_resolved=False,
                        replay_consistent=False,
                    )
                connection.commit()
            except Exception:
                connection.rollback()
        raise
    finally:
        connection.close()


def _holo_presence(subject_rappid: str) -> dict:
    if not rapp_protocol.rappid_valid(subject_rappid):
        raise ValueError("subject_rappid is invalid")
    connection = _holo_connect()
    try:
        rows = connection.execute(
            "SELECT * FROM holo_observations WHERE subject_rappid = ? "
            "AND channel_enabled = 1 "
            "ORDER BY rowid DESC LIMIT 8",
            (subject_rappid,),
        ).fetchall()
        disabled_count = connection.execute(
            "SELECT COUNT(*) AS count FROM holo_observations "
            "WHERE subject_rappid = ? AND channel_enabled = 0",
            (subject_rappid,),
        ).fetchone()["count"]
    finally:
        connection.close()
    rows = list(reversed(rows))
    if not rows:
        return {
            "schema": "rapp-holo-presence/1",
            "policy": "rapp-holo-presence-reference/1",
            "subject_rappid": subject_rappid,
            "evaluated_utc": rapp_protocol.utc_now_ms(),
            "window": None,
            "classification": "indeterminate",
            "reason_codes": [
                "holo-disabled" if disabled_count else "window-too-short"
            ],
        }
    counts = {
        name: sum(row["sightedness"] == name for row in rows)
        for name in ("sighted", "stale", "blind", "absent")
    }
    timed = sum(row["on_time"] is not None for row in rows)
    on_time = sum(row["on_time"] == 1 for row in rows)
    history_resolved = sum(row["history_resolved"] == 1 for row in rows)
    replay_consistent = sum(row["replay_consistent"] == 1 for row in rows)
    late = sum(row["on_time"] == 0 for row in rows)
    replay_failed = sum(row["replay_consistent"] == 0 for row in rows)
    if (
        len(rows) == 8
        and counts["sighted"] >= 7
        and timed >= 7
        and on_time >= 7
        and history_resolved >= 7
        and replay_consistent >= 7
        and not (counts["stale"] or counts["blind"])
    ):
        classification = "ai-present-likely"
        reasons = [
            "sustained-on-time-holo",
            "sustained-current-base",
            "sustained-history-resolution",
            "sustained-replay-consistency",
        ]
    elif len(rows) == 8 and (
        counts["absent"]
        + counts["stale"]
        + counts["blind"]
        + late
        + replay_failed
        >= 4
    ):
        classification = "unassisted-human-likely"
        reasons = []
        if counts["absent"]:
            reasons.append("verified-conversation-holo-absent")
        if counts["stale"]:
            reasons.append("repeated-stale-base")
        if counts["blind"]:
            reasons.append("repeated-blind-continuity")
        if late:
            reasons.append("verified-conversation-holo-late")
        if replay_failed:
            reasons.append("repeated-replay-inconsistency")
    else:
        classification = "indeterminate"
        reasons = ["window-too-short" if len(rows) < 8 else "insufficient-evidence"]
    return {
        "schema": "rapp-holo-presence/1",
        "policy": "rapp-holo-presence-reference/1",
        "subject_rappid": subject_rappid,
        "evaluated_utc": rapp_protocol.utc_now_ms(),
        "window": {
            "first_source_frame_hash": rows[0]["source_frame_hash"],
            "last_source_frame_hash": rows[-1]["source_frame_hash"],
            "turns_observed": len(rows),
            "holo_enabled_turns": len(rows),
            "timed_outputs": timed,
            "on_time_holo_outputs": on_time,
            "sighted_outputs": counts["sighted"],
            "stale_outputs": counts["stale"],
            "blind_outputs": counts["blind"],
            "history_resolved_outputs": history_resolved,
            "replay_consistent_outputs": replay_consistent,
        },
        "classification": classification,
        "reason_codes": reasons,
    }


def _utc_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _utc_milliseconds(value: datetime) -> str:
    current = value.astimezone(timezone.utc)
    return current.strftime("%Y-%m-%dT%H:%M:%S.") + (
        f"{current.microsecond // 1000:03d}Z"
    )


def _rolling_core_liveness(subject_rappid: str) -> dict:
    if not rapp_protocol.rappid_valid(subject_rappid):
        raise ValueError("subject_rappid is invalid")
    connection = _holo_connect()
    try:
        observation = connection.execute(
            "SELECT * FROM holo_observations WHERE subject_rappid = ? "
            "ORDER BY rowid DESC LIMIT 1",
            (subject_rappid,),
        ).fetchone()
        head = _current_holo_head(connection, subject_rappid)
    finally:
        connection.close()

    evaluated_utc = rapp_protocol.utc_now_ms()
    result = {
        "schema": "rapp-rolling-core-liveness/1",
        "policy": "verified-holo-tick-lease/1",
        "subject_rappid": subject_rappid,
        "evaluated_utc": evaluated_utc,
        "state": "sleeping",
        "reason_codes": [],
        "wake_lease_ms": None,
        "lease_age_ms": None,
        "lease_expires_utc": None,
        "current_head": _holo_head_payload(head),
        "last_observation": None,
    }
    if observation is None:
        result["reason_codes"] = ["no-observation"]
        return result

    result["last_observation"] = {
        "source_frame_hash": observation["source_frame_hash"],
        "holo_id": observation["holo_id"],
        "sightedness": observation["sightedness"],
        "observed_utc": observation["observed_utc"],
    }
    wake_lease = observation["wake_lease_ms"]
    result["wake_lease_ms"] = wake_lease
    if wake_lease is not None:
        observed_at = _utc_datetime(observation["observed_utc"])
        evaluated_at = _utc_datetime(evaluated_utc)
        age_ms = max(0, int((evaluated_at - observed_at).total_seconds() * 1000))
        result["lease_age_ms"] = age_ms
        result["lease_expires_utc"] = _utc_milliseconds(
            observed_at + timedelta(milliseconds=wake_lease)
        )

    if observation["sightedness"] == "blind":
        result["state"] = "quarantined"
        result["reason_codes"] = ["latest-output-blind"]
    elif observation["channel_enabled"] != 1:
        result["reason_codes"] = ["holo-channel-disabled"]
    elif wake_lease is None:
        result["reason_codes"] = ["wake-lease-unavailable"]
    elif result["lease_age_ms"] > wake_lease:
        result["reason_codes"] = ["wake-lease-expired"]
    elif observation["sightedness"] == "sighted" and observation["holo_id"]:
        result["state"] = "awake"
        result["reason_codes"] = ["verified-tick-fresh"]
    else:
        result["state"] = "waking"
        result["reason_codes"] = ["waiting-for-verified-tick"]
    return result


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


def _hologram_text(value, label: str, limit: int) -> str:
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > limit
        or value != unicodedata.normalize("NFC", value)
    ):
        raise ValueError(f"{label} must be bounded NFC text")
    return value


def _validate_hologram_scene(
    kind: str,
    scene: dict,
    *,
    allow_briefing: bool,
) -> dict:
    if not isinstance(scene, dict):
        raise ValueError("hologram scene must be an object")
    if kind == "character":
        if set(scene) != {"title", "subtitle"}:
            raise ValueError("character scene must contain exactly title and subtitle")
        _hologram_text(scene["title"], "scene.title", 120)
        _hologram_text(scene["subtitle"], "scene.subtitle", 240)
        return scene

    expected = {"prompt", "options"}
    if allow_briefing and "briefing" in scene:
        expected.add("briefing")
    if set(scene) != expected:
        raise ValueError(
            "data projection scene must contain prompt, options, and only "
            "an optional briefing"
        )
    _hologram_text(scene["prompt"], "scene.prompt", 300)
    options = scene["options"]
    if not isinstance(options, list) or len(options) != 3:
        raise ValueError("data projection must contain exactly three options")
    for option in options:
        if not isinstance(option, dict) or set(option) != {"label", "value"}:
            raise ValueError("each projection option must contain label and value")
        _hologram_text(option["label"], "option.label", 100)
        _hologram_text(option["value"], "option.value", 240)
    if "briefing" in scene:
        briefing = scene["briefing"]
        if (
            not isinstance(briefing, dict)
            or set(briefing) != {"trust", "revision"}
        ):
            raise ValueError("scene.briefing must contain exactly trust and revision")
        _hologram_text(briefing["trust"], "scene.briefing.trust", 40)
        _hologram_text(briefing["revision"], "scene.briefing.revision", 40)
    return scene


def _validate_hologram_entry(entry: dict, *, remote: bool = False) -> dict:
    if not isinstance(entry, dict):
        raise ValueError("hologram entry must be an object")
    hologram_id = entry.get("id")
    if (
        not isinstance(hologram_id, str)
        or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", hologram_id)
        or entry.get("kind") not in {"character", "data-projection"}
        or entry.get("engine") != "three-r128"
        or not rapp_protocol.rappid_valid(entry.get("rappid"))
        or not re.fullmatch(r"[0-9a-f]{64}", entry.get("default_seed", ""))
        or entry.get("accent") not in {"violet", "cyan", "ice"}
        or entry.get("data_binding") not in {"identity-seed", "live-zoo"}
        or entry.get("bottle") is not True
        or not isinstance(entry.get("dimensions"), list)
        or not entry.get("dimensions")
        or len(entry["dimensions"]) > 32
        or len(entry["dimensions"]) != len(set(entry["dimensions"]))
        or not all(
            isinstance(value, str)
            and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value)
            for value in entry["dimensions"]
        )
    ):
        raise ValueError("invalid hologram catalog entry")
    _hologram_text(entry.get("name"), "hologram name", 60)
    _hologram_text(entry.get("description"), "hologram description", 500)
    _hologram_text(entry.get("version"), "hologram version", 40)
    _validate_hologram_scene(
        entry["kind"],
        entry.get("scene"),
        allow_briefing=True,
    )
    if remote:
        expected = {
            "schema",
            "id",
            "rappid",
            "name",
            "kind",
            "bottle",
            "dimensions",
            "version",
            "engine",
            "minimum_zoo_version",
            "description",
            "source_file",
            "default_seed",
            "accent",
            "data_binding",
            "scene",
            "summon",
        }
        if set(entry) != expected or entry.get("schema") != "rar-hologram-dogg/1.0":
            raise ValueError("remote hologram DOGG has an unknown or missing member")
        if entry.get("summon") != {
            "adapter": "rapp-zoo",
            "endpoint": "/api/holograms/summon",
        }:
            raise ValueError("remote hologram DOGG has an unsupported summon adapter")
        encoded = json.dumps(entry, ensure_ascii=False).lower()
        if any(
            forbidden in encoded
            for forbidden in ("<script", "javascript:", "http://", "https://", "eval(")
        ):
            raise ValueError("remote hologram DOGG contains executable or remote content")
    return entry


def _installed_hologram_dir() -> str:
    return os.path.join(rapp_home(), "holograms", "rar")


def _generated_hologram_dir() -> str:
    return os.path.join(rapp_home(), "holograms", "generated")


def _write_json_exclusive(destination: str, value: dict) -> None:
    temporary = f"{destination}.tmp-{secrets.token_hex(12)}"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_BINARY"):
        flags |= os.O_BINARY
    descriptor = os.open(temporary, flags, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, destination)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def _hologram_catalog() -> dict:
    path = os.path.join(_HOLOGRAM_DIR, "catalog.json")
    with open(path, "r", encoding="utf-8") as handle:
        catalog = json.load(handle)
    if catalog.get("schema") != "rapp-zoo-holograms/1.0":
        raise ValueError("unsupported hologram catalog schema")
    entries = catalog.get("holograms")
    if not isinstance(entries, list):
        raise ValueError("hologram catalog must contain an array")
    seen = set()
    for entry in entries:
        _validate_hologram_entry(entry)
        hologram_id = entry["id"]
        if hologram_id in seen:
            raise ValueError("duplicate hologram catalog entry")
        entry["source"] = "bundled"
        entry["rar_notarized"] = False
        seen.add(hologram_id)
    installed = _installed_hologram_dir()
    if os.path.isdir(installed):
        for filename in sorted(os.listdir(installed)):
            if not filename.endswith(".json"):
                continue
            with open(os.path.join(installed, filename), "r", encoding="utf-8") as handle:
                record = _validate_hologram_entry(json.load(handle), remote=True)
            normalized = {
                key: value
                for key, value in record.items()
                if key not in {"schema", "minimum_zoo_version", "summon"}
            }
            normalized["source"] = "rar"
            normalized["rar_notarized"] = True
            if normalized["id"] in seen:
                entries = [
                    normalized if entry["id"] == normalized["id"] else entry
                    for entry in entries
                ]
            else:
                entries.append(normalized)
                seen.add(normalized["id"])
    generated = _generated_hologram_dir()
    if os.path.isdir(generated):
        for filename in sorted(os.listdir(generated)):
            if not filename.endswith(".json"):
                continue
            with open(os.path.join(generated, filename), "r", encoding="utf-8") as handle:
                record = json.load(handle)
            if (
                not isinstance(record, dict)
                or set(record) != {"schema", "source_frame", "hologram"}
                or record.get("schema") != "rapp-zoo-generated-hologram/1.0"
            ):
                raise ValueError("invalid generated hologram record")
            entry = _validate_hologram_entry(record["hologram"])
            retained_dimensions = [
                value
                for value in entry["dimensions"]
                if value not in _DIMENSION_STOPWORDS
            ]
            if retained_dimensions:
                entry["dimensions"] = retained_dimensions
            entry["source"] = "copilot"
            entry["rar_notarized"] = False
            if entry["id"] in seen:
                raise ValueError("generated hologram id collides with the catalog")
            entries.append(entry)
            seen.add(entry["id"])
    return {
        "schema": catalog["schema"],
        "rar_catalog_url": os.environ.get(
            "RAR_HOLOGRAM_INDEX_URL", _RAR_HOLOGRAM_INDEX
        ),
        "holograms": entries,
    }


def _hologram_entry(hologram_id: str) -> dict | None:
    return next(
        (
            entry
            for entry in _hologram_catalog()["holograms"]
            if entry["id"] == hologram_id
        ),
        None,
    )


def _fetch_dogg_bytes(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "rapp-zoo-hologram-dogg/1.0"},
    )
    with urllib.request.urlopen(request, timeout=12) as response:
        content = response.read(_MAX_DOGG_BYTES + 1)
    if len(content) > _MAX_DOGG_BYTES:
        raise ValueError("RAR hologram DOGG exceeds the byte limit")
    return content


def _rar_hologram_index() -> dict:
    url = os.environ.get("RAR_HOLOGRAM_INDEX_URL", _RAR_HOLOGRAM_INDEX)
    index = json.loads(_fetch_dogg_bytes(url).decode("utf-8"))
    if (
        index.get("schema") != "rar-hologram-dogg-index/1.0"
        or not isinstance(index.get("entries"), list)
    ):
        raise ValueError("RAR hologram index schema is unsupported")
    seen = set()
    for entry in index["entries"]:
        expected = {
            "id",
            "rappid",
            "name",
            "kind",
            "bottle",
            "dimensions",
            "version",
            "record_url",
            "record_sha256",
        }
        if (
            not isinstance(entry, dict)
            or set(entry) != expected
            or entry["id"] in seen
            or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", entry["id"])
            or entry["kind"] not in {"character", "data-projection"}
            or entry["bottle"] is not True
            or not isinstance(entry["dimensions"], list)
            or not entry["dimensions"]
            or not all(
                isinstance(value, str)
                and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", value)
                for value in entry["dimensions"]
            )
            or not rapp_protocol.rappid_valid(entry["rappid"])
            or not re.fullmatch(r"[0-9a-f]{64}", entry["record_sha256"])
        ):
            raise ValueError("RAR hologram index contains an invalid entry")
        parsed = urllib.parse.urlparse(entry["record_url"])
        expected_path = f"/kody-w/RAR/main/doggs/holograms/{entry['id']}.json"
        if (
            parsed.scheme != "https"
            or parsed.netloc != "raw.githubusercontent.com"
            or parsed.path != expected_path
            or parsed.params
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("RAR hologram record URL is outside the allowlist")
        seen.add(entry["id"])
    return index


def _validate_hologram_design(design: dict) -> dict:
    expected = {"name", "kind", "accent", "description", "scene"}
    if not isinstance(design, dict) or set(design) != expected:
        raise ValueError("Copilot hologram design has unknown or missing members")
    if design["kind"] not in {"character", "data-projection"}:
        raise ValueError("Copilot hologram kind is unsupported")
    if design["accent"] not in {"violet", "cyan", "ice"}:
        raise ValueError("Copilot hologram accent is unsupported")
    _hologram_text(design["name"], "Copilot hologram name", 60)
    _hologram_text(
        design["description"],
        "Copilot hologram description",
        500,
    )
    _validate_hologram_scene(
        design["kind"],
        design["scene"],
        allow_briefing=False,
    )
    encoded = json.dumps(design, ensure_ascii=False).lower()
    if any(
        forbidden in encoded
        for forbidden in (
            "<script",
            "javascript:",
            "http://",
            "https://",
            "shader",
            "eval(",
        )
    ):
        raise ValueError("Copilot hologram design contains executable or remote content")
    return design


def _desktop_capability_valid() -> bool:
    expected = os.environ.get("RAPP_ZOO_DESKTOP_TOKEN")
    supplied = request.headers.get("X-RAPP-Zoo-Desktop", "")
    return bool(expected and hmac.compare_digest(expected, supplied))


def _frame_tokens(frame: dict, query: str = "") -> set[str]:
    tokens = set(
        re.findall(
            r"[a-z0-9]+",
            f"{frame.get('kind', '')} {query}".lower(),
        )
    )

    def visit(value):
        if isinstance(value, dict):
            for key, item in value.items():
                tokens.update(re.findall(r"[a-z0-9]+", str(key).lower()))
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, str):
            tokens.update(re.findall(r"[a-z0-9]+", value.lower()))

    visit(frame.get("payload"))
    return {
        token
        for token in tokens
        if len(token) >= 3 and token not in _DIMENSION_STOPWORDS
    }


def _match_hologram(frame: dict, query: str = "") -> dict:
    entries = _hologram_catalog()["holograms"]
    tokens = _frame_tokens(frame, query)
    ranked = []
    for entry in entries:
        matches = sorted(set(entry["dimensions"]) & tokens)
        score = len(matches) * 4
        for dimension in entry["dimensions"]:
            if any(
                dimension in token or token in dimension
                for token in tokens
                if token != dimension
            ):
                score += 1
        ranked.append((score, entry["id"], matches, entry))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    score, _, matches, entry = ranked[0]
    mode = "dimensional"
    if score == 0:
        index = int(frame["frame_hash"][:8], 16) % len(entries)
        entry = sorted(entries, key=lambda item: item["id"])[index]
        mode = "nearest-static"
    return {
        "schema": "rapp-zoo-hologram-match/1.0",
        "mode": mode,
        "score": score,
        "matched_dimensions": matches,
        "tokens": sorted(tokens)[:64],
        "hologram": entry,
    }


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
            "frame-src 'self' http://hologram.localhost:7070; "
            "object-src 'none'; base-uri 'self'; "
            "frame-ancestors 'self'",
        )
        return response

    @app.route("/api/health")
    def health():
        peers = peer_registry.load()["peers"]
        live_count = sum(1 for p in peers if _probe_health(p.get("port") or 0)["live"])
        response = jsonify({
            "name": "rapp-zoo",
            "version": APP_VERSION,
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
        holograms = _hologram_catalog()["holograms"]
        holo_connection = _holo_connect()
        try:
            holo_head_rows = holo_connection.execute(
                "SELECT * FROM holo_heads ORDER BY subject_rappid"
            ).fetchall()
            player_active = _player_active_holos(holo_connection)
        finally:
            holo_connection.close()
        holo_heads = [
            {
                **_holo_head_payload(row),
                "player_active_holo_id": player_active.get(
                    row["subject_rappid"]
                ),
                "presence": _holo_presence(row["subject_rappid"]),
                "liveness": _rolling_core_liveness(row["subject_rappid"]),
            }
            for row in holo_head_rows
        ]
        return jsonify({
            "schema": "rapp-zoo-intelligence-context/1.0",
            "health": {
                "lineage_count": len(lineages),
                "instance_count": sum(
                    len(item["instances"]) for item in lineages
                ),
                "egg_count": len(egg_summaries),
                "hologram_count": len(holograms),
                "holo_subject_count": len(holo_heads),
            },
            "lineages": lineages,
            "eggs": egg_summaries,
            "holo_heads": holo_heads,
            "holo_output": {
                "protocol": "rapp-holo-output/1",
                "renderer_contract": "rapp-holo-renderer/1",
                "subject_rappid": HOLOGRAM_GENERATOR_RAPPID,
                "turn_endpoint": "/api/holo/turn",
            },
            "visible_controls": [
                "nav.collection",
                "nav.starters",
                "nav.holocards",
                "nav.holograms",
                "nav.discover",
                "collection.refresh",
                "egg.import",
                "brainstem.open",
                "holo.view-current",
                "holo.flipbook",
                "holo.presence",
                "holo.liveness",
                "hologram.legacy-hotload",
            ],
        }), 200

    @app.route("/api/holograms")
    def hologram_catalog():
        catalog = _hologram_catalog()
        catalog["zoo_version"] = APP_VERSION
        return jsonify(catalog), 200

    @app.route("/api/holo/example-turn")
    def holo_example_turn():
        with open(
            os.path.join(
                _HOLOGRAM_DIR,
                "protocol",
                "examples",
                "minimal-blank-output.json",
            ),
            "r",
            encoding="utf-8",
        ) as handle:
            authored = json.load(handle)
        frame = rapp_protocol.build_frame(
            "memory.chat-turn",
            f"{HOLOGRAM_GENERATOR_RAPPID}:holo-demo",
            0,
            rapp_protocol.utc_now_ms(),
            {
                "role": "assistant",
                "outputs": {
                    "text": "Holo/1 example turn.",
                    "voice": None,
                    "holo": authored,
                },
            },
            None,
        )
        return jsonify(frame), 200

    @app.route("/api/holo/examples/fantasy-draft")
    def holo_fantasy_draft_frame():
        frame = rapp_protocol.build_frame(
            "body.pulse",
            HOLOGRAM_GENERATOR_RAPPID,
            0,
            rapp_protocol.utc_now_ms(),
            _fantasy_draft_payload(),
            None,
        )
        return jsonify(frame), 200

    @app.route("/api/holo/turn", methods=["POST"])
    def commit_holo_turn():
        if not _desktop_capability_valid():
            return jsonify({"error": "desktop Brainstem capability required"}), 403
        body = request.get_json(silent=True) or {}
        expected = {"subject_rappid", "session_id", "text", "holo", "evidence"}
        if set(body) != expected:
            return jsonify({
                "error": (
                    "request must contain subject_rappid, session_id, text, "
                    "holo, and evidence"
                ),
            }), 400
        try:
            source_frame = _build_holo_source_turn(
                subject_rappid=body["subject_rappid"],
                session_id=body["session_id"],
                text_output=body["text"],
                holo_output=body["holo"],
                evidence=body["evidence"],
            )
            result, status = _commit_holo_source(source_frame)
        except sqlite3.OperationalError as exc:
            return jsonify({"error": f"holo turn unavailable: {exc}"}), 503
        except Exception as exc:
            return jsonify({"error": f"holo turn refused: {exc}"}), 422
        result["source_frame"] = source_frame
        return jsonify(result), status

    @app.route("/api/holo/commit", methods=["POST"])
    def commit_holo_output():
        if not _desktop_capability_valid():
            return jsonify({"error": "desktop Brainstem capability required"}), 403
        body = request.get_json(silent=True) or {}
        if set(body) != {"source_frame"}:
            return jsonify({
                "error": "request must contain exactly source_frame",
            }), 400
        try:
            result, status = _commit_holo_source(body["source_frame"])
        except sqlite3.OperationalError as exc:
            return jsonify({"error": f"holo append unavailable: {exc}"}), 503
        except Exception as exc:
            return jsonify({"error": f"holo output refused: {exc}"}), 422
        return jsonify(result), status

    @app.route("/api/holo/ingest", methods=["POST"])
    def ingest_wild_holo():
        if not _desktop_capability_valid():
            return jsonify({"error": "desktop Brainstem capability required"}), 403
        body = request.get_json(silent=True) or {}
        if set(body) != {"source_frame", "body_chain"}:
            return jsonify({
                "error": "request must contain exactly source_frame and body_chain",
            }), 400
        try:
            result, status = _ingest_holo_bundle(
                body["source_frame"],
                body["body_chain"],
            )
        except sqlite3.OperationalError as exc:
            return jsonify({"error": f"wild holo ingest unavailable: {exc}"}), 503
        except Exception as exc:
            return jsonify({"error": f"wild holo refused: {exc}"}), 422
        return jsonify(result), status

    @app.route("/api/holo/heads")
    def holo_heads():
        connection = _holo_connect()
        try:
            rows = connection.execute(
                "SELECT * FROM holo_heads ORDER BY subject_rappid"
            ).fetchall()
            player_active = _player_active_holos(connection)
        finally:
            connection.close()
        heads = []
        for row in rows:
            head = _holo_head_payload(row)
            head["player_active_holo_id"] = player_active.get(
                row["subject_rappid"]
            )
            head["presence"] = _holo_presence(row["subject_rappid"])
            heads.append(head)
        return jsonify({
            "schema": "rapp-holo-heads/1",
            "heads": heads,
        }), 200

    @app.route("/api/holo/history")
    def holo_history():
        subject = request.args.get("subject_rappid", "")
        if not rapp_protocol.rappid_valid(subject):
            return jsonify({"error": "valid subject_rappid is required"}), 400
        try:
            limit = int(request.args.get("limit", "64"))
        except ValueError:
            return jsonify({"error": "limit must be an integer"}), 400
        if not 1 <= limit <= 256:
            return jsonify({"error": "limit must be between 1 and 256"}), 400
        before = request.args.get("before")
        params: list = [subject]
        condition = ""
        if before is not None:
            try:
                before_seq = int(before)
            except ValueError:
                return jsonify({"error": "before must be an integer"}), 400
            condition = " AND holo_seq < ?"
            params.append(before_seq)
        params.append(limit)
        connection = _holo_connect()
        try:
            rows = connection.execute(
                "SELECT * FROM holo_records WHERE subject_rappid = ?"
                + condition
                + " ORDER BY holo_seq DESC LIMIT ?",
                params,
            ).fetchall()
            head = _current_holo_head(connection, subject)
        finally:
            connection.close()
        return jsonify({
            "schema": "rapp-holo-history/1",
            "subject_rappid": subject,
            "current_head": _holo_head_payload(head),
            "frames": [
                {
                    "holo_id": row["holo_id"],
                    "holo_seq": row["holo_seq"],
                    "visual_parent": row["visual_parent"],
                    "source_frame_hash": row["source_frame_hash"],
                    "frame": json.loads(row["frame_json"]),
                }
                for row in rows
            ],
        }), 200

    @app.route("/api/holo/frames/<holo_id>")
    def holo_frame(holo_id: str):
        if not re.fullmatch(r"[0-9a-f]{64}", holo_id):
            return jsonify({"error": "holo_id must be 64 lowercase hex"}), 400
        connection = _holo_connect()
        try:
            row = _holo_record_row(connection, holo_id)
            if row is None:
                return jsonify({"error": "unknown holo frame"}), 404
            head = _current_holo_head(connection, row["subject_rappid"])
            response = {
                "schema": "rapp-holo-frame-view/1",
                "authoritative": bool(head and head["holo_id"] == holo_id),
                "frame": json.loads(row["frame_json"]),
                "compiled": json.loads(row["compiled_json"]),
            }
        finally:
            connection.close()
        return jsonify(response), 200

    @app.route("/api/holo/sources/<frame_hash>")
    def holo_source(frame_hash: str):
        if not re.fullmatch(r"[0-9a-f]{64}", frame_hash):
            return jsonify({"error": "frame hash must be 64 lowercase hex"}), 400
        connection = _holo_connect()
        try:
            row = connection.execute(
                "SELECT frame_json FROM source_frames WHERE frame_hash = ?",
                (frame_hash,),
            ).fetchone()
        finally:
            connection.close()
        if row is None:
            return jsonify({"error": "unknown source frame"}), 404
        return jsonify(json.loads(row["frame_json"])), 200

    @app.route("/api/holo/presence")
    def holo_presence():
        subject = request.args.get("subject_rappid", "")
        try:
            result = _holo_presence(subject)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(result), 200

    @app.route("/api/holo/liveness")
    def holo_liveness():
        subject = request.args.get("subject_rappid", "")
        try:
            result = _rolling_core_liveness(subject)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        return jsonify(result), 200

    @app.route("/api/holo/activate", methods=["POST"])
    def activate_holo():
        body = request.get_json(silent=True) or {}
        expected = {
            "player_id",
            "previous_active_holo_id",
            "departure_logical_ms",
            "departure_manifest_hash",
            "new_holo_id",
        }
        if set(body) != expected:
            return jsonify({"error": "invalid activation record members"}), 400
        player_id = body["player_id"]
        if not rapp_protocol.lclabel_valid(player_id, 64):
            return jsonify({"error": "player_id must be a lowercase label"}), 400
        new_holo_id = body["new_holo_id"]
        previous = body["previous_active_holo_id"]
        departure_ms = body["departure_logical_ms"]
        departure_hash = body["departure_manifest_hash"]
        if not isinstance(new_holo_id, str) or not re.fullmatch(
            r"[0-9a-f]{64}", new_holo_id
        ):
            return jsonify({"error": "new_holo_id is invalid"}), 400
        connection = _holo_connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            new_row = _holo_record_row(connection, new_holo_id)
            if new_row is None:
                raise ValueError("new holo frame is unknown")
            last = connection.execute(
                "SELECT * FROM holo_activations WHERE player_id = ? "
                "ORDER BY activation_order DESC LIMIT 1",
                (player_id,),
            ).fetchone()
            if last is not None and last["new_holo_id"] == new_holo_id:
                connection.commit()
                return jsonify({
                    "schema": "rapp-holo-activation/1",
                    "player_id": player_id,
                    "activation_order": last["activation_order"],
                    "previous_active_holo_id": last["previous_active_holo_id"],
                    "departure_logical_ms": last["departure_logical_ms"],
                    "departure_manifest_hash": last["departure_manifest_hash"],
                    "new_holo_id": last["new_holo_id"],
                    "activated_utc": last["activated_utc"],
                }), 200
            if last is None:
                if previous is not None or departure_ms is not None or departure_hash is not None:
                    raise ValueError("first activation cannot declare a departure")
                activation_order = 0
            else:
                if previous != last["new_holo_id"]:
                    raise ValueError("activation does not extend the player-active holo")
                if (
                    not isinstance(departure_ms, int)
                    or isinstance(departure_ms, bool)
                    or departure_ms < 0
                    or not isinstance(departure_hash, str)
                    or not re.fullmatch(r"[0-9a-f]{64}", departure_hash)
                ):
                    raise ValueError("activation departure evidence is invalid")
                if new_row["visual_parent"] != previous:
                    raise ValueError("player must activate accepted holos in visual order")
                activation_order = last["activation_order"] + 1
            activated_utc = rapp_protocol.utc_now_ms()
            connection.execute(
                "INSERT INTO holo_activations "
                "(player_id, activation_order, previous_active_holo_id, "
                "departure_logical_ms, departure_manifest_hash, new_holo_id, "
                "activated_utc) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    player_id,
                    activation_order,
                    previous,
                    departure_ms,
                    departure_hash,
                    new_holo_id,
                    activated_utc,
                ),
            )
            connection.commit()
        except Exception as exc:
            connection.rollback()
            return jsonify({"error": f"holo activation refused: {exc}"}), 422
        finally:
            connection.close()
        return jsonify({
            "schema": "rapp-holo-activation/1",
            "player_id": player_id,
            "activation_order": activation_order,
            "previous_active_holo_id": previous,
            "departure_logical_ms": departure_ms,
            "departure_manifest_hash": departure_hash,
            "new_holo_id": new_holo_id,
            "activated_utc": activated_utc,
        }), 201

    @app.route("/api/holograms/<hologram_id>")
    def hologram_metadata(hologram_id: str):
        entry = _hologram_entry(hologram_id)
        if entry is None:
            return jsonify({"error": "unknown hologram"}), 404
        return jsonify(entry), 200

    @app.route("/api/holograms/example-frame")
    def hologram_example_frame():
        payload = {
            "schema": "rapp-zoo-hologram-request/1.0",
            "query": "Create a living briefing character for the current estate.",
            "dimensions": [
                "briefing",
                "status",
                "census",
                "character",
            ],
            "zoo": {
                "lineages": len(peer_registry.group_by_lineage()),
                "holograms": len(_hologram_catalog()["holograms"]),
            },
        }
        frame = rapp_protocol.build_frame(
            "body.pulse",
            HOLOGRAM_GENERATOR_RAPPID,
            0,
            rapp_protocol.utc_now_ms(),
            payload,
            None,
        )
        return jsonify(frame), 200

    @app.route("/api/holograms/match", methods=["POST"])
    def match_hologram():
        body = request.get_json(silent=True) or {}
        frame = body.get("frame")
        query = body.get("query") or ""
        if not isinstance(query, str) or len(query) > 2000:
            return jsonify({"error": "query must be bounded text"}), 400
        ok, step, why = _verify_hologram_frame(frame)
        if not ok:
            return jsonify({"error": f"RAPP frame refused at {step}: {why}"}), 422
        return jsonify(_match_hologram(frame, query)), 200

    @app.route("/api/holograms/generated", methods=["POST"])
    def store_generated_hologram():
        if not _desktop_capability_valid():
            return jsonify({"error": "desktop Brainstem capability required"}), 403
        body = request.get_json(silent=True) or {}
        frame = body.get("frame")
        randomize = body.get("randomize", True)
        try:
            if not isinstance(randomize, bool):
                raise ValueError("randomize must be boolean")
            ok, step, why = _verify_hologram_frame(frame)
            if not ok:
                raise ValueError(f"RAPP frame refused at {step}: {why}")
            design = _validate_hologram_design(body.get("design"))
            dimensional_match = _match_hologram(
                frame, design["description"]
            )
            slug = rapp_protocol.slugify(design["name"])
            directory = _generated_hologram_dir()
            owner = rapp_protocol.require_owner(default="kody-w")
            dimensions = sorted(
                {
                    design["kind"].replace("-projection", ""),
                    design["accent"],
                    *_frame_tokens(frame),
                }
            )[:32]
            os.makedirs(directory, exist_ok=True)
            for _ in range(8 if randomize else 1):
                entropy = secrets.token_bytes(32) if randomize else b""
                seed = hashlib.sha256(
                    b"rapp-zoo:hologram\n"
                    + bytes.fromhex(frame["frame_hash"])
                    + entropy
                    + rapp_protocol.canonical(design).encode("utf-8")
                ).hexdigest()
                hologram_id = f"generated-{slug}-{seed[:24]}"
                destination = os.path.join(directory, f"{hologram_id}.json")
                if os.path.exists(destination):
                    if randomize:
                        continue
                    with open(destination, "r", encoding="utf-8") as handle:
                        existing = json.load(handle)
                    existing_hologram = existing.get("hologram") or {}
                    existing_source = existing.get("source_frame") or {}
                    if (
                        existing_hologram.get("default_seed") == seed
                        and existing_source.get("frame_hash") == frame["frame_hash"]
                    ):
                        return jsonify({
                            "ok": True,
                            "hologram": existing_hologram,
                            "match": dimensional_match,
                            "reused": True,
                        }), 200
                    raise ValueError("deterministic hologram id collision")
                entry = {
                    "id": hologram_id,
                    "rappid": rapp_protocol.mint_rappid(owner, hologram_id),
                    "name": design["name"].strip(),
                    "kind": design["kind"],
                    "version": "1.0.0",
                    "engine": "three-r128",
                    "description": design["description"].strip(),
                    "source_file": "copilot-generated",
                    "default_seed": seed,
                    "accent": design["accent"],
                    "data_binding": (
                        "identity-seed"
                        if design["kind"] == "character"
                        else "live-zoo"
                    ),
                    "bottle": True,
                    "dimensions": dimensions,
                    "scene": design["scene"],
                    "generation": {
                        "brainstem": _FOUNDRY_URL,
                        "source_frame_hash": frame["frame_hash"],
                        "source_payload_hash": frame["payload_hash"],
                        "randomized": randomize,
                        "created_utc": rapp_protocol.utc_now_ms(),
                    },
                }
                _validate_hologram_entry(entry)
                record = {
                    "schema": "rapp-zoo-generated-hologram/1.0",
                    "source_frame": {
                        key: frame[key]
                        for key in (
                            "spec",
                            "kind",
                            "stream_id",
                            "seq",
                            "utc",
                            "payload_hash",
                            "frame_hash",
                        )
                    },
                    "hologram": entry,
                }
                try:
                    _write_json_exclusive(destination, record)
                except FileExistsError:
                    if randomize:
                        continue
                    raise ValueError("deterministic hologram id collision")
                break
            else:
                raise ValueError("could not allocate a unique randomized hologram id")
        except Exception as exc:
            return jsonify({"error": f"generated hologram refused: {exc}"}), 422
        return jsonify({
            "ok": True,
            "hologram": entry,
            "match": dimensional_match,
        }), 200

    @app.route("/api/holograms/rar")
    def rar_holograms():
        try:
            index = _rar_hologram_index()
        except Exception as exc:
            return jsonify({"error": f"RAR hologram catalog unavailable: {exc}"}), 502
        return jsonify(index), 200

    @app.route("/api/holograms/summon", methods=["POST"])
    def summon_hologram():
        body = request.get_json(silent=True) or {}
        hologram_id = body.get("id")
        if not isinstance(hologram_id, str) or not re.fullmatch(
            r"[a-z0-9]+(?:-[a-z0-9]+)*", hologram_id
        ):
            return jsonify({"error": "a valid hologram id is required"}), 400
        try:
            index = _rar_hologram_index()
            indexed = next(
                entry for entry in index["entries"] if entry["id"] == hologram_id
            )
        except StopIteration:
            return jsonify({"error": "hologram is not present in the RAR DOGG index"}), 404
        except Exception as exc:
            return jsonify({"error": f"RAR hologram catalog unavailable: {exc}"}), 502
        try:
            record_bytes = _fetch_dogg_bytes(indexed["record_url"])
            actual = hashlib.sha256(record_bytes).hexdigest()
            if actual != indexed["record_sha256"]:
                raise ValueError(
                    f"record hash mismatch: expected {indexed['record_sha256']}, got {actual}"
                )
            record = _validate_hologram_entry(
                json.loads(record_bytes.decode("utf-8")),
                remote=True,
            )
            if any(
                record[field] != indexed[field]
                for field in (
                    "id",
                    "rappid",
                    "name",
                    "kind",
                    "bottle",
                    "dimensions",
                    "version",
                )
            ):
                raise ValueError("RAR index and hologram record disagree")
            destination_dir = _installed_hologram_dir()
            os.makedirs(destination_dir, exist_ok=True)
            destination = os.path.join(destination_dir, f"{hologram_id}.json")
            temporary = destination + ".tmp"
            with open(temporary, "wb") as handle:
                handle.write(record_bytes)
            os.replace(temporary, destination)
        except Exception as exc:
            return jsonify({"error": f"hologram DOGG refused: {exc}"}), 422
        return jsonify({
            "ok": True,
            "id": record["id"],
            "rappid": record["rappid"],
            "record_sha256": actual,
            "installed_path": destination,
        }), 200

    @app.route("/holograms/<hologram_id>")
    def hologram_viewer(hologram_id: str):
        entry = _hologram_entry(hologram_id)
        if entry is None:
            return jsonify({"error": "unknown hologram"}), 404
        template_path = os.path.join(_HOLOGRAM_DIR, "viewer.html")
        with open(template_path, "r", encoding="utf-8") as handle:
            template = handle.read()
        encoded = json.dumps(
            entry,
            ensure_ascii=False,
            separators=(",", ":"),
        ).replace("</", "<\\/")
        nonce = secrets.token_urlsafe(24)
        response = app.response_class(
            template
            .replace("__HOLOGRAM_CONFIG__", encoded)
            .replace("__HOLOGRAM_NONCE__", nonce),
            mimetype="text/html",
        )
        response.headers["Content-Security-Policy"] = (
            f"default-src 'none'; script-src 'nonce-{nonce}'; "
            f"style-src 'nonce-{nonce}'; "
            "img-src data:; connect-src 'none'; object-src 'none'; "
            "base-uri 'none'; frame-ancestors 'self' "
            "http://127.0.0.1:7070 http://localhost:7070"
        )
        return response

    @app.route("/holo/<holo_id>")
    def holo_viewer(holo_id: str):
        if not re.fullmatch(r"[0-9a-f]{64}", holo_id):
            return jsonify({"error": "holo_id must be 64 lowercase hex"}), 400
        connection = _holo_connect()
        try:
            row = _holo_record_row(connection, holo_id)
            if row is None:
                return jsonify({"error": "unknown holo frame"}), 404
            frame = json.loads(row["frame_json"])
            try:
                history = _holo_history_closure(connection, row)
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 422
            head = _current_holo_head(connection, row["subject_rappid"])
            player_active = _player_active_holos(connection).get(
                row["subject_rappid"]
            )
        finally:
            connection.close()
        subject_name = rapp_protocol.rappid_parts(row["subject_rappid"])["slug"]
        config = {
            "schema": "rapp-holo-player-update/1",
            "id": holo_id,
            "rappid": row["subject_rappid"],
            "name": subject_name,
            "kind": "holo-stream",
            "mode": "holo/1",
            "record": frame,
            "base": history.get(frame["payload"]["visual_parent"]),
            "history": history,
            "authoritative_holo_id": head["holo_id"] if head else None,
            "player_active_holo_id": player_active,
            "holo_seq": row["holo_seq"],
            "source_frame_hash": row["source_frame_hash"],
        }
        template_path = os.path.join(_HOLOGRAM_DIR, "viewer.html")
        with open(template_path, "r", encoding="utf-8") as handle:
            template = handle.read()
        encoded = json.dumps(
            config,
            ensure_ascii=False,
            separators=(",", ":"),
        ).replace("</", "<\\/")
        nonce = secrets.token_urlsafe(24)
        response = app.response_class(
            template
            .replace("__HOLOGRAM_CONFIG__", encoded)
            .replace("__HOLOGRAM_NONCE__", nonce),
            mimetype="text/html",
        )
        response.headers["Content-Security-Policy"] = (
            f"default-src 'none'; script-src 'nonce-{nonce}'; "
            f"style-src 'nonce-{nonce}'; "
            "img-src data:; connect-src 'none'; object-src 'none'; "
            "base-uri 'none'; frame-ancestors 'self' "
            "http://127.0.0.1:7070 http://localhost:7070"
        )
        return response

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
