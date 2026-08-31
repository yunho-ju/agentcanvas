"""SQLite durable job queue — acceptance, claim, lease와 결과 fencing."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from agentcanvas_contracts.eval_result import EvalBatch
from agentcanvas_contracts.run import Run
from agentcanvas_contracts.run_events import EventType, RunEvent

from .job_store import (
    ConcurrentRunUpdate,
    DurableJob,
    IdempotencyConflict,
    JobAcceptance,
    JobCancelled,
    JobEventConflict,
    JobKind,
    JobOperation,
    JobStatus,
    LeaseLost,
    TerminalJobStatus,
)
from .sqlite_database import BUSY_WAIT_SECONDS, PreparedDatabase


class SqliteJobStore:
    def __init__(self, path: Path | str, *, database_is_prepared: bool = False) -> None:
        self._database = PreparedDatabase(path, already_prepared=database_is_prepared)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self._database.ensure()
        connection = sqlite3.connect(self._database.path, timeout=BUSY_WAIT_SECONDS)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @contextmanager
    def _write(self) -> Iterator[sqlite3.Connection]:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            yield connection

    @staticmethod
    def _json(value: object) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def _event_json(event: RunEvent) -> str:
        return SqliteJobStore._json(event.model_dump(mode="json"))

    def _job(self, row: sqlite3.Row) -> DurableJob:
        payload = json.loads(row["payload_json"])
        if not isinstance(payload, dict):
            raise TypeError("durable job payload must be an object")
        return DurableJob(
            id=row["id"],
            kind=row["kind"],
            operation=row["operation"],
            status=row["status"],
            attempt=row["attempt"],
            max_attempts=row["max_attempts"],
            idempotency_key=row["idempotency_key"],
            request_fingerprint=row["request_fingerprint"],
            reference_id=row["reference_id"],
            payload=payload,
            lease_owner=row["lease_owner"],
            lease_expires_at=(
                datetime.fromisoformat(row["lease_expires_at"])
                if row["lease_expires_at"] is not None
                else None
            ),
            cancel_requested_at=(
                datetime.fromisoformat(row["cancel_requested_at"])
                if row["cancel_requested_at"] is not None
                else None
            ),
            terminal_reason=row["terminal_reason"],
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
            terminal_at=(
                datetime.fromisoformat(row["terminal_at"])
                if row["terminal_at"] is not None
                else None
            ),
        )

    def _by_key(
        self,
        connection: sqlite3.Connection,
        idempotency_key: str,
        request_fingerprint: str,
        kind: JobKind,
        operation: JobOperation,
    ) -> DurableJob | None:
        row = connection.execute(
            "SELECT * FROM durable_jobs WHERE idempotency_key = ?",
            (idempotency_key,),
        ).fetchone()
        if row is None:
            return None
        job = self._job(row)
        if (
            job.request_fingerprint != request_fingerprint
            or job.kind != kind
            or job.operation != operation
        ):
            raise IdempotencyConflict("idempotency key belongs to another request")
        return job

    def _insert_job(
        self,
        connection: sqlite3.Connection,
        *,
        kind: JobKind,
        operation: JobOperation,
        reference_id: str,
        idempotency_key: str,
        request_fingerprint: str,
        payload: dict[str, object],
        now: datetime,
        max_attempts: int,
    ) -> DurableJob:
        if not 1 <= max_attempts <= 100:
            raise ValueError("max_attempts must be between 1 and 100")
        job_id = uuid4().hex
        written_at = now.isoformat()
        connection.execute(
            "INSERT INTO durable_jobs ("
            " id, kind, operation, status, attempt, max_attempts,"
            " idempotency_key, request_fingerprint, reference_id, payload_json,"
            " lease_owner, lease_expires_at, cancel_requested_at, terminal_reason,"
            " created_at, updated_at, terminal_at"
            ") VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, NULL, NULL, NULL,"
            " NULL, ?, ?, NULL)",
            (
                job_id,
                kind,
                operation,
                max_attempts,
                idempotency_key,
                request_fingerprint,
                reference_id,
                self._json(payload),
                written_at,
                written_at,
            ),
        )
        row = connection.execute(
            "SELECT * FROM durable_jobs WHERE id = ?", (job_id,)
        ).fetchone()
        assert row is not None
        return self._job(row)

    def accept_run(
        self,
        run: Run,
        *,
        idempotency_key: str,
        request_fingerprint: str,
        payload: dict[str, object],
        now: datetime,
        max_attempts: int = 3,
    ) -> JobAcceptance:
        with self._write() as connection:
            existing = self._by_key(
                connection, idempotency_key, request_fingerprint, "run", "start"
            )
            if existing is not None:
                return JobAcceptance(existing, replayed=True)
            connection.execute(
                "INSERT INTO runs"
                " (run_id, spec_id, spec_revision, created_at, thread_id, end_user_ref)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    run.id,
                    run.spec_id,
                    run.spec_revision,
                    run.created_at.isoformat(),
                    run.thread_id,
                    run.end_user_ref,
                ),
            )
            job = self._insert_job(
                connection,
                kind="run",
                operation="start",
                reference_id=run.id,
                idempotency_key=idempotency_key,
                request_fingerprint=request_fingerprint,
                payload=payload,
                now=now,
                max_attempts=max_attempts,
            )
        return JobAcceptance(job, replayed=False)

    def accept_resume(
        self,
        run_id: str,
        expected_last_seq: int,
        opening: list[RunEvent],
        *,
        idempotency_key: str,
        request_fingerprint: str,
        payload: dict[str, object],
        now: datetime,
        max_attempts: int = 3,
    ) -> JobAcceptance:
        with self._write() as connection:
            existing = self._by_key(
                connection, idempotency_key, request_fingerprint, "run", "resume"
            )
            if existing is not None:
                return JobAcceptance(existing, replayed=True)
            row = connection.execute(
                "SELECT MAX(seq) AS last_seq FROM run_events WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            actual = -1 if row is None or row["last_seq"] is None else row["last_seq"]
            if actual != expected_last_seq:
                raise ConcurrentRunUpdate(
                    "run events changed before approval was accepted"
                )
            self._insert_events(connection, run_id, opening)
            job = self._insert_job(
                connection,
                kind="run",
                operation="resume",
                reference_id=run_id,
                idempotency_key=idempotency_key,
                request_fingerprint=request_fingerprint,
                payload=payload,
                now=now,
                max_attempts=max_attempts,
            )
        return JobAcceptance(job, replayed=False)

    def accept_eval(
        self,
        batch_id: str,
        *,
        idempotency_key: str,
        request_fingerprint: str,
        payload: dict[str, object],
        now: datetime,
        max_attempts: int = 3,
    ) -> JobAcceptance:
        with self._write() as connection:
            existing = self._by_key(
                connection, idempotency_key, request_fingerprint, "eval", "batch"
            )
            if existing is not None:
                return JobAcceptance(existing, replayed=True)
            job = self._insert_job(
                connection,
                kind="eval",
                operation="batch",
                reference_id=batch_id,
                idempotency_key=idempotency_key,
                request_fingerprint=request_fingerprint,
                payload=payload,
                now=now,
                max_attempts=max_attempts,
            )
        return JobAcceptance(job, replayed=False)

    def find_by_idempotency(
        self,
        idempotency_key: str,
        request_fingerprint: str,
        kind: JobKind,
        operation: JobOperation,
    ) -> DurableJob | None:
        with self._connect() as connection:
            return self._by_key(
                connection,
                idempotency_key,
                request_fingerprint,
                kind,
                operation,
            )

    def claim(
        self, owner: str, now: datetime, lease_expires_at: datetime
    ) -> DurableJob | None:
        with self._write() as connection:
            row = connection.execute(
                "SELECT * FROM durable_jobs"
                " WHERE status = 'queued'"
                " OR (status = 'leased' AND lease_expires_at <= ?)"
                " ORDER BY enqueue_seq LIMIT 1",
                (now.isoformat(),),
            ).fetchone()
            if row is None:
                return None
            job = self._job(row)
            attempt = job.attempt + 1
            connection.execute(
                "UPDATE durable_jobs SET status = 'leased', attempt = ?,"
                " lease_owner = ?, lease_expires_at = ?, updated_at = ?"
                " WHERE id = ?",
                (
                    attempt,
                    owner,
                    lease_expires_at.isoformat(),
                    now.isoformat(),
                    job.id,
                ),
            )
            claimed = connection.execute(
                "SELECT * FROM durable_jobs WHERE id = ?", (job.id,)
            ).fetchone()
            assert claimed is not None
            return self._job(claimed)

    def renew(
        self, job_id: str, owner: str, now: datetime, lease_expires_at: datetime
    ) -> bool:
        with self._connect() as connection:
            changed = connection.execute(
                "UPDATE durable_jobs SET lease_expires_at = ?, updated_at = ?"
                " WHERE id = ? AND status = 'leased' AND lease_owner = ?"
                " AND lease_expires_at > ?",
                (
                    lease_expires_at.isoformat(),
                    now.isoformat(),
                    job_id,
                    owner,
                    now.isoformat(),
                ),
            ).rowcount
        return changed == 1

    def relinquish(self, job_id: str, owner: str, now: datetime) -> bool:
        with self._connect() as connection:
            changed = connection.execute(
                "UPDATE durable_jobs SET status = 'queued', lease_owner = NULL,"
                " lease_expires_at = NULL, updated_at = ?"
                " WHERE id = ? AND status = 'leased' AND lease_owner = ?",
                (now.isoformat(), job_id, owner),
            ).rowcount
        return changed == 1

    def _leased(
        self,
        connection: sqlite3.Connection,
        job_id: str,
        owner: str,
        now: datetime,
    ) -> DurableJob:
        row = connection.execute(
            "SELECT * FROM durable_jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if row is None:
            raise LeaseLost("job no longer exists")
        job = self._job(row)
        if job.status != "leased" or job.lease_owner != owner:
            raise LeaseLost("job lease belongs to another worker")
        if job.lease_expires_at is None or job.lease_expires_at <= now:
            raise LeaseLost("job lease has expired")
        return job

    def _insert_events(
        self,
        connection: sqlite3.Connection,
        run_id: str,
        events: Sequence[RunEvent],
    ) -> None:
        for event in events:
            encoded = self._event_json(event)
            row = connection.execute(
                "SELECT event_json FROM run_events WHERE run_id = ? AND seq = ?",
                (run_id, event.seq),
            ).fetchone()
            if row is None:
                connection.execute(
                    "INSERT INTO run_events (run_id, seq, event_json) VALUES (?, ?, ?)",
                    (run_id, event.seq, encoded),
                )
            elif json.loads(row["event_json"]) != json.loads(encoded):
                raise JobEventConflict("run event replay diverged from stored history")

    def append_run_events(
        self,
        job_id: str,
        owner: str,
        events: list[RunEvent],
        *,
        now: datetime,
        terminal_status: TerminalJobStatus | None = None,
        terminal_reason: str | None = None,
    ) -> None:
        with self._write() as connection:
            job = self._leased(connection, job_id, owner, now)
            if job.cancel_requested_at is not None:
                raise JobCancelled("cancellation won before run events were committed")
            self._insert_events(connection, job.reference_id, events)
            if terminal_status is not None:
                connection.execute(
                    "UPDATE durable_jobs SET status = ?, lease_owner = NULL,"
                    " lease_expires_at = NULL, terminal_reason = ?, updated_at = ?,"
                    " terminal_at = ? WHERE id = ? AND lease_owner = ?",
                    (
                        terminal_status,
                        terminal_reason,
                        now.isoformat(),
                        now.isoformat(),
                        job_id,
                        owner,
                    ),
                )

    def save_eval_result(
        self, job_id: str, owner: str, batch: EvalBatch, now: datetime
    ) -> None:
        encoded = self._json(batch.model_dump(mode="json"))
        with self._write() as connection:
            job = self._leased(connection, job_id, owner, now)
            if job.cancel_requested_at is not None:
                raise JobCancelled("cancellation won before eval result was committed")
            row = connection.execute(
                "SELECT batch_json FROM eval_batches WHERE batch_id = ?",
                (batch.id,),
            ).fetchone()
            if row is None:
                connection.execute(
                    "INSERT INTO eval_batches (batch_id, dataset_id, batch_json)"
                    " VALUES (?, ?, ?)",
                    (batch.id, batch.dataset_id, encoded),
                )
            elif json.loads(row["batch_json"]) != json.loads(encoded):
                raise JobEventConflict("eval replay diverged from stored result")
            connection.execute(
                "UPDATE durable_jobs SET status = 'succeeded', lease_owner = NULL,"
                " lease_expires_at = NULL, updated_at = ?, terminal_at = ?"
                " WHERE id = ? AND lease_owner = ?",
                (now.isoformat(), now.isoformat(), job.id, owner),
            )

    def retry_or_fail(
        self, job_id: str, owner: str, now: datetime, reason: str
    ) -> JobStatus:
        with self._write() as connection:
            job = self._leased(connection, job_id, owner, now)
            if job.cancel_requested_at is not None:
                raise JobCancelled("cancellation won before retry was committed")
            terminal = job.attempt >= job.max_attempts
            status: JobStatus = "failed" if terminal else "queued"
            connection.execute(
                "UPDATE durable_jobs SET status = ?, lease_owner = NULL,"
                " lease_expires_at = NULL, terminal_reason = ?, updated_at = ?,"
                " terminal_at = ? WHERE id = ? AND lease_owner = ?",
                (
                    status,
                    reason if terminal else None,
                    now.isoformat(),
                    now.isoformat() if terminal else None,
                    job.id,
                    owner,
                ),
            )
            return status

    def finish_failed(
        self,
        job_id: str,
        owner: str,
        now: datetime,
        reason: str,
        run_event: RunEvent | None = None,
    ) -> None:
        with self._write() as connection:
            job = self._leased(connection, job_id, owner, now)
            if job.cancel_requested_at is not None:
                raise JobCancelled("cancellation won before failure was committed")
            if run_event is not None:
                last = connection.execute(
                    "SELECT MAX(seq) FROM run_events WHERE run_id = ?",
                    (job.reference_id,),
                ).fetchone()
                seq = 0 if last is None or last[0] is None else int(last[0]) + 1
                self._insert_events(
                    connection,
                    job.reference_id,
                    [run_event.model_copy(update={"seq": seq})],
                )
            connection.execute(
                "UPDATE durable_jobs SET status = 'failed', lease_owner = NULL,"
                " lease_expires_at = NULL, terminal_reason = ?, updated_at = ?,"
                " terminal_at = ? WHERE id = ? AND lease_owner = ?",
                (reason, now.isoformat(), now.isoformat(), job.id, owner),
            )

    def request_cancel(
        self,
        kind: JobKind,
        reference_id: str,
        now: datetime,
        queued_run_event: RunEvent | None = None,
    ) -> DurableJob | None:
        with self._write() as connection:
            row = connection.execute(
                "SELECT * FROM durable_jobs WHERE kind = ? AND reference_id = ?"
                " ORDER BY enqueue_seq DESC LIMIT 1",
                (kind, reference_id),
            ).fetchone()
            if row is None:
                return None
            job = self._job(row)
            if job.status in {"failed", "cancelled"}:
                return job
            paused_run = False
            if (
                job.status == "succeeded"
                and kind == "run"
                and queued_run_event is not None
            ):
                last_event = connection.execute(
                    "SELECT event_json FROM run_events WHERE run_id = ?"
                    " ORDER BY seq DESC LIMIT 1",
                    (reference_id,),
                ).fetchone()
                paused_run = (
                    last_event is not None
                    and RunEvent.model_validate_json(
                        last_event["event_json"]
                    ).event_type
                    is EventType.RUN_PAUSED
                )
            if job.status == "succeeded" and not paused_run:
                return job
            if job.status == "queued" or paused_run:
                if queued_run_event is not None:
                    last = connection.execute(
                        "SELECT MAX(seq) FROM run_events WHERE run_id = ?",
                        (reference_id,),
                    ).fetchone()
                    seq = 0 if last is None or last[0] is None else int(last[0]) + 1
                    event = queued_run_event.model_copy(update={"seq": seq})
                    self._insert_events(connection, reference_id, [event])
                connection.execute(
                    "UPDATE durable_jobs SET status = 'cancelled',"
                    " lease_owner = NULL, lease_expires_at = NULL,"
                    " cancel_requested_at = ?, terminal_reason = 'cancelled',"
                    " updated_at = ?, terminal_at = ? WHERE id = ?",
                    (now.isoformat(), now.isoformat(), now.isoformat(), job.id),
                )
            else:
                connection.execute(
                    "UPDATE durable_jobs SET cancel_requested_at = ?, updated_at = ?"
                    " WHERE id = ?",
                    (now.isoformat(), now.isoformat(), job.id),
                )
            updated = connection.execute(
                "SELECT * FROM durable_jobs WHERE id = ?", (job.id,)
            ).fetchone()
            assert updated is not None
            return self._job(updated)

    def mark_cancelled(
        self,
        job_id: str,
        owner: str,
        now: datetime,
        run_event: RunEvent | None = None,
    ) -> None:
        with self._write() as connection:
            job = self._leased(connection, job_id, owner, now)
            if run_event is not None:
                last = connection.execute(
                    "SELECT MAX(seq) FROM run_events WHERE run_id = ?",
                    (job.reference_id,),
                ).fetchone()
                seq = 0 if last is None or last[0] is None else int(last[0]) + 1
                self._insert_events(
                    connection,
                    job.reference_id,
                    [run_event.model_copy(update={"seq": seq})],
                )
            connection.execute(
                "UPDATE durable_jobs SET status = 'cancelled', lease_owner = NULL,"
                " lease_expires_at = NULL, terminal_reason = 'cancelled',"
                " updated_at = ?, terminal_at = ? WHERE id = ? AND lease_owner = ?",
                (now.isoformat(), now.isoformat(), job.id, owner),
            )

    def get(self, job_id: str) -> DurableJob | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM durable_jobs WHERE id = ?", (job_id,)
            ).fetchone()
        return None if row is None else self._job(row)

    def forget_runs(self, run_ids: Sequence[str]) -> None:
        """지워진 실행이 남긴 일감을 함께 거둔다 — 없는 실행을 집으려 드는 일꾼이 없게."""
        with self._write() as connection:
            connection.executemany(
                "DELETE FROM durable_jobs WHERE kind = 'run' AND reference_id = ?",
                [(run_id,) for run_id in run_ids],
            )

    def latest_for_reference(
        self, kind: JobKind, reference_id: str
    ) -> DurableJob | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM durable_jobs WHERE kind = ? AND reference_id = ?"
                " ORDER BY enqueue_seq DESC LIMIT 1",
                (kind, reference_id),
            ).fetchone()
        return None if row is None else self._job(row)


__all__ = ["SqliteJobStore"]
