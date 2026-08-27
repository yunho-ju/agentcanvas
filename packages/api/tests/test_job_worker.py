from __future__ import annotations

import json
import multiprocessing
import os
import threading
import time
from datetime import UTC, datetime, timedelta
from itertools import count
from pathlib import Path

from agentcanvas_api.eval_service import EvalBatchService, EvalBatchStarted
from agentcanvas_api.job_worker import DurableJobWorker
from agentcanvas_api.run_service import RunService, RunView
from agentcanvas_api.sqlite_eval_batch_store import SqliteEvalBatchStore
from agentcanvas_api.sqlite_eval_dataset_store import SqliteEvalDatasetStore
from agentcanvas_api.sqlite_job_store import SqliteJobStore
from agentcanvas_api.sqlite_run_store import SqliteRunStore
from agentcanvas_api.sqlite_store import SqliteSpecStore
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.eval_case import EvalCase, EvalDataset
from agentcanvas_contracts.run import RunStatus
from agentcanvas_contracts.run_events import EventType, RunEvent

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)
NOW = datetime(2026, 8, 26, 12, 0, tzinfo=UTC)


def claim_then_crash(path: str) -> None:
    jobs = SqliteJobStore(path)
    now = datetime.now(UTC)
    claimed = jobs.claim(
        "crashed-process",
        now,
        now + timedelta(seconds=0.2),
    )
    os._exit(17 if claimed is not None else 2)


def spec() -> AgentSpec:
    return AgentSpec.model_validate(
        json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    )


def wait_until(predicate, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("durable worker did not converge in time")


def system(path: Path):
    specs = SqliteSpecStore(path)
    runs_store = SqliteRunStore(path)
    datasets = SqliteEvalDatasetStore(path)
    batches = SqliteEvalBatchStore(path)
    jobs = SqliteJobStore(path)
    specs.append(spec(), NOW)
    run_ids = count(1)
    batch_ids = count(1)
    runs = RunService(
        specs,
        runs_store,
        clock=lambda: NOW,
        new_run_id=lambda: f"run-{next(run_ids)}",
        jobs=jobs,
    )
    evals = EvalBatchService(
        datasets,
        specs,
        batches,
        clock=lambda: NOW,
        new_run_id=lambda: f"eval-run-{next(run_ids)}",
        new_batch_id=lambda: f"batch-{next(batch_ids)}",
        jobs=jobs,
    )
    worker = DurableJobWorker(
        jobs,
        runs,
        evals,
        lease_seconds=0.3,
        poll_seconds=0.01,
    )
    return specs, runs_store, datasets, batches, jobs, runs, evals, worker


def test_queued_run_is_claimed_and_reaches_a_persisted_segment_ending(tmp_path: Path):
    _, _, _, _, jobs, runs, _, worker = system(tmp_path / "jobs.db")
    started = runs.start(spec().id, idempotency_key="run-key")
    assert isinstance(started, RunView)

    worker.start()
    try:
        wait_until(
            lambda: (
                jobs.latest_for_reference("run", started.run.id).status == "succeeded"
            )
        )
    finally:
        worker.stop()

    assert runs.view(started.run.id).status in {RunStatus.PAUSED, RunStatus.COMPLETED}


def test_expired_unstarted_run_is_reclaimed_after_worker_restart(tmp_path: Path):
    _, _, _, _, jobs, runs, _, worker = system(tmp_path / "jobs.db")
    started = runs.start(spec().id, idempotency_key="run-key")
    assert isinstance(started, RunView)
    now = datetime.now(UTC)
    abandoned = jobs.claim("dead-worker", now, now - timedelta(seconds=1))
    assert abandoned is not None

    worker.start()
    try:
        wait_until(
            lambda: (
                jobs.latest_for_reference("run", started.run.id).status == "succeeded"
            )
        )
    finally:
        worker.stop()

    assert jobs.latest_for_reference("run", started.run.id).attempt == 2


def test_partial_run_from_a_dead_worker_is_closed_as_failed_not_replayed(
    tmp_path: Path,
):
    _, _, _, _, jobs, runs, _, worker = system(tmp_path / "jobs.db")
    started = runs.start(spec().id, idempotency_key="run-key")
    assert isinstance(started, RunView)
    now = datetime.now(UTC)
    abandoned = jobs.claim("dead-worker", now, now - timedelta(seconds=1))
    assert abandoned is not None
    jobs.append_run_events(
        abandoned.id,
        "dead-worker",
        [
            RunEvent(
                seq=0,
                run_id=started.run.id,
                event_type=EventType.RUN_STARTED,
                timestamp=NOW,
                spec_revision=started.run.spec_revision,
                payload={},
            )
        ],
        now=NOW,
    )

    worker.start()
    try:
        wait_until(lambda: runs.view(started.run.id).status == RunStatus.FAILED)
    finally:
        worker.stop()

    events = runs.events(started.run.id)
    assert [event.event_type for event in events] == [
        EventType.RUN_STARTED,
        EventType.RUN_FAILED,
    ]
    assert jobs.latest_for_reference("run", started.run.id).status == "failed"


def test_eval_identity_survives_an_expired_lease_and_completes(tmp_path: Path):
    _, _, datasets, _, jobs, _, evals, worker = system(tmp_path / "jobs.db")
    dataset = EvalDataset(
        id="greetings",
        name="Greetings",
        cases=[
            EvalCase(
                id="case-1",
                title="Greeting",
                input={},
                expected_phrases=["hello"],
            )
        ],
    )
    datasets.save(dataset)
    accepted = evals.start(
        dataset.id,
        spec().id,
        spec().revision,
        idempotency_key="eval-key",
    )
    assert isinstance(accepted, EvalBatchStarted)
    now = datetime.now(UTC)
    abandoned = jobs.claim("dead-worker", now, now - timedelta(seconds=1))
    assert abandoned is not None

    worker.start()
    try:
        wait_until(lambda: jobs.get(abandoned.id).status == "succeeded")
    finally:
        worker.stop()

    completed = evals.view(accepted.batch_id)
    assert completed is not None
    assert not hasattr(completed, "message")
    assert jobs.get(abandoned.id).attempt == 2


def test_queued_cancellation_is_visible_after_a_new_service_instance(tmp_path: Path):
    path = tmp_path / "jobs.db"
    _, _, _, _, jobs, runs, _, _ = system(path)
    started = runs.start(spec().id, idempotency_key="run-key")
    assert isinstance(started, RunView)

    cancelled = runs.cancel(started.run.id)
    restarted = RunService(
        SqliteSpecStore(path),
        SqliteRunStore(path),
        jobs=SqliteJobStore(path),
    )

    assert cancelled is not None
    assert restarted.view(started.run.id).status == RunStatus.FAILED
    assert jobs.latest_for_reference("run", started.run.id).status == "cancelled"


def test_run_is_reclaimed_after_the_lease_owner_process_is_killed(tmp_path: Path):
    path = tmp_path / "jobs.db"
    _, _, _, _, jobs, runs, _, worker = system(path)
    started = runs.start(spec().id, idempotency_key="run-key")
    assert isinstance(started, RunView)
    process = multiprocessing.get_context("spawn").Process(
        target=claim_then_crash,
        args=(str(path),),
    )
    process.start()
    process.join(timeout=5)
    assert process.exitcode == 17
    time.sleep(0.25)

    worker.start()
    try:
        wait_until(
            lambda: (
                jobs.latest_for_reference("run", started.run.id).status == "succeeded"
            )
        )
    finally:
        worker.stop()

    assert jobs.latest_for_reference("run", started.run.id).attempt == 2


def test_shutdown_relinquishes_a_job_that_outlives_the_grace_period(tmp_path: Path):
    path = tmp_path / "jobs.db"
    specs = SqliteSpecStore(path)
    runs_store = SqliteRunStore(path)
    datasets = SqliteEvalDatasetStore(path)
    batches = SqliteEvalBatchStore(path)
    jobs = SqliteJobStore(path)
    stored_spec = spec()
    specs.append(stored_spec, NOW)
    entered = threading.Event()
    release = threading.Event()

    def blocking_start(_spec, run_id, clock, _input):
        entered.set()
        release.wait(timeout=5)
        yield [
            RunEvent(
                seq=0,
                run_id=run_id,
                event_type=EventType.RUN_COMPLETED,
                timestamp=clock(),
                spec_revision=stored_spec.revision,
                payload={},
            )
        ]

    runs = RunService(
        specs,
        runs_store,
        clock=lambda: NOW,
        new_run_id=lambda: "blocked-run",
        start_run=blocking_start,
        jobs=jobs,
    )
    evals = EvalBatchService(datasets, specs, batches, jobs=jobs)
    worker = DurableJobWorker(
        jobs,
        runs,
        evals,
        lease_seconds=1,
        poll_seconds=0.01,
    )
    started = runs.start(stored_spec.id, idempotency_key="blocked-command")
    assert isinstance(started, RunView)
    worker.start()
    assert entered.wait(timeout=1)

    worker.stop(grace_seconds=0.01)
    reclaimed_at = datetime.now(UTC)
    reclaimed = jobs.claim(
        "replacement-worker",
        reclaimed_at,
        reclaimed_at + timedelta(seconds=1),
    )

    assert not worker.started
    assert reclaimed is not None
    assert reclaimed.id == jobs.latest_for_reference("run", "blocked-run").id
    assert reclaimed.attempt == 2

    release.set()
    worker.stop(grace_seconds=1)
