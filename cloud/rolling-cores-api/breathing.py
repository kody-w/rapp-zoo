import os
from dataclasses import dataclass
from typing import Any, Protocol

from credits.domain import CreditError, validate_organism_rappid


class WildBreathingUnavailable(CreditError):
    code = "wild_breathing_unavailable"
    status_code = 503


class WildBreathingRejected(CreditError):
    code = "wild_breathing_rejected"
    status_code = 403


LIMIT_KEYS = {
    "interval_seconds",
    "max_ticks",
    "max_output_tokens_per_tick",
    "max_total_output_tokens",
    "lease_seconds",
}
START_KEYS = {
    "organism_rappid",
    "limits",
    "acknowledge_metered_compute",
}
PAUSE_KEYS = {"organism_rappid"}


def _integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise CreditError(f"{label} must be an integer.")
    if value < minimum or value > maximum:
        raise CreditError(f"{label} is outside the allowed range.")
    return value


@dataclass(frozen=True)
class WildBreathingCeilings:
    minimum_interval_seconds: int
    maximum_ticks_per_lease: int
    maximum_output_tokens_per_tick: int
    maximum_total_output_tokens: int
    maximum_lease_seconds: int

    @classmethod
    def from_env(cls) -> "WildBreathingCeilings":
        try:
            return cls(
                minimum_interval_seconds=int(
                    os.environ.get("WILD_BREATH_MIN_INTERVAL_SECONDS", "300"),
                ),
                maximum_ticks_per_lease=int(
                    os.environ.get("WILD_BREATH_MAX_TICKS_PER_LEASE", "12"),
                ),
                maximum_output_tokens_per_tick=int(
                    os.environ.get("WILD_BREATH_MAX_OUTPUT_TOKENS_PER_TICK", "512"),
                ),
                maximum_total_output_tokens=int(
                    os.environ.get("WILD_BREATH_MAX_TOTAL_OUTPUT_TOKENS", "6144"),
                ),
                maximum_lease_seconds=int(
                    os.environ.get("WILD_BREATH_MAX_LEASE_SECONDS", "86400"),
                ),
            ).validated()
        except ValueError as error:
            raise RuntimeError("Wild breathing ceiling configuration is invalid.") from error

    def validated(self) -> "WildBreathingCeilings":
        _integer(self.minimum_interval_seconds, "minimum interval", 60, 86_400)
        _integer(self.maximum_ticks_per_lease, "maximum ticks", 1, 288)
        _integer(
            self.maximum_output_tokens_per_tick,
            "maximum output tokens per tick",
            64,
            4_096,
        )
        _integer(
            self.maximum_total_output_tokens,
            "maximum total output tokens",
            64,
            1_000_000,
        )
        _integer(self.maximum_lease_seconds, "maximum lease", 60, 604_800)
        if self.maximum_total_output_tokens > (
            self.maximum_ticks_per_lease * self.maximum_output_tokens_per_tick
        ):
            raise CreditError("Wild breathing ceiling totals are inconsistent.")
        return self

    def public_dict(self) -> dict[str, int]:
        return {
            "minimum_interval_seconds": self.minimum_interval_seconds,
            "maximum_ticks_per_lease": self.maximum_ticks_per_lease,
            "maximum_output_tokens_per_tick": self.maximum_output_tokens_per_tick,
            "maximum_total_output_tokens": self.maximum_total_output_tokens,
            "maximum_lease_seconds": self.maximum_lease_seconds,
        }


class ScopedTokenVerifier(Protocol):
    configured: bool

    def verify(self, token: str, organism_rappid: str) -> dict[str, Any]:
        ...


class PrepaidComputeLedger(Protocol):
    configured: bool

    def reserve(self, claims: dict[str, Any], limits: dict[str, int]) -> str:
        ...

    def pause(self, claims: dict[str, Any], organism_rappid: str) -> None:
        ...


class BreathingWorkerScheduler(Protocol):
    configured: bool

    def start(
        self,
        claims: dict[str, Any],
        organism_rappid: str,
        limits: dict[str, int],
        reservation_id: str,
    ) -> str:
        ...


class DisabledAdapter:
    configured = False

    def verify(self, token: str, organism_rappid: str) -> dict[str, Any]:
        del token, organism_rappid
        raise WildBreathingUnavailable("Scoped Rapterbox token verification is not configured.")

    def reserve(self, claims: dict[str, Any], limits: dict[str, int]) -> str:
        del claims, limits
        raise WildBreathingUnavailable("The prepaid compute ledger is not configured.")

    def pause(self, claims: dict[str, Any], organism_rappid: str) -> None:
        del claims, organism_rappid

    def start(
        self,
        claims: dict[str, Any],
        organism_rappid: str,
        limits: dict[str, int],
        reservation_id: str,
    ) -> str:
        del claims, organism_rappid, limits, reservation_id
        raise WildBreathingUnavailable("The Wild breathing worker is not configured.")


class WildBreathingService:
    def __init__(
        self,
        *,
        ceilings: WildBreathingCeilings,
        token_verifier: ScopedTokenVerifier,
        ledger: PrepaidComputeLedger,
        scheduler: BreathingWorkerScheduler,
    ):
        self.ceilings = ceilings.validated()
        self.token_verifier = token_verifier
        self.ledger = ledger
        self.scheduler = scheduler

    def status(self) -> dict[str, Any]:
        reasons = []
        if not self.token_verifier.configured:
            reasons.append("scoped-token-verifier-not-configured")
        if not self.ledger.configured:
            reasons.append("prepaid-compute-ledger-not-configured")
        if not self.scheduler.configured:
            reasons.append("breathing-worker-not-configured")
        return {
            "schema": "rappter-breath-eligibility/1",
            "mode": "wild",
            "breath_eligible": not reasons,
            "state": "Sleeping",
            "reason_codes": reasons or ["eligible-awaiting-explicit-start"],
            "requires": [
                "scoped-rapterbox-token",
                "positive-prepaid-compute-balance",
                "explicit-bounded-lease",
            ],
            "ceilings": self.ceilings.public_dict(),
            "spend_is_bounded": True,
            "history_preserved_when_stopped": True,
        }

    def start(self, request: Any, token: str | None) -> dict[str, Any]:
        if not isinstance(request, dict) or set(request) != START_KEYS:
            raise CreditError("Wild breathing start request has an invalid shape.")
        if request.get("acknowledge_metered_compute") is not True:
            raise CreditError("Metered compute must be explicitly acknowledged.")
        organism_rappid = validate_organism_rappid(request.get("organism_rappid"))
        limits = self.validate_limits(request.get("limits"))
        if not token:
            raise WildBreathingRejected("A scoped Rapterbox token is required.")
        claims = self.token_verifier.verify(token, organism_rappid)
        reservation_id = self.ledger.reserve(claims, limits)
        lease_id = self.scheduler.start(
            claims,
            organism_rappid,
            limits,
            reservation_id,
        )
        return {
            "schema": "rappter-breath-lease/1",
            "mode": "wild",
            "state": "Waking",
            "organism_rappid": organism_rappid,
            "lease_id": lease_id,
            "limits": limits,
            "spend_is_bounded": True,
        }

    def pause(self, request: Any, token: str | None) -> dict[str, Any]:
        if not isinstance(request, dict) or set(request) != PAUSE_KEYS:
            raise CreditError("Wild breathing pause request has an invalid shape.")
        organism_rappid = validate_organism_rappid(request.get("organism_rappid"))
        if token and self.token_verifier.configured:
            claims = self.token_verifier.verify(token, organism_rappid)
            self.ledger.pause(claims, organism_rappid)
        return {
            "schema": "rappter-breath-status/1",
            "mode": "wild",
            "state": "Sleeping",
            "organism_rappid": organism_rappid,
            "pause_reason": "explicit-pause",
            "history_preserved": True,
        }

    def validate_limits(self, value: Any) -> dict[str, int]:
        if not isinstance(value, dict) or set(value) != LIMIT_KEYS:
            raise CreditError("Wild breathing limits have an invalid shape.")
        limits = {
            "interval_seconds": _integer(
                value.get("interval_seconds"),
                "interval_seconds",
                self.ceilings.minimum_interval_seconds,
                self.ceilings.maximum_lease_seconds,
            ),
            "max_ticks": _integer(
                value.get("max_ticks"),
                "max_ticks",
                1,
                self.ceilings.maximum_ticks_per_lease,
            ),
            "max_output_tokens_per_tick": _integer(
                value.get("max_output_tokens_per_tick"),
                "max_output_tokens_per_tick",
                64,
                self.ceilings.maximum_output_tokens_per_tick,
            ),
            "max_total_output_tokens": _integer(
                value.get("max_total_output_tokens"),
                "max_total_output_tokens",
                64,
                self.ceilings.maximum_total_output_tokens,
            ),
            "lease_seconds": _integer(
                value.get("lease_seconds"),
                "lease_seconds",
                60,
                self.ceilings.maximum_lease_seconds,
            ),
        }
        if limits["max_total_output_tokens"] > (
            limits["max_ticks"] * limits["max_output_tokens_per_tick"]
        ):
            raise CreditError("Wild breathing total tokens exceed the per-tick tick budget.")
        if limits["max_ticks"] * limits["interval_seconds"] > limits["lease_seconds"]:
            raise CreditError("Wild breathing ticks do not fit inside the requested lease.")
        return limits


wild_breathing_service = WildBreathingService(
    ceilings=WildBreathingCeilings.from_env(),
    token_verifier=DisabledAdapter(),
    ledger=DisabledAdapter(),
    scheduler=DisabledAdapter(),
)
