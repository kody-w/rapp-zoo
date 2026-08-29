import json
import logging
import math
import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlparse

import azure.functions as func
import httpx

from azure_auth import get_azure_credential
from http_responses import error_response, json_response


TOKEN_SCOPE = "https://cognitiveservices.azure.com/.default"
ALLOWED_ROLES = {"developer", "system", "user", "assistant"}
REQUEST_KEYS = {
    "model",
    "messages",
    "max_tokens",
    "max_completion_tokens",
    "temperature",
    "top_p",
    "user",
    "stream",
}
MESSAGE_KEYS = {"role", "content"}


@dataclass(frozen=True)
class Settings:
    endpoint: str
    deployment: str
    api_version: str
    max_request_bytes: int
    max_messages: int
    max_message_chars: int
    max_total_message_chars: int
    max_output_tokens: int
    connect_timeout_seconds: float
    request_timeout_seconds: float

    @classmethod
    def from_env(cls) -> "Settings":
        endpoint = os.environ.get(
            "AZURE_OPENAI_ENDPOINT",
            "https://rappter.cognitiveservices.azure.com/",
        ).rstrip("/")
        parsed = urlparse(endpoint)
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
            raise RuntimeError("AZURE_OPENAI_ENDPOINT must be an HTTPS origin.")
        deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-5.4").strip()
        api_version = os.environ.get(
            "AZURE_OPENAI_API_VERSION",
            "2025-04-01-preview",
        ).strip()
        if not deployment or len(deployment) > 128:
            raise RuntimeError("AZURE_OPENAI_DEPLOYMENT is invalid.")
        if not api_version or len(api_version) > 64:
            raise RuntimeError("AZURE_OPENAI_API_VERSION is invalid.")
        return cls(
            endpoint=endpoint,
            deployment=deployment,
            api_version=api_version,
            max_request_bytes=_bounded_env_int("MAX_REQUEST_BYTES", 65_536, 1_024, 1_048_576),
            max_messages=_bounded_env_int("MAX_MESSAGES", 32, 1, 128),
            max_message_chars=_bounded_env_int("MAX_MESSAGE_CHARS", 12_000, 1, 128_000),
            max_total_message_chars=_bounded_env_int(
                "MAX_TOTAL_MESSAGE_CHARS",
                32_000,
                1,
                256_000,
            ),
            max_output_tokens=_bounded_env_int("MAX_OUTPUT_TOKENS", 256, 1, 4_096),
            connect_timeout_seconds=_bounded_env_float(
                "UPSTREAM_CONNECT_TIMEOUT_SECONDS",
                5.0,
                0.1,
                30.0,
            ),
            request_timeout_seconds=_bounded_env_float(
                "UPSTREAM_TIMEOUT_SECONDS",
                45.0,
                1.0,
                120.0,
            ),
        )

    @property
    def chat_url(self) -> str:
        deployment = quote(self.deployment, safe="")
        return (
            f"{self.endpoint}/openai/deployments/{deployment}/chat/completions"
            f"?api-version={quote(self.api_version, safe='')}"
        )


def _bounded_env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer.") from error
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be from {minimum} to {maximum}.")
    return value


def _bounded_env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be numeric.") from error
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be from {minimum} to {maximum}.")
    return value


def settings() -> Settings:
    return Settings.from_env()


def _headers() -> dict[str, str]:
    token = get_azure_credential().get_token(TOKEN_SCOPE)
    return {
        "authorization": f"Bearer {token.token}",
        "content-type": "application/json",
        "accept": "application/json",
    }


class InvalidRequest(Exception):
    def __init__(self, message: str, code: str, param: str | None = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.param = param


def _reject_json_constant(constant: str) -> None:
    raise ValueError(f"Invalid JSON constant: {constant}")


def _parse_body(req: func.HttpRequest, value_settings: Settings) -> dict[str, Any]:
    content_length = req.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > value_settings.max_request_bytes:
                raise InvalidRequest("Request body is too large.", "request_too_large")
        except ValueError as error:
            raise InvalidRequest("Content-Length is invalid.", "invalid_content_length") from error
    raw_body = req.get_body()
    if len(raw_body) > value_settings.max_request_bytes:
        raise InvalidRequest("Request body is too large.", "request_too_large")
    try:
        value = json.loads(
            raw_body,
            parse_constant=lambda constant: _reject_json_constant(constant),
        )
    except (UnicodeDecodeError, ValueError) as error:
        raise InvalidRequest("Request body must be valid JSON.", "invalid_json") from error
    if not isinstance(value, dict):
        raise InvalidRequest("Request body must be an object.", "invalid_body")
    unknown = sorted(set(value) - REQUEST_KEYS)
    if unknown:
        raise InvalidRequest(
            f"Unknown request field: {unknown[0]}.",
            "unknown_field",
            unknown[0],
        )
    requested_model = value.get("model", value_settings.deployment)
    if requested_model != value_settings.deployment:
        raise InvalidRequest(
            "The requested model is not available through this gateway.",
            "model_not_allowed",
            "model",
        )
    if "stream" in value and value["stream"] is not False:
        raise InvalidRequest("Streaming is not enabled.", "stream_not_supported", "stream")
    messages = value.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= value_settings.max_messages:
        raise InvalidRequest(
            f"messages must contain 1 to {value_settings.max_messages} items.",
            "invalid_messages",
            "messages",
        )
    normalized_messages = []
    total_characters = 0
    for index, message in enumerate(messages):
        if not isinstance(message, dict):
            raise InvalidRequest("Each message must be an object.", "invalid_message", "messages")
        unknown_message_keys = sorted(set(message) - MESSAGE_KEYS)
        if unknown_message_keys:
            raise InvalidRequest(
                f"Unknown message field: {unknown_message_keys[0]}.",
                "unknown_message_field",
                f"messages[{index}].{unknown_message_keys[0]}",
            )
        role = message.get("role")
        content = message.get("content")
        if role not in ALLOWED_ROLES:
            raise InvalidRequest("Message role is invalid.", "invalid_role", f"messages[{index}].role")
        if (
            not isinstance(content, str)
            or not content
            or len(content) > value_settings.max_message_chars
        ):
            raise InvalidRequest(
                "Message content is empty or too large.",
                "invalid_content",
                f"messages[{index}].content",
            )
        total_characters += len(content)
        normalized_messages.append({"role": role, "content": content})
    if total_characters > value_settings.max_total_message_chars:
        raise InvalidRequest("Total message content is too large.", "messages_too_large", "messages")

    if "max_tokens" in value and "max_completion_tokens" in value:
        raise InvalidRequest(
            "Use max_tokens or max_completion_tokens, not both.",
            "duplicate_token_limit",
            "max_tokens",
        )
    requested_tokens = value.get(
        "max_completion_tokens",
        value.get("max_tokens", min(128, value_settings.max_output_tokens)),
    )
    if (
        isinstance(requested_tokens, bool)
        or not isinstance(requested_tokens, int)
        or requested_tokens < 1
        or requested_tokens > value_settings.max_output_tokens
    ):
        raise InvalidRequest(
            f"Output tokens must be from 1 to {value_settings.max_output_tokens}.",
            "invalid_token_limit",
            "max_completion_tokens",
        )
    upstream: dict[str, Any] = {
        "model": value_settings.deployment,
        "messages": normalized_messages,
        "max_completion_tokens": requested_tokens,
        "stream": False,
    }
    for key, minimum, maximum in (("temperature", 0.0, 2.0), ("top_p", 0.0, 1.0)):
        if key in value:
            number = value[key]
            if (
                isinstance(number, bool)
                or not isinstance(number, (int, float))
                or not math.isfinite(number)
            ):
                raise InvalidRequest(f"{key} must be numeric.", f"invalid_{key}", key)
            if number < minimum or number > maximum:
                raise InvalidRequest(
                    f"{key} must be from {minimum} to {maximum}.",
                    f"invalid_{key}",
                    key,
                )
            upstream[key] = number
    if "user" in value:
        user = value["user"]
        if not isinstance(user, str) or not user or len(user) > 128:
            raise InvalidRequest("user is invalid.", "invalid_user", "user")
        upstream["user"] = user
    return upstream


def _upstream_chat(payload: dict[str, Any], value_settings: Settings) -> httpx.Response:
    timeout = httpx.Timeout(
        connect=value_settings.connect_timeout_seconds,
        read=value_settings.request_timeout_seconds,
        write=value_settings.request_timeout_seconds,
        pool=value_settings.connect_timeout_seconds,
    )
    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        return client.post(value_settings.chat_url, headers=_headers(), json=payload)


def health_payload() -> dict[str, Any]:
    value_settings = settings()
    return {
        "status": "ok",
        "service": "rolling-cores-api",
        "auth": "function",
        "model": value_settings.deployment,
        "credit_registry": {
            "official_records_require_signature": True,
            "purchase_verifier": os.environ.get("PURCHASE_VERIFIER_MODE", "disabled"),
        },
    }


def models_response() -> func.HttpResponse:
    value_settings = settings()
    return json_response({
        "object": "list",
        "data": [{
            "id": value_settings.deployment,
            "object": "model",
            "created": 0,
            "owned_by": "rappter",
        }],
    })


def chat_response(req: func.HttpRequest) -> func.HttpResponse:
    value_settings = settings()
    try:
        payload = _parse_body(req, value_settings)
    except InvalidRequest as error:
        return error_response(400, error.message, error.code, param=error.param)
    try:
        upstream = _upstream_chat(payload, value_settings)
    except httpx.TimeoutException:
        logging.warning("Azure OpenAI request timed out.")
        return error_response(
            504,
            "The configured model timed out.",
            "upstream_timeout",
            error_type="server_error",
        )
    except Exception as error:
        logging.warning("Azure OpenAI request failed (%s).", type(error).__name__)
        return error_response(
            502,
            "The configured model could not be reached.",
            "upstream_unavailable",
            error_type="server_error",
        )
    if upstream.status_code < 200 or upstream.status_code >= 300:
        logging.warning("Azure OpenAI returned HTTP %d.", upstream.status_code)
        return error_response(
            502,
            "The configured model rejected the request.",
            "upstream_rejected",
            error_type="server_error",
        )
    try:
        body = upstream.json()
    except ValueError:
        return error_response(
            502,
            "The configured model returned invalid JSON.",
            "invalid_upstream_response",
            error_type="server_error",
        )
    if (
        not isinstance(body, dict)
        or body.get("object") != "chat.completion"
        or not isinstance(body.get("choices"), list)
    ):
        return error_response(
            502,
            "The configured model returned an invalid completion.",
            "invalid_upstream_response",
            error_type="server_error",
        )
    return json_response(body)
