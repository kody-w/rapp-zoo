import json
import logging

import azure.functions as func

from breathing import wild_breathing_service
import model_gateway
from credits import api as credit_api
from credits.domain import CreditError
from http_responses import error_response, json_response


app = func.FunctionApp()


def _breathing_body(req: func.HttpRequest):
    raw = req.get_body()
    if len(raw) > 16_384:
        raise CreditError("Breathing request body is too large.")
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CreditError("Breathing request body must be valid JSON.") from error


def _breathing_token(req: func.HttpRequest) -> str | None:
    authorization = req.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        return None
    token = authorization.removeprefix("Bearer ").strip()
    return token if token and len(token) <= 8_192 else None


def _breathing_call(operation):
    try:
        return json_response(operation())
    except CreditError as error:
        return error_response(error.status_code, str(error), error.code)
    except Exception as error:
        logging.warning("Wild breathing request failed (%s).", type(error).__name__)
        return error_response(
            503,
            "Wild breathing is temporarily unavailable.",
            "wild_breathing_unavailable",
            error_type="server_error",
        )


@app.route(route="health", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def health(req: func.HttpRequest) -> func.HttpResponse:
    del req
    return json_response({
        **model_gateway.health_payload(),
        "wild_breathing": wild_breathing_service.status(),
    })


@app.route(
    route="v1/models",
    methods=["GET"],
    auth_level=func.AuthLevel.FUNCTION,
)
def openai_models(req: func.HttpRequest) -> func.HttpResponse:
    del req
    return model_gateway.models_response()


@app.route(
    route="v1/chat/completions",
    methods=["POST"],
    auth_level=func.AuthLevel.FUNCTION,
)
def openai_chat(req: func.HttpRequest) -> func.HttpResponse:
    return model_gateway.chat_response(req)


@app.route(
    route="v1/credit-registry/quote",
    methods=["GET"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def credit_quote(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.quote(req)


@app.route(
    route="v1/credit-registry/issuer",
    methods=["GET"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def credit_issuer(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.issuer(req)


@app.route(
    route="v1/credit-registry/credits",
    methods=["GET"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def credit_list(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.list_credits(req)


@app.route(
    route="v1/credit-registry/schedules",
    methods=["GET"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def valuation_schedules(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.schedules(req)


@app.route(
    route="v1/credit-registry/lookup",
    methods=["GET"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def credit_lookup(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.lookup(req)


@app.route(
    route="v1/credit-registry/lifecycle/status",
    methods=["GET"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def credit_lifecycle_status(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.lifecycle_status(req)


@app.route(
    route="v1/credit-registry/ownership",
    methods=["GET"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def credit_ownership(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.ownership(req)


@app.route(
    route="v1/credit-registry/lifecycle",
    methods=["GET"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def credit_lifecycle(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.lifecycle_events(req)


@app.route(
    route="v1/credit-registry/verify",
    methods=["POST"],
    auth_level=func.AuthLevel.ANONYMOUS,
)
def credit_verify(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.verify(req)


@app.route(
    route="v1/purchases/redeem",
    methods=["POST"],
    auth_level=func.AuthLevel.FUNCTION,
)
def purchase_redeem(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.redeem(req)


@app.route(
    route="v1/credits/return",
    methods=["POST"],
    auth_level=func.AuthLevel.FUNCTION,
)
def credit_return(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.return_credit(req)


@app.route(
    route="v1/resale/listings",
    methods=["POST"],
    auth_level=func.AuthLevel.FUNCTION,
)
def resale_listing(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.list_for_resale(req)


@app.route(
    route="v1/resale/listings/cancel",
    methods=["POST"],
    auth_level=func.AuthLevel.FUNCTION,
)
def resale_listing_cancel(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.cancel_listing(req)


@app.route(
    route="v1/resale/sales",
    methods=["POST"],
    auth_level=func.AuthLevel.FUNCTION,
)
def resale_sale(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.complete_sale(req)


@app.route(
    route="v1/issuer/valuation-schedules",
    methods=["POST"],
    auth_level=func.AuthLevel.FUNCTION,
)
def valuation_schedule_publish(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.publish_schedule(req)


@app.route(
    route="v1/breathing/status",
    methods=["GET"],
    auth_level=func.AuthLevel.FUNCTION,
)
def wild_breathing_status(req: func.HttpRequest) -> func.HttpResponse:
    del req
    return json_response(wild_breathing_service.status())


@app.route(
    route="v1/breathing/start",
    methods=["POST"],
    auth_level=func.AuthLevel.FUNCTION,
)
def wild_breathing_start(req: func.HttpRequest) -> func.HttpResponse:
    return _breathing_call(lambda: wild_breathing_service.start(
        _breathing_body(req),
        _breathing_token(req),
    ))


@app.route(
    route="v1/breathing/pause",
    methods=["POST"],
    auth_level=func.AuthLevel.FUNCTION,
)
def wild_breathing_pause(req: func.HttpRequest) -> func.HttpResponse:
    return _breathing_call(lambda: wild_breathing_service.pause(
        _breathing_body(req),
        _breathing_token(req),
    ))


@app.route(
    route="v1/capsules/authorize-download",
    methods=["POST"],
    auth_level=func.AuthLevel.FUNCTION,
)
def capsule_authorize(req: func.HttpRequest) -> func.HttpResponse:
    return credit_api.authorize_capsule(req)
