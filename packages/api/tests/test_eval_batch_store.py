"""배치 저장소는 완결된 EvalBatch만 저장한다 — 덧붙이기만 하고, 지나간 배치를 고쳐 쓰지 않는다.

두 구현(메모리·SQLite)은 같은 약속을 지킨다: 같은 시험을 둘 다 통과한다.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

import pytest
from agentcanvas_api.eval_batch_store import EvalBatchStore, EvalBatchSummary
from agentcanvas_api.memory_eval_batch_store import InMemoryEvalBatchStore
from agentcanvas_api.sqlite_eval_batch_store import SqliteEvalBatchStore
from agentcanvas_contracts.eval_result import EvalAttempt, EvalBatch, EvalCaseResult

REVISION = "sha256:" + "1" * 64
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)


def a_result(**overrides) -> EvalCaseResult:
    base = {
        "case_id": "case-1",
        "attempts": [
            EvalAttempt(run_id="run-1", passed=True, output_text="반갑습니다")
        ],
        "passed": True,
        "evaluator": "expected_phrases",
        "evaluator_version": "v1",
    }
    return EvalCaseResult.model_validate({**base, **overrides})


def a_batch(**overrides) -> EvalBatch:
    base = {
        "id": "batch-1",
        "dataset_id": "greetings",
        "spec_id": "clinical-assistant",
        "spec_revision": REVISION,
        "started_at": STARTED_AT,
        "results": [a_result()],
    }
    return EvalBatch.model_validate({**base, **overrides})


@pytest.fixture(params=["memory", "sqlite"])
def store(request, tmp_path: Path) -> EvalBatchStore:
    if request.param == "memory":
        return InMemoryEvalBatchStore()
    return SqliteEvalBatchStore(tmp_path / "eval.db")


def test_nothing_is_stored_before_anything_is_written(store: EvalBatchStore):
    assert store.get("batch-1") is None
    assert store.list_for_dataset("greetings") == []


def test_a_saved_batch_comes_back_as_it_was(store: EvalBatchStore):
    store.save(a_batch())

    found = store.get("batch-1")

    assert found == a_batch()


def test_listing_shows_only_that_datasets_batches_newest_last(store: EvalBatchStore):
    store.save(a_batch())
    store.save(a_batch(id="batch-2", dataset_id="other"))

    listed = store.list_for_dataset("greetings")

    assert [batch.id for batch in listed] == ["batch-1"]


def test_listing_keeps_the_order_batches_were_saved_in(store: EvalBatchStore):
    """저장한 순서 그대로다 — 먼저 돈 배치가 앞, 나중에 돈 배치가 뒤(newest last)."""
    store.save(a_batch())
    store.save(a_batch(id="batch-2"))
    store.save(a_batch(id="batch-3"))

    listed = store.list_for_dataset("greetings")

    assert [batch.id for batch in listed] == ["batch-1", "batch-2", "batch-3"]


def test_listing_respects_a_limit_without_changing_the_order(store: EvalBatchStore):
    """limit은 순수 성능 수정이다 — 기존 순서(저장한 순서)는 그대로, 자르기만 한다."""
    store.save(a_batch())
    store.save(a_batch(id="batch-2"))
    store.save(a_batch(id="batch-3"))

    listed = store.list_for_dataset("greetings", limit=2)

    assert [batch.id for batch in listed] == ["batch-1", "batch-2"]


def test_a_batch_summary_counts_cases_and_passes_without_the_output_text():
    passing = a_result(passed=True)
    failing = a_result(case_id="case-2", passed=False)
    batch = a_batch(results=[passing, failing])

    summary = EvalBatchSummary.of(batch)

    assert summary.id == batch.id
    assert summary.started_at == batch.started_at
    assert summary.case_count == 2
    assert summary.passed_count == 1
    assert "output_text" not in EvalBatchSummary.model_fields


def test_a_batch_saved_before_missing_phrases_existed_still_reads(tmp_path: Path):
    """C5: 이미 파일에 들어 있는 옛 배치 JSON은 마이그레이션 없이 그대로 읽힌다.

    missing_phrases는 나중에 생긴 자리라 옛 저장분에는 없다 — 없는 근거는 빈 근거다.
    """
    path = tmp_path / "eval.db"
    store = SqliteEvalBatchStore(path)
    store.save(a_batch())  # 표를 만들어 두고, 그 안에 옛 모양의 줄을 직접 넣는다
    old_json = {
        "id": "batch-old",
        "dataset_id": "greetings",
        "spec_id": "clinical-assistant",
        "spec_revision": REVISION,
        "started_at": "2026-08-01T12:30:00Z",
        "results": [
            {
                "case_id": "case-1",
                "attempts": [
                    {"run_id": "run-1", "passed": False, "output_text": "반갑습니다"}
                ],
                "passed": False,
                "evaluator": "expected_phrases",
                "evaluator_version": "v1",
            }
        ],
    }
    with sqlite3.connect(path) as connection:
        connection.execute(
            "INSERT INTO eval_batches (batch_id, dataset_id, batch_json)"
            " VALUES (?, ?, ?)",
            ("batch-old", "greetings", json.dumps(old_json, ensure_ascii=False)),
        )

    found = store.get("batch-old")

    assert found is not None
    assert found.results[0].attempts[0].missing_phrases == []
    # judged_by도 나중에 생긴 자리다 — 0층만 있던 시절의 줄은 판정한 이름 없이 읽힌다.
    assert found.results[0].attempts[0].judged_by is None


def test_constructing_the_sqlite_store_does_not_touch_the_filesystem(tmp_path: Path):
    """구성만으로 db 파일이 생기면 안 된다 — 실제로 쓰거나 읽을 때 처음 연결한다(lazy connect)."""
    path = tmp_path / "not-yet.db"

    SqliteEvalBatchStore(path)

    assert not path.exists()
