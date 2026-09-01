"""실행을 쌓아 두는 자리 — 실행 하나와, 그 실행이 남긴 이벤트들.

두 구현(메모리·SQLite)은 같은 약속을 지킨다: 이벤트는 덧붙이기만 하고 고쳐 쓰지 않는다.
"""

from __future__ import annotations

import sqlite3
import sys
import threading
from datetime import UTC, datetime
from pathlib import Path

import pytest
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.run_store import RunStore, SeqAlreadyStored
from agentcanvas_api.sqlite_run_store import SqliteRunStore
from agentcanvas_contracts.run import Run
from agentcanvas_contracts.run_events import EventType, RunEvent

REVISION = "sha256:" + "1" * 64

#: 부딪히는 순간은 드물다 — 여러 번, 여럿이 붙어야 드러난다.
RACES = 200
RACERS = 8

#: 이만큼도 답이 없으면 시험은 기다리다 통과하지 않고 깨진다.
PATIENCE = 10.0

#: 자리를 붙들고 있는 동안 — 이 사이에 적히면 기다린 것이 아니다.
HELD_FOR = 0.2


def at(minute: int) -> datetime:
    return datetime(2026, 8, 1, 12, minute, tzinfo=UTC)


def a_run(run_id: str = "run_1", spec_id: str = "clinical-assistant") -> Run:
    return Run(id=run_id, spec_id=spec_id, spec_revision=REVISION, created_at=at(30))


def an_event(
    seq: int,
    run_id: str = "run_1",
    event_type: EventType = EventType.NODE_STARTED,
    node_id: str | None = "input",
) -> RunEvent:
    return RunEvent(
        seq=seq,
        run_id=run_id,
        event_type=event_type,
        timestamp=at(30),
        spec_revision=REVISION,
        payload={"node_type": "core.input"},
        node_id=node_id,
    )


@pytest.fixture(params=["memory", "sqlite"])
def store(request, tmp_path: Path) -> RunStore:
    if request.param == "memory":
        return InMemoryRunStore()
    return SqliteRunStore(tmp_path / "runs.db")


def test_no_run_is_there_before_one_is_started(store: RunStore):
    assert store.get("run_1") is None
    assert store.events("run_1") == []


def test_a_started_run_comes_back_as_it_was(store: RunStore):
    run = a_run()

    store.start(run)

    assert store.get("run_1") == run


def test_the_events_of_a_run_come_back_in_the_order_they_happened(store: RunStore):
    store.start(a_run())

    store.append(a_run().id, [an_event(0), an_event(1)])
    store.append(a_run().id, [an_event(2)])

    assert [event.seq for event in store.events("run_1")] == [0, 1, 2]


def test_an_event_comes_back_exactly_as_it_was_written(store: RunStore):
    store.start(a_run())
    event = an_event(0, event_type=EventType.RUN_PAUSED, node_id="human-gate")

    store.append("run_1", [event])

    assert store.events("run_1") == [event]


def test_only_what_happened_after_a_seq_can_be_asked_for(store: RunStore):
    store.start(a_run())
    store.append("run_1", [an_event(0), an_event(1), an_event(2)])

    assert [event.seq for event in store.events("run_1", after=0)] == [1, 2]
    assert store.events("run_1", after=2) == []


def test_one_run_does_not_see_another_runs_events(store: RunStore):
    store.start(a_run())
    store.start(a_run(run_id="run_2"))
    store.append("run_1", [an_event(0)])
    store.append("run_2", [an_event(0, run_id="run_2"), an_event(1, run_id="run_2")])

    assert len(store.events("run_1")) == 1
    assert len(store.events("run_2")) == 2


def test_the_last_event_is_the_one_with_the_highest_seq(store: RunStore):
    store.start(a_run())
    store.append("run_1", [an_event(0), an_event(1, event_type=EventType.RUN_PAUSED)])

    last = store.last_event("run_1")

    assert last is not None
    assert last.seq == 1


def test_a_run_with_no_events_has_no_last_event(store: RunStore):
    store.start(a_run())

    assert store.last_event("run_1") is None


def test_an_event_that_already_happened_cannot_be_written_over(store: RunStore):
    """이벤트는 덧붙이기만 한다 — 같은 순번을 두 번 적는 일은 없다."""
    store.start(a_run())
    store.append("run_1", [an_event(0)])

    with pytest.raises(SeqAlreadyStored):
        store.append("run_1", [an_event(0, node_id="other")])

    assert store.events("run_1") == [an_event(0)]


@pytest.fixture
def eager_switching():
    """일꾼들이 서로의 발을 밟도록 실을 자주 바꾼다 — 드문 순간을 시험에서 흔한 순간으로."""
    before = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    yield
    sys.setswitchinterval(before)


def winners_of_one_race() -> int:
    """같은 순번을 향해 한꺼번에 달려든 답들 중 몇이 적혔는가."""
    store = InMemoryRunStore()
    store.start(a_run())
    together = threading.Barrier(RACERS)
    written: list[int] = []

    def answer() -> None:
        together.wait(timeout=PATIENCE)
        try:
            store.append("run_1", [an_event(0)])
            written.append(1)
        except SeqAlreadyStored:
            pass

    racers = [threading.Thread(target=answer) for _ in range(RACERS)]
    for racer in racers:
        racer.start()
    for racer in racers:
        racer.join(timeout=PATIENCE)
        assert not racer.is_alive(), "an answer never finished"
    assert len(store.events("run_1")) == len(written)
    return len(written)


def test_answers_arriving_at_the_same_moment_cannot_both_be_written(eager_switching):
    """문은 여러 일꾼이 동시에 연다 — 같은 순번을 향한 답이 여럿이면 하나만 이겨야 한다."""
    assert [winners_of_one_race() for _ in range(RACES)] == [1] * RACES


class TestTheFileWhileTwoThingsUseItAtOnce:
    """배경에서 이벤트를 쌓는 일과, 듣는 쪽이 쉼 없이 되읽는 일은 늘 함께 일어난다."""

    def a_store_with_one_event(self, path: Path) -> SqliteRunStore:
        store = SqliteRunStore(path)
        store.start(a_run())
        store.append("run_1", [an_event(0)])
        return store

    def test_someone_reading_the_run_does_not_stop_it_from_going_on(
        self, tmp_path: Path
    ):
        """듣는 사람이 읽고 있다고 실행이 다음 사건을 남기지 못하면 안 된다."""
        path = tmp_path / "runs.db"
        store = self.a_store_with_one_event(path)
        reading = sqlite3.connect(str(path))
        reading.execute("BEGIN")
        reading.execute("SELECT event_json FROM run_events").fetchall()

        try:
            store.append("run_1", [an_event(1)])
        finally:
            reading.close()

        assert [event.seq for event in store.events("run_1")] == [0, 1]

    def test_a_write_that_meets_another_write_waits_its_turn(self, tmp_path: Path):
        """같은 순간에 두 곳에서 적으면 하나는 잠깐 기다린다 — 기다리지 않고 포기하지 않는다."""
        path = tmp_path / "runs.db"
        store = self.a_store_with_one_event(path)
        holding = sqlite3.connect(str(path))
        holding.execute("BEGIN IMMEDIATE")
        holding.execute(
            "INSERT INTO run_events (run_id, seq, event_json) VALUES ('other', 0, '{}')"
        )
        written = threading.Event()
        went_wrong: list[Exception] = []

        def append_from_the_background() -> None:
            try:
                store.append("run_1", [an_event(1)])
            except Exception as trouble:  # noqa: BLE001 — 무슨 일이 났든 시험이 말해 준다.
                went_wrong.append(trouble)
            written.set()

        writer = threading.Thread(target=append_from_the_background)
        writer.start()
        assert not written.wait(HELD_FOR), "붙들려 있는 동안에는 적히지 못한다"
        holding.rollback()
        holding.close()

        assert written.wait(PATIENCE), "자리가 나도 적히지 못했다"
        writer.join(timeout=PATIENCE)
        assert went_wrong == []


def test_a_reopened_file_still_holds_the_run_and_its_events(tmp_path: Path):
    """프로세스가 죽었다 살아나도 실행은 그대로 있다."""
    path = tmp_path / "runs.db"
    first = SqliteRunStore(path)
    first.start(a_run())
    first.append("run_1", [an_event(0), an_event(1)])

    reopened = SqliteRunStore(path)

    assert reopened.get("run_1") == a_run()
    assert [event.seq for event in reopened.events("run_1")] == [0, 1]


def test_a_run_carries_its_thread_and_end_user_through_storage(store: RunStore):
    run = Run(
        id="run_1",
        spec_id="clinical-assistant",
        spec_revision=REVISION,
        created_at=at(30),
        thread_id="chat_7",
        end_user_ref="end-user://alice",
    )

    store.start(run)

    stored = store.get("run_1")
    assert stored is not None
    assert stored.thread_id == "chat_7"
    assert stored.end_user_ref == "end-user://alice"


def test_a_solo_run_stores_itself_as_its_own_thread(store: RunStore):
    store.start(a_run())

    stored = store.get("run_1")
    assert stored is not None
    assert stored.thread_id == "run_1"
    assert stored.end_user_ref is None


def test_runs_in_a_thread_come_back_in_the_order_they_started(store: RunStore):
    for index, minute in enumerate((10, 20, 30)):
        store.start(
            Run(
                id=f"run_{index}",
                spec_id="clinical-assistant",
                spec_revision=REVISION,
                created_at=at(minute),
                thread_id="chat_7",
            )
        )

    ordered = store.runs_in_thread("chat_7")

    assert [run.id for run in ordered] == ["run_0", "run_1", "run_2"]


def test_a_thread_does_not_see_another_threads_runs(store: RunStore):
    store.start(a_run(run_id="mine"))  # its own solo thread
    store.start(
        Run(
            id="theirs",
            spec_id="clinical-assistant",
            spec_revision=REVISION,
            created_at=at(40),
            thread_id="chat_7",
        )
    )

    assert [run.id for run in store.runs_in_thread("chat_7")] == ["theirs"]


def test_an_empty_thread_is_an_empty_list(store: RunStore):
    assert store.runs_in_thread("nobody-here") == []


def test_deleting_a_thread_takes_its_runs_and_their_events_with_it(store: RunStore):
    store.start(a_run(run_id="mine"))  # its own solo thread
    store.start(
        Run(
            id="theirs",
            spec_id="clinical-assistant",
            spec_revision=REVISION,
            created_at=at(40),
            thread_id="chat_7",
        )
    )
    store.append("theirs", [an_event(0, run_id="theirs")])

    store.delete_thread("chat_7")

    assert store.get("theirs") is None
    assert store.events("theirs") == []
    assert store.runs_in_thread("chat_7") == []
    assert store.get("mine") is not None, "남의 대화는 건드리지 않는다"


def test_deleting_a_thread_nobody_started_is_no_trouble(store: RunStore):
    store.delete_thread("nobody-here")

    assert store.runs_in_thread("nobody-here") == []


def a_turn(run_id: str, thread_id: str, minute: int, spec_id: str) -> Run:
    return Run(
        id=run_id,
        spec_id=spec_id,
        spec_revision=REVISION,
        created_at=at(minute),
        thread_id=thread_id,
    )


def test_the_conversations_of_a_graph_come_back_with_the_latest_one_first(
    store: RunStore,
):
    """지난 대화 목록은 최근에 말이 오간 대화부터 — 안에서는 말한 순서대로 묶인다."""
    store.start(a_turn("run_1", "chat_old", 10, "clinical-assistant"))
    store.start(a_turn("run_2", "chat_new", 20, "clinical-assistant"))
    store.start(a_turn("run_3", "chat_old", 30, "clinical-assistant"))

    threads = store.threads_of_spec("clinical-assistant")

    assert [[run.id for run in thread] for thread in threads] == [
        ["run_1", "run_3"],
        ["run_2"],
    ]


def test_a_run_that_named_no_thread_is_a_conversation_of_its_own(store: RunStore):
    """홀로 선 실행도 숨기지 않는다 — 그 자체로 하나의 대화다."""
    store.start(a_run(run_id="alone"))

    threads = store.threads_of_spec("clinical-assistant")

    assert [[run.id for run in thread] for thread in threads] == [["alone"]]


def test_the_conversations_of_one_graph_do_not_mix_with_anothers(store: RunStore):
    store.start(a_turn("mine", "chat_1", 10, "clinical-assistant"))
    store.start(a_turn("theirs", "chat_2", 20, "triage-bot"))

    assert [
        [run.id for run in thread]
        for thread in store.threads_of_spec("clinical-assistant")
    ] == [["mine"]]


def test_a_graph_nobody_has_run_has_no_conversations(store: RunStore):
    assert store.threads_of_spec("nobody-here") == []
