"""RAPP/1 rev-6 protocol primitives used by rapp-zoo.

This module is the single implementation boundary for RAPP identities, frames,
and eggs.
It is dependency-free unless detached JWS signing or verification is requested,
in which case the optional ``cryptography`` package is loaded lazily.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import struct
import time
import unicodedata
import uuid
import zipfile
import zlib
from datetime import datetime, timezone
from typing import Callable, Mapping, Optional


SPEC = "rapp/1"
SPEC_REVISION = "rev-6"
SPEC_COMMIT = "2d3e50df04d5beaf40045da244493503d16f7779"
SPEC_SHA256 = "8212bbccaf86f2dc81bd07e2fcd5184f3a157f4eee162b13a698407684b6e134"

EGG_SCHEMA = "rapp/1-egg"
EGG_VARIANTS = {
    "organism",
    "rapplication",
    "session",
    "invite",
    "neighborhood",
    "estate",
}
JSON_EGG_VARIANTS = {"session", "invite"}
EGG_MANIFEST_KEYS = {
    "schema",
    "variant",
    "rappid",
    "created_utc",
    "contents",
    "payload",
    "sig",
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

MAX_CANONICAL_BYTES = 1024 * 1024
MAX_JSON_DEPTH = 64
MAX_NESTED_EGG_DEPTH = 8
MAX_EGG_ENTRIES = 4096
MAX_EGG_FILE_BYTES = 64 * 1024 * 1024
MAX_EGG_TOTAL_BYTES = 256 * 1024 * 1024

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
_LCLABEL = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_RAPPID = re.compile(
    r"^rappid:@([a-z0-9]+(?:-[a-z0-9]+)*)/"
    r"([a-z0-9]+(?:-[a-z0-9]+)*):([0-9a-f]{64})$"
)
_KIND = re.compile(
    r"^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$"
)

SignatureVerifier = Callable[[dict, str, bool], tuple[bool, str]]
FrameSignatureVerifier = Callable[[dict, str], tuple[bool, str]]
# Rev-6 kinds named by the pinned specification; authenticated registries can
# supply a larger append-only mapping to verify estate-specific extensions.
CORE_KIND_FAMILIES = {
    "memory.chat-turn": "memory",
    "memory.tool-call": "memory",
    "memory.save": "memory",
    "memory.reconstructed": "memory",
    "memory.re-genesis": "memory",
    "swarm.guidance": "swarm",
    "swarm.echo": "swarm",
    "swarm.telemetry": "swarm",
    "swarm.reconstructed": "swarm",
    "swarm.re-genesis": "swarm",
    "body.pulse": "body",
    "body.twin-pulse": "body",
    "body.reconstructed": "body",
    "body.re-genesis": "body",
}


class ProtocolError(ValueError):
    """A RAPP value cannot be parsed or represented without repairing it."""


class EggRuleError(ProtocolError):
    def __init__(self, step: str, reason: str):
        super().__init__(reason)
        self.step = step
        self.reason = reason


def _raise_float(_: str):
    raise ProtocolError("floats require full RFC 8785 number serialization")


def _raise_constant(value: str):
    raise ProtocolError(f"non-I-JSON numeric constant: {value}")


def _object_from_pairs(pairs):
    out = {}
    for key, value in pairs:
        if key in out:
            raise ProtocolError(f"duplicate object member: {key!r}")
        out[key] = value
    return out


def strict_json_loads(raw: bytes | str):
    """Parse UTF-8 I-JSON without duplicate keys, floats, or non-finite values."""
    if isinstance(raw, bytes):
        if len(raw) > MAX_CANONICAL_BYTES:
            raise ProtocolError("JSON exceeds the 1 MiB RAPP limit")
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ProtocolError(f"JSON is not UTF-8: {exc}") from exc
    elif isinstance(raw, str):
        text = raw
        if len(text.encode("utf-8")) > MAX_CANONICAL_BYTES:
            raise ProtocolError("JSON exceeds the 1 MiB RAPP limit")
    else:
        raise ProtocolError("JSON input must be bytes or str")

    try:
        value = json.loads(
            text,
            object_pairs_hook=_object_from_pairs,
            parse_float=_raise_float,
            parse_constant=_raise_constant,
        )
    except ProtocolError:
        raise
    except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise ProtocolError(f"invalid JSON: {exc}") from exc
    canonical(value)
    return value


def _check_string(value: str) -> None:
    if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise ProtocolError("unpaired UTF-16 surrogate")


def _canonical(value, depth: int) -> str:
    if depth > MAX_JSON_DEPTH:
        raise ProtocolError("JSON nesting exceeds 64")
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, int):
        if abs(value) > 2**53 - 1:
            raise ProtocolError("integer outside the interoperable uint53 range")
        return json.dumps(value)
    if isinstance(value, float):
        raise ProtocolError("floats require full RFC 8785 number serialization")
    if isinstance(value, str):
        _check_string(value)
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(_canonical(item, depth + 1) for item in value) + "]"
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise ProtocolError("JSON object keys must be strings")
        for key in value:
            _check_string(key)
        keys = sorted(value, key=lambda key: key.encode("utf-16-be"))
        return (
            "{"
            + ",".join(
                json.dumps(key, ensure_ascii=False)
                + ":"
                + _canonical(value[key], depth + 1)
                for key in keys
            )
            + "}"
        )
    raise ProtocolError(f"non-I-JSON value: {type(value).__name__}")


def canonical(value) -> str:
    """Return the RAPP profile's RFC 8785 canonical UTF-8 string."""
    encoded = _canonical(value, 1)
    if len(encoded.encode("utf-8")) > MAX_CANONICAL_BYTES:
        raise ProtocolError("canonical value exceeds 1 MiB")
    return encoded


def H(space: str, value) -> str:
    return hashlib.sha256(
        space.encode("ascii") + b"\x0a" + canonical(value).encode("utf-8")
    ).hexdigest()


def Hb(space: str, octets: bytes) -> str:
    if not isinstance(octets, bytes):
        raise ProtocolError("Hb input must be bytes")
    return hashlib.sha256(space.encode("ascii") + b"\x0a" + octets).hexdigest()


def lclabel_valid(value: str, max_length: int) -> bool:
    return (
        isinstance(value, str)
        and 1 <= len(value) <= max_length
        and bool(_LCLABEL.fullmatch(value))
        and unicodedata.normalize("NFC", value) == value
    )


def slugify(value: str, max_length: int = 100) -> str:
    normalized = unicodedata.normalize("NFC", str(value)).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    slug = slug[:max_length].rstrip("-")
    if not lclabel_valid(slug, max_length):
        raise ProtocolError(f"cannot form a RAPP lowercase label from {value!r}")
    return slug


def rappid_valid(value: str) -> bool:
    if not isinstance(value, str):
        return False
    match = _RAPPID.fullmatch(value)
    return bool(
        match
        and lclabel_valid(match.group(1), 39)
        and lclabel_valid(match.group(2), 100)
    )


def rappid_parts(value: str) -> dict:
    match = _RAPPID.fullmatch(value or "")
    if not match:
        raise ProtocolError(f"invalid RAPPID: {value!r}")
    return {
        "owner": match.group(1),
        "slug": match.group(2),
        "hash": match.group(3),
        "rappid": value,
    }


def require_owner(value: Optional[str] = None, *, default: Optional[str] = None) -> str:
    owner = (value or os.environ.get("RAPP_OWNER") or default or "").lstrip("@")
    if not lclabel_valid(owner, 39):
        raise ProtocolError(
            "a lowercase GitHub login is required; set RAPP_OWNER or pass owner="
        )
    return owner


def mint_rappid(
    owner: str,
    slug: str,
    *,
    spki_der: Optional[bytes] = None,
    uuid_bytes: Optional[bytes] = None,
) -> str:
    owner = require_owner(owner)
    if not lclabel_valid(slug, 100):
        raise ProtocolError(f"invalid RAPPID slug: {slug!r}")
    if spki_der is not None and uuid_bytes is not None:
        raise ProtocolError("choose keyed or keyless minting, not both")
    source = spki_der if spki_der is not None else (uuid_bytes or uuid.uuid4().bytes)
    if not isinstance(source, bytes):
        raise ProtocolError("RAPPID mint source must be bytes")
    return f"rappid:@{owner}/{slug}:{Hb('rapp/1:rappid', source)}"


def utc_now_ms() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def utc_valid(value: str) -> bool:
    if not isinstance(value, str) or not _UTC.fullmatch(value):
        return False
    if value[17:19] == "60":
        return False
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        return False
    return True


def _stream_id_valid(value: str) -> bool:
    if not isinstance(value, str):
        return False
    if value.startswith("net:"):
        return lclabel_valid(value[4:], 64)
    if rappid_valid(value):
        return True
    if ":" not in value:
        return False
    rappid, instance = value.rsplit(":", 1)
    return rappid_valid(rappid) and lclabel_valid(instance, 64)


def _stream_family(value: str) -> Optional[str]:
    if value.startswith("net:"):
        return "swarm"
    if rappid_valid(value):
        return "body"
    if ":" in value:
        rappid, instance = value.rsplit(":", 1)
        if rappid_valid(rappid) and lclabel_valid(instance, 64):
            return "memory"
    return None


def build_frame(
    kind: str,
    stream_id: str,
    seq: int,
    utc: str,
    payload: dict,
    prev: Optional[str],
    *,
    prev_wave: Optional[str] = None,
    sig: Optional[str] = None,
    head: Optional[dict] = None,
    kind_families: Optional[Mapping[str, str]] = None,
    signature_verifier: Optional[FrameSignatureVerifier] = None,
) -> dict:
    if not _KIND.fullmatch(kind or ""):
        raise ProtocolError("frame kind is invalid")
    if not _stream_id_valid(stream_id):
        raise ProtocolError("frame stream_id is invalid")
    if not (
        isinstance(seq, int)
        and not isinstance(seq, bool)
        and 0 <= seq <= 2**53 - 1
    ):
        raise ProtocolError("frame seq must be uint53")
    if not utc_valid(utc) or not isinstance(payload, dict):
        raise ProtocolError("frame utc or payload is invalid")
    payload_hash = H("rapp/1:particle", payload)
    frame = {
        "spec": SPEC,
        "kind": kind,
        "stream_id": stream_id,
        "seq": seq,
        "utc": utc,
        "payload": payload,
        "payload_hash": payload_hash,
        "frame_hash": "",
        "prev": prev,
        "prev_wave": prev_wave,
        "sig": sig,
    }
    preimage = {
        key: value
        for key, value in frame.items()
        if key not in {"frame_hash", "sig"}
    }
    frame["frame_hash"] = H("rapp/1:wave", preimage)
    ok, step, why = verify_frame(
        frame,
        head=head,
        stream_id_of_record=stream_id,
        kind_families=kind_families,
        signature_verifier=signature_verifier,
    )
    if not ok:
        raise ProtocolError(f"frame producer refusal at {step}: {why}")
    return frame


def verify_frame(
    frame: dict,
    *,
    head: Optional[dict] = None,
    stream_id_of_record: Optional[str] = None,
    kind_families: Optional[Mapping[str, str]] = None,
    signature_verifier: Optional[FrameSignatureVerifier] = None,
) -> tuple[bool, Optional[str], str]:
    if not isinstance(frame, dict) or set(frame) != FRAME_KEYS:
        return False, "1", "frame must contain exactly eleven keys"
    if (
        frame["spec"] != SPEC
        or not isinstance(frame["kind"], str)
        or not _KIND.fullmatch(frame["kind"])
        or not _stream_id_valid(frame["stream_id"])
        or not isinstance(frame["payload"], dict)
        or not utc_valid(frame["utc"])
    ):
        return False, "1", "frame shape or grammar is invalid"
    registered_kinds = (
        CORE_KIND_FAMILIES if kind_families is None else kind_families
    )
    family = registered_kinds.get(frame["kind"])
    if family not in {"memory", "swarm", "body"}:
        return False, "1", "frame kind is not registered"
    if _stream_family(frame["stream_id"]) != family:
        return False, "1", "frame kind family is incompatible with stream_id"
    if not (
        isinstance(frame["seq"], int)
        and not isinstance(frame["seq"], bool)
        and 0 <= frame["seq"] <= 2**53 - 1
    ):
        return False, "1", "frame seq is not uint53"
    for key in ("payload_hash", "frame_hash"):
        if not isinstance(frame[key], str) or not _HEX64.fullmatch(frame[key]):
            return False, "1", f"{key} is not 64 lowercase hex"
    for key in ("prev", "prev_wave"):
        if frame[key] is not None and (
            not isinstance(frame[key], str)
            or not _HEX64.fullmatch(frame[key])
        ):
            return False, "1", f"{key} must be null or 64 lowercase hex"
    if frame["sig"] is not None:
        if not isinstance(frame["sig"], str):
            return False, "1", "sig must be null or a detached JWS"
        try:
            parse_detached_jws(frame["sig"])
        except ProtocolError as exc:
            return False, "1", f"sig is not a conformant detached JWS: {exc}"
    if (
        stream_id_of_record is not None
        and frame["stream_id"] != stream_id_of_record
    ):
        return False, "1a", "stream_id does not match the stream of record"
    if head is not None and stream_id_of_record is None:
        return False, "1a", "non-genesis verification requires a stream of record"
    try:
        if frame["payload_hash"] != H("rapp/1:particle", frame["payload"]):
            return False, "2", "payload_hash mismatch"
        preimage = {
            key: value
            for key, value in frame.items()
            if key not in {"frame_hash", "sig"}
        }
        if frame["frame_hash"] != H("rapp/1:wave", preimage):
            return False, "3", "frame_hash mismatch"
    except ProtocolError as exc:
        return False, "1", str(exc)
    if head is not None and (
        not isinstance(head, dict)
        or head.get("stream_id") != frame["stream_id"]
        or not isinstance(head.get("seq"), int)
        or isinstance(head.get("seq"), bool)
        or not isinstance(head.get("payload_hash"), str)
        or not _HEX64.fullmatch(head["payload_hash"])
        or not isinstance(head.get("frame_hash"), str)
        or not _HEX64.fullmatch(head["frame_hash"])
        or not utc_valid(head.get("utc"))
    ):
        return False, "4", "supplied head is invalid or belongs to another stream"
    if head is None:
        if frame["seq"] != 0 or frame["prev"] is not None:
            return False, "4", "genesis must be seq 0 with prev null"
    else:
        if (
            frame["seq"] != head["seq"] + 1
            or frame["prev"] != head["payload_hash"]
            or frame["utc"] < head["utc"]
        ):
            return False, "4", "frame does not extend the supplied head"
    is_swarm = frame["stream_id"].startswith("net:")
    if is_swarm and frame["seq"] > 0:
        if head is not None and frame["prev_wave"] != head["frame_hash"]:
            return False, "5", "swarm prev_wave mismatch"
    elif frame["prev_wave"] is not None:
        return False, "5", "prev_wave must be null outside non-genesis swarm frames"
    if is_swarm and frame["sig"] is None:
        return False, "6", "swarm frame must be signed"
    if frame["sig"] is not None:
        if signature_verifier is None:
            return False, "6", "signed frame cannot be verified without trusted registry material"
        unsigned = {key: value for key, value in frame.items() if key != "sig"}
        try:
            ok, why = signature_verifier(unsigned, frame["sig"])
        except Exception as exc:
            return False, "6", f"frame signature verifier failed: {exc}"
        if not ok:
            return False, "6", why
    return True, None, "ok"


def _path_valid(path: str) -> bool:
    if not isinstance(path, str) or not path:
        return False
    if path == "manifest.json" or path.startswith("/") or "\\" in path:
        return False
    if unicodedata.normalize("NFC", path) != path:
        return False
    parts = path.split("/")
    return all(part not in ("", ".", "..") for part in parts)


def _normalized_files(files: Optional[Mapping[str, bytes | str]]) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    for path, value in dict(files or {}).items():
        if not _path_valid(path):
            raise ProtocolError(f"invalid egg path: {path!r}")
        if path in out:
            raise ProtocolError(f"duplicate egg path: {path}")
        if isinstance(value, str):
            value = value.encode("utf-8")
        if not isinstance(value, bytes):
            raise ProtocolError(f"egg content must be bytes: {path}")
        out[path] = value
    return out


def _egg_contents(files: Mapping[str, bytes]) -> list[dict]:
    contents = [
        {"path": path, "hash": Hb("rapp/1:egg", octets)}
        for path, octets in files.items()
    ]
    contents.sort(key=lambda item: item["path"].encode("utf-8"))
    return contents


def build_egg_manifest(
    variant: str,
    rappid: str,
    created_utc: str,
    *,
    files: Optional[Mapping[str, bytes | str]] = None,
    payload: Optional[dict] = None,
    sig: Optional[str] = None,
) -> tuple[dict, dict[str, bytes]]:
    if variant not in EGG_VARIANTS:
        raise ProtocolError(f"unknown egg variant: {variant!r}")
    if not rappid_valid(rappid):
        raise ProtocolError(f"invalid egg RAPPID: {rappid!r}")
    if not utc_valid(created_utc):
        raise ProtocolError("created_utc must use the fixed millisecond UTC form")
    packed = _normalized_files(files)
    if variant in JSON_EGG_VARIANTS and packed:
        raise ProtocolError(f"{variant} is a JSON egg and cannot contain files")
    payload = {} if payload is None else payload
    if not isinstance(payload, dict):
        raise ProtocolError("egg payload must be an object")
    if sig is not None and not isinstance(sig, str):
        raise ProtocolError("egg sig must be a detached JWS string or null")
    manifest = {
        "schema": EGG_SCHEMA,
        "variant": variant,
        "rappid": rappid,
        "created_utc": created_utc,
        "contents": [] if variant in JSON_EGG_VARIANTS else _egg_contents(packed),
        "payload": payload,
        "sig": sig,
    }
    canonical(manifest)
    return manifest, packed


def egg_address(manifest: dict) -> str:
    return H(
        "rapp/1:egg-manifest",
        {key: value for key, value in manifest.items() if key != "sig"},
    )


def _stored_zip(entries: list[tuple[str, bytes]]) -> bytes:
    """Write the exact §9.1 ZIP profile, including UTF-8 flags on ASCII paths."""
    if len(entries) > 0xFFFF:
        raise ProtocolError("egg has too many ZIP entries")
    body = io.BytesIO()
    central = io.BytesIO()
    for name, data in entries:
        encoded_name = name.encode("utf-8")
        if len(encoded_name) > 0xFFFF or len(data) > 0xFFFFFFFF:
            raise ProtocolError(f"ZIP entry exceeds the non-Zip64 RAPP profile: {name}")
        crc = zlib.crc32(data) & 0xFFFFFFFF
        offset = body.tell()
        body.write(
            struct.pack(
                "<IHHHHHIIIHH",
                0x04034B50,
                20,
                0x800,
                0,
                0,
                33,
                crc,
                len(data),
                len(data),
                len(encoded_name),
                0,
            )
        )
        body.write(encoded_name)
        body.write(data)
        central.write(
            struct.pack(
                "<IHHHHHHIIIHHHHHII",
                0x02014B50,
                20,
                20,
                0x800,
                0,
                0,
                33,
                crc,
                len(data),
                len(data),
                len(encoded_name),
                0,
                0,
                0,
                0,
                0,
                offset,
            )
        )
        central.write(encoded_name)
    central_offset = body.tell()
    central_bytes = central.getvalue()
    body.write(central_bytes)
    body.write(
        struct.pack(
            "<IHHHHIIH",
            0x06054B50,
            0,
            0,
            len(entries),
            len(entries),
            len(central_bytes),
            central_offset,
            0,
        )
    )
    return body.getvalue()


def serialize_egg(manifest: dict, files: Mapping[str, bytes]) -> bytes:
    manifest_octets = canonical(manifest).encode("utf-8")
    variant = manifest["variant"]
    if variant in JSON_EGG_VARIANTS:
        return manifest_octets
    entries = [("manifest.json", manifest_octets)]
    entries.extend((item["path"], files[item["path"]]) for item in manifest["contents"])
    return _stored_zip(entries)


def pack_egg(
    variant: str,
    rappid: str,
    created_utc: str,
    *,
    files: Optional[Mapping[str, bytes | str]] = None,
    payload: Optional[dict] = None,
    sig: Optional[str] = None,
    signature_verifier: Optional[SignatureVerifier] = None,
) -> bytes:
    manifest, packed = build_egg_manifest(
        variant,
        rappid,
        created_utc,
        files=files,
        payload=payload,
        sig=sig,
    )
    blob = serialize_egg(manifest, packed)
    ok, step, why = verify_egg(blob, signature_verifier=signature_verifier)
    if not ok:
        raise ProtocolError(f"producer would emit a non-conformant egg ({step}: {why})")
    return blob


def _parse_egg(blob: bytes):
    if not isinstance(blob, bytes) or not blob:
        raise ProtocolError("egg must be non-empty bytes")
    if blob[:2] == b"PK":
        try:
            archive = zipfile.ZipFile(io.BytesIO(blob))
        except zipfile.BadZipFile as exc:
            raise ProtocolError(f"invalid ZIP egg: {exc}") from exc
        try:
            infos = archive.infolist()
            if len(infos) > MAX_EGG_ENTRIES:
                raise EggRuleError("resource", "ZIP egg has too many entries")
            names = [info.filename for info in infos]
            if len(names) != len(set(names)):
                raise ProtocolError("ZIP egg contains duplicate entries")
            if "manifest.json" not in names:
                raise ProtocolError("ZIP egg has no manifest.json")
            total_size = 0
            for info in infos:
                if info.flag_bits & 0x1:
                    raise EggRuleError("§9.1", "encrypted ZIP entries are not allowed")
                if info.compress_type != zipfile.ZIP_STORED:
                    raise EggRuleError(
                        "§9.1", f"ZIP entry is compressed: {info.filename}"
                    )
                if info.file_size > MAX_EGG_FILE_BYTES:
                    raise EggRuleError(
                        "resource", f"ZIP entry exceeds size limit: {info.filename}"
                    )
                total_size += info.file_size
                if total_size > MAX_EGG_TOTAL_BYTES:
                    raise EggRuleError("resource", "ZIP egg exceeds expanded-size limit")
            manifest_octets = archive.read("manifest.json")
            manifest = strict_json_loads(manifest_octets)
            files = {
                info.filename: archive.read(info.filename)
                for info in infos
                if info.filename != "manifest.json"
            }
        except ProtocolError:
            raise
        except (KeyError, RuntimeError, zipfile.BadZipFile, zlib.error) as exc:
            raise ProtocolError(f"corrupt ZIP egg: {exc}") from exc
        finally:
            archive.close()
        return manifest, files, "zip", infos, manifest_octets
    manifest = strict_json_loads(blob)
    return manifest, {}, "json", [], blob


def read_egg(blob: bytes) -> tuple[dict, dict[str, bytes]]:
    manifest, files, _, _, _ = _parse_egg(blob)
    return manifest, files


def _identity_ok(raw: bytes, expected_rappid: str) -> Optional[str]:
    try:
        identity = strict_json_loads(raw)
    except ProtocolError as exc:
        return f"rappid.json is invalid: {exc}"
    if not isinstance(identity, dict):
        return "rappid.json must be an object"
    if identity.get("schema") != SPEC:
        return "rappid.json schema must be rapp/1"
    if identity.get("rappid") != expected_rappid:
        return "rappid.json identity must match the egg manifest RAPPID"
    if not rappid_valid(identity.get("rappid")):
        return "rappid.json contains an invalid RAPPID"
    return None


def _member_filename(rappid: str) -> str:
    parts = rappid_parts(rappid)
    return f"{parts['owner']}--{parts['slug']}.egg"


def _variant_viability(
    manifest: dict,
    files: dict[str, bytes],
    signature_verifier: Optional[SignatureVerifier],
    depth: int,
) -> Optional[str]:
    variant = manifest["variant"]
    payload = manifest["payload"]
    if variant == "organism":
        if not {"rappid.json", "soul.md"} <= set(files):
            return "organism contents must include rappid.json and soul.md"
        return _identity_ok(files["rappid.json"], manifest["rappid"])
    if variant == "rapplication":
        if "rappid.json" not in files:
            return "rapplication contents must include rappid.json"
        root_python = sorted(
            path for path in files if "/" not in path and path.endswith(".py")
        )
        if root_python != ["agent.py"]:
            return "rapplication must contain exactly one root agent.py"
        return _identity_ok(files["rappid.json"], manifest["rappid"])
    if variant == "session":
        if set(payload) != {"runtime", "transcript"}:
            return "session payload must be exactly {runtime, transcript}"
        if not isinstance(payload["runtime"], str):
            return "session runtime must be a string"
        if not (
            isinstance(payload["transcript"], list)
            and all(isinstance(turn, dict) for turn in payload["transcript"])
        ):
            return "session transcript must be an array of objects"
        return None
    if variant == "invite":
        if set(payload) != {"target_rappid", "target_url", "target_kind"}:
            return "invite payload must be exactly {target_rappid, target_url, target_kind}"
        if not rappid_valid(payload["target_rappid"]):
            return "invite target_rappid is invalid"
        if not isinstance(payload["target_url"], str) or not payload["target_url"]:
            return "invite target_url must be a non-empty string"
        if payload["target_kind"] not in {"neighborhood", "estate"}:
            return "invite target_kind must be neighborhood or estate"
        return None
    if variant in {"neighborhood", "estate"}:
        key = "members" if variant == "neighborhood" else "neighborhoods"
        if set(payload) != {key}:
            return f"{variant} payload must be exactly {{{key}}}"
        members = payload[key]
        if not (
            isinstance(members, list)
            and len(members) == len(set(members))
            and all(rappid_valid(member) for member in members)
        ):
            return f"{variant} {key} must be unique valid RAPPIDs"
        expected = {_member_filename(member): member for member in members}
        if set(files) != set(expected):
            return f"{variant} must contain exactly one root sub-egg per {key[:-1]}"
        if depth >= MAX_NESTED_EGG_DEPTH:
            return "nested egg depth exceeds the implementation limit"
        for filename, expected_rappid in expected.items():
            ok, step, why = verify_egg(
                files[filename],
                signature_verifier=signature_verifier,
                _depth=depth + 1,
            )
            if not ok:
                return f"nested egg {filename} refused at {step}: {why}"
            child, _ = read_egg(files[filename])
            if child["rappid"] != expected_rappid:
                return f"nested egg {filename} does not match its declared RAPPID"
            if variant == "estate" and child["variant"] != "neighborhood":
                return f"estate member {filename} must be a neighborhood egg"
        return None
    return f"unsupported egg variant: {variant}"


def verify_egg(
    blob: bytes,
    *,
    signature_verifier: Optional[SignatureVerifier] = None,
    _depth: int = 0,
) -> tuple[bool, Optional[str], str]:
    """Verify RAPP/1 egg integrity, signature policy, then viability."""
    try:
        manifest, files, container, infos, manifest_octets = _parse_egg(blob)
    except EggRuleError as exc:
        return False, exc.step, exc.reason
    except ProtocolError as exc:
        return False, "parse", str(exc)
    if not isinstance(manifest, dict) or set(manifest) != EGG_MANIFEST_KEYS:
        return False, "§9.1", "manifest must have exactly the seven RAPP/1 members"
    if manifest["schema"] != EGG_SCHEMA:
        return False, "§9.1", f"schema must be {EGG_SCHEMA}"
    variant = manifest["variant"]
    if variant not in EGG_VARIANTS:
        return False, "§9.2", f"unknown variant: {variant!r}"
    if not rappid_valid(manifest["rappid"]):
        return False, "§6.1", f"invalid RAPPID: {manifest['rappid']!r}"
    if not utc_valid(manifest["created_utc"]):
        return False, "§7.4", "created_utc is not fixed-form calendar-valid UTC"
    if not isinstance(manifest["payload"], dict):
        return False, "§9.1", "payload must be an object"
    if manifest["sig"] is not None and not isinstance(manifest["sig"], str):
        return False, "§9.1", "sig must be a detached JWS string or null"
    try:
        expected_manifest = canonical(manifest).encode("utf-8")
    except ProtocolError as exc:
        return False, "§4", str(exc)
    if manifest_octets != expected_manifest:
        return False, "§9.1", "manifest bytes are not canonical"

    contents = manifest["contents"]
    if not isinstance(contents, list):
        return False, "§9.1", "contents must be an array"
    paths = []
    for item in contents:
        if not isinstance(item, dict) or set(item) != {"path", "hash"}:
            return False, "§9.1", "each contents entry must be exactly {path, hash}"
        if not _path_valid(item["path"]):
            return False, "§9.1", f"invalid content path: {item['path']!r}"
        if not isinstance(item["hash"], str) or not _HEX64.fullmatch(item["hash"]):
            return False, "§9.1", f"invalid content hash: {item['path']}"
        paths.append(item["path"])
    if len(paths) != len(set(paths)):
        return False, "§9.1", "contents contains duplicate paths"
    if paths != sorted(paths, key=lambda path: path.encode("utf-8")):
        return False, "§9.1", "contents is not sorted by UTF-8 path bytes"

    if variant in JSON_EGG_VARIANTS:
        if container != "json" or contents or files:
            return False, "§9.1", f"{variant} must be a canonical JSON egg"
    else:
        if container != "zip":
            return False, "§9.1", f"{variant} must be a ZIP egg"
        expected_names = ["manifest.json", *paths]
        if [info.filename for info in infos] != expected_names:
            return False, "§9.1", "ZIP entry order or entry set differs from contents"
        for info in infos:
            if info.compress_type != zipfile.ZIP_STORED:
                return False, "§9.1", f"ZIP entry is compressed: {info.filename}"
            if info.date_time != (1980, 1, 1, 0, 0, 0):
                return False, "§9.1", f"ZIP timestamp is not deterministic: {info.filename}"
            if info.extra:
                return False, "§9.1", f"ZIP entry contains extra fields: {info.filename}"
            if not (info.flag_bits & 0x800):
                return False, "§9.1", f"ZIP entry lacks the UTF-8 flag: {info.filename}"
        if set(files) != set(paths):
            return False, "§9.1", "ZIP entry set differs from contents"
        for item in contents:
            if Hb("rapp/1:egg", files[item["path"]]) != item["hash"]:
                return False, "§5", f"content hash mismatch: {item['path']}"

    if variant == "invite" and manifest["sig"] is None:
        return False, "§10", "invite signature is required"
    if manifest["sig"] is not None:
        if signature_verifier is None:
            return False, "§10", "signed egg cannot be verified without trusted registry material"
        ok, why = signature_verifier(
            {key: value for key, value in manifest.items() if key != "sig"},
            manifest["sig"],
            variant == "invite",
        )
        if not ok:
            return False, "§10", why

    why = _variant_viability(manifest, files, signature_verifier, _depth)
    if why:
        return False, "§9.2", why
    return True, None, "ok"


def inspect_egg(
    blob: bytes,
    *,
    signature_verifier: Optional[SignatureVerifier] = None,
) -> dict:
    ok, step, why = verify_egg(blob, signature_verifier=signature_verifier)
    if not ok:
        raise ProtocolError(f"{step}: {why}")
    manifest, files = read_egg(blob)
    return {
        "manifest": manifest,
        "files": files,
        "egg_hash": egg_address(manifest),
    }


def _b64url_decode(value: str) -> bytes:
    if not isinstance(value, str) or "=" in value:
        raise ProtocolError("base64url value must be unpadded")
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, base64.binascii.Error) as exc:
        raise ProtocolError(f"invalid base64url: {exc}") from exc


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def parse_detached_jws(sig: str) -> tuple[dict, str, bytes]:
    parts = sig.split(".") if isinstance(sig, str) else []
    if len(parts) != 3 or parts[1] != "":
        raise ProtocolError("JWS must use detached compact serialization")
    header_octets = _b64url_decode(parts[0])
    header = strict_json_loads(header_octets)
    if not isinstance(header, dict) or set(header) != {"alg", "b64", "crit", "kid"}:
        raise ProtocolError("JWS protected header must have exactly alg,b64,crit,kid")
    if header["alg"] not in {"EdDSA", "ES256"}:
        raise ProtocolError("JWS alg must be EdDSA or ES256")
    if header["b64"] is not False or header["crit"] != ["b64"]:
        raise ProtocolError("JWS must use b64=false with crit=['b64']")
    if not rappid_valid(header["kid"]):
        raise ProtocolError("JWS kid must be a valid keyed RAPPID")
    if header_octets != canonical(header).encode("utf-8"):
        raise ProtocolError("JWS protected header is not canonical")
    return header, parts[0], _b64url_decode(parts[2])


def verify_detached_jws(
    value: dict,
    sig: str,
    spki_der: bytes,
    *,
    expected_kid: Optional[str] = None,
) -> tuple[bool, str]:
    try:
        header, protected, signature = parse_detached_jws(sig)
        kid = header["kid"]
        if expected_kid is not None and kid != expected_kid:
            return False, f"JWS kid {kid} does not match required signer {expected_kid}"
        if Hb("rapp/1:rappid", spki_der) != rappid_parts(kid)["hash"]:
            return False, "JWS key does not match the kid RAPPID tail"
        signing_input = (
            protected.encode("ascii") + b"." + canonical(value).encode("utf-8")
        )
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec, ed25519
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

        public_key = serialization.load_der_public_key(spki_der)
        if header["alg"] == "EdDSA":
            if not isinstance(public_key, ed25519.Ed25519PublicKey):
                return False, "EdDSA JWS did not resolve to an Ed25519 key"
            public_key.verify(signature, signing_input)
        else:
            if not (
                isinstance(public_key, ec.EllipticCurvePublicKey)
                and isinstance(public_key.curve, ec.SECP256R1)
                and len(signature) == 64
            ):
                return False, "ES256 JWS requires a P-256 key and 64-byte raw signature"
            r = int.from_bytes(signature[:32], "big")
            s = int.from_bytes(signature[32:], "big")
            public_key.verify(
                encode_dss_signature(r, s),
                signing_input,
                ec.ECDSA(hashes.SHA256()),
            )
    except ImportError:
        return False, "cryptography is required to verify signed RAPP eggs"
    except InvalidSignature:
        return False, "detached JWS signature is invalid"
    except (ProtocolError, ValueError, TypeError) as exc:
        return False, str(exc)
    return True, "ok"


def sign_detached_jws(value: dict, private_key, kid: str, *, alg: str = "EdDSA") -> str:
    if alg not in {"EdDSA", "ES256"}:
        raise ProtocolError("JWS alg must be EdDSA or ES256")
    if not rappid_valid(kid):
        raise ProtocolError("JWS kid must be a valid RAPPID")
    header = {"alg": alg, "b64": False, "crit": ["b64"], "kid": kid}
    protected = _b64url_encode(canonical(header).encode("utf-8"))
    signing_input = protected.encode("ascii") + b"." + canonical(value).encode("utf-8")
    if alg == "EdDSA":
        signature = private_key.sign(signing_input)
    else:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

        der = private_key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
        r, s = decode_dss_signature(der)
        signature = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return protected + ".." + _b64url_encode(signature)


class RegistryTrust:
    """Verified registry material used for RAPP/1 egg JWS checks."""

    def __init__(
        self,
        registry: dict,
        *,
        trust_anchor_rappid: str,
        trust_anchor_spki_der: bytes,
        minimum_seq: int = 0,
    ):
        if not rappid_valid(trust_anchor_rappid):
            raise ProtocolError("invalid estate-owner trust anchor RAPPID")
        if Hb("rapp/1:rappid", trust_anchor_spki_der) != rappid_parts(
            trust_anchor_rappid
        )["hash"]:
            raise ProtocolError("estate-owner SPKI does not match the trust anchor")
        if not isinstance(registry, dict):
            raise ProtocolError("registry must be an object")
        if registry.get("schema") != "rapp/1-registry":
            raise ProtocolError("registry schema must be rapp/1-registry")
        seq = registry.get("registry_seq")
        if not (
            isinstance(seq, int)
            and not isinstance(seq, bool)
            and minimum_seq <= seq <= 2**53 - 1
        ):
            raise ProtocolError("registry_seq is invalid or rolled back")
        entries = registry.get("entries")
        if not isinstance(entries, list) or not all(
            isinstance(entry, dict) for entry in entries
        ):
            raise ProtocolError("registry entries must be an array of objects")
        sig = registry.get("sig")
        if not isinstance(sig, str):
            raise ProtocolError("registry must carry its detached owner signature")
        unsigned = {key: value for key, value in registry.items() if key != "sig"}
        ok, why = verify_detached_jws(
            unsigned,
            sig,
            trust_anchor_spki_der,
            expected_kid=trust_anchor_rappid,
        )
        if not ok:
            raise ProtocolError(f"registry signature refused: {why}")

        owners = [
            entry["rappid"]
            for entry in entries
            if entry.get("type") == "estate_owner"
            and not entry.get("deprecated", False)
            and rappid_valid(entry.get("rappid"))
        ]
        if owners != [trust_anchor_rappid]:
            raise ProtocolError("registry must name the pinned estate owner exactly once")

        self.registry_seq = seq
        self.estate_owner = trust_anchor_rappid
        self.keys: dict[str, bytes] = {}
        self.kind_families: dict[str, str] = {}
        for entry in entries:
            if entry.get("type") == "kind":
                if (
                    set(entry) != {"type", "kind", "family", "deprecated"}
                    or not isinstance(entry.get("kind"), str)
                    or not _KIND.fullmatch(entry["kind"])
                    or entry.get("family") not in {"memory", "swarm", "body"}
                    or not isinstance(entry.get("deprecated"), bool)
                ):
                    raise ProtocolError("registry contains an invalid kind entry")
                if not entry["deprecated"]:
                    if entry["kind"] in self.kind_families:
                        raise ProtocolError(
                            f"registry repeats active kind {entry['kind']}"
                        )
                    self.kind_families[entry["kind"]] = entry["family"]
                continue
            if entry.get("type") != "spki":
                continue
            rappid = entry.get("rappid")
            encoded = entry.get("spki_der_b64")
            if not rappid_valid(rappid) or not isinstance(encoded, str):
                raise ProtocolError("registry contains an invalid SPKI entry")
            try:
                spki = base64.b64decode(encoded, validate=True)
            except (ValueError, base64.binascii.Error) as exc:
                raise ProtocolError(f"registry SPKI is not base64: {exc}") from exc
            if Hb("rapp/1:rappid", spki) != rappid_parts(rappid)["hash"]:
                raise ProtocolError(f"registry SPKI does not match {rappid}")
            self.keys[rappid] = spki
        self.reanchors = [
            entry for entry in entries if entry.get("type") == "re-anchor"
        ]
        self.tombstones = [
            entry for entry in entries if entry.get("type") == "tombstone"
        ]
        self._verify_lifecycle_entries()

    def _owner_reaches_current(self, rappid: str) -> bool:
        seen = set()
        current = rappid
        while current != self.estate_owner:
            if current in seen:
                return False
            seen.add(current)
            matches = [
                entry
                for entry in self.reanchors
                if entry.get("old_rappid") == current
            ]
            if len(matches) != 1:
                return False
            current = matches[0].get("new_rappid")
        return True

    def _verify_owner_signed_entry(self, entry: dict, excluded: set[str]) -> None:
        sig = entry.get("sig")
        if not isinstance(sig, str):
            raise ProtocolError(f"{entry.get('type')} registry entry is unsigned")
        header, _, _ = parse_detached_jws(sig)
        kid = header["kid"]
        if not self._owner_reaches_current(kid):
            raise ProtocolError(f"{entry.get('type')} signer is not in owner succession")
        spki = self.keys.get(kid)
        if spki is None:
            raise ProtocolError(f"registry has no SPKI for lifecycle signer {kid}")
        unsigned = {key: value for key, value in entry.items() if key not in excluded}
        ok, why = verify_detached_jws(unsigned, sig, spki, expected_kid=kid)
        if not ok:
            raise ProtocolError(f"{entry.get('type')} signature refused: {why}")

    def _verify_lifecycle_entries(self) -> None:
        for entry in self.reanchors:
            if not (
                isinstance(entry.get("old_rappid"), str)
                and bool(entry.get("old_rappid"))
                and rappid_valid(entry.get("new_rappid"))
                and entry.get("case")
                in {"upgrade", "rotation", "compromise", "tag-migrate"}
                and utc_valid(entry.get("utc"))
            ):
                raise ProtocolError("registry contains an invalid re-anchor entry")
            self._verify_owner_signed_entry(entry, {"sig", "old_key_sig"})
            if entry["case"] == "rotation":
                old_sig = entry.get("old_key_sig")
                old_spki = self.keys.get(entry["old_rappid"])
                if not isinstance(old_sig, str) or old_spki is None:
                    raise ProtocolError("rotation requires old_key_sig and old SPKI")
                old_value = {
                    key: value
                    for key, value in entry.items()
                    if key not in {"sig", "old_key_sig"}
                }
                ok, why = verify_detached_jws(
                    old_value,
                    old_sig,
                    old_spki,
                    expected_kid=entry["old_rappid"],
                )
                if not ok:
                    raise ProtocolError(f"rotation continuity proof refused: {why}")
        for entry in self.tombstones:
            if not (
                rappid_valid(entry.get("rappid"))
                and utc_valid(entry.get("revoked_utc"))
            ):
                raise ProtocolError("registry contains an invalid tombstone entry")
            self._verify_owner_signed_entry(entry, {"sig"})

    def verify_egg_signature(
        self,
        unsigned_manifest: dict,
        sig: str,
        require_estate_owner: bool,
    ) -> tuple[bool, str]:
        try:
            header, _, _ = parse_detached_jws(sig)
        except ProtocolError as exc:
            return False, str(exc)
        kid = header["kid"]
        created_utc = unsigned_manifest.get("created_utc")
        if not utc_valid(created_utc):
            return False, "signed egg has no valid created_utc"
        if require_estate_owner and not self._owner_reaches_current(kid):
            return False, "invite signer is not in estate-owner succession"
        spki = self.keys.get(kid)
        if spki is None:
            return False, f"JWS kid is absent from the verified registry: {kid}"
        for entry in self.tombstones:
            if entry["rappid"] == kid and created_utc >= entry["revoked_utc"]:
                return False, f"JWS kid was revoked at {entry['revoked_utc']}"
        for entry in self.reanchors:
            if entry["old_rappid"] == kid and created_utc >= entry["utc"]:
                return False, f"JWS kid was superseded at {entry['utc']}"
        return verify_detached_jws(unsigned_manifest, sig, spki, expected_kid=kid)

    def verify_frame_signature(
        self,
        unsigned_frame: dict,
        sig: str,
    ) -> tuple[bool, str]:
        try:
            header, _, _ = parse_detached_jws(sig)
        except ProtocolError as exc:
            return False, str(exc)
        kid = header["kid"]
        frame_utc = unsigned_frame.get("utc")
        if not utc_valid(frame_utc):
            return False, "signed frame has no valid utc"
        spki = self.keys.get(kid)
        if spki is None:
            return False, f"JWS kid is absent from the verified registry: {kid}"
        for entry in self.tombstones:
            if entry["rappid"] == kid and frame_utc >= entry["revoked_utc"]:
                return False, f"JWS kid was revoked at {entry['revoked_utc']}"
        for entry in self.reanchors:
            if entry["old_rappid"] == kid and frame_utc >= entry["utc"]:
                return False, f"JWS kid was superseded at {entry['utc']}"
        return verify_detached_jws(unsigned_frame, sig, spki, expected_kid=kid)

    @classmethod
    def from_environment(cls) -> Optional["RegistryTrust"]:
        registry_path = os.environ.get("RAPP_REGISTRY_PATH")
        owner = os.environ.get("RAPP_ESTATE_OWNER_RAPPID")
        spki_path = os.environ.get("RAPP_ESTATE_OWNER_SPKI_PATH")
        if not any((registry_path, owner, spki_path)):
            return None
        if not all((registry_path, owner, spki_path)):
            raise ProtocolError(
                "RAPP_REGISTRY_PATH, RAPP_ESTATE_OWNER_RAPPID, and "
                "RAPP_ESTATE_OWNER_SPKI_PATH must be configured together"
            )
        max_age = int(os.environ.get("RAPP_REGISTRY_MAX_AGE_SECONDS", "86400"))
        age = max(0, time.time() - os.path.getmtime(registry_path))
        if age > max_age:
            raise ProtocolError(
                f"configured RAPP registry is stale ({int(age)}s > {max_age}s policy)"
            )
        with open(registry_path, "rb") as handle:
            registry_octets = handle.read()
        registry = strict_json_loads(registry_octets)
        with open(spki_path, "rb") as handle:
            spki = handle.read()
        state_path = os.environ.get("RAPP_REGISTRY_STATE_PATH") or os.path.join(
            os.path.expanduser("~"), ".config", "rapp", "registry-state.json"
        )
        previous = None
        if os.path.isfile(state_path):
            with open(state_path, "rb") as handle:
                previous = strict_json_loads(handle.read())
        minimum_seq = int((previous or {}).get("registry_seq", 0))
        trust = cls(
            registry,
            trust_anchor_rappid=owner,
            trust_anchor_spki_der=spki,
            minimum_seq=minimum_seq,
        )
        digest = hashlib.sha256(canonical(registry).encode("utf-8")).hexdigest()
        if (
            previous
            and previous.get("registry_seq") == trust.registry_seq
            and previous.get("sha256") != digest
        ):
            raise ProtocolError("registry changed at an already-verified registry_seq")
        state_path = os.path.abspath(state_path)
        os.makedirs(os.path.dirname(state_path), exist_ok=True)
        tmp = state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(
                {"registry_seq": trust.registry_seq, "sha256": digest},
                handle,
                indent=2,
            )
        os.replace(tmp, state_path)
        return trust


def signature_verifier_from_environment() -> Optional[SignatureVerifier]:
    trust = RegistryTrust.from_environment()
    return trust.verify_egg_signature if trust is not None else None
