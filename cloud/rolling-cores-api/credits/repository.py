import json
import threading
from collections.abc import Callable
from typing import Any, Protocol

from azure.core import MatchConditions
from azure.core.exceptions import HttpResponseError, ResourceExistsError, ResourceNotFoundError
from azure.data.tables import TableServiceClient, UpdateMode

from .domain import (
    CreditConflict,
    CreditNotFound,
    IssuanceCapReached,
    RegistryUnavailable,
)
from .valuation import ValuationScheduleChanged, ValuationScheduleNotFound


PARTITION = "official"
COUNTER_ROW = "meta:issuance"
SCHEDULE_COUNTER_ROW = "meta:valuation"
INDEX_WIDTH = 12


def _credit_row(credit_id: str) -> str:
    return f"credit:{credit_id}"


def _payment_row(payment_reference_hash: str) -> str:
    return f"payment:{payment_reference_hash}"


def _organism_row(organism_lookup_hash: str) -> str:
    return f"organism:{organism_lookup_hash}"


def _issuance_row(index: int) -> str:
    return f"issuance:{index:0{INDEX_WIDTH}d}"


def _ownership_row(credit_id: str) -> str:
    return f"ownership:{credit_id}"


def _schedule_row(schedule_id: str) -> str:
    return f"schedule:{schedule_id}"


def _schedule_index_row(index: int) -> str:
    return f"schedule-index:{index:0{INDEX_WIDTH}d}"


def _schedule_pointer_row(set_lookup_hash: str) -> str:
    return f"schedule-current:{set_lookup_hash}"


def _event_row(event_id: str) -> str:
    return f"event:{event_id}"


def _lifecycle_row(credit_id: str, event_seq: int) -> str:
    return f"lifecycle:{credit_id}:{event_seq:0{INDEX_WIDTH}d}"


def _operation_row(operation_hash: str) -> str:
    return f"operation:{operation_hash}"


def _record_entity(row_key: str, record: dict[str, Any]) -> dict[str, Any]:
    return {
        "PartitionKey": PARTITION,
        "RowKey": row_key,
        "credit_id": record["credit_id"],
        "record_json": json.dumps(record, separators=(",", ":"), sort_keys=True),
    }


def _schedule_entity(row_key: str, record: dict[str, Any]) -> dict[str, Any]:
    return {
        "PartitionKey": PARTITION,
        "RowKey": row_key,
        "schedule_id": record["schedule_id"],
        "set_id": record["set_id"],
        "record_json": json.dumps(record, separators=(",", ":"), sort_keys=True),
    }


def _entity_record(entity: dict[str, Any]) -> dict[str, Any]:
    return json.loads(entity["record_json"])


def _same_binding(record: dict[str, Any], candidate: dict[str, Any]) -> bool:
    keys = (
        "credit_id",
        "payment_reference_hash",
        "product_id",
        "organism_rappid",
        "genesis_core_id",
        "core_manifest_hash",
    )
    return all(record.get(key) == candidate.get(key) for key in keys)


class CreditRepository(Protocol):
    def issue(
        self,
        *,
        credit_id: str,
        payment_reference_hash: str,
        organism_lookup_hash: str,
        issuance_cap: int,
        set_lookup_hash: str,
        schedule_id: str,
        build_record: Callable[[int, int], dict[str, Any]],
    ) -> tuple[dict[str, Any], bool]:
        ...

    def get_credit(self, credit_id: str) -> dict[str, Any]:
        ...

    def get_by_organism_hash(self, organism_lookup_hash: str) -> dict[str, Any]:
        ...

    def list_credits(self, after: int, limit: int) -> list[dict[str, Any]]:
        ...

    def get_by_payment_hash(self, payment_reference_hash: str) -> dict[str, Any] | None:
        ...

    def publish_schedule(
        self,
        *,
        set_lookup_hash: str,
        build_record: Callable[[int, str | None], dict[str, Any]],
    ) -> dict[str, Any]:
        ...

    def get_schedule(self, schedule_id: str) -> dict[str, Any]:
        ...

    def get_current_schedule(self, set_lookup_hash: str) -> dict[str, Any]:
        ...

    def list_schedules(self, after: int, limit: int) -> list[dict[str, Any]]:
        ...

    def get_ownership(self, credit_id: str) -> dict[str, Any]:
        ...

    def append_lifecycle(
        self,
        *,
        credit_id: str,
        operation_hash: str,
        build_events: Callable[
            [dict[str, Any]],
            tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
        ],
    ) -> tuple[list[dict[str, Any]], bool]:
        ...

    def get_operation_events(self, operation_hash: str) -> list[dict[str, Any]] | None:
        ...

    def get_event(self, event_id: str) -> dict[str, Any]:
        ...

    def list_lifecycle(self, credit_id: str, after: int, limit: int) -> list[dict[str, Any]]:
        ...


class AzureTableCreditRepository:
    def __init__(
        self,
        account_url: str | None = None,
        table_name: str | None = None,
        credential: Any = None,
        *,
        table_client: Any = None,
    ):
        if table_client is not None:
            self.table = table_client
        else:
            service = TableServiceClient(endpoint=account_url, credential=credential)
            service.create_table_if_not_exists(table_name)
            self.table = service.get_table_client(table_name)

    def _get_optional(self, row_key: str) -> dict[str, Any] | None:
        try:
            return self.table.get_entity(PARTITION, row_key)
        except ResourceNotFoundError:
            return None

    def _ensure_counter(self, issuance_cap: int) -> None:
        try:
            self.table.create_entity({
                "PartitionKey": PARTITION,
                "RowKey": COUNTER_ROW,
                "issued_count": 0,
                "issuance_cap": issuance_cap,
            })
        except ResourceExistsError:
            return

    def _ensure_schedule_counter(self) -> None:
        try:
            self.table.create_entity({
                "PartitionKey": PARTITION,
                "RowKey": SCHEDULE_COUNTER_ROW,
                "schedule_count": 0,
            })
        except ResourceExistsError:
            return

    def _idempotent_payment(
        self,
        payment_reference_hash: str,
        candidate: dict[str, Any],
    ) -> dict[str, Any] | None:
        payment = self._get_optional(_payment_row(payment_reference_hash))
        if payment is None:
            return None
        record = self.get_credit(payment["credit_id"])
        if not _same_binding(record, candidate):
            raise CreditConflict("The verified payment is already bound to another credit.")
        return record

    def get_by_payment_hash(self, payment_reference_hash: str) -> dict[str, Any] | None:
        payment = self._get_optional(_payment_row(payment_reference_hash))
        if payment is None:
            return None
        return self.get_credit(payment["credit_id"])

    def issue(
        self,
        *,
        credit_id: str,
        payment_reference_hash: str,
        organism_lookup_hash: str,
        issuance_cap: int,
        set_lookup_hash: str,
        schedule_id: str,
        build_record: Callable[[int, int], dict[str, Any]],
    ) -> tuple[dict[str, Any], bool]:
        self._ensure_counter(issuance_cap)
        if self._get_optional(_organism_row(organism_lookup_hash)) is not None:
            raise CreditConflict("The organism already has an active official credit.")

        for _ in range(6):
            pointer = self._get_optional(_schedule_pointer_row(set_lookup_hash))
            if pointer is None or pointer.get("schedule_id") != schedule_id:
                raise ValuationScheduleChanged(
                    "The active valuation schedule changed before issuance.",
                )
            counter = self.table.get_entity(PARTITION, COUNTER_ROW)
            issued_count = int(counter["issued_count"])
            stored_cap = int(counter["issuance_cap"])
            if issued_count >= stored_cap:
                raise IssuanceCapReached("The official credit issuance cap has been reached.")
            index = issued_count + 1
            record = build_record(index, stored_cap)
            counter_update = {
                "PartitionKey": PARTITION,
                "RowKey": COUNTER_ROW,
                "issued_count": index,
                "issuance_cap": stored_cap,
            }
            credit = _record_entity(_credit_row(credit_id), record)
            payment = {
                "PartitionKey": PARTITION,
                "RowKey": _payment_row(payment_reference_hash),
                "credit_id": credit_id,
            }
            organism = {
                "PartitionKey": PARTITION,
                "RowKey": _organism_row(organism_lookup_hash),
                "credit_id": credit_id,
                "organism_rappid": record["organism_rappid"],
            }
            issuance = _record_entity(_issuance_row(index), record)
            ownership = {
                "PartitionKey": PARTITION,
                "RowKey": _ownership_row(credit_id),
                "credit_id": credit_id,
                "current_owner_hash": record["owner_reference_hash"],
                "current_event_id": f"issuance:{credit_id}",
                "event_seq": 0,
                "state": "owned",
                "active_listing_id": "",
                "purchase_utc": record["purchase_utc"],
            }
            etag = getattr(counter, "metadata", {}).get("etag")
            pointer_etag = getattr(pointer, "metadata", {}).get("etag")
            if not etag or not pointer_etag:
                raise RegistryUnavailable("The issuance transaction guard did not provide an ETag.")
            operations = [
                (
                    "update",
                    counter_update,
                    {
                        "mode": UpdateMode.REPLACE,
                        "etag": etag,
                        "match_condition": MatchConditions.IfNotModified,
                    },
                ),
                ("create", credit),
                ("create", organism),
                ("create", payment),
                ("create", issuance),
                ("create", ownership),
                (
                    "update",
                    dict(pointer),
                    {
                        "mode": UpdateMode.REPLACE,
                        "etag": pointer_etag,
                        "match_condition": MatchConditions.IfNotModified,
                    },
                ),
            ]
            try:
                self.table.submit_transaction(operations)
                return record, True
            except HttpResponseError as error:
                if getattr(error, "status_code", None) not in {409, 412}:
                    raise RegistryUnavailable("The credit registry transaction failed.") from error
                existing = self._idempotent_payment(payment_reference_hash, record)
                if existing is not None:
                    return existing, False
                if self._get_optional(_organism_row(organism_lookup_hash)) is not None:
                    raise CreditConflict("The organism already has an active official credit.")
        raise RegistryUnavailable("The credit registry remained busy after bounded retries.")

    def publish_schedule(
        self,
        *,
        set_lookup_hash: str,
        build_record: Callable[[int, str | None], dict[str, Any]],
    ) -> dict[str, Any]:
        self._ensure_schedule_counter()
        for _ in range(6):
            counter = self.table.get_entity(PARTITION, SCHEDULE_COUNTER_ROW)
            pointer = self._get_optional(_schedule_pointer_row(set_lookup_hash))
            previous_hash = pointer.get("schedule_hash") if pointer else None
            index = int(counter["schedule_count"]) + 1
            record = build_record(index, previous_hash)
            counter_etag = getattr(counter, "metadata", {}).get("etag")
            if not counter_etag:
                raise RegistryUnavailable("The valuation counter did not provide an ETag.")
            counter_update = {
                "PartitionKey": PARTITION,
                "RowKey": SCHEDULE_COUNTER_ROW,
                "schedule_count": index,
            }
            current_pointer = {
                "PartitionKey": PARTITION,
                "RowKey": _schedule_pointer_row(set_lookup_hash),
                "set_id": record["set_id"],
                "schedule_id": record["schedule_id"],
                "schedule_hash": record["schedule_hash"],
            }
            operations: list[tuple[Any, ...]] = [
                (
                    "update",
                    counter_update,
                    {
                        "mode": UpdateMode.REPLACE,
                        "etag": counter_etag,
                        "match_condition": MatchConditions.IfNotModified,
                    },
                ),
                ("create", _schedule_entity(_schedule_row(record["schedule_id"]), record)),
                ("create", _schedule_entity(_schedule_index_row(index), record)),
            ]
            if pointer is None:
                operations.append(("create", current_pointer))
            else:
                pointer_etag = getattr(pointer, "metadata", {}).get("etag")
                if not pointer_etag:
                    raise RegistryUnavailable(
                        "The valuation schedule pointer did not provide an ETag.",
                    )
                operations.append((
                    "update",
                    current_pointer,
                    {
                        "mode": UpdateMode.REPLACE,
                        "etag": pointer_etag,
                        "match_condition": MatchConditions.IfNotModified,
                    },
                ))
            try:
                self.table.submit_transaction(operations)
                return record
            except HttpResponseError as error:
                if getattr(error, "status_code", None) not in {409, 412}:
                    raise RegistryUnavailable(
                        "The valuation schedule transaction failed.",
                    ) from error
        raise RegistryUnavailable("The valuation registry remained busy after bounded retries.")

    def get_credit(self, credit_id: str) -> dict[str, Any]:
        entity = self._get_optional(_credit_row(credit_id))
        if entity is None:
            raise CreditNotFound("Credit not found.")
        return _entity_record(entity)

    def get_by_organism_hash(self, organism_lookup_hash: str) -> dict[str, Any]:
        lookup = self._get_optional(_organism_row(organism_lookup_hash))
        if lookup is None:
            raise CreditNotFound("No active credit is bound to this organism.")
        return self.get_credit(lookup["credit_id"])

    def list_credits(self, after: int, limit: int) -> list[dict[str, Any]]:
        start = _issuance_row(after + 1)
        entities = self.table.query_entities(
            query_filter=(
                "PartitionKey eq @partition and RowKey ge @start and RowKey lt @end"
            ),
            parameters={
                "partition": PARTITION,
                "start": start,
                "end": "issuance;",
            },
            results_per_page=limit,
        )
        records = []
        for entity in entities:
            records.append(_entity_record(entity))
            if len(records) >= limit:
                break
        return records

    def get_schedule(self, schedule_id: str) -> dict[str, Any]:
        entity = self._get_optional(_schedule_row(schedule_id))
        if entity is None:
            raise ValuationScheduleNotFound("Valuation schedule not found.")
        return _entity_record(entity)

    def get_current_schedule(self, set_lookup_hash: str) -> dict[str, Any]:
        pointer = self._get_optional(_schedule_pointer_row(set_lookup_hash))
        if pointer is None:
            raise ValuationScheduleNotFound(
                "No official valuation schedule exists for this set.",
            )
        return self.get_schedule(pointer["schedule_id"])

    def list_schedules(self, after: int, limit: int) -> list[dict[str, Any]]:
        start = _schedule_index_row(after + 1)
        entities = self.table.query_entities(
            query_filter=(
                "PartitionKey eq @partition and RowKey ge @start and RowKey lt @end"
            ),
            parameters={
                "partition": PARTITION,
                "start": start,
                "end": "schedule-index;",
            },
            results_per_page=limit,
        )
        records = []
        for entity in entities:
            records.append(_entity_record(entity))
            if len(records) >= limit:
                break
        return records

    def get_ownership(self, credit_id: str) -> dict[str, Any]:
        entity = self._get_optional(_ownership_row(credit_id))
        if entity is None:
            raise CreditNotFound("Official ownership head not found.")
        return entity

    def _events_for_operation(self, operation_hash: str) -> list[dict[str, Any]] | None:
        operation = self._get_optional(_operation_row(operation_hash))
        if operation is None:
            return None
        return [
            _entity_record(self.table.get_entity(PARTITION, _event_row(event_id)))
            for event_id in json.loads(operation["event_ids_json"])
        ]

    def get_operation_events(self, operation_hash: str) -> list[dict[str, Any]] | None:
        return self._events_for_operation(operation_hash)

    def get_event(self, event_id: str) -> dict[str, Any]:
        entity = self._get_optional(_event_row(event_id))
        if entity is None:
            raise CreditNotFound("Lifecycle event not found.")
        return _entity_record(entity)

    def append_lifecycle(
        self,
        *,
        credit_id: str,
        operation_hash: str,
        build_events: Callable[
            [dict[str, Any]],
            tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
        ],
    ) -> tuple[list[dict[str, Any]], bool]:
        existing = self._events_for_operation(operation_hash)
        if existing is not None:
            return existing, False
        for _ in range(6):
            head = self.get_ownership(credit_id)
            head_etag = getattr(head, "metadata", {}).get("etag")
            if not head_etag:
                raise RegistryUnavailable("The ownership head did not provide an ETag.")
            events, head_update, unique_rows = build_events(dict(head))
            expected_seq = int(head["event_seq"]) + 1
            if not events or any(
                event.get("event_seq") != expected_seq + index
                for index, event in enumerate(events)
            ):
                raise RegistryUnavailable("Lifecycle event sequence is invalid.")
            update_entity = {
                "PartitionKey": PARTITION,
                "RowKey": _ownership_row(credit_id),
                **head_update,
            }
            operations: list[tuple[Any, ...]] = [
                (
                    "update",
                    update_entity,
                    {
                        "mode": UpdateMode.REPLACE,
                        "etag": head_etag,
                        "match_condition": MatchConditions.IfNotModified,
                    },
                ),
            ]
            for event in events:
                operations.extend([
                    ("create", {
                        "PartitionKey": PARTITION,
                        "RowKey": _event_row(event["event_id"]),
                        "credit_id": credit_id,
                        "record_json": json.dumps(
                            event,
                            separators=(",", ":"),
                            sort_keys=True,
                        ),
                    }),
                    ("create", {
                        "PartitionKey": PARTITION,
                        "RowKey": _lifecycle_row(credit_id, event["event_seq"]),
                        "credit_id": credit_id,
                        "event_id": event["event_id"],
                        "record_json": json.dumps(
                            event,
                            separators=(",", ":"),
                            sort_keys=True,
                        ),
                    }),
                ])
            operations.append(("create", {
                "PartitionKey": PARTITION,
                "RowKey": _operation_row(operation_hash),
                "credit_id": credit_id,
                "event_ids_json": json.dumps([event["event_id"] for event in events]),
            }))
            operations.extend(("create", row) for row in unique_rows)
            try:
                self.table.submit_transaction(operations)
                return events, True
            except HttpResponseError as error:
                existing = self._events_for_operation(operation_hash)
                if existing is not None:
                    return existing, False
                if getattr(error, "status_code", None) == 409:
                    raise CreditConflict("Lifecycle reference is already in use.") from error
                if getattr(error, "status_code", None) != 412:
                    raise RegistryUnavailable("Lifecycle transaction failed.") from error
        raise RegistryUnavailable("Lifecycle registry remained busy after bounded retries.")

    def list_lifecycle(self, credit_id: str, after: int, limit: int) -> list[dict[str, Any]]:
        prefix = f"lifecycle:{credit_id}:"
        start = _lifecycle_row(credit_id, after + 1)
        entities = self.table.query_entities(
            query_filter=(
                "PartitionKey eq @partition and RowKey ge @start and RowKey lt @end"
            ),
            parameters={
                "partition": PARTITION,
                "start": start,
                "end": f"{prefix};",
            },
            results_per_page=limit,
        )
        records = []
        for entity in entities:
            records.append(_entity_record(entity))
            if len(records) >= limit:
                break
        return records


class InMemoryCreditRepository:
    def __init__(self):
        self.lock = threading.Lock()
        self.issued_count = 0
        self.cap = None
        self.credits: dict[str, dict[str, Any]] = {}
        self.payments: dict[str, str] = {}
        self.organisms: dict[str, str] = {}
        self.issuance: list[dict[str, Any]] = []
        self.ownership: dict[str, dict[str, Any]] = {}
        self.schedules: dict[str, dict[str, Any]] = {}
        self.schedule_current: dict[str, str] = {}
        self.schedule_issuance: list[dict[str, Any]] = []
        self.lifecycle_events: dict[str, list[dict[str, Any]]] = {}
        self.operations: dict[str, list[str]] = {}
        self.unique_lifecycle_rows: set[str] = set()

    def issue(
        self,
        *,
        credit_id: str,
        payment_reference_hash: str,
        organism_lookup_hash: str,
        issuance_cap: int,
        set_lookup_hash: str,
        schedule_id: str,
        build_record: Callable[[int, int], dict[str, Any]],
    ) -> tuple[dict[str, Any], bool]:
        with self.lock:
            if self.cap is None:
                self.cap = issuance_cap
            existing_credit_id = self.payments.get(payment_reference_hash)
            if existing_credit_id:
                existing = self.credits[existing_credit_id]
                candidate = build_record(1, self.cap)
                if not _same_binding(existing, candidate):
                    raise CreditConflict("The verified payment is already bound to another credit.")
                return existing, False
            if organism_lookup_hash in self.organisms:
                raise CreditConflict("The organism already has an active official credit.")
            if self.schedule_current.get(set_lookup_hash) != schedule_id:
                raise ValuationScheduleChanged(
                    "The active valuation schedule changed before issuance.",
                )
            if self.issued_count >= self.cap:
                raise IssuanceCapReached("The official credit issuance cap has been reached.")
            index = self.issued_count + 1
            record = build_record(index, self.cap)
            self.credits[credit_id] = record
            self.payments[payment_reference_hash] = credit_id
            self.organisms[organism_lookup_hash] = credit_id
            self.issuance.append(record)
            self.ownership[credit_id] = {
                "credit_id": credit_id,
                "current_owner_hash": record["owner_reference_hash"],
                "current_event_id": f"issuance:{credit_id}",
                "event_seq": 0,
                "state": "owned",
                "active_listing_id": "",
                "purchase_utc": record["purchase_utc"],
            }
            self.issued_count = index
            return record, True

    def get_by_payment_hash(self, payment_reference_hash: str) -> dict[str, Any] | None:
        credit_id = self.payments.get(payment_reference_hash)
        return self.credits.get(credit_id) if credit_id else None

    def publish_schedule(
        self,
        *,
        set_lookup_hash: str,
        build_record: Callable[[int, str | None], dict[str, Any]],
    ) -> dict[str, Any]:
        with self.lock:
            previous_id = self.schedule_current.get(set_lookup_hash)
            previous_hash = (
                self.schedules[previous_id]["schedule_hash"]
                if previous_id
                else None
            )
            record = build_record(len(self.schedule_issuance) + 1, previous_hash)
            if record["schedule_id"] in self.schedules:
                raise CreditConflict("Valuation schedule already exists.")
            self.schedules[record["schedule_id"]] = record
            self.schedule_current[set_lookup_hash] = record["schedule_id"]
            self.schedule_issuance.append(record)
            return record

    def get_credit(self, credit_id: str) -> dict[str, Any]:
        try:
            return self.credits[credit_id]
        except KeyError as error:
            raise CreditNotFound("Credit not found.") from error

    def get_by_organism_hash(self, organism_lookup_hash: str) -> dict[str, Any]:
        try:
            return self.get_credit(self.organisms[organism_lookup_hash])
        except KeyError as error:
            raise CreditNotFound("No active credit is bound to this organism.") from error

    def list_credits(self, after: int, limit: int) -> list[dict[str, Any]]:
        return self.issuance[after:after + limit]

    def get_schedule(self, schedule_id: str) -> dict[str, Any]:
        try:
            return self.schedules[schedule_id]
        except KeyError as error:
            raise ValuationScheduleNotFound("Valuation schedule not found.") from error

    def get_current_schedule(self, set_lookup_hash: str) -> dict[str, Any]:
        try:
            return self.get_schedule(self.schedule_current[set_lookup_hash])
        except KeyError as error:
            raise ValuationScheduleNotFound(
                "No official valuation schedule exists for this set.",
            ) from error

    def list_schedules(self, after: int, limit: int) -> list[dict[str, Any]]:
        return self.schedule_issuance[after:after + limit]

    def get_ownership(self, credit_id: str) -> dict[str, Any]:
        try:
            return dict(self.ownership[credit_id])
        except KeyError as error:
            raise CreditNotFound("Official ownership head not found.") from error

    def append_lifecycle(
        self,
        *,
        credit_id: str,
        operation_hash: str,
        build_events: Callable[
            [dict[str, Any]],
            tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]],
        ],
    ) -> tuple[list[dict[str, Any]], bool]:
        with self.lock:
            if operation_hash in self.operations:
                ids = self.operations[operation_hash]
                events = self.lifecycle_events.get(credit_id, [])
                return [event for event in events if event["event_id"] in ids], False
            head = self.get_ownership(credit_id)
            events, head_update, unique_rows = build_events(head)
            row_keys = [row["RowKey"] for row in unique_rows]
            if any(row_key in self.unique_lifecycle_rows for row_key in row_keys):
                raise CreditConflict("Lifecycle reference is already in use.")
            self.ownership[credit_id] = dict(head_update)
            self.lifecycle_events.setdefault(credit_id, []).extend(events)
            self.operations[operation_hash] = [event["event_id"] for event in events]
            self.unique_lifecycle_rows.update(row_keys)
            return events, True

    def get_operation_events(self, operation_hash: str) -> list[dict[str, Any]] | None:
        ids = self.operations.get(operation_hash)
        if ids is None:
            return None
        by_id = {
            event["event_id"]: event
            for events in self.lifecycle_events.values()
            for event in events
        }
        return [by_id[event_id] for event_id in ids]

    def get_event(self, event_id: str) -> dict[str, Any]:
        for events in self.lifecycle_events.values():
            for event in events:
                if event["event_id"] == event_id:
                    return event
        raise CreditNotFound("Lifecycle event not found.")

    def list_lifecycle(self, credit_id: str, after: int, limit: int) -> list[dict[str, Any]]:
        return self.lifecycle_events.get(credit_id, [])[after:after + limit]
