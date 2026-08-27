"""브라우저에서 오는 요청 — 스튜디오는 서버와 다른 자리에서 뜬다(포트부터 다르다).

브라우저는 다른 자리에서 온 요청을 서버가 허락했는지 먼저 묻고(preflight), 허락이 없으면
요청 자체를 보내지 않는다. curl은 묻지 않으므로 이 층은 curl로도 TestClient의 기본 호출로도
드러나지 않는다 — 그래서 여기서 따로 지킨다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_api.app import ALLOWED_ORIGINS_ENV, create_app
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)
STUDIO = "http://localhost:5173"
ELSEWHERE = "https://somewhere-else.example"


def payload() -> dict:
    return json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))


def server(**options) -> TestClient:
    return TestClient(
        create_app(store=InMemorySpecStore(), run_store=InMemoryRunStore(), **options)
    )


@pytest.fixture
def client() -> TestClient:
    return server()


def preflight(client: TestClient, origin: str, requested_headers: str = "content-type"):
    return client.options(
        "/specs",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": requested_headers,
        },
    )


def test_the_studio_may_ask_before_it_saves(client: TestClient):
    answer = preflight(client, STUDIO)

    assert answer.status_code == 200
    assert answer.headers["access-control-allow-origin"] == STUDIO


def test_the_studio_may_send_the_revision_guard_header(client: TestClient):
    answer = preflight(client, STUDIO, "content-type, if-match")

    assert answer.status_code == 200
    assert "if-match" in answer.headers["access-control-allow-headers"].lower()


def test_the_answer_to_a_save_carries_the_permission_too(client: TestClient):
    answer = client.post("/specs", json=payload(), headers={"Origin": STUDIO})

    assert answer.status_code == 201
    assert answer.headers["access-control-allow-origin"] == STUDIO


def test_reading_is_allowed_from_the_studio_as_well(client: TestClient):
    client.post("/specs", json=payload(), headers={"Origin": STUDIO})

    answer = client.get("/specs/clinical-assistant", headers={"Origin": STUDIO})

    assert answer.headers["access-control-allow-origin"] == STUDIO


def test_the_studio_may_listen_to_a_run_it_started(client: TestClient):
    """실행이 흘려보내는 이벤트도 다른 자리에서 듣는다 — 허락이 없으면 브라우저가 듣지 못한다."""
    client.post("/specs", json=payload(), headers={"Origin": STUDIO})
    run = client.post("/specs/clinical-assistant/runs").json()["run"]["id"]
    client.post(f"/runs/{run}/approval", json={"approved": True})

    with client.stream(
        "GET", f"/runs/{run}/events", headers={"Origin": STUDIO}
    ) as answer:
        assert answer.headers["access-control-allow-origin"] == STUDIO


def test_a_stranger_is_not_let_in(client: TestClient):
    answer = client.post("/specs", json=payload(), headers={"Origin": ELSEWHERE})

    assert "access-control-allow-origin" not in answer.headers


def test_the_door_is_never_left_open_to_everyone(client: TestClient):
    answer = preflight(client, STUDIO)

    assert answer.headers.get("access-control-allow-origin") != "*"


def test_the_list_of_allowed_places_can_be_handed_in():
    ours = "https://studio.example"
    client = server(allowed_origins=[ours])

    assert preflight(client, ours).headers["access-control-allow-origin"] == ours
    assert "access-control-allow-origin" not in preflight(client, STUDIO).headers


def test_the_list_can_come_from_the_place_the_server_runs(monkeypatch):
    one, other = "https://one.example", "https://other.example"
    monkeypatch.setenv(ALLOWED_ORIGINS_ENV, f"{one}, {other}")
    client = server()

    assert preflight(client, one).headers["access-control-allow-origin"] == one
    assert preflight(client, other).headers["access-control-allow-origin"] == other
    assert "access-control-allow-origin" not in preflight(client, ELSEWHERE).headers


def test_what_is_handed_in_wins_over_the_place_it_runs(monkeypatch):
    monkeypatch.setenv(ALLOWED_ORIGINS_ENV, "https://from-the-env.example")
    ours = "https://handed-in.example"
    client = server(allowed_origins=[ours])

    assert preflight(client, ours).headers["access-control-allow-origin"] == ours
    assert (
        "access-control-allow-origin"
        not in preflight(client, "https://from-the-env.example").headers
    )
