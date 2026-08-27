"""SQLite durable job을 claim하고 lease를 갱신하며 run/eval handler로 옮긴다."""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from .eval_service import EvalBatchService
from .job_store import (
    DurableJob,
    DurableJobStore,
    JobCancelled,
    LeaseLost,
    UnrecoverableJob,
)
from .run_service import RunService

logger = logging.getLogger(__name__)
_MAX_STORE_BACKOFF_SECONDS = 5.0


class DurableJobWorker:
    def __init__(
        self,
        jobs: DurableJobStore,
        runs: RunService,
        evals: EvalBatchService,
        *,
        lease_seconds: float = 30.0,
        poll_seconds: float = 0.25,
        now=lambda: datetime.now(UTC),
    ) -> None:
        if lease_seconds <= 0 or poll_seconds <= 0:
            raise ValueError("worker timings must be positive")
        self._jobs = jobs
        self._runs = runs
        self._evals = evals
        self._lease_seconds = lease_seconds
        self._poll_seconds = poll_seconds
        self._now = now
        self._owner = f"worker-{uuid4().hex}"
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self._started = threading.Event()
        self._healthy = threading.Event()
        self._initial_store_check = threading.Event()
        self._active_lock = threading.Lock()
        self._active_job_id: str | None = None
        self._active_heartbeat_stop: threading.Event | None = None

    @property
    def started(self) -> bool:
        thread = self._thread
        return self._started.is_set() and thread is not None and thread.is_alive()

    @property
    def healthy(self) -> bool:
        return self.started and self._healthy.is_set()

    def wake(self) -> None:
        self._wake.set()

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._healthy.clear()
        self._initial_store_check.clear()
        self._thread = threading.Thread(
            target=self._loop,
            name="agentcanvas-durable-worker",
            daemon=True,
        )
        self._thread.start()
        self._started.wait(timeout=5.0)
        if not self.started:
            raise RuntimeError("durable worker did not start")
        if not self._initial_store_check.wait(timeout=5.0):
            self.stop(grace_seconds=0.0)
            raise RuntimeError("durable worker store check did not finish")

    def stop(self, grace_seconds: float = 5.0) -> None:
        self._stop.set()
        self._wake.set()
        thread = self._thread
        try:
            if thread is not None:
                thread.join(timeout=grace_seconds)
                if thread.is_alive():
                    with self._active_lock:
                        active_job_id = self._active_job_id
                        heartbeat_stop = self._active_heartbeat_stop
                    if heartbeat_stop is not None:
                        heartbeat_stop.set()
                    if active_job_id is not None:
                        self._relinquish(active_job_id, "shutdown")
                else:
                    self._thread = None
        finally:
            self._healthy.clear()
            self._started.clear()

    def _relinquish(self, job_id: str, boundary: str) -> None:
        try:
            self._jobs.relinquish(job_id, self._owner, self._now())
        except Exception:
            logger.exception(
                "durable_job_relinquish_failed",
                extra={"job_id": job_id, "boundary": boundary},
            )

    def _backoff_seconds(self, failures: int) -> float:
        multiplier = 2 ** min(max(failures - 1, 0), 8)
        return min(_MAX_STORE_BACKOFF_SECONDS, self._poll_seconds * multiplier)

    def _wait_after_store_failure(self, failures: int) -> None:
        self._stop.wait(self._backoff_seconds(failures))

    def _loop(self) -> None:
        failures = 0
        self._started.set()
        try:
            while not self._stop.is_set():
                now = self._now()
                try:
                    job = self._jobs.claim(
                        self._owner,
                        now,
                        now + timedelta(seconds=self._lease_seconds),
                    )
                except Exception:
                    failures += 1
                    self._healthy.clear()
                    self._initial_store_check.set()
                    logger.exception(
                        "durable_job_claim_failed",
                        extra={
                            "failure_count": failures,
                            "backoff_seconds": self._backoff_seconds(failures),
                        },
                    )
                    self._wait_after_store_failure(failures)
                    continue

                self._initial_store_check.set()
                if self._stop.is_set():
                    if job is not None:
                        self._relinquish(job.id, "post_stop_claim")
                    break
                self._healthy.set()
                if job is None:
                    failures = 0
                    self._wake.wait(self._poll_seconds)
                    self._wake.clear()
                    continue
                try:
                    self._execute(job)
                except Exception:
                    failures += 1
                    self._healthy.clear()
                    logger.exception(
                        "durable_job_execution_boundary_failed",
                        extra={
                            "job_id": job.id,
                            "job_kind": job.kind,
                            "job_attempt": job.attempt,
                            "failure_count": failures,
                            "backoff_seconds": self._backoff_seconds(failures),
                        },
                    )
                    self._wait_after_store_failure(failures)
                else:
                    failures = 0
        finally:
            self._healthy.clear()
            self._initial_store_check.set()
            self._started.clear()

    def _execute(self, job: DurableJob) -> None:
        if job.attempt > job.max_attempts:
            self._finish_failed(job, "retry_exhausted")
            return
        if job.cancel_requested_at is not None:
            self._finish_cancelled(job)
            return

        heartbeat_stop = threading.Event()
        lease_lost = threading.Event()
        heartbeat = threading.Thread(
            target=self._heartbeat,
            args=(job.id, heartbeat_stop, lease_lost),
            name=f"agentcanvas-lease-{job.id[:8]}",
            daemon=True,
        )
        with self._active_lock:
            self._active_job_id = job.id
            self._active_heartbeat_stop = heartbeat_stop
        heartbeat.start()

        def lease_is_live() -> bool:
            return not lease_lost.is_set()

        try:
            if job.kind == "run":
                self._runs.execute_durable(
                    job,
                    self._owner,
                    lease_is_live=lease_is_live,
                )
            else:
                self._evals.execute_durable(
                    job,
                    self._owner,
                    lease_is_live=lease_is_live,
                )
        except JobCancelled:
            self._finish_cancelled(job)
        except LeaseLost:
            return
        except UnrecoverableJob:
            self._finish_failed(job, "unrecoverable_state")
        except Exception:  # noqa: BLE001 — worker boundary: retry에는 내부 예외를 저장하지 않는다.
            if lease_lost.is_set():
                return
            if job.attempt < job.max_attempts:
                try:
                    self._jobs.retry_or_fail(
                        job.id,
                        self._owner,
                        self._now(),
                        "runtime_error",
                    )
                    self.wake()
                except JobCancelled:
                    self._finish_cancelled(job)
                except LeaseLost:
                    return
            else:
                self._finish_failed(job, "retry_exhausted")
        finally:
            heartbeat_stop.set()
            heartbeat.join(timeout=max(1.0, self._lease_seconds / 3))
            with self._active_lock:
                if self._active_job_id == job.id:
                    self._active_job_id = None
                    self._active_heartbeat_stop = None

    def _heartbeat(
        self,
        job_id: str,
        stop: threading.Event,
        lease_lost: threading.Event,
    ) -> None:
        interval = max(0.05, self._lease_seconds / 3)
        while not stop.wait(interval):
            now = self._now()
            try:
                renewed = self._jobs.renew(
                    job_id,
                    self._owner,
                    now,
                    now + timedelta(seconds=self._lease_seconds),
                )
            except Exception:
                lease_lost.set()
                self._healthy.clear()
                logger.exception(
                    "durable_job_heartbeat_failed",
                    extra={"job_id": job_id},
                )
                return
            if not renewed:
                lease_lost.set()
                self._healthy.clear()
                logger.warning(
                    "durable_job_lease_lost",
                    extra={"job_id": job_id},
                )
                return

    def _finish_cancelled(self, job: DurableJob) -> None:
        try:
            if job.kind == "run":
                self._runs.cancel_durable_job(job, self._owner)
            else:
                self._evals.cancel_durable_job(job, self._owner)
        except LeaseLost:
            return

    def _finish_failed(self, job: DurableJob, reason: str) -> None:
        try:
            if job.kind == "run":
                self._runs.fail_durable_job(job, self._owner, reason)
            else:
                self._evals.fail_durable_job(job, self._owner, reason)
        except JobCancelled:
            self._finish_cancelled(job)
        except LeaseLost:
            return


__all__ = ["DurableJobWorker"]
