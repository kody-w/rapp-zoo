import json
import logging
import os

import azure.functions as func
import httpx

from credits.domain import CreditError
from credits.signing import configured_registry_signer
from http_responses import error_response, json_response

from .delivery import (
    ArtifactDeliveryService,
    DisabledEntitlementTokenVerifier,
    AzureTableReplayStore,
    HttpArtifactFetcher,
)
from .key_vault import KeyVaultDekManager


service_instance: ArtifactDeliveryService | None = None
service_override: ArtifactDeliveryService | None = None


def _service() -> ArtifactDeliveryService:
    global service_instance
    if service_override is not None:
        return service_override
    if service_instance is None:
        account_url = os.environ.get("CREDIT_TABLE_ACCOUNT_URL", "").strip()
        table_name = os.environ.get("CREDIT_TABLE_NAME", "RapterCreditRegistry").strip()
        vault_url = os.environ.get("ARTIFACT_KEY_VAULT_URL", "").strip()
        key_name = os.environ.get("ARTIFACT_WRAPPING_KEY_NAME", "").strip()
        if (
            not account_url.startswith("https://")
            or not table_name.isalnum()
            or not vault_url.startswith("https://")
            or not key_name
        ):
            raise RuntimeError("Artifact delivery configuration is incomplete.")
        try:
            manifest_max = int(os.environ.get("ARTIFACT_MANIFEST_MAX_BYTES", "65536"))
            ciphertext_max = int(
                os.environ.get("ARTIFACT_CIPHERTEXT_MAX_BYTES", "52428800"),
            )
        except ValueError as error:
            raise RuntimeError("Artifact delivery size limits are invalid.") from error
        client = httpx.Client(
            timeout=httpx.Timeout(30.0, connect=5.0),
            follow_redirects=False,
        )
        service_instance = ArtifactDeliveryService(
            token_verifier=DisabledEntitlementTokenVerifier(),
            replay_store=AzureTableReplayStore(account_url, table_name),
            fetcher=HttpArtifactFetcher(client),
            dek_unwrapper=KeyVaultDekManager(vault_url, key_name),
            manifest_signer=configured_registry_signer(),
            manifest_max_bytes=manifest_max,
            ciphertext_max_bytes=ciphertext_max,
        )
    return service_instance


def reset_service() -> None:
    global service_instance, service_override
    service_instance = None
    service_override = None


def _body(req: func.HttpRequest):
    raw = req.get_body()
    if len(raw) > 16_384:
        raise CreditError("Artifact key-release request is too large.")
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CreditError("Artifact key-release request must be valid JSON.") from error


def _token(req: func.HttpRequest) -> str | None:
    authorization = req.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    return token if token and len(token) <= 8_192 else None


def _call(operation):
    try:
        return operation()
    except CreditError as error:
        return error_response(error.status_code, str(error), error.code)
    except Exception as error:
        logging.warning("Artifact delivery failed (%s).", type(error).__name__)
        return error_response(
            503,
            "Artifact key release is temporarily unavailable.",
            "artifact_unavailable",
            error_type="server_error",
        )


def status(_: func.HttpRequest) -> func.HttpResponse:
    return _call(lambda: json_response(_service().status()))


def release_key(req: func.HttpRequest) -> func.HttpResponse:
    return _call(lambda: json_response(
        _service().release_key(_body(req), _token(req)),
    ))
