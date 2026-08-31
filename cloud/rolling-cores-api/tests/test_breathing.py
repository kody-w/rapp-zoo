import pytest

from breathing import (
    DisabledAdapter,
    WildBreathingCeilings,
    WildBreathingService,
    WildBreathingUnavailable,
)
from credits.domain import CreditError


SUBJECT = "rappid:@owner/rapter:" + "a" * 64


def service():
    adapter = DisabledAdapter()
    return WildBreathingService(
        ceilings=WildBreathingCeilings(
            minimum_interval_seconds=300,
            maximum_ticks_per_lease=12,
            maximum_output_tokens_per_tick=512,
            maximum_total_output_tokens=6144,
            maximum_lease_seconds=86400,
        ),
        token_verifier=adapter,
        ledger=adapter,
        scheduler=adapter,
    )


def limits():
    return {
        "interval_seconds": 300,
        "max_ticks": 6,
        "max_output_tokens_per_tick": 512,
        "max_total_output_tokens": 3072,
        "lease_seconds": 3600,
    }


def test_wild_status_fails_closed_without_token_ledger_or_worker():
    status = service().status()
    assert status["breath_eligible"] is False
    assert status["state"] == "Sleeping"
    assert status["spend_is_bounded"] is True
    assert status["reason_codes"] == [
        "scoped-token-verifier-not-configured",
        "prepaid-compute-ledger-not-configured",
        "breathing-worker-not-configured",
    ]


def test_wild_start_requires_explicit_bounded_metered_consent():
    breathing = service()
    with pytest.raises(CreditError, match="explicitly acknowledged"):
        breathing.start({
            "organism_rappid": SUBJECT,
            "limits": limits(),
            "acknowledge_metered_compute": False,
        }, "scoped-token")
    too_large = {**limits(), "max_ticks": 13}
    with pytest.raises(CreditError, match="outside the allowed range"):
        breathing.start({
            "organism_rappid": SUBJECT,
            "limits": too_large,
            "acknowledge_metered_compute": True,
        }, "scoped-token")
    with pytest.raises(WildBreathingUnavailable, match="token verification"):
        breathing.start({
            "organism_rappid": SUBJECT,
            "limits": limits(),
            "acknowledge_metered_compute": True,
        }, "scoped-token")


def test_explicit_pause_is_safe_even_when_credentials_are_revoked():
    result = service().pause({"organism_rappid": SUBJECT}, None)
    assert result["state"] == "Sleeping"
    assert result["pause_reason"] == "explicit-pause"
    assert result["history_preserved"] is True
