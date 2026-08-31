import base64
import copy
import hashlib
import json
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from artifacts.delivery import (
    ArtifactAccessDenied,
    ArtifactDeliveryService,
    ArtifactReplayDenied,
    EntitlementClaims,
)
from artifacts.manifest import (
    build_encrypted_artifact,
    decrypt_artifact,
    recipient_jwk_thumbprint,
    validate_pinned_raw_url,
)
from credits.domain import CreditError, canonical_json


NOW = datetime(2026, 8, 29, 20, 0, 0, tzinfo=timezone.utc)
COMMIT = "a" * 40
MANIFEST_URL = (
    f"https://raw.githubusercontent.com/kody-w/rapp-zoo/{COMMIT}/"
    "artifacts/rapter.manifest.json"
)
CIPHERTEXT_URL = (
    f"https://raw.githubusercontent.com/kody-w/rapp-zoo/{COMMIT}/"
    "artifacts/rapter.ciphertext"
)


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


class Signer:
    def __init__(self, version="v1"):
        self.version = version

    def sign(self, payload):
        digest = hashlib.sha256(
            self.version.encode() + canonical_json(payload),
        ).digest()
        return {
            "algorithm": "ES256",
            "key_id": f"https://issuer.example/keys/manifest/{self.version}",
            "value": b64(digest + digest),
        }

    def verify(self, payload, signature):
        version = signature["key_id"].rsplit("/", 1)[-1]
        return Signer(version).sign(payload)["value"] == signature["value"]


class KeyManager:
    def __init__(self):
        self.keys = {
            "v1": rsa.generate_private_key(public_exponent=65537, key_size=2048),
            "v2": rsa.generate_private_key(public_exponent=65537, key_size=2048),
        }
        self.active = "v1"

    def wrap(self, dek):
        key_id = f"https://vault.example/keys/artifact/{self.active}"
        wrapped = self.keys[self.active].public_key().encrypt(
            dek,
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None,
            ),
        )
        return key_id, wrapped

    def unwrap(self, key_id, wrapped):
        version = key_id.rsplit("/", 1)[-1]
        return self.keys[version].decrypt(
            wrapped,
            padding.OAEP(
                mgf=padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None,
            ),
        )


class Fetcher:
    def __init__(self, values):
        self.values = values
        self.calls = []

    def fetch(self, url, maximum_bytes):
        self.calls.append(url)
        value = self.values[url]
        if len(value) > maximum_bytes:
            raise AssertionError("fixture exceeded requested maximum")
        return value


class TokenVerifier:
    configured = True

    def __init__(self, claims):
        self.claims = claims

    def verify(self, token):
        if token != "valid-token":
            raise ArtifactAccessDenied("token invalid")
        return self.claims


class ReplayStore:
    def __init__(self):
        self.used = set()

    def consume(self, token_id_hash, artifact_id, expires_utc):
        del artifact_id, expires_utc
        if token_id_hash in self.used:
            raise ArtifactReplayDenied("replayed")
        self.used.add(token_id_hash)


def recipient():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    numbers = private_key.public_key().public_numbers()
    jwk = {
        "kty": "RSA",
        "n": b64(numbers.n.to_bytes(256, "big")),
        "e": b64(numbers.e.to_bytes(3, "big")),
    }
    return private_key, jwk


def fixture(version="v1"):
    key_manager = KeyManager()
    key_manager.active = version
    signer = Signer(version)
    random_values = iter([b"d" * 32, b"n" * 12])
    ciphertext, manifest = build_encrypted_artifact(
        plaintext=b"signed local capsule bytes",
        logical_name="rapter-one.rapp",
        content_type="application/vnd.rapterbox.capsule",
        ciphertext_url=CIPHERTEXT_URL,
        created_utc=NOW.isoformat(timespec="seconds"),
        wrap_dek=key_manager.wrap,
        signer=signer,
        random_bytes=lambda _length: next(random_values),
    )
    envelope = manifest["key_envelope"]
    dek = key_manager.unwrap(
        envelope["key_id"],
        base64.urlsafe_b64decode(
            envelope["wrapped_dek"] + "=" * (-len(envelope["wrapped_dek"]) % 4),
        ),
    )
    manifest_bytes = canonical_json(manifest) + b"\n"
    recipient_private, recipient_jwk = recipient()
    claims = EntitlementClaims(
        token_id=f"token-{version}",
        device_id="device-1",
        artifact_id=manifest["artifact_id"],
        recipient_jwk_thumbprint=recipient_jwk_thumbprint(recipient_jwk),
        expires_utc=(NOW + timedelta(minutes=5)).isoformat(timespec="seconds"),
    )
    fetcher = Fetcher({
        MANIFEST_URL: manifest_bytes,
        CIPHERTEXT_URL: ciphertext,
    })
    service = ArtifactDeliveryService(
        token_verifier=TokenVerifier(claims),
        replay_store=ReplayStore(),
        fetcher=fetcher,
        dek_unwrapper=key_manager,
        manifest_signer=Signer(),
        now=lambda: NOW,
    )
    request = {
        "manifest_url": MANIFEST_URL,
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "recipient_jwk": recipient_jwk,
    }
    return {
        "service": service,
        "request": request,
        "manifest": manifest,
        "manifest_bytes": manifest_bytes,
        "ciphertext": ciphertext,
        "dek": dek,
        "recipient_private": recipient_private,
        "key_manager": key_manager,
        "fetcher": fetcher,
    }


def unwrap_recipient(private_key, wrapped):
    return private_key.decrypt(
        base64.urlsafe_b64decode(wrapped + "=" * (-len(wrapped) % 4)),
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )


def test_valid_entitlement_releases_only_a_recipient_wrapped_dek():
    item = fixture()
    released = item["service"].release_key(item["request"], "valid-token")
    assert released["schema"] == "rappter-recipient-wrapped-dek/1"
    recipient_dek = unwrap_recipient(
        item["recipient_private"],
        released["wrapped_dek"],
    )
    assert recipient_dek == item["dek"]
    assert decrypt_artifact(
        item["ciphertext"],
        item["manifest"],
        recipient_dek,
    ) == b"signed local capsule bytes"
    assert "dek" not in released
    assert released["device_id_hash"] != "device-1"
    assert "token" not in json.dumps(released)


def test_unauthorized_wrong_recipient_revoked_and_expired_tokens_are_denied():
    item = fixture()
    with pytest.raises(ArtifactAccessDenied, match="required"):
        item["service"].release_key(item["request"], None)

    _, wrong_jwk = recipient()
    with pytest.raises(ArtifactAccessDenied, match="another recipient"):
        item["service"].release_key(
            {**item["request"], "recipient_jwk": wrong_jwk},
            "valid-token",
        )

    revoked = copy.copy(item["service"].token_verifier.claims)
    object.__setattr__(revoked, "revoked", True)
    item["service"].token_verifier = TokenVerifier(revoked)
    with pytest.raises(ArtifactAccessDenied, match="revoked"):
        item["service"].release_key(item["request"], "valid-token")

    expired = copy.copy(revoked)
    object.__setattr__(expired, "revoked", False)
    object.__setattr__(
        expired,
        "expires_utc",
        (NOW - timedelta(seconds=1)).isoformat(timespec="seconds"),
    )
    item["service"].token_verifier = TokenVerifier(expired)
    with pytest.raises(ArtifactAccessDenied, match="expired"):
        item["service"].release_key(item["request"], "valid-token")


def test_tampered_manifest_and_ciphertext_are_denied():
    item = fixture()
    tampered_manifest = bytearray(item["manifest_bytes"])
    tampered_manifest[-2] = ord(" ")
    item["fetcher"].values[MANIFEST_URL] = bytes(tampered_manifest)
    with pytest.raises(ArtifactAccessDenied, match="Manifest"):
        item["service"].release_key(item["request"], "valid-token")

    item = fixture()
    tampered_ciphertext = bytearray(item["ciphertext"])
    tampered_ciphertext[0] ^= 1
    item["fetcher"].values[CIPHERTEXT_URL] = bytes(tampered_ciphertext)
    with pytest.raises(ArtifactAccessDenied, match="Ciphertext"):
        item["service"].release_key(item["request"], "valid-token")


def test_manifest_signature_tamper_is_denied_even_with_matching_file_hash():
    item = fixture()
    manifest = copy.deepcopy(item["manifest"])
    manifest["signature"]["value"] = (
        ("A" if manifest["signature"]["value"][0] != "A" else "B")
        + manifest["signature"]["value"][1:]
    )
    manifest_bytes = canonical_json(manifest) + b"\n"
    item["fetcher"].values[MANIFEST_URL] = manifest_bytes
    request = {
        **item["request"],
        "manifest_sha256": hashlib.sha256(manifest_bytes).hexdigest(),
    }
    with pytest.raises(ArtifactAccessDenied, match="signature"):
        item["service"].release_key(request, "valid-token")


def test_token_replay_is_denied():
    item = fixture()
    item["service"].release_key(item["request"], "valid-token")
    with pytest.raises(ArtifactReplayDenied):
        item["service"].release_key(item["request"], "valid-token")


def test_wrapping_key_rotation_keeps_old_manifests_releasable():
    item_v1 = fixture("v1")
    release_v1 = item_v1["service"].release_key(item_v1["request"], "valid-token")
    assert unwrap_recipient(
        item_v1["recipient_private"],
        release_v1["wrapped_dek"],
    ) == item_v1["dek"]

    item_v2 = fixture("v2")
    release_v2 = item_v2["service"].release_key(item_v2["request"], "valid-token")
    assert release_v2["key_envelope_key_id"].endswith("/v2")
    assert unwrap_recipient(
        item_v2["recipient_private"],
        release_v2["wrapped_dek"],
    ) == item_v2["dek"]


def test_raw_urls_must_be_pinned_to_commit_sha():
    assert validate_pinned_raw_url(CIPHERTEXT_URL) == CIPHERTEXT_URL
    with pytest.raises(CreditError, match="commit SHA"):
        validate_pinned_raw_url(
            "https://raw.githubusercontent.com/kody-w/rapp-zoo/main/file.bin",
        )
    with pytest.raises(CreditError, match="query-free"):
        validate_pinned_raw_url(f"{CIPHERTEXT_URL}?password=never")
