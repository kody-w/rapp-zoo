import base64
import hashlib
import os
from typing import Any, Protocol

from azure.keyvault.keys import KeyClient
from azure.keyvault.keys.crypto import CryptographyClient, SignatureAlgorithm

from azure_auth import get_azure_credential

from .domain import (
    CreditError,
    ES256_SIGNATURE,
    SIGNATURE_KEYS,
    SigningUnavailable,
    bounded_text,
    canonical_json,
)


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode_base64url(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


class RegistrySigner(Protocol):
    def sign(self, payload: dict[str, Any]) -> dict[str, str]:
        ...

    def verify(self, payload: dict[str, Any], signature: dict[str, str]) -> bool:
        ...

    def descriptor(self, key_id: str | None = None) -> dict[str, Any]:
        ...


class DisabledRegistrySigner:
    def sign(self, payload: dict[str, Any]) -> dict[str, str]:
        del payload
        raise SigningUnavailable("Official credit signing is not configured.")

    def verify(self, payload: dict[str, Any], signature: dict[str, str]) -> bool:
        del payload, signature
        raise SigningUnavailable("Official credit signing is not configured.")

    def descriptor(self, key_id: str | None = None) -> dict[str, Any]:
        del key_id
        raise SigningUnavailable("Official credit signing is not configured.")


class KeyVaultRegistrySigner:
    def __init__(self, vault_url: str, key_name: str):
        self.vault_url = vault_url.rstrip("/")
        self.key_name = key_name
        self.credential = get_azure_credential()
        self.key_client = KeyClient(vault_url=self.vault_url, credential=self.credential)
        self._current_key = None
        self._signing_ready = False

    def _key(self):
        if self._current_key is None:
            self._current_key = self.key_client.get_key(self.key_name)
        return self._current_key

    def _allowed_key_id(self, key_id: str) -> bool:
        return key_id.startswith(f"{self.vault_url}/keys/{self.key_name}/")

    def sign(self, payload: dict[str, Any]) -> dict[str, str]:
        key = self._key()
        digest = hashlib.sha256(canonical_json(payload)).digest()
        result = CryptographyClient(key.id, self.credential).sign(
            SignatureAlgorithm.es256,
            digest,
        )
        return {
            "algorithm": "ES256",
            "key_id": key.id,
            "value": _base64url(result.signature),
        }

    def verify(self, payload: dict[str, Any], signature: dict[str, str]) -> bool:
        if not isinstance(signature, dict) or set(signature) != SIGNATURE_KEYS:
            raise CreditError("Signature is invalid.")
        if signature.get("algorithm") != "ES256":
            raise CreditError("Signature algorithm is invalid.")
        key_id = bounded_text(signature.get("key_id"), "signature.key_id", 2_048)
        if not self._allowed_key_id(key_id):
            return False
        signature_value = bounded_text(signature.get("value"), "signature.value", 512)
        if not ES256_SIGNATURE.fullmatch(signature_value):
            raise CreditError("Signature value is invalid.")
        digest = hashlib.sha256(canonical_json(payload)).digest()
        result = CryptographyClient(key_id, self.credential).verify(
            SignatureAlgorithm.es256,
            digest,
            _decode_base64url(signature_value),
        )
        return bool(result.is_valid)

    def descriptor(self, key_id: str | None = None) -> dict[str, Any]:
        if key_id is not None:
            if not self._allowed_key_id(key_id):
                raise SigningUnavailable("The requested signing key is not an issuer key.")
            key = self.key_client.get_key(
                self.key_name,
                key_id.rsplit("/", 1)[-1],
            )
        else:
            key = self._key()
        if not self._signing_ready:
            digest = hashlib.sha256(b"rappter-credit-signer-self-test/v1").digest()
            crypto = CryptographyClient(self._key().id, self.credential)
            signature = crypto.sign(SignatureAlgorithm.es256, digest).signature
            if not crypto.verify(SignatureAlgorithm.es256, digest, signature).is_valid:
                raise SigningUnavailable("The issuer signing key failed self-verification.")
            self._signing_ready = True
        curve = getattr(key.key.crv, "value", str(key.key.crv))
        return {
            "algorithm": "ES256",
            "key_id": key.id,
            "signing_ready": True,
            "jwk": {
                "kty": "EC",
                "crv": curve,
                "x": _base64url(key.key.x),
                "y": _base64url(key.key.y),
                "use": "sig",
                "alg": "ES256",
                "kid": key.id,
            },
        }


def configured_registry_signer() -> RegistrySigner:
    vault_url = os.environ.get("CREDIT_KEY_VAULT_URL", "").strip()
    key_name = os.environ.get("CREDIT_SIGNING_KEY_NAME", "").strip()
    if not vault_url or not key_name:
        return DisabledRegistrySigner()
    if not vault_url.startswith("https://") or len(key_name) > 127:
        raise RuntimeError("Credit signing configuration is invalid.")
    return KeyVaultRegistrySigner(vault_url, key_name)
