"""재시작 뒤에도 남는 작업과 lease의 저장 계약."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from agentcanvas_contracts.eval_result import EvalBatch
from agentcanvas_contracts.run import Run
from agentcanvas_contracts.run_events import RunEvent

JobKind = Literal["run", "eval"]
JobOperation = Literal["start", "resume", "batch"]
JobStatus = Literal["queued", "leased", "succeeded", "failed", "cancelled"]
TerminalJobStatus = Literal["succeeded", "failed", "cancelled"]


def request_fingerprint(payload: object) -> str:
    """같은 요청인지 가리는 지문 — 같은 뜻이면 같은 값이 나온다."""
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode()
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


class IdempotencyConflict(Exception):
    """같은 key를 다른 요청에 다시 썼다."""


class ConcurrentRunUpdate(Exception):
    """approval을 받을 때 run event가 다른 writer에 의해 이미 움직였다."""


class LeaseLost(Exception):
    """이 worker가 더는 job 결과를 쓸 수 없다."""


class JobEventConflict(Exception):
    """재청구한 run이 이미 저장된 event와 다른 history를 만들었다."""


class JobCancelled(Exception):
    """worker가 cooperative 경계에서 cancellation 요청을 확인했다."""


class UnrecoverableJob(Exception):
    """재시도로 안전하게 이어갈 수 없어 terminal failure로 닫아야 한다."""


@dataclass(frozen=True)
class DurableJob:
    id: str
    kind: JobKind
    operation: JobOperation
    status: JobStatus
    attempt: int
    max_attempts: int
    idempotency_key: str
    request_fingerprint: str
    reference_id: str
    payload: dict[str, object]
    lease_owner: str | None
    lease_expires_at: datetime | None
    cancel_requested_at: datetime | None
    terminal_reason: str | None
    created_at: datetime
    updated_at: datetime
    terminal_at: datetime | None


@dataclass(frozen=True)
class JobAcceptance:
    job: DurableJob
    replayed: bool


class DurableJobStore(Protocol):
    def accept_run(
        self,
        run: Run,
        *,
        idempotency_key: str,
        request_fingerprint: str,
        payload: dict[str, object],
        now: datetime,
        max_attempts: int = 3,
    ) -> JobAcceptance: ...

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
    ) -> JobAcceptance: ...

    def accept_eval(
        self,
        batch_id: str,
        *,
        idempotency_key: str,
        request_fingerprint: str,
        payload: dict[str, object],
        now: datetime,
        max_attempts: int = 3,
    ) -> JobAcceptance: ...

    def find_by_idempotency(
        self,
        idempotency_key: str,
        request_fingerprint: str,
        kind: JobKind,
        operation: JobOperation,
    ) -> DurableJob | None: ...

    def claim(
        self, owner: str, now: datetime, lease_expires_at: datetime
    ) -> DurableJob | None: ...

    def renew(
        self, job_id: str, owner: str, now: datetime, lease_expires_at: datetime
    ) -> bool: ...

    def relinquish(self, job_id: str, owner: str, now: datetime) -> bool: ...

    def append_run_events(
        self,
        job_id: str,
        owner: str,
        events: list[RunEvent],
        *,
        now: datetime,
        terminal_status: TerminalJobStatus | None = None,
        terminal_reason: str | None = None,
    ) -> None: ...

    def save_eval_result(
        self, job_id: str, owner: str, batch: EvalBatch, now: datetime
    ) -> None: ...

    def retry_or_fail(
        self, job_id: str, owner: str, now: datetime, reason: str
    ) -> JobStatus: ...

    def finish_failed(
        self,
        job_id: str,
        owner: str,
        now: datetime,
        reason: str,
        run_event: RunEvent | None = None,
    ) -> None: ...

    def request_cancel(
        self,
        kind: JobKind,
        reference_id: str,
        now: datetime,
        queued_run_event: RunEvent | None = None,
    ) -> DurableJob | None: ...

    def mark_cancelled(
        self,
        job_id: str,
        owner: str,
        now: datetime,
        run_event: RunEvent | None = None,
    ) -> None: ...

    def get(self, job_id: str) -> DurableJob | None: ...

    def forget_runs(self, run_ids: Sequence[str]) -> None:
        """지워진 실행들이 남긴 일감을 함께 거둔다 — 실행과 일감이 어긋나 남지 않는다."""
        ...

    def latest_for_reference(
        self, kind: JobKind, reference_id: str
    ) -> DurableJob | None: ...


__all__ = [
    "ConcurrentRunUpdate",
    "DurableJob",
    "DurableJobStore",
    "IdempotencyConflict",
    "JobAcceptance",
    "JobCancelled",
    "JobEventConflict",
    "JobKind",
    "JobOperation",
    "JobStatus",
    "LeaseLost",
    "TerminalJobStatus",
    "UnrecoverableJob",
]
