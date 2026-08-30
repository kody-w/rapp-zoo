import json
from typing import Any

import azure.functions as func


def json_response(
    body: dict[str, Any],
    status_code: int = 200,
) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(body, separators=(",", ":")),
        status_code=status_code,
        mimetype="application/json",
        headers={
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
        },
    )


def error_response(
    status_code: int,
    message: str,
    code: str,
    *,
    param: str | None = None,
    error_type: str = "invalid_request_error",
) -> func.HttpResponse:
    return json_response(
        {
            "error": {
                "message": message,
                "type": error_type,
                "param": param,
                "code": code,
            },
        },
        status_code,
    )
