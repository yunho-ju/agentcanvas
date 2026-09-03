"""주소 하나를 주면 SKILL.md 원문을 돌려주는 문 (SK-3) — 그물은 주입한다."""

from __future__ import annotations

from agentcanvas_adapters.skill_fetch import Fetched, FetchFailed, FetchRequest
from agentcanvas_api.app import create_app
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from fastapi.testclient import TestClient

SKILL = "---\nname: plain-answer\ndescription: use it\n---\n\nAnswer plainly.\n"
RAW = "https://raw.githubusercontent.com/acme/kit/main/skills/plain-answer/SKILL.md"


def a_client(gets) -> TestClient:
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            gets_a_page=gets,
        )
    )


def answers(pages: dict[str, str]):
    def gets(request: FetchRequest) -> Fetched:
        text = pages.get(request.url)
        return Fetched(status_code=200, text=text) if text else Fetched(404, "")

    return gets


def test_an_address_gives_back_the_text_and_where_it_came_from():
    client = a_client(answers({RAW: SKILL}))

    answer = client.get("/skills/fetch", params={"url": RAW})

    assert answer.status_code == 200
    assert answer.json() == {"text": SKILL}


def test_a_skills_sh_address_is_read_from_the_repository_it_names():
    client = a_client(answers({RAW: SKILL}))

    answer = client.get(
        "/skills/fetch", params={"url": "https://skills.sh/acme/kit/plain-answer"}
    )

    assert answer.status_code == 200
    assert answer.json() == {"text": SKILL}


def test_an_address_we_do_not_call_is_refused_with_a_code_the_screen_knows():
    asked: list[str] = []

    def gets(request: FetchRequest) -> Fetched:
        asked.append(request.url)
        return Fetched(200, SKILL)

    client = a_client(gets)

    answer = client.get("/skills/fetch", params={"url": "https://example.com/SKILL.md"})

    assert answer.status_code == 400
    assert answer.json()["detail"] == "skill.fetch.host"
    assert asked == []


def test_nothing_at_that_address_says_so():
    client = a_client(answers({}))

    answer = client.get(
        "/skills/fetch", params={"url": "https://skills.sh/acme/kit/plain-answer"}
    )

    assert answer.status_code == 404
    assert answer.json()["detail"] == "skill.fetch.notfound"


def test_a_file_bigger_than_we_carry_says_so():
    client = a_client(answers({RAW: "x" * (256 * 1024 + 1)}))

    answer = client.get("/skills/fetch", params={"url": RAW})

    assert answer.status_code == 413
    assert answer.json()["detail"] == "skill.fetch.toolarge"


def test_an_address_that_does_not_answer_in_time_says_so():
    def gets(_request: FetchRequest) -> FetchFailed:
        return FetchFailed(reason="timeout", message="the call timed out")

    client = a_client(gets)

    answer = client.get("/skills/fetch", params={"url": RAW})

    assert answer.status_code == 504
    assert answer.json()["detail"] == "skill.fetch.timeout"
    # 저쪽이 보낸 말은 화면으로 나가지 않는다 — 코드 하나만 건넨다.
    assert "timed out" not in answer.text
