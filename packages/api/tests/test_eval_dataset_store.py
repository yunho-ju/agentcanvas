"""데이터셋 저장소는 저장만 한다 — 판 이력은 없다(v1), 있는 것을 그대로 덮어쓴다(upsert).

두 구현(메모리·SQLite)은 같은 약속을 지킨다: 같은 시험을 둘 다 통과한다.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from agentcanvas_api.eval_dataset_store import EvalDatasetStore
from agentcanvas_api.memory_eval_dataset_store import InMemoryEvalDatasetStore
from agentcanvas_api.sqlite_eval_dataset_store import SqliteEvalDatasetStore
from agentcanvas_contracts.eval_case import EvalCase, EvalDataset


def a_case(**overrides) -> EvalCase:
    base = {
        "id": "case-1",
        "title": "인사에 반갑다는 말이 있는가",
        "input": {},
        "expected_phrases": ["반갑습니다"],
    }
    return EvalCase.model_validate({**base, **overrides})


def a_dataset(**overrides) -> EvalDataset:
    base = {"id": "greetings", "name": "인사 데이터셋", "cases": [a_case()]}
    return EvalDataset.model_validate({**base, **overrides})


@pytest.fixture(params=["memory", "sqlite"])
def store(request, tmp_path: Path) -> EvalDatasetStore:
    if request.param == "memory":
        return InMemoryEvalDatasetStore()
    return SqliteEvalDatasetStore(tmp_path / "eval.db")


def test_nothing_is_stored_before_anything_is_written(store: EvalDatasetStore):
    assert store.get("greetings") is None
    assert store.list_summaries() == []


def test_a_saved_dataset_comes_back_as_it_was(store: EvalDatasetStore):
    store.save(a_dataset())

    found = store.get("greetings")

    assert found == a_dataset()


def test_saving_again_overwrites_the_previous_content(store: EvalDatasetStore):
    """upsert다 — 판 이력을 남기지 않고 있는 것을 그대로 덮어쓴다."""
    store.save(a_dataset())
    store.save(a_dataset(name="고친 이름", cases=[a_case(id="case-2")]))

    found = store.get("greetings")

    assert found is not None
    assert found.name == "고친 이름"
    assert [case.id for case in found.cases] == ["case-2"]


def test_listing_shows_a_summary_of_each_saved_dataset(store: EvalDatasetStore):
    store.save(a_dataset())
    store.save(a_dataset(id="other", name="다른 것", cases=[a_case(), a_case(id="c2")]))

    listed = store.list_summaries()

    assert {summary.id for summary in listed} == {"greetings", "other"}
    other = next(summary for summary in listed if summary.id == "other")
    assert other.name == "다른 것"
    assert other.case_count == 2


def test_deleting_a_known_dataset_says_it_existed_and_removes_it(
    store: EvalDatasetStore,
):
    store.save(a_dataset())

    existed = store.delete("greetings")

    assert existed is True
    assert store.get("greetings") is None


def test_deleting_an_unknown_dataset_says_it_did_not_exist(store: EvalDatasetStore):
    assert store.delete("nobody-here") is False


def test_constructing_the_sqlite_store_does_not_touch_the_filesystem(tmp_path: Path):
    """구성만으로 db 파일이 생기면 안 된다 — 실제로 쓰거나 읽을 때 처음 연결한다(lazy connect)."""
    path = tmp_path / "not-yet.db"

    SqliteEvalDatasetStore(path)

    assert not path.exists()
