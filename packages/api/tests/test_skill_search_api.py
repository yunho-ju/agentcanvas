"""무엇을 잘하게 할까를 물으면 skill을 찾아 주는 문 (SK-4) — 바깥은 주입한다.

문서가 가진 skill은 여기 오지 않는다: 화면이 이미 알고 있으므로 서버는 시작 skill과
바깥 목록만 말하고, 앞에 합치는 일은 화면의 몫이다 (문서를 서버에 보내지 않는다).
"""

from __future__ import annotations

from agentcanvas_adapters.skill_search import RemoteUnavailable, SkillHit
from agentcanvas_api.app import create_app
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from fastapi.testclient import TestClient

OUTSIDE = SkillHit(
    name="plain-writing",
    description=None,
    origin="remote",
    url="https://skills.sh/acme/kit/plain-writing",
    installs=12_000,
    owner_repo="acme/kit",
)


def a_client(searches) -> TestClient:
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            searches_skills=searches,
        )
    )


def test_the_starter_skills_come_first_and_the_outside_follows():
    client = a_client(lambda _query: [OUTSIDE])

    answer = client.get("/skills/search", params={"q": "plain"})

    assert answer.status_code == 200
    found = answer.json()
    assert found["remote_reached"] is True
    assert [hit["origin"] for hit in found["hits"]] == ["starter", "remote"]
    assert found["hits"][0]["name"] == "plain-answer"
    assert found["hits"][1] == {
        "name": "plain-writing",
        "description": None,
        "origin": "remote",
        "url": "https://skills.sh/acme/kit/plain-writing",
        "installs": 12_000,
        "owner_repo": "acme/kit",
        "ref": None,
    }


def test_an_outside_we_could_not_reach_is_said_and_not_hidden():
    client = a_client(lambda _query: RemoteUnavailable(reason="timeout"))

    answer = client.get("/skills/search", params={"q": "plain"})

    assert answer.status_code == 200
    found = answer.json()
    assert found["remote_reached"] is False
    assert [hit["origin"] for hit in found["hits"]] == ["starter"]


def test_asking_nothing_is_not_a_question():
    asked: list[str] = []

    def searches(query: str) -> list[SkillHit]:
        asked.append(query)
        return []

    client = a_client(searches)

    assert client.get("/skills/search", params={"q": ""}).status_code == 422
    # 빈칸만 적은 것도 물음이 아니다 — 바깥에 빈 물음을 던지지 않는다.
    assert client.get("/skills/search", params={"q": "   "}).status_code == 422
    assert asked == []
