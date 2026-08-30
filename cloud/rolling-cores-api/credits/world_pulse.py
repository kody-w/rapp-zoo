import hashlib
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from .domain import CreditError, bounded_text, canonical_json, hash_reference, validate_sha256
from .growth import GROWTH_CATEGORIES
from .signing import RegistrySigner


WORLD_PULSE_SCHEMA = "rapp-rapter-world-pulse/1"
ENTITLEMENT_CLASSES = {
    "verified-account",
    "free-companion",
    "premium-owner",
    "premium-lessee",
}
MILESTONE_KINDS = {"shared-story", "shared-region"}


@dataclass(frozen=True)
class VerifiedGrowthAttestation:
    attestation_id: str
    account_reference: str
    entitlement_class: str
    category: str
    points: int
    observed_utc: str
    source: str
    evidence_hash: str
    account_verified: bool
    anti_sybil_passed: bool


class GrowthAttestationVerifier(Protocol):
    configured: bool

    def verify(self, payload: bytes, headers: dict[str, str]) -> VerifiedGrowthAttestation:
        ...


class DisabledGrowthAttestationVerifier:
    configured = False

    def verify(self, payload: bytes, headers: dict[str, str]) -> VerifiedGrowthAttestation:
        del payload, headers
        raise CreditError("Growth attestation verification is not configured.")


def _utc(value: Any, label: str) -> datetime:
    text = bounded_text(value, label, 64)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as error:
        raise CreditError(f"{label} is invalid.") from error
    if parsed.tzinfo is None:
        raise CreditError(f"{label} must include a timezone.")
    return parsed.astimezone(timezone.utc)


def _merkle_root(leaves: list[str]) -> str:
    if not leaves:
        return hashlib.sha256(b"rappter-world-pulse-empty").hexdigest()
    level = [bytes.fromhex(value) for value in sorted(leaves)]
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        level = [
            hashlib.sha256(b"world-pulse-node\0" + level[index] + level[index + 1]).digest()
            for index in range(0, len(level), 2)
        ]
    return level[0].hex()


class InMemoryWorldPulseLedger:
    def __init__(
        self,
        *,
        verifier: GrowthAttestationVerifier,
        points_per_event_cap: int = 5,
        events_per_account_daily_cap: int = 10,
        points_per_account_daily_cap: int = 40,
    ):
        self.verifier = verifier
        self.points_per_event_cap = points_per_event_cap
        self.events_per_account_daily_cap = events_per_account_daily_cap
        self.points_per_account_daily_cap = points_per_account_daily_cap
        self.events: dict[str, dict[str, Any]] = {}
        self.account_day_events: dict[tuple[str, str], int] = defaultdict(int)
        self.account_day_points: dict[tuple[str, str], int] = defaultdict(int)

    def record(
        self,
        payload: bytes,
        headers: dict[str, str],
    ) -> tuple[dict[str, Any], bool]:
        attestation = self.verifier.verify(payload, headers)
        if not attestation.account_verified or not attestation.anti_sybil_passed:
            raise CreditError("Growth contribution failed verified-account anti-Sybil policy.")
        if attestation.entitlement_class not in ENTITLEMENT_CLASSES:
            raise CreditError("Growth contribution entitlement class is invalid.")
        if attestation.category not in GROWTH_CATEGORIES:
            raise CreditError("Growth contribution category is invalid.")
        if (
            isinstance(attestation.points, bool)
            or not isinstance(attestation.points, int)
            or attestation.points < 1
            or attestation.points > self.points_per_event_cap
        ):
            raise CreditError("Growth contribution points exceed the event cap.")
        observed = _utc(attestation.observed_utc, "observed_utc")
        evidence_hash = validate_sha256(attestation.evidence_hash, "evidence_hash")
        account_hash = hash_reference(
            "world-pulse-account",
            bounded_text(attestation.account_reference, "account reference", 512),
        )
        event_hash = hash_reference(
            "world-pulse-attestation",
            bounded_text(attestation.attestation_id, "attestation id", 512),
        )
        if event_hash in self.events:
            return self.events[event_hash], False
        day_key = (account_hash, observed.date().isoformat())
        if self.account_day_events[day_key] >= self.events_per_account_daily_cap:
            raise CreditError("Growth contribution daily event cap would be exceeded.")
        if (
            self.account_day_points[day_key] + attestation.points
            > self.points_per_account_daily_cap
        ):
            raise CreditError("Growth contribution daily point cap would be exceeded.")
        record = {
            "event_hash": event_hash,
            "account_hash": account_hash,
            "entitlement_class": attestation.entitlement_class,
            "category": attestation.category,
            "points": attestation.points,
            "observed_utc": observed.isoformat(timespec="seconds"),
            "attester": bounded_text(attestation.source, "attester source", 128),
            "evidence_hash": evidence_hash,
            "purchasable": False,
            "transferable": False,
            "redeemable": False,
        }
        self.events[event_hash] = record
        self.account_day_events[day_key] += 1
        self.account_day_points[day_key] += attestation.points
        return record, True

    def window(self, start_utc: str, end_utc: str) -> list[dict[str, Any]]:
        start = _utc(start_utc, "window_start_utc")
        end = _utc(end_utc, "window_end_utc")
        if end <= start:
            raise CreditError("World Pulse window end must follow its start.")
        return sorted(
            (
                event
                for event in self.events.values()
                if start <= _utc(event["observed_utc"], "observed_utc") < end
            ),
            key=lambda event: (event["observed_utc"], event["event_hash"]),
        )


class WorldPulseService:
    def __init__(
        self,
        *,
        issuer: str,
        ledger: InMemoryWorldPulseLedger,
        signer: RegistrySigner,
        milestones: list[dict[str, Any]],
    ):
        self.issuer = issuer
        self.ledger = ledger
        self.signer = signer
        self.milestones = milestones

    def submit_attestation(
        self,
        payload: bytes,
        headers: dict[str, str],
    ) -> tuple[dict[str, Any], bool]:
        return self.ledger.record(payload, headers)

    def checkpoint(
        self,
        *,
        window_start_utc: str,
        window_end_utc: str,
        previous_aggregate_hash: str | None,
    ) -> dict[str, Any]:
        return build_world_pulse_checkpoint(
            issuer=self.issuer,
            window_start_utc=window_start_utc,
            window_end_utc=window_end_utc,
            events=self.ledger.window(window_start_utc, window_end_utc),
            previous_aggregate_hash=previous_aggregate_hash,
            milestones=self.milestones,
            signer=self.signer,
        )

    def status(self) -> dict[str, Any]:
        return {
            "schema": "rapp-rapter-world-pulse-policy/1",
            "attestation_verifier_configured": self.ledger.verifier.configured,
            "verified_accounts_only": True,
            "free_companion_accounts_eligible": True,
            "points_per_event_cap": self.ledger.points_per_event_cap,
            "events_per_account_daily_cap": self.ledger.events_per_account_daily_cap,
            "points_per_account_daily_cap": self.ledger.points_per_account_daily_cap,
            "purchasable": False,
            "redeemable": False,
            "monetary_value": False,
        }


def build_world_pulse_checkpoint(
    *,
    issuer: str,
    window_start_utc: str,
    window_end_utc: str,
    events: list[dict[str, Any]],
    previous_aggregate_hash: str | None,
    milestones: list[dict[str, Any]],
    signer: RegistrySigner,
) -> dict[str, Any]:
    start = _utc(window_start_utc, "window_start_utc")
    end = _utc(window_end_utc, "window_end_utc")
    if end <= start:
        raise CreditError("World Pulse window end must follow its start.")
    if previous_aggregate_hash is not None:
        previous_aggregate_hash = validate_sha256(
            previous_aggregate_hash,
            "previous_aggregate_hash",
        )
    event_hashes = []
    participants = set()
    point_total = 0
    for event in events:
        if set(event) != {
            "event_hash",
            "account_hash",
            "entitlement_class",
            "category",
            "points",
            "observed_utc",
            "attester",
            "evidence_hash",
            "purchasable",
            "transferable",
            "redeemable",
        }:
            raise CreditError("World Pulse event projection contains private or unknown data.")
        observed = _utc(event["observed_utc"], "observed_utc")
        if not start <= observed < end:
            raise CreditError("World Pulse event falls outside the aggregate window.")
        event_hashes.append(validate_sha256(event["event_hash"], "event_hash"))
        participants.add(validate_sha256(event["account_hash"], "account_hash"))
        point_total += event["points"]
        if any(event[name] is not False for name in (
            "purchasable",
            "transferable",
            "redeemable",
        )):
            raise CreditError("World Pulse points cannot carry monetary rights.")
    unlocked = []
    for milestone in milestones:
        if not isinstance(milestone, dict) or set(milestone) != {
            "milestone_id",
            "threshold_points",
            "event_kind",
        }:
            raise CreditError("World Pulse milestone has an invalid shape.")
        threshold = milestone["threshold_points"]
        if (
            isinstance(threshold, bool)
            or not isinstance(threshold, int)
            or threshold < 1
            or milestone["event_kind"] not in MILESTONE_KINDS
        ):
            raise CreditError("World Pulse milestone is invalid.")
        if point_total >= threshold:
            unlocked.append({
                "milestone_id": bounded_text(
                    milestone["milestone_id"],
                    "milestone_id",
                    128,
                ),
                "event_kind": milestone["event_kind"],
                "threshold_points": threshold,
            })
    base = {
        "schema": WORLD_PULSE_SCHEMA,
        "kind": "swarm.telemetry",
        "issuer": bounded_text(issuer, "issuer", 128),
        "window_start_utc": start.isoformat(timespec="seconds"),
        "window_end_utc": end.isoformat(timespec="seconds"),
        "previous_aggregate_hash": previous_aggregate_hash,
        "participant_count": len(participants),
        "event_count": len(event_hashes),
        "point_total": point_total,
        "evidence_merkle_root": _merkle_root(event_hashes),
        "unlocked_events": unlocked,
        "monetary_value": False,
        "purchasable_points": False,
        "investment_value": False,
    }
    aggregate_hash = hashlib.sha256(canonical_json(base)).hexdigest()
    payload = {
        **base,
        "aggregate_id": f"world-pulse:{aggregate_hash}",
        "aggregate_hash": aggregate_hash,
    }
    return {**payload, "signature": signer.sign(payload)}
