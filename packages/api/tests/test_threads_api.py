"""지난 대화를 여는 문들 — 한 그래프에서 오간 대화들과, 한 대화에 쌓인 이벤트들.

요약(첫 마디·마지막 상태)은 저장된 적이 없다: 이미 쌓인 이벤트에서 읽을 때마다 파생된다.
실시간은 SSE가, 되돌아보기는 이 JSON이 맡는다 — 두 길은 같은 이벤트를 본다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from itertools import count
from pathlib import Path

import pytest
from agentcanvas_api.app import create_app
from agentcanvas_api.architect_service import blank_architect_seed
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.run_service import Work
from agentcanvas_api.run_store import RunStore
from agentcanvas_api.run_stream import StreamTiming
from agentcanvas_contracts.chat import CHAT_SAID_BINDING
from agentcanvas_contracts.run import Run
from agentcanvas_contracts.run_events import EventType, RunEvent
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)
SPEC_ID = "clinical-assistant"
REVISION = "sha256:" + "1" * 64
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)

QUICK = StreamTiming(poll_seconds=0.01, keepalive_seconds=15.0)


def right_here(work: Work) -> None:
    work()


def at(minute: int) -> datetime:
    return datetime(2026, 8, 1, 12, minute, tzinfo=UTC)


def an_event(
    run_id: str, seq: int, event_type: EventType, payload: dict | None = None
) -> RunEvent:
    return RunEvent(
        seq=seq,
        run_id=run_id,
        event_type=event_type,
        timestamp=at(30),
        spec_revision=REVISION,
        payload={} if payload is None else payload,
    )


def a_turn(
    store: RunStore,
    run_id: str,
    thread_id: str,
    minute: int,
    said: str | None = None,
    ended_with: EventType | None = None,
    spec_id: str = SPEC_ID,
    said_binding: str = CHAT_SAID_BINDING,
) -> None:
    """말 한 번을 그대로 쌓아 둔다 — 실행 하나와 그 실행이 남긴 이벤트들."""
    store.start(
        Run(
            id=run_id,
            spec_id=spec_id,
            spec_revision=REVISION,
            created_at=at(minute),
            thread_id=thread_id,
        )
    )
    opening: dict = {"spec_id": spec_id}
    if said is not None:
        opening["input"] = {said_binding: said}
    written = [an_event(run_id, 0, EventType.RUN_STARTED, opening)]
    if ended_with is not None:
        written.append(an_event(run_id, 1, ended_with))
    store.append(run_id, written)


def a_client(store: RunStore) -> TestClient:
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=store,
            clock=lambda: STARTED_AT,
            stream_timing=QUICK,
            worker=right_here,
        )
    )


@pytest.fixture
def store() -> InMemoryRunStore:
    return InMemoryRunStore()


@pytest.fixture
def client(store: InMemoryRunStore) -> TestClient:
    return a_client(store)


class TestTheConversationsOfAGraph:
    """지난 대화 목록 — 화면이 대화마다 되묻지 않도록 요약을 곁들여 한 번에 준다."""

    def test_every_conversation_comes_back_with_its_turns_counted(
        self, store: InMemoryRunStore, client: TestClient
    ):
        a_turn(store, "run_1", "chat_old", 10, said="처음 물은 것")
        a_turn(store, "run_2", "chat_old", 20)
        a_turn(store, "run_3", "chat_new", 30, said="새 대화")

        response = client.get(f"/specs/{SPEC_ID}/threads")

        assert response.status_code == 200
        assert [
            (thread["thread_id"], thread["turns"]) for thread in response.json()
        ] == [("chat_new", 1), ("chat_old", 2)]

    def test_a_conversation_says_when_it_began_and_when_it_last_spoke(
        self, store: InMemoryRunStore, client: TestClient
    ):
        a_turn(store, "run_1", "chat_1", 10)
        a_turn(store, "run_2", "chat_1", 40)

        thread = client.get(f"/specs/{SPEC_ID}/threads").json()[0]

        assert datetime.fromisoformat(thread["started_at"]) == at(10)
        assert datetime.fromisoformat(thread["last_at"]) == at(40)
        assert thread["spec_revision"] == REVISION

    def test_the_first_thing_a_person_said_is_the_name_of_the_conversation(
        self, store: InMemoryRunStore, client: TestClient
    ):
        a_turn(store, "run_1", "chat_1", 10, said="어떻게 시작하나요")
        a_turn(store, "run_2", "chat_1", 20, said="그 다음은요")

        thread = client.get(f"/specs/{SPEC_ID}/threads").json()[0]

        assert thread["first_said"] == "어떻게 시작하나요"

    def test_the_first_word_is_read_from_the_name_a_new_draft_listens_on(
        self, store: InMemoryRunStore, client: TestClient
    ):
        """새 초안이 받기로 한 그 이름이 곧 첫 마디를 읽는 이름이다.

        두 자리가 갈라지면 Architect로 만든 판은 대화가 되어도 목록에서 이름이 없다.
        """
        seed = blank_architect_seed("draft-thread-name")
        (bindings,) = [
            node.config["bindings"] for node in seed.nodes if node.id == "core-input"
        ]
        (listens_on,) = bindings

        a_turn(store, "run_1", "chat_1", 10, said="첫 말", said_binding=listens_on)

        assert (
            client.get(f"/specs/{SPEC_ID}/threads").json()[0]["first_said"] == "첫 말"
        )

    def test_a_run_nobody_spoke_into_has_no_first_word_instead_of_a_made_up_one(
        self, store: InMemoryRunStore, client: TestClient
    ):
        """건넨 것이 없는 실행도 대화다 — 첫 마디는 지어내지 않고 없다고 말한다."""
        a_turn(store, "run_1", "chat_1", 10)

        assert client.get(f"/specs/{SPEC_ID}/threads").json()[0]["first_said"] is None

    @pytest.mark.parametrize(
        ("ended_with", "expected"),
        [
            (EventType.RUN_COMPLETED, "completed"),
            (EventType.RUN_FAILED, "failed"),
            (EventType.RUN_PAUSED, "paused"),
            (None, "running"),
        ],
    )
    def test_the_state_of_a_conversation_is_read_from_its_last_turn(
        self,
        store: InMemoryRunStore,
        client: TestClient,
        ended_with: EventType | None,
        expected: str,
    ):
        a_turn(store, "run_1", "chat_1", 10, ended_with=EventType.RUN_COMPLETED)
        a_turn(store, "run_2", "chat_1", 20, ended_with=ended_with)

        assert client.get(f"/specs/{SPEC_ID}/threads").json()[0]["last_status"] == (
            expected
        )

    def test_a_graph_nobody_has_talked_to_has_no_conversations(
        self, client: TestClient
    ):
        """대화는 만들어 두는 것이 아니다 — 없는 그래프는 없다고 하지 않고 비어 있다."""
        response = client.get("/specs/nobody-here/threads")

        assert response.status_code == 200
        assert response.json() == []

    def test_a_run_that_named_no_conversation_is_listed_as_one_of_its_own(
        self, store: InMemoryRunStore, client: TestClient
    ):
        """혼자 돈 실행도 숨기지 않는다 — 목록은 일어난 일을 그대로 말한다."""
        store.start(
            Run(
                id="alone",
                spec_id=SPEC_ID,
                spec_revision=REVISION,
                created_at=at(10),
            )
        )

        assert [
            thread["thread_id"]
            for thread in client.get(f"/specs/{SPEC_ID}/threads").json()
        ] == ["alone"]

    def test_the_conversations_of_another_graph_are_not_mixed_in(
        self, store: InMemoryRunStore, client: TestClient
    ):
        a_turn(store, "mine", "chat_1", 10)
        a_turn(store, "theirs", "chat_2", 20, spec_id="triage-bot")

        assert [
            thread["thread_id"]
            for thread in client.get(f"/specs/{SPEC_ID}/threads").json()
        ] == ["chat_1"]


class TestTheEventsOfAConversation:
    """되돌아보기 — 대화 하나에 쌓인 이벤트를 실행별로 묶어 한 번에 준다."""

    def test_the_turns_come_back_in_the_order_they_were_spoken(
        self, store: InMemoryRunStore, client: TestClient
    ):
        a_turn(store, "run_1", "chat_1", 10, ended_with=EventType.RUN_COMPLETED)
        a_turn(store, "run_2", "chat_1", 20, ended_with=EventType.RUN_COMPLETED)

        response = client.get("/threads/chat_1/events")

        assert response.status_code == 200
        assert [turn["run"]["id"] for turn in response.json()] == ["run_1", "run_2"]

    def test_a_conversation_nobody_has_spoken_in_is_an_empty_list(
        self, client: TestClient
    ):
        response = client.get("/threads/nobody-here/events")

        assert response.status_code == 200
        assert response.json() == []

    def test_a_turn_that_is_still_going_gives_what_has_happened_so_far(
        self, store: InMemoryRunStore, client: TestClient
    ):
        """흐르는 중에 되돌아봐도 답이 온다 — 지금까지 쌓인 데까지의 스냅샷이다."""
        a_turn(store, "run_1", "chat_1", 10, said="아직 흐르는 중")

        turns = client.get("/threads/chat_1/events").json()

        assert [event["event_type"] for event in turns[0]["events"]] == ["run.started"]


def a_chatty_client() -> TestClient:
    """말이 여러 번 오가는 시험 — 진짜 실행기가 남긴 이벤트를 그대로 본다."""
    names = iter([f"run_{turn}" for turn in range(1, 10)])
    ticks = count(1)
    client = TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            clock=lambda: STARTED_AT + timedelta(seconds=next(ticks)),
            new_run_id=lambda: next(names),
            stream_timing=QUICK,
            worker=right_here,
        )
    )
    client.post("/specs", json=json.loads(EXAMPLE_PATH.read_text(encoding="utf-8")))
    client.post(f"/specs/{SPEC_ID}/publish")
    return client


def streamed(client: TestClient, run_id: str) -> list[dict]:
    """SSE로 받던 그대로의 이벤트들 — 되돌아보기가 같은 것을 주는지 견주는 자."""
    with client.stream("GET", f"/runs/{run_id}/events") as response:
        return [
            json.loads(line[len("data: ") :])
            for line in response.iter_lines()
            if line.startswith("data: ")
        ]


def a_finished_turn(client: TestClient, run_id: str, thread_id: str) -> None:
    client.post(
        f"/specs/{SPEC_ID}/runs",
        json={"revision_source": "published", "thread_id": thread_id},
    )
    client.post(f"/runs/{run_id}/approval", json={"approved": True})


def test_looking_back_gives_the_same_events_the_stream_gave() -> None:
    """실시간과 되돌아보기는 같은 이벤트를 본다 — 길만 둘이고 일어난 일은 하나다."""
    client = a_chatty_client()
    a_finished_turn(client, "run_1", "chat_1")
    a_finished_turn(client, "run_2", "chat_1")

    turns = client.get("/threads/chat_1/events").json()

    assert [turn["run"]["id"] for turn in turns] == ["run_1", "run_2"]
    assert [turn["events"] for turn in turns] == [
        streamed(client, "run_1"),
        streamed(client, "run_2"),
    ]
