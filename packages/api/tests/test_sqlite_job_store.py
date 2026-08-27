from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from agentcanvas_api.job_store import IdempotencyConflict, JobCancelled, LeaseLost
from agentcanvas_api.sqlite_eval_batch_store import SqliteEvalBatchStore
from agentcanvas_api.sqlite_job_store import SqliteJobStore
from agentcanvas_api.sqlite_run_store import SqliteRunStore
from agentcanvas_contracts.eval_result import EvalBatch
from agentcanvas_contracts.run import Run
from agentcanvas_contracts.run_events import EventType, RunEvent

NOW = datetime(2026, 8, 26, 12, 0, tzinfo=UTC)
REVISION = "sha256:" + "1" * 64


def a_run(run_id: str = "run-1") -> Run:
    return Run(
        id=run_id,
        spec_id="clinical-assistant",
        spec_revision=REVISION,
        created_at=NOW,
    )


def an_event(seq: int = 0, event_type: EventType = EventType.RUN_STARTED) -> RunEvent:
    return RunEvent(
        seq=seq,
        run_id="run-1",
        event_type=event_type,
        timestamp=NOW,
        spec_revision=REVISION,
        payload={},
    )


def accept_run(store: SqliteJobStore, *, key: str = "key-1"):
    return store.accept_run(
        a_run(),
        idempotency_key=key,
        request_fingerprint="fingerprint-1",
        payload={"run_id": "run-1"},
        now=NOW,
    )


def claim(store: SqliteJobStore, owner: str = "worker-1", at: datetime = NOW):
    return store.claim(owner, at, at + timedelta(seconds=30))


def test_accepting_a_run_and_job_is_idempotent(tmp_path: Path):
    store = SqliteJobStore(tmp_path / "jobs.db")

    first = accept_run(store)
    replay = accept_run(store)

    assert first.replayed is False
    assert replay.replayed is True
    assert replay.job.id == first.job.id
    assert replay.job.reference_id == "run-1"


def test_reusing_an_idempotency_key_for_another_request_is_refused(tmp_path: Path):
    store = SqliteJobStore(tmp_path / "jobs.db")
    accept_run(store)

    with pytest.raises(IdempotencyConflict):
        store.accept_eval(
            "batch-1",
            idempotency_key="key-1",
            request_fingerprint="another-fingerprint",
            payload={},
            now=NOW,
        )


def test_competing_workers_can_claim_a_job_only_once(tmp_path: Path):
    store = SqliteJobStore(tmp_path / "jobs.db")
    accept_run(store)

    with ThreadPoolExecutor(max_workers=4) as executor:
        claimed = list(
            executor.map(lambda index: claim(store, f"worker-{index}"), range(4))
        )

    winners = [job for job in claimed if job is not None]
    assert len(winners) == 1
    assert winners[0].attempt == 1


def test_same_timestamp_jobs_keep_enqueue_order_through_expiry_and_retry(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    ids = iter([SimpleNamespace(hex="f" * 32), SimpleNamespace(hex="0" * 32)])
    monkeypatch.setattr(
        "agentcanvas_api.sqlite_job_store.uuid4",
        lambda: next(ids),
    )
    store = SqliteJobStore(tmp_path / "jobs.db")
    first = store.accept_eval(
        "batch-first",
        idempotency_key="first-key",
        request_fingerprint="first-fingerprint",
        payload={},
        now=NOW,
        max_attempts=3,
    )
    second = store.accept_eval(
        "batch-second",
        idempotency_key="second-key",
        request_fingerprint="second-fingerprint",
        payload={},
        now=NOW,
    )

    claimed = claim(store, "worker-1")
    assert claimed is not None
    assert claimed.id == first.job.id
    assert claimed.id > second.job.id

    reclaimed = claim(store, "worker-2", NOW + timedelta(seconds=31))
    assert reclaimed is not None
    assert reclaimed.id == first.job.id
    assert reclaimed.attempt == 2
    assert (
        store.retry_or_fail(
            reclaimed.id,
            "worker-2",
            NOW + timedelta(seconds=31),
            "runtime_error",
        )
        == "queued"
    )

    retried = claim(store, "worker-3", NOW + timedelta(seconds=31))
    assert retried is not None
    assert retried.id == first.job.id
    assert retried.attempt == 3
    assert (
        store.retry_or_fail(
            retried.id,
            "worker-3",
            NOW + timedelta(seconds=31),
            "retry_exhausted",
        )
        == "failed"
    )

    next_job = claim(store, "worker-4", NOW + timedelta(seconds=31))
    assert next_job is not None
    assert next_job.id == second.job.id
    assert next_job.attempt == 1


def test_an_expired_lease_is_reclaimed_and_the_old_owner_is_fenced(tmp_path: Path):
    store = SqliteJobStore(tmp_path / "jobs.db")
    accept_run(store)
    first = claim(store, "worker-1")
    assert first is not None

    reclaimed = claim(store, "worker-2", NOW + timedelta(seconds=31))

    assert reclaimed is not None
    assert reclaimed.id == first.id
    assert reclaimed.attempt == 2
    with pytest.raises(LeaseLost):
        store.append_run_events(
            first.id,
            "worker-1",
            [an_event()],
            now=NOW + timedelta(seconds=31),
        )
    store.append_run_events(
        reclaimed.id,
        "worker-2",
        [an_event()],
        now=NOW + timedelta(seconds=31),
        terminal_status="succeeded",
    )
    assert store.get(first.id).status == "succeeded"


def test_a_lease_can_be_renewed_only_by_its_owner(tmp_path: Path):
    store = SqliteJobStore(tmp_path / "jobs.db")
    accept_run(store)
    job = claim(store)
    assert job is not None

    assert store.renew(
        job.id,
        "worker-1",
        NOW + timedelta(seconds=10),
        NOW + timedelta(seconds=40),
    )
    assert not store.renew(
        job.id,
        "another-worker",
        NOW + timedelta(seconds=10),
        NOW + timedelta(seconds=40),
    )


def test_failure_requeues_until_the_attempt_limit_then_becomes_terminal(
    tmp_path: Path,
):
    store = SqliteJobStore(tmp_path / "jobs.db")
    store.accept_run(
        a_run(),
        idempotency_key="key-1",
        request_fingerprint="fingerprint-1",
        payload={},
        now=NOW,
        max_attempts=2,
    )
    first = claim(store, at=NOW)
    assert first is not None
    assert store.retry_or_fail(first.id, "worker-1", NOW, "runtime_error") == "queued"
    second = claim(store, at=NOW + timedelta(seconds=1))
    assert second is not None

    assert (
        store.retry_or_fail(
            second.id,
            "worker-1",
            NOW + timedelta(seconds=1),
            "runtime_error",
        )
        == "failed"
    )
    assert store.get(second.id).terminal_reason == "runtime_error"


def test_resume_acceptance_appends_opening_and_job_in_one_transaction(tmp_path: Path):
    store = SqliteJobStore(tmp_path / "jobs.db")
    accept_run(store)
    claimed = claim(store)
    assert claimed is not None
    store.append_run_events(
        claimed.id,
        "worker-1",
        [an_event()],
        now=NOW,
        terminal_status="succeeded",
    )
    opening = an_event(1, EventType.NODE_STARTED)

    resumed = store.accept_resume(
        "run-1",
        0,
        [opening],
        idempotency_key="resume-key",
        request_fingerprint="resume-fingerprint",
        payload={"base_seq": 0},
        now=NOW,
    )

    assert resumed.job.operation == "resume"
    assert resumed.job.status == "queued"


def test_eval_result_and_job_terminalize_together(tmp_path: Path):
    store = SqliteJobStore(tmp_path / "jobs.db")
    accepted = store.accept_eval(
        "batch-1",
        idempotency_key="eval-key",
        request_fingerprint="eval-fingerprint",
        payload={},
        now=NOW,
    )
    job = claim(store)
    assert job is not None
    batch = EvalBatch(
        id="batch-1",
        dataset_id="dataset-1",
        spec_id="clinical-assistant",
        spec_revision=REVISION,
        started_at=NOW,
        results=[],
    )

    store.save_eval_result(job.id, "worker-1", batch, NOW)

    assert store.get(accepted.job.id).status == "succeeded"


def test_queued_cancellation_is_terminal_and_leased_cancellation_is_requested(
    tmp_path: Path,
):
    store = SqliteJobStore(tmp_path / "jobs.db")
    accept_run(store)

    cancelled = store.request_cancel("run", "run-1", NOW, an_event())

    assert cancelled is not None
    assert cancelled.status == "cancelled"
    second = store.accept_eval(
        "batch-1",
        idempotency_key="eval-key",
        request_fingerprint="eval-fingerprint",
        payload={},
        now=NOW,
    )
    claimed = claim(store)
    assert claimed is not None
    requested = store.request_cancel("eval", "batch-1", NOW)
    assert requested is not None
    assert requested.status == "leased"
    assert requested.cancel_requested_at == NOW
    store.mark_cancelled(second.job.id, "worker-1", NOW)
    assert store.get(second.job.id).status == "cancelled"


def test_leased_run_cancellation_fences_a_terminal_event_write(tmp_path: Path):
    store = SqliteJobStore(tmp_path / "jobs.db")
    accepted = accept_run(store)
    job = claim(store)
    assert job is not None
    store.request_cancel("run", "run-1", NOW)

    with pytest.raises(JobCancelled):
        store.append_run_events(
            job.id,
            "worker-1",
            [an_event(event_type=EventType.RUN_COMPLETED)],
            now=NOW,
            terminal_status="succeeded",
        )

    store.mark_cancelled(job.id, "worker-1", NOW, an_event())
    assert store.get(accepted.job.id).status == "cancelled"


def test_leased_eval_cancellation_fences_the_result_write(tmp_path: Path):
    path = tmp_path / "jobs.db"
    store = SqliteJobStore(path)
    accepted = store.accept_eval(
        "batch-1",
        idempotency_key="eval-key",
        request_fingerprint="eval-fingerprint",
        payload={},
        now=NOW,
    )
    job = claim(store)
    assert job is not None
    store.request_cancel("eval", "batch-1", NOW)
    batch = EvalBatch(
        id="batch-1",
        dataset_id="dataset-1",
        spec_id="clinical-assistant",
        spec_revision=REVISION,
        started_at=NOW,
        results=[],
    )

    with pytest.raises(JobCancelled):
        store.save_eval_result(job.id, "worker-1", batch, NOW)

    store.mark_cancelled(job.id, "worker-1", NOW)
    assert store.get(accepted.job.id).status == "cancelled"
    assert SqliteEvalBatchStore(path).get("batch-1") is None


def test_expired_owner_cannot_renew_or_write_before_reclaim(tmp_path: Path):
    store = SqliteJobStore(tmp_path / "jobs.db")
    accept_run(store)
    job = claim(store)
    assert job is not None
    after_expiry = NOW + timedelta(seconds=31)

    assert not store.renew(
        job.id,
        "worker-1",
        after_expiry,
        after_expiry + timedelta(seconds=30),
    )
    with pytest.raises(LeaseLost):
        store.append_run_events(
            job.id,
            "worker-1",
            [an_event()],
            now=after_expiry,
            terminal_status="succeeded",
        )

    assert store.get(job.id).status == "leased"


def test_cancellation_fences_retry_and_failure_transitions(tmp_path: Path):
    store = SqliteJobStore(tmp_path / "jobs.db")
    accepted = accept_run(store)
    job = claim(store)
    assert job is not None
    store.request_cancel("run", "run-1", NOW)

    with pytest.raises(JobCancelled):
        store.retry_or_fail(job.id, "worker-1", NOW, "runtime_error")
    with pytest.raises(JobCancelled):
        store.finish_failed(
            job.id,
            "worker-1",
            NOW,
            "runtime_error",
            an_event(event_type=EventType.RUN_FAILED),
        )

    store.mark_cancelled(
        job.id,
        "worker-1",
        NOW,
        an_event(event_type=EventType.RUN_FAILED),
    )
    assert store.get(accepted.job.id).status == "cancelled"


@pytest.mark.parametrize("lease_resume", [False, True])
def test_cancellation_selects_the_newest_same_timestamp_resume(
    tmp_path: Path,
    lease_resume: bool,
):
    path = tmp_path / "jobs.db"
    store = SqliteJobStore(path)
    start = accept_run(store)
    started_job = claim(store)
    assert started_job is not None
    store.append_run_events(
        started_job.id,
        "worker-1",
        [an_event(event_type=EventType.RUN_PAUSED)],
        now=NOW,
        terminal_status="succeeded",
    )
    resumed = store.accept_resume(
        "run-1",
        0,
        [an_event(1, EventType.RUN_RESUMED)],
        idempotency_key="resume-key",
        request_fingerprint="resume-fingerprint",
        payload={"base_seq": 0},
        now=NOW,
    )
    if lease_resume:
        claimed_resume = claim(store, at=NOW)
        assert claimed_resume is not None
        assert claimed_resume.id == resumed.job.id

    cancelled = store.request_cancel(
        "run",
        "run-1",
        NOW,
        an_event(event_type=EventType.RUN_FAILED),
    )

    assert cancelled is not None
    assert cancelled.id == resumed.job.id
    assert store.get(start.job.id).status == "succeeded"
    if lease_resume:
        assert cancelled.status == "leased"
        assert cancelled.cancel_requested_at == NOW
    else:
        assert cancelled.status == "cancelled"
        assert (
            SqliteRunStore(path).events("run-1")[-1].event_type is EventType.RUN_FAILED
        )
