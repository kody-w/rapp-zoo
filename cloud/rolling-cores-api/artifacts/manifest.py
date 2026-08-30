import base64
import hashlib
import json
import re
from datetime import datetime
from typing import Any, Callable
from urllib.parse import unquote, urlparse

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from credits.domain import CreditError, bounded_text, canonical_json, validate_sha256
from credits.signing import RegistrySigner


MANIFEST_SCHEMA = "rappter-encrypted-artifact-manifest/1"
RELEASE_SCHEMA = "rappter-recipient-wrapped-dek/1"
MANIFEST_KEYS = {
    "schema",
    "artifact_id",
    "logical_name",
    "content_type",
    "created_utc",
    "aad",
    "ciphertext",
    "key_envelope",
    "manifest_hash",
    "signature",
}
AAD_KEYS = {"schema", "logical_name", "content_type", "version"}
CIPHERTEXT_KEYS = {
    "url",
    "sha256",
    "size_bytes",
    "algorithm",
    "nonce",
}
ENVELOPE_KEYS = {"algorithm", "key_id", "wrapped_dek"}
RSA_JWK_KEYS = {"kty", "n", "e"}
COMMIT_SHA = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
REPO_PART = re.compile(r"^[A-Za-z0-9_.-]+$")


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode_base64url(value: Any, label: str, maximum: int = 16_384) -> bytes:
    if not isinstance(value, str) or not value or "=" in value or len(value) > maximum:
        raise CreditError(f"{label} is invalid.")
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, base64.binascii.Error) as error:
        raise CreditError(f"{label} is invalid.") from error


def validate_pinned_raw_url(value: Any) -> str:
    url_value = bounded_text(value, "artifact URL", 2_048)
    try:
        parsed = urlparse(url_value)
    except ValueError as error:
        raise CreditError("Artifact URL is invalid.") from error
    if (
        parsed.scheme != "https"
        or parsed.hostname != "raw.githubusercontent.com"
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise CreditError("Artifact URL must be a query-free GitHub raw HTTPS URL.")
    parts = [unquote(part) for part in parsed.path.split("/") if part]
    if (
        len(parts) < 4
        or not REPO_PART.fullmatch(parts[0])
        or not REPO_PART.fullmatch(parts[1])
        or not COMMIT_SHA.fullmatch(parts[2])
        or any(part in {".", ".."} for part in parts[3:])
    ):
        raise CreditError("Artifact URL must be pinned to a full commit SHA.")
    return url_value


def recipient_jwk_thumbprint(value: Any) -> str:
    if not isinstance(value, dict) or set(value) != RSA_JWK_KEYS or value.get("kty") != "RSA":
        raise CreditError("Recipient JWK must contain exactly kty, n, and e.")
    modulus = _decode_base64url(value.get("n"), "recipient_jwk.n", 1_024)
    exponent = _decode_base64url(value.get("e"), "recipient_jwk.e", 16)
    if len(modulus) < 256 or len(modulus) > 512:
        raise CreditError("Recipient RSA key must be 2048 to 4096 bits.")
    if int.from_bytes(exponent, "big") < 3:
        raise CreditError("Recipient RSA exponent is invalid.")
    canonical = canonical_json({"e": value["e"], "kty": "RSA", "n": value["n"]})
    return hashlib.sha256(canonical).hexdigest()


def wrap_dek_for_recipient(dek: bytes, recipient_jwk: dict[str, str]) -> str:
    recipient_jwk_thumbprint(recipient_jwk)
    public_key = rsa.RSAPublicNumbers(
        int.from_bytes(_decode_base64url(recipient_jwk["e"], "recipient_jwk.e", 16), "big"),
        int.from_bytes(_decode_base64url(recipient_jwk["n"], "recipient_jwk.n", 1_024), "big"),
    ).public_key()
    wrapped = public_key.encrypt(
        dek,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return _base64url(wrapped)


def manifest_signature_payload(manifest: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in manifest.items() if key != "signature"}


def _manifest_hash_payload(manifest: dict[str, Any]) -> dict[str, Any]:
    return {
        key: item
        for key, item in manifest.items()
        if key not in {"manifest_hash", "signature"}
    }


def validate_manifest(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != MANIFEST_KEYS:
        raise CreditError("Encrypted artifact manifest has an invalid shape.")
    if value.get("schema") != MANIFEST_SCHEMA:
        raise CreditError("Encrypted artifact manifest schema is invalid.")
    logical_name = bounded_text(value.get("logical_name"), "logical_name", 256)
    content_type = bounded_text(value.get("content_type"), "content_type", 128)
    created_utc = bounded_text(value.get("created_utc"), "created_utc", 64)
    try:
        created = datetime.fromisoformat(created_utc)
    except ValueError as error:
        raise CreditError("created_utc is invalid.") from error
    if created.tzinfo is None:
        raise CreditError("created_utc must include a timezone.")
    aad = value.get("aad")
    if not isinstance(aad, dict) or set(aad) != AAD_KEYS:
        raise CreditError("Artifact AAD is invalid.")
    if aad != {
        "schema": "rappter-artifact-aad/1",
        "logical_name": logical_name,
        "content_type": content_type,
        "version": 1,
    }:
        raise CreditError("Artifact AAD does not match manifest metadata.")
    ciphertext = value.get("ciphertext")
    if not isinstance(ciphertext, dict) or set(ciphertext) != CIPHERTEXT_KEYS:
        raise CreditError("Ciphertext descriptor is invalid.")
    url = validate_pinned_raw_url(ciphertext.get("url"))
    del url
    ciphertext_hash = validate_sha256(ciphertext.get("sha256"), "ciphertext.sha256")
    artifact_id = bounded_text(value.get("artifact_id"), "artifact_id", 80)
    if artifact_id != f"artifact:sha256:{ciphertext_hash}":
        raise CreditError("artifact_id does not match ciphertext hash.")
    if (
        isinstance(ciphertext.get("size_bytes"), bool)
        or not isinstance(ciphertext.get("size_bytes"), int)
        or ciphertext["size_bytes"] < 17
    ):
        raise CreditError("ciphertext.size_bytes is invalid.")
    if ciphertext.get("algorithm") != "AES-256-GCM":
        raise CreditError("Ciphertext algorithm is invalid.")
    if len(_decode_base64url(ciphertext.get("nonce"), "ciphertext.nonce", 64)) != 12:
        raise CreditError("Ciphertext nonce must be 12 bytes.")
    envelope = value.get("key_envelope")
    if not isinstance(envelope, dict) or set(envelope) != ENVELOPE_KEYS:
        raise CreditError("Key envelope is invalid.")
    if envelope.get("algorithm") != "RSA-OAEP-256":
        raise CreditError("Key envelope algorithm is invalid.")
    bounded_text(envelope.get("key_id"), "key_envelope.key_id", 2_048)
    if len(_decode_base64url(envelope.get("wrapped_dek"), "key_envelope.wrapped_dek")) < 128:
        raise CreditError("Wrapped DEK is invalid.")
    manifest_hash = validate_sha256(value.get("manifest_hash"), "manifest_hash")
    expected_hash = hashlib.sha256(canonical_json(_manifest_hash_payload(value))).hexdigest()
    if manifest_hash != expected_hash:
        raise CreditError("Manifest content hash is invalid.")
    if not isinstance(value.get("signature"), dict):
        raise CreditError("Manifest signature is invalid.")
    return value


def build_encrypted_artifact(
    *,
    plaintext: bytes,
    logical_name: str,
    content_type: str,
    ciphertext_url: str,
    created_utc: str,
    wrap_dek: Callable[[bytes], tuple[str, bytes]],
    signer: RegistrySigner,
    random_bytes: Callable[[int], bytes],
) -> tuple[bytes, dict[str, Any]]:
    if not isinstance(plaintext, bytes) or not plaintext:
        raise CreditError("Artifact plaintext must be non-empty bytes.")
    logical_name = bounded_text(logical_name, "logical_name", 256)
    content_type = bounded_text(content_type, "content_type", 128)
    ciphertext_url = validate_pinned_raw_url(ciphertext_url)
    aad = {
        "schema": "rappter-artifact-aad/1",
        "logical_name": logical_name,
        "content_type": content_type,
        "version": 1,
    }
    dek = random_bytes(32)
    nonce = random_bytes(12)
    if len(dek) != 32 or len(nonce) != 12:
        raise CreditError("Artifact randomness source returned an invalid length.")
    ciphertext_bytes = AESGCM(dek).encrypt(nonce, plaintext, canonical_json(aad))
    ciphertext_hash = hashlib.sha256(ciphertext_bytes).hexdigest()
    key_id, wrapped_dek = wrap_dek(dek)
    base = {
        "schema": MANIFEST_SCHEMA,
        "artifact_id": f"artifact:sha256:{ciphertext_hash}",
        "logical_name": logical_name,
        "content_type": content_type,
        "created_utc": created_utc,
        "aad": aad,
        "ciphertext": {
            "url": ciphertext_url,
            "sha256": ciphertext_hash,
            "size_bytes": len(ciphertext_bytes),
            "algorithm": "AES-256-GCM",
            "nonce": _base64url(nonce),
        },
        "key_envelope": {
            "algorithm": "RSA-OAEP-256",
            "key_id": key_id,
            "wrapped_dek": _base64url(wrapped_dek),
        },
    }
    manifest_hash = hashlib.sha256(canonical_json(base)).hexdigest()
    payload = {**base, "manifest_hash": manifest_hash}
    signature = signer.sign(payload)
    if not signer.verify(payload, signature):
        raise CreditError("Manifest signer failed self-verification.")
    manifest = {**payload, "signature": signature}
    validate_manifest(manifest)
    return ciphertext_bytes, manifest


def decrypt_artifact(
    ciphertext_bytes: bytes,
    manifest: dict[str, Any],
    dek: bytes,
) -> bytes:
    validated = validate_manifest(manifest)
    if hashlib.sha256(ciphertext_bytes).hexdigest() != validated["ciphertext"]["sha256"]:
        raise CreditError("Ciphertext hash does not match the signed manifest.")
    if len(ciphertext_bytes) != validated["ciphertext"]["size_bytes"]:
        raise CreditError("Ciphertext size does not match the signed manifest.")
    nonce = _decode_base64url(validated["ciphertext"]["nonce"], "ciphertext.nonce", 64)
    try:
        return AESGCM(dek).decrypt(
            nonce,
            ciphertext_bytes,
            canonical_json(validated["aad"]),
        )
    except Exception as error:
        raise CreditError("Artifact ciphertext authentication failed.") from error
