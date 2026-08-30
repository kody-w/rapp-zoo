import json
import os

import azure.functions as func
import httpx
import pytest

import azure_auth
import function_app
import model_gateway
from credits import api as credit_api


def request(method: str, path: str, body: dict | None = None) -> func.HttpRequest:
    return func.HttpRequest(
        method=method,
        url=f"https://example.test/v1/{path}",
        headers={"content-type": "application/json"},
        params={},
        route_params={},
        body=b"" if body is None else json.dumps(body).encode(),
    )


def body(response: func.HttpResponse) -> dict:
    return json.loads(response.get_body())


@pytest.fixture(autouse=True)
def configured(monkeypatch: pytest.MonkeyPatch):
    values = {
        "AZURE_OPENAI_ENDPOINT": "https://rappter.cognitiveservices.azure.com/",
        "AZURE_OPENAI_DEPLOYMENT": "gpt-5.4",
        "AZURE_OPENAI_API_VERSION": "2025-04-01-preview",
        "MAX_OUTPUT_TOKENS": "64",
        "MAX_REQUEST_BYTES": "4096",
        "MAX_MESSAGES": "4",
        "MAX_MESSAGE_CHARS": "100",
        "MAX_TOTAL_MESSAGE_CHARS": "200",
        "UPSTREAM_CONNECT_TIMEOUT_SECONDS": "1",
        "UPSTREAM_TIMEOUT_SECONDS": "3",
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("WEBSITE_INSTANCE_ID", raising=False)
    monkeypatch.delenv("IDENTITY_ENDPOINT", raising=False)
    monkeypatch.setenv("PURCHASE_VERIFIER_MODE", "disabled")
    azure_auth.reset_azure_credential()
    credit_api.reset_service()


def test_health_and_models_are_openai_shaped():
    health = function_app.health(request("GET", "health"))
    assert health.status_code == 200
    assert body(health)["status"] == "ok"
    assert body(health)["model"] == "gpt-5.4"
    assert body(health)["credit_registry"]["official_records_require_signature"] is True
    assert body(health)["wild_breathing"]["breath_eligible"] is False
    models = function_app.openai_models(request("GET", "models"))
    assert models.status_code == 200
    assert body(models)["data"][0]["id"] == "gpt-5.4"


def test_chat_forces_configured_deployment_and_caps_output(monkeypatch: pytest.MonkeyPatch):
    captured = {}

    def upstream(payload, settings):
        captured["payload"] = payload
        captured["url"] = settings.chat_url
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": "OK"},
                    "finish_reason": "stop",
                }],
            },
        )

    monkeypatch.setattr(model_gateway, "_upstream_chat", upstream)
    response = function_app.openai_chat(request("POST", "chat/completions", {
        "model": "gpt-5.4",
        "messages": [{"role": "user", "content": "Reply only OK"}],
        "max_tokens": 32,
    }))
    assert response.status_code == 200
    assert captured["payload"]["model"] == "gpt-5.4"
    assert captured["payload"]["max_completion_tokens"] == 32
    assert captured["payload"]["stream"] is False
    assert "gpt-5.4/chat/completions" in captured["url"]


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        ({
            "model": "attacker-model",
            "messages": [{"role": "user", "content": "hello"}],
        }, "model_not_allowed"),
        ({
            "model": "gpt-5.4",
            "messages": [{"role": "user", "content": "hello"}],
            "max_tokens": 65,
        }, "invalid_token_limit"),
        ({
            "model": "gpt-5.4",
            "messages": [{"role": "user", "content": "hello"}],
            "upstream_url": "https://attacker.invalid",
        }, "unknown_field"),
        ({
            "model": "gpt-5.4",
            "messages": [{"role": "user", "content": "x" * 101}],
        }, "invalid_content"),
        ({
            "model": "gpt-5.4",
            "messages": [{"role": "user", "content": "hello"}],
            "stream": 0,
        }, "stream_not_supported"),
    ],
)
def test_chat_rejects_unbounded_or_rerouted_requests(payload, code):
    response = function_app.openai_chat(request("POST", "chat/completions", payload))
    assert response.status_code == 400
    assert body(response)["error"]["code"] == code


def test_upstream_errors_are_sanitized(monkeypatch: pytest.MonkeyPatch, caplog):
    def upstream(_payload, _settings):
        raise httpx.ReadTimeout("secret prompt must not escape")

    monkeypatch.setattr(model_gateway, "_upstream_chat", upstream)
    response = function_app.openai_chat(request("POST", "chat/completions", {
        "messages": [{"role": "user", "content": "private prompt"}],
    }))
    assert response.status_code == 504
    serialized = json.dumps(body(response))
    assert "private prompt" not in serialized
    assert "secret prompt" not in caplog.text


def test_production_selects_managed_identity(monkeypatch: pytest.MonkeyPatch):
    created = []

    class Managed:
        def __init__(self):
            created.append("managed")

    class Default:
        def __init__(self, **_kwargs):
            created.append("default")

    monkeypatch.setattr(azure_auth, "ManagedIdentityCredential", Managed)
    monkeypatch.setattr(azure_auth, "DefaultAzureCredential", Default)
    monkeypatch.setenv("WEBSITE_INSTANCE_ID", "instance")
    azure_auth.reset_azure_credential()
    azure_auth.get_azure_credential()
    assert created == ["managed"]

    monkeypatch.delenv("WEBSITE_INSTANCE_ID")
    azure_auth.reset_azure_credential()
    azure_auth.get_azure_credential()
    assert created == ["managed", "default"]


def test_gateway_bindings_require_function_keys():
    function_app.app.functions_bindings = {}
    functions = {
        item.get_function_name(): item
        for item in function_app.app.get_functions()
    }
    for name in ("openai_models", "openai_chat"):
        binding = next(
            item
            for item in functions[name].get_bindings()
            if item.get_dict_repr().get("type") == "httpTrigger"
        )
        assert binding.get_dict_repr()["authLevel"] == func.AuthLevel.FUNCTION


def test_credit_routes_separate_public_reads_from_authenticated_writes():
    function_app.app.functions_bindings = {}
    auth_levels = {}
    for item in function_app.app.get_functions():
        for binding in item.get_bindings():
            value = binding.get_dict_repr()
            if value.get("type") == "httpTrigger":
                auth_levels[item.get_function_name()] = value["authLevel"]
    assert auth_levels["credit_quote"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["credit_issuer"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["credit_list"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["valuation_schedules"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["credit_lookup"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["credit_verify"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["artifact_status"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["subscription_policy"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["subscription_events"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["credit_lifecycle_status"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["credit_ownership"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["credit_lifecycle"] == func.AuthLevel.ANONYMOUS
    assert auth_levels["purchase_redeem"] == func.AuthLevel.FUNCTION
    assert auth_levels["credit_return"] == func.AuthLevel.FUNCTION
    assert auth_levels["resale_listing"] == func.AuthLevel.FUNCTION
    assert auth_levels["resale_listing_cancel"] == func.AuthLevel.FUNCTION
    assert auth_levels["resale_sale"] == func.AuthLevel.FUNCTION
    assert auth_levels["artifact_release_key"] == func.AuthLevel.FUNCTION
    assert auth_levels["companion_claim"] == func.AuthLevel.FUNCTION
    assert auth_levels["entitlement_status"] == func.AuthLevel.FUNCTION
    assert auth_levels["subscription_capsule_access"] == func.AuthLevel.FUNCTION
    assert auth_levels["subscription_billing_webhook"] == func.AuthLevel.FUNCTION
    assert auth_levels["subscription_recover"] == func.AuthLevel.FUNCTION
    assert auth_levels["subscription_sync"] == func.AuthLevel.FUNCTION
    assert auth_levels["valuation_schedule_publish"] == func.AuthLevel.FUNCTION
    assert auth_levels["wild_breathing_status"] == func.AuthLevel.FUNCTION
    assert auth_levels["wild_breathing_start"] == func.AuthLevel.FUNCTION
    assert auth_levels["wild_breathing_pause"] == func.AuthLevel.FUNCTION
    assert auth_levels["capsule_authorize"] == func.AuthLevel.FUNCTION
