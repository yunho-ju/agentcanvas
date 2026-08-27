"""실행을 여는 문들 — 만들고, 들여다보고, 흘러나오는 것을 듣고, 사람이 답한다.

실행 이름과 시계는 주입한다: 시험은 언제나 같은 실행을 본다.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import get_args

import httpx
import pytest
import uvicorn
from agentcanvas_api.app import RUN_REFUSAL_STATUS, create_app
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.run_service import RunRefusal, Work, Worker, in_the_background
from agentcanvas_api.run_store import RunStore, SeqAlreadyStored
from agentcanvas_api.run_stream import StreamTiming
from agentcanvas_contracts.run_events import EventType, RunEvent
from fastapi import FastAPI
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)
SPEC_ID = "clinical-assistant"
RUN_ID = "run_1"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)

#: 시험이 기다리는 시간은 짧다 — 규칙은 같고 박자만 빠르다.
QUICK = StreamTiming(poll_seconds=0.01, keepalive_seconds=15.0)

#: 이만큼도 답이 없으면 시험은 기다리다 통과하지 않고 깨진다.
PATIENCE = 10.0


def right_here(work: Work) -> None:
    """그 자리에서 곧장 하는 일꾼 — 시험은 배경을 기다리지 않고 결과를 본다."""
    work()


def a_server(worker: Worker = right_here, run_store: RunStore | None = None) -> FastAPI:
    return create_app(
        store=InMemorySpecStore(),
        run_store=run_store if run_store is not None else InMemoryRunStore(),
        clock=lambda: STARTED_AT,
        new_run_id=lambda: RUN_ID,
        stream_timing=QUICK,
        worker=worker,
    )


@contextmanager
def a_live_server() -> Iterator[str]:
    """진짜로 뜬 서버 하나 — 실행도 진짜 배경 일꾼이 옮긴다 (실제로 도는 모습 그대로)."""
    config = uvicorn.Config(
        a_server(worker=in_the_background),
        host="127.0.0.1",
        port=0,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + PATIENCE
    while not server.started:
        if time.monotonic() > deadline:
            raise TimeoutError("the server never came up")
        time.sleep(0.01)
    try:
        host, port = server.servers[0].sockets[0].getsockname()[:2]
        yield f"http://{host}:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=PATIENCE)


class _AlreadyAnswered(InMemoryRunStore):
    """다른 답이 한 발 먼저 재개시킨 저장소 — 답을 잇는 사건은 이미 적힌 순번에 부딪힌다."""

    def append(self, run_id: str, events: Sequence[RunEvent]) -> None:
        if any(event.event_type is EventType.RUN_RESUMED for event in events):
            raise SeqAlreadyStored(f"{run_id!r} was resumed by another answer")
        super().append(run_id, events)


def payload(**overrides) -> dict:
    raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    return {**raw, **overrides}


@pytest.fixture
def client() -> TestClient:
    client = TestClient(a_server())
    client.post("/specs", json=payload())
    return client


def start_a_run(client: TestClient) -> dict:
    return client.post(f"/specs/{SPEC_ID}/runs").json()


def frames(lines: list[str]) -> list[dict]:
    return [
        json.loads(line[len("data: ") :]) for line in lines if line.startswith("data: ")
    ]


def frames_until(lines: Iterator[str], event_type: str) -> list[dict]:
    """그 사건이 나올 때까지 읽어 모은다 — 그 앞에 몇 개가 오는지는 실행기가 정한다.

    사건이 오기 전에 줄글이 끝나면 조용히 통과하지 않고 깨진다.
    """
    read: list[dict] = []
    for line in lines:
        if not line.startswith("data: "):
            continue
        read.append(json.loads(line[len("data: ") :]))
        if read[-1]["event_type"] == event_type:
            return read
    raise AssertionError(f"the stream ended before {event_type}")


def ids(lines: list[str]) -> list[str]:
    return [line for line in lines if line.startswith("id: ")]


def test_every_reason_a_run_can_be_refused_has_an_http_answer():
    """표에 없는 까닭은 KeyError가 되어 500으로 샌다 — 까닭을 늘리면 여기서 먼저 걸린다."""
    assert set(RUN_REFUSAL_STATUS) == set(get_args(RunRefusal))


class TestStartingARun:
    def test_a_run_is_opened_on_the_graph_that_is_saved(self, client: TestClient):
        response = client.post(f"/specs/{SPEC_ID}/runs")

        assert response.status_code == 201
        body = response.json()
        assert body["run"]["id"] == RUN_ID
        assert body["run"]["spec_id"] == SPEC_ID

    def test_the_answer_comes_back_before_the_run_has_got_anywhere(
        self, client: TestClient
    ):
        """문은 실행이 끝나기를 기다리지 않는다 — 열어 준 실행은 이제 막 흐르기 시작했다."""
        assert client.post(f"/specs/{SPEC_ID}/runs").json()["status"] == "running"

    def test_what_the_run_did_is_there_to_be_read_afterwards(self, client: TestClient):
        start_a_run(client)

        assert client.get(f"/runs/{RUN_ID}").json()["status"] == "paused"

    def test_the_run_carries_the_revision_the_server_has(self, client: TestClient):
        saved = client.get(f"/specs/{SPEC_ID}").json()["spec"]["revision"]

        assert start_a_run(client)["run"]["spec_revision"] == saved

    def test_a_graph_that_was_never_saved_cannot_be_run(self, client: TestClient):
        response = client.post("/specs/nothing-like-that/runs")

        assert response.status_code == 404

    def test_asking_for_the_revision_that_is_saved_runs_it(self, client: TestClient):
        saved = client.get(f"/specs/{SPEC_ID}").json()["spec"]["revision"]

        response = client.post(f"/specs/{SPEC_ID}/runs", json={"spec_revision": saved})

        assert response.status_code == 201

    def test_a_misspelled_field_is_refused_not_quietly_dropped(
        self, client: TestClient
    ):
        """`specRevision` 오타가 조용히 버려지면, 판을 고정한 줄 알고 최신 판이 돈다."""
        response = client.post(
            f"/specs/{SPEC_ID}/runs", json={"specRevision": "sha256:" + "0" * 64}
        )

        assert response.status_code == 422

    def test_what_the_run_is_started_with_reaches_the_run_itself(self):
        """실행에 값을 건네는 통로 — 건넨 것은 그 실행이 연 자리에 그대로 적힌다."""
        runs = InMemoryRunStore()
        client = TestClient(a_server(run_store=runs))
        client.post("/specs", json=payload())

        client.post(
            f"/specs/{SPEC_ID}/runs", json={"input": {"question": "is it raining"}}
        )

        assert runs.events(RUN_ID)[0].payload["input"] == {"question": "is it raining"}

    def test_an_older_revision_is_not_quietly_run(self, client: TestClient):
        response = client.post(
            f"/specs/{SPEC_ID}/runs", json={"spec_revision": "sha256:" + "0" * 64}
        )

        assert response.status_code == 409


class TestLookingAtARun:
    def test_a_started_run_can_be_read_back(self, client: TestClient):
        start_a_run(client)

        response = client.get(f"/runs/{RUN_ID}")

        assert response.status_code == 200
        assert response.json()["run"]["id"] == RUN_ID
        assert response.json()["status"] == "paused"

    def test_a_run_that_was_never_started_is_not_there(self, client: TestClient):
        assert client.get("/runs/run_nothing").status_code == 404

    def test_the_events_of_a_run_that_was_never_started_are_not_there(
        self, client: TestClient
    ):
        assert client.get("/runs/run_nothing/events").status_code == 404


class TestAnsweringAGate:
    def test_approving_lets_the_run_finish(self, client: TestClient):
        start_a_run(client)

        response = client.post(f"/runs/{RUN_ID}/approval", json={"approved": True})

        assert response.status_code == 200
        assert client.get(f"/runs/{RUN_ID}").json()["status"] == "completed"

    def test_what_the_person_filled_in_is_written_on_the_resuming_event(
        self, client: TestClient
    ):
        start_a_run(client)

        client.post(
            f"/runs/{RUN_ID}/approval",
            json={"approved": True, "values": {"comment": "looks right"}},
        )

        with client.stream("GET", f"/runs/{RUN_ID}/events") as stream:
            sent = frames(list(stream.iter_lines()))
        resumed = next(one for one in sent if one["event_type"] == "run.resumed")
        assert resumed["payload"]["values"] == {"comment": "looks right"}

    def test_turning_it_down_closes_the_run_where_it_stood(self, client: TestClient):
        start_a_run(client)

        response = client.post(f"/runs/{RUN_ID}/approval", json={"approved": False})

        assert response.status_code == 200
        with client.stream("GET", f"/runs/{RUN_ID}/events") as stream:
            sent = frames(list(stream.iter_lines()))
        assert [one["event_type"] for one in sent[-3:]] == [
            "run.resumed",
            "node.completed",
            "run.completed",
        ]
        assert not any(one["node_id"] == "output" for one in sent)

    def test_a_refusal_cannot_carry_values(self, client: TestClient):
        start_a_run(client)

        response = client.post(
            f"/runs/{RUN_ID}/approval",
            json={"approved": False, "values": {"comment": "no"}},
        )

        assert response.status_code == 422

    def test_a_run_that_is_not_waiting_cannot_be_answered(self, client: TestClient):
        start_a_run(client)
        client.post(f"/runs/{RUN_ID}/approval", json={"approved": True})

        response = client.post(f"/runs/{RUN_ID}/approval", json={"approved": True})

        assert response.status_code == 409

    def test_a_run_that_was_never_started_cannot_be_answered(self, client: TestClient):
        response = client.post("/runs/run_nothing/approval", json={"approved": True})

        assert response.status_code == 404

    def test_an_answer_that_arrives_second_is_turned_down_not_broken(self):
        """두 사람이 같은 순간에 답하면 하나만 이긴다 — 진 쪽은 터지지 않고 409로 돌아온다."""
        client = TestClient(a_server(run_store=_AlreadyAnswered()))
        client.post("/specs", json=payload())
        start_a_run(client)

        response = client.post(f"/runs/{RUN_ID}/approval", json={"approved": True})

        assert response.status_code == 409


class TestListeningToARun:
    def test_the_stream_is_the_kind_a_browser_listens_to(self, client: TestClient):
        start_a_run(client)
        client.post(f"/runs/{RUN_ID}/approval", json={"approved": True})

        with client.stream("GET", f"/runs/{RUN_ID}/events") as stream:
            assert stream.headers["content-type"].startswith("text/event-stream")

    def test_every_event_is_sent_with_its_seq_as_the_id(self, client: TestClient):
        start_a_run(client)
        client.post(f"/runs/{RUN_ID}/approval", json={"approved": True})

        with client.stream("GET", f"/runs/{RUN_ID}/events") as stream:
            lines = list(stream.iter_lines())

        sent = frames(lines)
        assert ids(lines) == [f"id: {one['seq']}" for one in sent]
        assert sent[-1]["event_type"] == "run.completed"

    def test_the_stream_closes_itself_once_the_run_has_ended(self, client: TestClient):
        """끝난 실행은 더 보낼 것이 없다 — 스트림이 스스로 닫힌다 (읽기가 끝난다)."""
        start_a_run(client)
        client.post(f"/runs/{RUN_ID}/approval", json={"approved": True})

        with client.stream("GET", f"/runs/{RUN_ID}/events") as stream:
            lines = list(stream.iter_lines())

        assert frames(lines)[-1]["event_type"] == "run.completed"

    def test_coming_back_starts_after_what_was_already_read(self, client: TestClient):
        start_a_run(client)
        client.post(f"/runs/{RUN_ID}/approval", json={"approved": True})

        with client.stream(
            "GET", f"/runs/{RUN_ID}/events", headers={"Last-Event-ID": "20"}
        ) as stream:
            sent = frames(list(stream.iter_lines()))

        assert next(one["seq"] for one in sent) == 21

    def test_coming_back_after_the_last_event_closes_at_once(self, client: TestClient):
        """브라우저는 스트림이 닫히면 마지막 `id:`를 들고 곧바로 다시 온다 — 그때도 닫혀야 한다."""
        start_a_run(client)
        client.post(f"/runs/{RUN_ID}/approval", json={"approved": True})
        with client.stream("GET", f"/runs/{RUN_ID}/events") as stream:
            last = frames(list(stream.iter_lines()))[-1]["seq"]

        with client.stream(
            "GET", f"/runs/{RUN_ID}/events", headers={"Last-Event-ID": str(last)}
        ) as stream:
            assert frames(list(stream.iter_lines())) == []

        with client.stream("GET", f"/runs/{RUN_ID}/events?after={last}") as stream:
            assert frames(list(stream.iter_lines())) == []

    def test_the_query_can_say_where_to_carry_on_from(self, client: TestClient):
        start_a_run(client)
        client.post(f"/runs/{RUN_ID}/approval", json={"approved": True})

        with client.stream("GET", f"/runs/{RUN_ID}/events?after=20") as stream:
            sent = frames(list(stream.iter_lines()))

        assert next(one["seq"] for one in sent) == 21


def test_a_held_run_keeps_the_stream_open_and_carries_on_when_answered():
    """멈춰 선 실행의 스트림은 닫히지 않는다 — 사람이 답하면 그 자리에서 이어진다.

    진짜 서버를 띄워서 본다: 시험용 클라이언트는 답을 다 받고 나서야 돌려주므로
    '아직 끝나지 않은 스트림'을 볼 수 없다.
    """
    with a_live_server() as base:
        httpx.post(f"{base}/specs", json=payload(), timeout=PATIENCE)
        held = httpx.post(f"{base}/specs/{SPEC_ID}/runs", timeout=PATIENCE).json()
        assert held["status"] == "running"

        with httpx.stream(
            "GET", f"{base}/runs/{RUN_ID}/events", timeout=PATIENCE
        ) as stream:
            lines = stream.iter_lines()
            held = frames_until(lines, "run.paused")
            assert held[0]["event_type"] == "run.started"

            httpx.post(
                f"{base}/runs/{RUN_ID}/approval",
                json={"approved": True},
                timeout=PATIENCE,
            )

            carried_on = frames(list(lines))

    assert carried_on[0]["event_type"] == "run.resumed"
    assert carried_on[-1]["event_type"] == "run.completed"
