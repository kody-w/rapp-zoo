import json
import logging
import os
from typing import Any

import azure.functions as func

from azure_auth import get_azure_credential
from http_responses import error_response, json_response

from .domain import CreditError, ProductCatalog
from .lifecycle import (
    EVENT_SCHEMAS,
    DisabledOwnerAuthorizer,
    DisabledResaleSettlementVerifier,
    LifecycleService,
    configured_refund_router,
)
from .purchases import configured_purchase_verifier
from .quotes import configured_quote_provider
from .repository import AzureTableCreditRepository
from .service import CreditService
from .signing import configured_registry_signer
from .subscriptions import (
    AzureTableSubscriptionRepository,
    DisabledAccountTokenVerifier,
    DisabledBillingWebhookVerifier,
    DisabledSubscriptionRecoveryAdapter,
    SubscriptionService,
)


MAX_CREDIT_REQUEST_BYTES = 65_536
service_override: CreditService | None = None
service_instance: CreditService | None = None
lifecycle_override: LifecycleService | None = None
lifecycle_instance: LifecycleService | None = None
subscription_override: SubscriptionService | None = None
subscription_instance: SubscriptionService | None = None


def _service() -> CreditService:
    global lifecycle_instance, service_instance, subscription_instance
    if service_override is not None:
        return service_override
    if service_instance is None:
        account_url = os.environ.get("CREDIT_TABLE_ACCOUNT_URL", "").strip()
        table_name = os.environ.get("CREDIT_TABLE_NAME", "RapterCreditRegistry").strip()
        if not account_url.startswith("https://") or not table_name.isalnum():
            raise RuntimeError("Credit Table Storage configuration is invalid.")
        try:
            issuance_cap = int(os.environ.get("CREDIT_ISSUANCE_CAP", "1000000"))
            quote_max_age_seconds = int(os.environ.get("BTC_QUOTE_MAX_AGE_SECONDS", "120"))
        except ValueError as error:
            raise RuntimeError("Credit numeric configuration is invalid.") from error
        repository = AzureTableCreditRepository(
            account_url,
            table_name,
            get_azure_credential(),
        )
        signer = configured_registry_signer()
        service_instance = CreditService(
            issuer=os.environ.get("CREDIT_ISSUER_ID", "rappterbox"),
            issuance_cap=issuance_cap,
            quote_max_age_seconds=quote_max_age_seconds,
            catalog=ProductCatalog.from_json(
                os.environ.get("CREDIT_PRODUCTS_JSON", "{}"),
            ),
            verifier=configured_purchase_verifier(),
            quote_provider=configured_quote_provider(),
            signer=signer,
            repository=repository,
        )
        try:
            bitcoin_fee_sats = int(os.environ.get("BITCOIN_REFUND_FEE_SATS", "0"))
        except ValueError as error:
            raise RuntimeError("BITCOIN_REFUND_FEE_SATS must be an integer.") from error
        lifecycle_instance = LifecycleService(
            issuer=os.environ.get("CREDIT_ISSUER_ID", "rappterbox"),
            repository=repository,
            signer=signer,
            owner_authorizer=DisabledOwnerAuthorizer(),
            refund_router=configured_refund_router(),
            resale_verifier=DisabledResaleSettlementVerifier(),
            verify_credit=lambda record: service_instance.verify(record)["valid"],
            bitcoin_refund_fee_sats=bitcoin_fee_sats,
        )
        subscription_instance = SubscriptionService(
            issuer=os.environ.get("CREDIT_ISSUER_ID", "rappterbox"),
            credits=repository,
            repository=AzureTableSubscriptionRepository(repository.table, repository),
            signer=signer,
            account_verifier=DisabledAccountTokenVerifier(),
            webhook_verifier=DisabledBillingWebhookVerifier(),
            recovery_adapter=DisabledSubscriptionRecoveryAdapter(),
            verify_credit=lambda record: service_instance.verify(record)["valid"],
        )
    return service_instance


def reset_service() -> None:
    global lifecycle_instance, lifecycle_override
    global service_instance, service_override
    global subscription_instance, subscription_override
    service_instance = None
    service_override = None
    lifecycle_instance = None
    lifecycle_override = None
    subscription_instance = None
    subscription_override = None


def _lifecycle() -> LifecycleService:
    if lifecycle_override is not None:
        return lifecycle_override
    _service()
    if lifecycle_instance is None:
        raise RuntimeError("Credit lifecycle service is unavailable.")
    return lifecycle_instance


def _subscriptions() -> SubscriptionService:
    if subscription_override is not None:
        return subscription_override
    _service()
    if subscription_instance is None:
        raise RuntimeError("Subscription service is unavailable.")
    return subscription_instance


def _scoped_token(req: func.HttpRequest) -> str | None:
    authorization = req.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    return token if token and len(token) <= 8_192 else None


def _body(req: func.HttpRequest) -> Any:
    content_length = req.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_CREDIT_REQUEST_BYTES:
                raise CreditError("Request body is too large.")
        except ValueError as error:
            raise CreditError("Content-Length is invalid.") from error
    raw = req.get_body()
    if len(raw) > MAX_CREDIT_REQUEST_BYTES:
        raise CreditError("Request body is too large.")
    try:
        return json.loads(
            raw,
            parse_constant=lambda value: _reject_json_constant(value),
        )
    except (UnicodeDecodeError, ValueError) as error:
        raise CreditError("Request body must be valid JSON.") from error


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"Invalid JSON constant: {value}")


def _call(operation):
    try:
        return operation()
    except CreditError as error:
        return error_response(error.status_code, str(error), error.code)
    except Exception as error:
        logging.warning("Credit registry request failed (%s).", type(error).__name__)
        return error_response(
            503,
            "The official credit registry is temporarily unavailable.",
            "credit_registry_unavailable",
            error_type="server_error",
        )


def quote(_: func.HttpRequest) -> func.HttpResponse:
    return _call(lambda: json_response(_service().quote(_.params.get("set_id"))))


def issuer(req: func.HttpRequest) -> func.HttpResponse:
    key_id = req.params.get("key_id")
    return _call(lambda: json_response(_service().issuer_descriptor(key_id)))


def list_credits(req: func.HttpRequest) -> func.HttpResponse:
    return _call(lambda: json_response(
        _service().list_credits(req.params.get("after"), req.params.get("limit")),
    ))


def schedules(req: func.HttpRequest) -> func.HttpResponse:
    set_id = req.params.get("set_id")
    if set_id:
        return _call(lambda: json_response(_service().get_current_schedule(set_id)))
    return _call(lambda: json_response(
        _service().list_schedules(req.params.get("after"), req.params.get("limit")),
    ))


def lookup(req: func.HttpRequest) -> func.HttpResponse:
    credit_id = req.params.get("credit_id")
    organism_rappid = req.params.get("organism_rappid")
    if bool(credit_id) == bool(organism_rappid):
        return error_response(
            400,
            "Provide exactly one of credit_id or organism_rappid.",
            "invalid_lookup",
        )
    return _call(lambda: json_response(
        _service().get_credit(credit_id)
        if credit_id
        else _service().get_by_organism(organism_rappid),
    ))


def verify(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        value = _body(req)
        if isinstance(value, dict) and value.get("schema") in EVENT_SCHEMAS:
            return json_response(_lifecycle().verify_event(value))
        if isinstance(value, dict) and value.get("schema") == "rappter-valuation-schedule/1":
            return json_response(_service().verify_schedule(value))
        return json_response(_service().verify(value))

    return _call(operation)


def redeem(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        value = _body(req)
        record, created = _service().redeem(value)
        return json_response(
            {"created": created, "credit": record},
            201 if created else 200,
        )

    return _call(operation)


def publish_schedule(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        value = _body(req)
        return json_response(_service().publish_schedule(value), 201)

    return _call(operation)


def authorize_capsule(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        value = _body(req)
        return json_response(_service().authorize_capsule(value))

    return _call(operation)


def lifecycle_status(_: func.HttpRequest) -> func.HttpResponse:
    return _call(lambda: json_response(_lifecycle().status()))


def ownership(req: func.HttpRequest) -> func.HttpResponse:
    return _call(lambda: json_response(
        _lifecycle().ownership(req.params.get("credit_id")),
    ))


def lifecycle_events(req: func.HttpRequest) -> func.HttpResponse:
    return _call(lambda: json_response(_lifecycle().list_events(
        req.params.get("credit_id"),
        req.params.get("after"),
        req.params.get("limit"),
    )))


def return_credit(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        event, created = _lifecycle().return_credit(_body(req), _scoped_token(req))
        return json_response({"created": created, "event": event}, 201 if created else 200)

    return _call(operation)


def list_for_resale(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        event, created = _lifecycle().list_for_resale(_body(req), _scoped_token(req))
        return json_response({"created": created, "event": event}, 201 if created else 200)

    return _call(operation)


def cancel_listing(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        event, created = _lifecycle().cancel_listing(_body(req), _scoped_token(req))
        return json_response({"created": created, "event": event}, 201 if created else 200)

    return _call(operation)


def complete_sale(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        events, created = _lifecycle().complete_sale(_body(req), _scoped_token(req))
        return json_response({"created": created, "events": events}, 201 if created else 200)

    return _call(operation)


def subscription_policy(_: func.HttpRequest) -> func.HttpResponse:
    return _call(lambda: json_response(_subscriptions().service_status()))


def claim_companion(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        entitlement, created = _subscriptions().claim_companion(_scoped_token(req))
        return json_response(
            {"created": created, "entitlement": entitlement},
            201 if created else 200,
        )

    return _call(operation)


def entitlement_status(req: func.HttpRequest) -> func.HttpResponse:
    return _call(lambda: json_response(_subscriptions().entitlement_status(
        _scoped_token(req),
        req.params.get("credit_id"),
    )))


def subscription_events(req: func.HttpRequest) -> func.HttpResponse:
    return _call(lambda: json_response(_subscriptions().public_events(
        req.params.get("credit_id"),
        req.params.get("after"),
        req.params.get("limit"),
    )))


def subscription_capsule_access(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        return json_response(_subscriptions().capsule_access(
            _scoped_token(req),
            _body(req),
        ))

    return _call(operation)


def billing_webhook(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        raw = req.get_body()
        if len(raw) > MAX_CREDIT_REQUEST_BYTES:
            raise CreditError("Billing webhook body is too large.")
        events, created = _subscriptions().process_webhook(
            raw,
            {key.lower(): value for key, value in req.headers.items()},
        )
        return json_response({"created": created, "events": events}, 201 if created else 200)

    return _call(operation)


def recover_subscription(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        value = _body(req)
        if not isinstance(value, dict) or set(value) != {"proof"}:
            raise CreditError("Subscription recovery request has an invalid shape.")
        results = _subscriptions().recover(_scoped_token(req), value["proof"])
        return json_response({"recoveries": results})

    return _call(operation)


def sync_subscription(req: func.HttpRequest) -> func.HttpResponse:
    def operation():
        value = _body(req)
        if not isinstance(value, dict) or set(value) != {"credit_id"}:
            raise CreditError("Subscription sync request has an invalid shape.")
        events, created = _subscriptions().sync_expiry(
            _scoped_token(req),
            value["credit_id"],
        )
        return json_response({"created": created, "events": events})

    return _call(operation)
