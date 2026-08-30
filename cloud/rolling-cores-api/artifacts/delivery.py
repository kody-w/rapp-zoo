import base64
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from azure.core.exceptions import ResourceExistsError
from azure.data.tables import TableServiceClient
from azure_auth import get_azure_credential
from credits.domain import CreditError, bounded_text, validate_sha256
from credits.repository import PARTITION
from credits.signing import RegistrySigner

from .manifest import (
    RELEASE_SCHEMA,
    manifest_signature_payload,
    recipient_jwk_thumbprint,
    validate_manifest,
    validate_pinned_raw_url,
    wrap_dek_for_recipient,
)


REQUEST_KEYS = {"manifest_url", "manifest_sha256", "recipient_jwk"}


class ArtifactAccessDenied(CreditError):
    code = "artifact_access_denied"
    status_code = 403


class ArtifactReplayDenied(CreditError):
    code = "artifact_token_replayed"
    status_code = 409


class ArtifactUnavailable(CreditError):
    code = "artifact_unavailable"
    status_code = 503


@dataclass(frozen=True)
class EntitlementClaims:
    token_id: str
    device_id: str
    artifact_id: str
    recipient_jwk_thumbprint: str
    expires_utc: str
    revoked: bool = False


class EntitlementTokenVerifier(Protocol):
    configured: bool

    def verify(self, token: str) -> EntitlementClaims:
        ...


class ReplayStore(Protocol):
    def consume(self, token_id_hash: str, artifact_id: str, expires_utc: str) -> None:
        ...


class ArtifactFetcher(Protocol):
    def fetch(self, url: str, maximum_bytes: int) -> bytes:
        ...


class DekUnwrapper(Protocol):
    def unwrap(self, key_id: str, wrapped_dek: bytes) -> bytes:
        ...


class DisabledEntitlementTokenVerifier:
    configured = False

    def verify(self, token: str) -> EntitlementClaims:
        del token
        raise ArtifactUnavailable("Scoped artifact entitlement verification is not configured.")


class AzureTableReplayStore:
    def __init__(self, account_url: str, table_name: str):
        service = TableServiceClient(
            endpoint=account_url,
            credential=get_azure_credential(),
        )
        service.create_table_if_not_exists(table_name)
        self.table = service.get_table_client(table_name)

    def consume(self, token_id_hash: str, artifact_id: str, expires_utc: str) -> None:
        try:
            self.table.create_entity({
                "PartitionKey": PARTITION,
                "RowKey": f"artifact-release:{token_id_hash}",
                "artifact_id": artifact_id,
                "expires_utc": expires_utc,
            })
        except ResourceExistsError as error:
            raise ArtifactReplayDenied("Artifact entitlement token was already used.") from error


class HttpArtifactFetcher:
    def __init__(self, client):
        self.client = client

    def fetch(self, url: str, maximum_bytes: int) -> bytes:
        validate_pinned_raw_url(url)
        try:
            with self.client.stream(
                "GET",
                url,
                headers={"accept": "application/octet-stream"},
                follow_redirects=False,
            ) as response:
                if response.status_code != 200:
                    raise ArtifactUnavailable("Pinned artifact could not be fetched.")
                chunks = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > maximum_bytes:
                        raise ArtifactUnavailable("Pinned artifact exceeded its size limit.")
                    chunks.append(chunk)
                return b"".join(chunks)
        except ArtifactUnavailable:
            raise
        except Exception as error:
            raise ArtifactUnavailable("Pinned artifact could not be fetched.") from error


class ArtifactDeliveryService:
    def __init__(
        self,
        *,
        token_verifier: EntitlementTokenVerifier,
        replay_store: ReplayStore,
        fetcher: ArtifactFetcher,
        dek_unwrapper: DekUnwrapper,
        manifest_signer: RegistrySigner,
        manifest_max_bytes: int = 65_536,
        ciphertext_max_bytes: int = 52_428_800,
        now=lambda: datetime.now(timezone.utc),
    ):
        self.token_verifier = token_verifier
        self.replay_store = replay_store
        self.fetcher = fetcher
        self.dek_unwrapper = dek_unwrapper
        self.manifest_signer = manifest_signer
        self.manifest_max_bytes = manifest_max_bytes
        self.ciphertext_max_bytes = ciphertext_max_bytes
        self.now = now

    def status(self) -> dict[str, Any]:
        return {
            "schema": "rappter-artifact-delivery-status/1",
            "entitlement_verifier_configured": self.token_verifier.configured,
            "ciphertext_host": "raw.githubusercontent.com",
            "commit_pin_required": True,
            "envelope_encryption": "AES-256-GCM + RSA-OAEP-256",
            "manifest_max_bytes": self.manifest_max_bytes,
            "ciphertext_max_bytes": self.ciphertext_max_bytes,
            "revocation_effect": "stops-future-key-release",
            "previously_decrypted_copy_erasure": False,
        }

    def release_key(self, request: Any, token: str | None) -> dict[str, Any]:
        if not token:
            raise ArtifactAccessDenied("A scoped entitlement/device token is required.")
        if not isinstance(request, dict) or set(request) != REQUEST_KEYS:
            raise CreditError("Artifact key-release request has an invalid shape.")
        manifest_url = validate_pinned_raw_url(request["manifest_url"])
        expected_manifest_hash = validate_sha256(
            request["manifest_sha256"],
            "manifest_sha256",
        )
        recipient_jwk = request["recipient_jwk"]
        recipient_thumbprint = recipient_jwk_thumbprint(recipient_jwk)
        claims = self.token_verifier.verify(token)
        if claims.revoked:
            raise ArtifactAccessDenied("Artifact entitlement token is revoked.")
        try:
            expires = datetime.fromisoformat(claims.expires_utc)
        except ValueError as error:
            raise ArtifactAccessDenied("Artifact entitlement expiry is invalid.") from error
        if expires.tzinfo is None or self.now() >= expires.astimezone(timezone.utc):
            raise ArtifactAccessDenied("Artifact entitlement token is expired.")
        if recipient_thumbprint != claims.recipient_jwk_thumbprint:
            raise ArtifactAccessDenied("Artifact token is scoped to another recipient key.")

        manifest_bytes = self.fetcher.fetch(manifest_url, self.manifest_max_bytes)
        if hashlib.sha256(manifest_bytes).hexdigest() != expected_manifest_hash:
            raise ArtifactAccessDenied("Manifest bytes do not match the requested content hash.")
        try:
            manifest = validate_manifest(json.loads(manifest_bytes))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ArtifactAccessDenied("Manifest JSON is invalid.") from error
        if not self.manifest_signer.verify(
            manifest_signature_payload(manifest),
            manifest["signature"],
        ):
            raise ArtifactAccessDenied("Manifest issuer signature is invalid.")
        if manifest["artifact_id"] != claims.artifact_id:
            raise ArtifactAccessDenied("Artifact entitlement scope does not match the manifest.")

        ciphertext = self.fetcher.fetch(
            manifest["ciphertext"]["url"],
            self.ciphertext_max_bytes,
        )
        if (
            len(ciphertext) != manifest["ciphertext"]["size_bytes"]
            or hashlib.sha256(ciphertext).hexdigest() != manifest["ciphertext"]["sha256"]
        ):
            raise ArtifactAccessDenied("Ciphertext does not match the signed manifest.")
        wrapped_dek = base64url_decode(manifest["key_envelope"]["wrapped_dek"])
        dek = self.dek_unwrapper.unwrap(
            manifest["key_envelope"]["key_id"],
            wrapped_dek,
        )
        if len(dek) != 32:
            raise ArtifactUnavailable("Issuer key envelope did not contain an AES-256 DEK.")
        recipient_wrapped_dek = wrap_dek_for_recipient(dek, recipient_jwk)
        token_id = bounded_text(claims.token_id, "entitlement token id", 512)
        device_id = bounded_text(claims.device_id, "entitlement device id", 512)
        token_id_hash = hashlib.sha256(token_id.encode("utf-8")).hexdigest()
        self.replay_store.consume(
            token_id_hash,
            manifest["artifact_id"],
            claims.expires_utc,
        )
        return {
            "schema": RELEASE_SCHEMA,
            "artifact_id": manifest["artifact_id"],
            "manifest_hash": manifest["manifest_hash"],
            "recipient_jwk_thumbprint": recipient_thumbprint,
            "device_id_hash": hashlib.sha256(device_id.encode("utf-8")).hexdigest(),
            "entitlement_expires_utc": claims.expires_utc,
            "algorithm": "RSA-OAEP-256",
            "wrapped_dek": recipient_wrapped_dek,
            "key_envelope_key_id": manifest["key_envelope"]["key_id"],
        }


def base64url_decode(value: str) -> bytes:
    if not isinstance(value, str) or "=" in value:
        raise CreditError("Base64url value is invalid.")
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, base64.binascii.Error) as error:
        raise CreditError("Base64url value is invalid.") from error
