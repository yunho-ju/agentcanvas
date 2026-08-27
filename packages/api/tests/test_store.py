"""저장소는 저장만 한다 — 판을 매기는 규칙은 서비스가, SQL은 저장소가 안다.

두 구현(메모리·SQLite)은 같은 약속을 지킨다: 같은 테스트를 둘 다 통과한다.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from threading import Barrier

import pytest
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.sqlite_store import SqliteSpecStore
from agentcanvas_api.store import (
    RevisionChanged,
    SpecStore,
    StoredSpec,
    VersionAlreadyStored,
)
from agentcanvas_contracts.agent_spec import AgentSpec

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)


def example_spec(**overrides) -> AgentSpec:
    raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    candidate = AgentSpec.model_validate({**raw, **overrides})
    return candidate.model_copy(update={"revision": candidate.computed_revision()})


def at(minute: int) -> datetime:
    return datetime(2026, 8, 1, 12, minute, tzinfo=UTC)


@pytest.fixture(params=["memory", "sqlite"])
def store(request, tmp_path: Path) -> SpecStore:
    if request.param == "memory":
        return InMemorySpecStore()
    return SqliteSpecStore(tmp_path / "specs.db")


def test_nothing_is_stored_before_anything_is_written(store: SpecStore):
    assert store.latest("clinical-assistant") is None
    assert store.revisions("clinical-assistant") == []


def test_written_spec_comes_back_as_it_was(store: SpecStore):
    spec = example_spec(version=1)

    store.append(spec, created_at=at(30))

    stored = store.latest(spec.id)
    assert stored is not None
    assert stored.spec == spec
    assert stored.created_at == at(30)


def test_the_latest_written_spec_is_the_one_that_comes_back(store: SpecStore):
    store.append(example_spec(version=1), created_at=at(30))
    store.append(example_spec(version=2, name="고친 판"), created_at=at(31))

    stored = store.latest("clinical-assistant")
    assert stored is not None
    assert stored.spec.version == 2
    assert stored.spec.name == "고친 판"


def test_history_keeps_every_version_newest_first(store: SpecStore):
    first = example_spec(version=1)
    second = example_spec(version=2, name="고친 판")
    store.append(first, created_at=at(30))
    store.append(second, created_at=at(31))

    history = store.revisions("clinical-assistant")

    assert [entry.version for entry in history] == [2, 1]
    assert [entry.revision for entry in history] == [second.revision, first.revision]
    assert [entry.created_at for entry in history] == [at(31), at(30)]


def test_one_graph_does_not_see_another_graphs_history(store: SpecStore):
    store.append(example_spec(version=1), created_at=at(30))
    store.append(example_spec(id="other", version=1), created_at=at(31))

    assert len(store.revisions("clinical-assistant")) == 1
    assert store.latest("other") is not None


def test_history_is_not_rewritten_when_a_new_version_arrives(store: SpecStore):
    first = example_spec(version=1)
    store.append(first, created_at=at(30))
    store.append(example_spec(version=2, name="고친 판"), created_at=at(31))

    assert store.revisions("clinical-assistant")[-1].revision == first.revision


def test_the_same_version_cannot_be_written_twice(store: SpecStore):
    """이력은 고쳐 쓰지 않는다 — 같은 판 번호를 두 번 잇는 일은 없다."""
    store.append(example_spec(version=1), created_at=at(30))

    with pytest.raises(VersionAlreadyStored):
        store.append(example_spec(version=1, name="다른 내용"), created_at=at(31))

    assert [entry.version for entry in store.revisions("clinical-assistant")] == [1]


def test_conditional_append_rejects_a_stale_revision(store: SpecStore):
    first = example_spec(version=1)
    store.append(first, created_at=at(30))
    second = example_spec(version=2, name="먼저 저장")
    store.append_if_revision(second, first.revision, created_at=at(31))

    with pytest.raises(RevisionChanged):
        store.append_if_revision(
            example_spec(version=3, name="나중 저장"),
            first.revision,
            created_at=at(32),
        )

    assert store.latest(first.id).spec == second
    assert [entry.version for entry in store.revisions(first.id)] == [2, 1]


def test_conditional_append_serializes_competing_writers(store: SpecStore):
    first = example_spec(version=1)
    store.append(first, created_at=at(30))
    ready = Barrier(2)

    def write(name: str) -> StoredSpec | Exception:
        ready.wait()
        try:
            return store.append_if_revision(
                example_spec(version=2, name=name),
                first.revision,
                created_at=at(31),
            )
        except RevisionChanged as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(write, ["writer-a", "writer-b"]))

    assert sum(isinstance(result, StoredSpec) for result in results) == 1
    assert sum(isinstance(result, RevisionChanged) for result in results) == 1
    assert len(store.revisions(first.id)) == 2


def test_a_past_revision_can_be_taken_out_again(store: SpecStore):
    """지나간 판도 그대로 꺼낼 수 있다 — 그 판으로 시작한 실행이 이어서 돌 수 있게."""
    first = example_spec(version=1)
    store.append(first, created_at=at(30))
    store.append(example_spec(version=2, name="고친 판"), created_at=at(31))

    taken = store.by_revision("clinical-assistant", first.revision)

    assert taken is not None
    assert taken.spec == first
    assert taken.created_at == at(30)


def test_a_revision_that_was_never_written_is_not_there(store: SpecStore):
    store.append(example_spec(version=1), created_at=at(30))

    assert store.by_revision("clinical-assistant", "sha256:" + "0" * 64) is None


def test_one_graph_does_not_hand_out_another_graphs_revision(store: SpecStore):
    other = example_spec(id="other", version=1)
    store.append(other, created_at=at(30))

    assert store.by_revision("clinical-assistant", other.revision) is None


def test_nothing_is_listed_before_anything_is_written(store: SpecStore):
    assert store.summaries(limit=10) == []


def test_the_list_shows_the_latest_of_each_graph_newest_first(store: SpecStore):
    store.append(example_spec(version=1), created_at=at(30))
    store.append(example_spec(version=2, name="고친 판"), created_at=at(32))
    store.append(example_spec(id="other", version=1, name="다른 것"), created_at=at(31))

    listed = store.summaries(limit=10)

    assert [entry.id for entry in listed] == ["clinical-assistant", "other"]
    assert [entry.version for entry in listed] == [2, 1]
    assert [entry.name for entry in listed] == ["고친 판", "다른 것"]
    assert [entry.saved_at for entry in listed] == [at(32), at(31)]
    assert listed[0].revision == example_spec(version=2, name="고친 판").revision


def test_the_list_stops_at_the_limit_and_keeps_the_newest(store: SpecStore):
    for minute in range(30, 35):
        store.append(example_spec(id=f"doc-{minute}", version=1), created_at=at(minute))

    listed = store.summaries(limit=2)

    assert [entry.id for entry in listed] == ["doc-34", "doc-33"]


def test_a_reopened_file_still_holds_what_was_written(tmp_path: Path):
    """프로세스가 죽었다 살아나도 저장한 것은 그대로 있다."""
    path = tmp_path / "specs.db"
    SqliteSpecStore(path).append(example_spec(version=1), created_at=at(30))

    reopened = SqliteSpecStore(path)

    stored = reopened.latest("clinical-assistant")
    assert stored is not None
    assert stored.spec == example_spec(version=1)
    assert [entry.version for entry in reopened.revisions("clinical-assistant")] == [1]
