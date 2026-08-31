"""그래프를 저장하는 최초의 서버 — 판 번호와 revision의 권위는 서버에 있다.

저장은 벌주지 않는다: 아직 손볼 곳이 있어도 저장되고, 무엇이 걸렸는지 함께 돌려준다.
계약을 어긴 것(파싱 불가)만 거절한다 — 그것은 데이터가 아니다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from agentcanvas_api.app import create_app
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.service import LIST_LIMIT
from agentcanvas_contracts.agent_spec import AgentSpec
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)
SPEC_ID = "clinical-assistant"


def payload(**overrides) -> dict:
    raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    return {**raw, **overrides}


class Ticking:
    """한 걸음에 1분씩 가는 시계 — 시간은 밖에서 주입한다."""

    def __init__(self) -> None:
        self.steps = 0

    def __call__(self) -> datetime:
        now = datetime(2026, 8, 1, 12, 30, tzinfo=UTC) + timedelta(minutes=self.steps)
        self.steps += 1
        return now


@pytest.fixture
def client() -> TestClient:
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            clock=Ticking(),
        )
    )


def revision_of(body: dict) -> str:
    """서버가 돌려준 그래프가 스스로와 들어맞는가 — 계약이 정한 그 값인가."""
    return AgentSpec.model_validate(body["spec"]).computed_revision()


def test_saving_a_new_graph_starts_at_version_one(client: TestClient):
    response = client.post("/specs", json=payload())

    assert response.status_code == 201
    body = response.json()
    assert body["spec"]["version"] == 1
    assert body["spec"]["revision"] == revision_of(body)
    assert body["issues"] == []


def test_a_saved_graph_can_be_read_back(client: TestClient):
    client.post("/specs", json=payload(name="임상 도우미"))

    response = client.get(f"/specs/{SPEC_ID}")

    assert response.status_code == 200
    assert response.json()["spec"]["name"] == "임상 도우미"


def test_reading_a_graph_says_what_still_needs_work(client: TestClient):
    """조회도 저장과 같은 봉투다 — 손볼 곳은 읽는 순간 다시 재어 준다."""
    unfinished = payload()
    unfinished["nodes"][1]["type"] = "llm.unheard-of"
    saved = client.post("/specs", json=unfinished).json()

    body = client.get(f"/specs/{SPEC_ID}").json()

    assert body["spec"] == saved["spec"]
    assert body["issues"] == saved["issues"]
    assert any("llm.unheard-of" in issue["message"] for issue in body["issues"])


def test_a_graph_that_still_needs_work_is_saved_all_the_same(client: TestClient):
    unfinished = payload()
    unfinished["nodes"][1]["type"] = "llm.unheard-of"

    response = client.post("/specs", json=unfinished)

    assert response.status_code == 201
    issues = response.json()["issues"]
    assert issues != []
    assert any("llm.unheard-of" in issue["message"] for issue in issues)
    assert client.get(f"/specs/{SPEC_ID}").status_code == 200


def test_a_broken_contract_is_refused_and_nothing_is_saved(client: TestClient):
    broken = payload()
    del broken["state_schema"]

    response = client.post("/specs", json=broken)

    assert response.status_code == 422
    assert "state_schema" in json.dumps(response.json())
    assert client.get(f"/specs/{SPEC_ID}").status_code == 404


def test_the_revision_the_client_sends_is_not_believed(client: TestClient):
    made_up = "sha256:" + "0" * 64

    body = client.post("/specs", json=payload(revision=made_up, version=99)).json()

    assert body["spec"]["revision"] != made_up
    assert body["spec"]["revision"] == revision_of(body)
    assert body["spec"]["version"] == 1


def test_changing_a_graph_makes_the_next_version(client: TestClient):
    first = client.post("/specs", json=payload()).json()

    response = client.put(
        f"/specs/{SPEC_ID}",
        headers={"If-Match": first["spec"]["revision"]},
        json=payload(name="고친 판"),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["spec"]["version"] == 2
    assert body["spec"]["revision"] != first["spec"]["revision"]
    assert body["spec"]["revision"] == revision_of(body)


def test_the_old_version_is_still_in_the_history(client: TestClient):
    first = client.post("/specs", json=payload()).json()
    second = client.put(
        f"/specs/{SPEC_ID}",
        headers={"If-Match": first["spec"]["revision"]},
        json=payload(name="고친 판"),
    ).json()

    history = client.get(f"/specs/{SPEC_ID}/revisions").json()["revisions"]

    assert [entry["version"] for entry in history] == [2, 1]
    assert [entry["revision"] for entry in history] == [
        second["spec"]["revision"],
        first["spec"]["revision"],
    ]
    assert history[0]["created_at"] > history[1]["created_at"]


def test_a_past_revision_can_be_read_back_whole(client: TestClient):
    """지나간 판도 그대로 읽힌다 — 대화가 어느 판과 오갔는지 화면이 열어 볼 수 있어야 한다."""
    first = client.post("/specs", json=payload()).json()["spec"]
    client.put(
        f"/specs/{SPEC_ID}",
        headers={"If-Match": first["revision"]},
        json=payload(name="고친 판"),
    )

    response = client.get(f"/specs/{SPEC_ID}/revisions/{first['revision']}")

    assert response.status_code == 200
    assert response.json()["spec"] == first
    assert response.json()["issues"] == client.get(f"/specs/{SPEC_ID}").json()["issues"]


def test_a_revision_nobody_saved_is_not_there(client: TestClient):
    client.post("/specs", json=payload())

    response = client.get(f"/specs/{SPEC_ID}/revisions/sha256:{'0' * 64}")

    assert response.status_code == 404


def test_a_revision_of_a_graph_nobody_saved_is_not_there(client: TestClient):
    response = client.get(f"/specs/nowhere/revisions/sha256:{'0' * 64}")

    assert response.status_code == 404


def test_saving_the_same_thing_again_changes_nothing(client: TestClient):
    first = client.post("/specs", json=payload()).json()

    again = client.put(
        f"/specs/{SPEC_ID}",
        headers={"If-Match": first["spec"]["revision"]},
        json=payload(),
    ).json()

    assert again["spec"]["version"] == first["spec"]["version"]
    assert again["spec"]["revision"] == first["spec"]["revision"]
    assert len(client.get(f"/specs/{SPEC_ID}/revisions").json()["revisions"]) == 1


def test_saving_the_same_thing_the_server_returned_changes_nothing(client: TestClient):
    saved = client.post("/specs", json=payload()).json()["spec"]

    again = client.put(
        f"/specs/{SPEC_ID}",
        headers={"If-Match": saved["revision"]},
        json=saved,
    ).json()

    assert again["spec"]["version"] == 1
    assert len(client.get(f"/specs/{SPEC_ID}/revisions").json()["revisions"]) == 1


def test_reading_a_graph_nobody_saved(client: TestClient):
    assert client.get("/specs/nowhere").status_code == 404
    assert client.get("/specs/nowhere/revisions").status_code == 404


def test_changing_a_graph_nobody_saved(client: TestClient):
    response = client.put("/specs/nowhere", json=payload(id="nowhere"))

    assert response.status_code == 404


def test_changing_a_graph_without_the_latest_revision_is_required(client: TestClient):
    first = client.post("/specs", json=payload()).json()

    response = client.put(f"/specs/{SPEC_ID}", json=payload(name="기준 없음"))

    assert response.status_code == 428
    assert client.get(f"/specs/{SPEC_ID}").json()["spec"] == first["spec"]
    assert len(client.get(f"/specs/{SPEC_ID}/revisions").json()["revisions"]) == 1


def test_two_clients_cannot_overwrite_the_same_base_revision(client: TestClient):
    first = client.post("/specs", json=payload()).json()
    peer = TestClient(client.app)
    expected = {"If-Match": first["spec"]["revision"]}

    winner = client.put(
        f"/specs/{SPEC_ID}", headers=expected, json=payload(name="먼저 저장")
    )
    loser = peer.put(
        f"/specs/{SPEC_ID}", headers=expected, json=payload(name="나중 저장")
    )

    assert winner.status_code == 200
    assert loser.status_code == 409
    assert client.get(f"/specs/{SPEC_ID}").json()["spec"]["name"] == "먼저 저장"
    assert [
        entry["version"]
        for entry in client.get(f"/specs/{SPEC_ID}/revisions").json()["revisions"]
    ] == [2, 1]


def test_saving_over_a_graph_that_is_already_there_is_refused(client: TestClient):
    client.post("/specs", json=payload())

    response = client.post("/specs", json=payload(name="다른 이름"))

    assert response.status_code == 409
    assert client.get(f"/specs/{SPEC_ID}").json()["spec"]["name"] is None


def test_the_graph_in_the_body_decides_which_graph_is_changed(client: TestClient):
    client.post("/specs", json=payload())

    response = client.put(f"/specs/{SPEC_ID}", json=payload(id="another"))

    assert response.status_code == 409


def test_the_history_of_a_graph_saved_once(client: TestClient):
    body = client.post("/specs", json=payload()).json()

    history = client.get(f"/specs/{SPEC_ID}/revisions").json()["revisions"]

    assert history == [
        {
            "version": 1,
            "revision": body["spec"]["revision"],
            "created_at": "2026-08-01T12:30:00Z",
        }
    ]


def test_nobody_has_saved_anything_yet(client: TestClient):
    """아직 아무것도 저장하지 않았으면 빈 목록이다 — 없는 것은 404가 아니다."""
    response = client.get("/specs")

    assert response.status_code == 200
    assert response.json() == {"documents": [], "has_more": False}


def test_the_list_says_what_each_saved_graph_is_called_now(client: TestClient):
    first = client.post("/specs", json=payload(name="임상 도우미")).json()
    later = client.put(
        f"/specs/{SPEC_ID}",
        headers={"If-Match": first["spec"]["revision"]},
        json=payload(name="고친 이름"),
    ).json()

    listed = client.get("/specs").json()

    assert listed["has_more"] is False
    assert listed["documents"] == [
        {
            "id": SPEC_ID,
            "name": "고친 이름",
            "version": 2,
            "revision": later["spec"]["revision"],
            "saved_at": "2026-08-01T12:31:00Z",
        }
    ]


def test_the_list_puts_the_one_saved_last_first(client: TestClient):
    client.post("/specs", json=payload())
    client.post("/specs", json=payload(id="second", name="나중 것"))

    listed = client.get("/specs").json()

    assert [entry["id"] for entry in listed["documents"]] == ["second", SPEC_ID]


def test_a_graph_with_no_name_is_listed_without_one(client: TestClient):
    client.post("/specs", json=payload())

    assert client.get("/specs").json()["documents"][0]["name"] is None


def save_many(client: TestClient, how_many: int) -> None:
    for number in range(how_many):
        assert (
            client.post("/specs", json=payload(id=f"doc-{number:03d}")).status_code
            == 201
        )


def test_the_list_stops_at_the_limit_and_says_more_is_waiting(client: TestClient):
    """오래된 문서까지 다 실어 보내지 않는다 — 잘렸다는 사실은 서버가 말해 준다."""
    save_many(client, LIST_LIMIT + 1)

    listed = client.get("/specs").json()

    assert len(listed["documents"]) == LIST_LIMIT
    assert listed["has_more"] is True
    assert listed["documents"][0]["id"] == f"doc-{LIST_LIMIT:03d}"


def test_a_list_that_exactly_fills_the_limit_is_not_cut_off(client: TestClient):
    """딱 상한만큼 저장돼 있으면 잘린 것이 없다 — 없는 것을 있다고 말하지 않는다."""
    save_many(client, LIST_LIMIT)

    listed = client.get("/specs").json()

    assert len(listed["documents"]) == LIST_LIMIT
    assert listed["has_more"] is False


def test_a_server_that_writes_to_a_file_still_knows_it_after_a_restart(tmp_path: Path):
    """프로세스가 죽었다 살아나도 저장한 것은 그대로 있다."""
    from agentcanvas_api.sqlite_store import SqliteSpecStore

    path = tmp_path / "specs.db"
    saved = TestClient(
        create_app(
            store=SqliteSpecStore(path),
            run_store=InMemoryRunStore(),
            clock=Ticking(),
        )
    ).post("/specs", json=payload(name="임상 도우미"))
    assert saved.status_code == 201

    restarted = TestClient(
        create_app(
            store=SqliteSpecStore(path),
            run_store=InMemoryRunStore(),
            clock=Ticking(),
        )
    )

    assert restarted.get(f"/specs/{SPEC_ID}").json() == saved.json()
    assert len(restarted.get(f"/specs/{SPEC_ID}/revisions").json()["revisions"]) == 1


def test_reading_the_server_module_writes_nothing_to_disk(tmp_path: Path, monkeypatch):
    """서버를 불러 읽는 것만으로 파일이 생기지 않는다 — 저장은 띄울 때 시작된다."""
    import importlib

    import agentcanvas_api.app as server

    monkeypatch.chdir(tmp_path)
    importlib.reload(server)

    assert list(tmp_path.iterdir()) == []


def test_saving_an_unfinished_graph_again_still_says_what_is_unfinished(
    client: TestClient,
):
    """달라진 것이 없어 새 판을 만들지 않아도, 아직 손볼 곳은 그대로 일러 준다."""
    unfinished = payload()
    unfinished["nodes"][1]["type"] = "llm.unheard-of"
    first = client.post("/specs", json=unfinished).json()

    again = client.put(
        f"/specs/{SPEC_ID}",
        headers={"If-Match": first["spec"]["revision"]},
        json=unfinished,
    ).json()

    assert again["spec"]["version"] == 1
    assert again["issues"] == first["issues"]
    assert any("llm.unheard-of" in issue["message"] for issue in again["issues"])


def test_the_answer_the_server_gives_is_the_recorded_shape(client: TestClient):
    """서버가 돌려주는 모양을 파일 하나에 못 박는다 — 프론트의 가짜 서버도 이 모양을 흉내 낸다."""
    recorded = json.loads(
        (EXAMPLE_PATH.parent / "saved_spec.json").read_text(encoding="utf-8")
    )
    body = client.post("/specs", json=payload()).json()

    assert body["spec"] == {
        **recorded,
        "version": 1,
        "revision": body["spec"]["revision"],
    }
    assert body["spec"]["edges"][0]["condition"] is None
    assert body["spec"]["name"] is None


# --- 게시 (CHAT-2) — 저장 판과 게시 판은 다른 축, 화면 밖에서도 그 둘이 갈린다 -------


def revision_now(client: TestClient, spec_id: str = SPEC_ID) -> str:
    return client.get(f"/specs/{spec_id}").json()["spec"]["revision"]


def test_no_publication_before_a_graph_is_published(client: TestClient):
    client.post("/specs", json=payload())

    response = client.get(f"/specs/{SPEC_ID}/publication")

    assert response.status_code == 200
    assert response.json() is None


def test_publishing_points_at_the_saved_revision(client: TestClient):
    client.post("/specs", json=payload())
    revision = revision_now(client)

    response = client.post(f"/specs/{SPEC_ID}/publish")

    assert response.status_code == 200
    body = response.json()
    assert body["spec_id"] == SPEC_ID
    assert body["revision"] == revision
    assert client.get(f"/specs/{SPEC_ID}/publication").json()["revision"] == revision


def test_publishing_a_graph_that_was_never_saved_is_refused(client: TestClient):
    response = client.post("/specs/ghost/publish")

    assert response.status_code == 404


def test_publishing_a_revision_that_was_never_saved_is_refused(client: TestClient):
    client.post("/specs", json=payload())

    response = client.post(
        f"/specs/{SPEC_ID}/publish", json={"revision": "sha256:" + "0" * 64}
    )

    assert response.status_code == 404
    assert client.get(f"/specs/{SPEC_ID}/publication").json() is None


def test_a_published_pointer_stays_put_when_the_canvas_moves_on(client: TestClient):
    client.post("/specs", json=payload(name="처음"))
    first_revision = revision_now(client)
    client.post(f"/specs/{SPEC_ID}/publish")

    client.put(
        f"/specs/{SPEC_ID}",
        json=payload(name="나중"),
        headers={"If-Match": first_revision},
    )

    assert client.get(f"/specs/{SPEC_ID}/publication").json()["revision"] == (
        first_revision
    )
    assert revision_now(client) != first_revision


def test_unpublishing_removes_the_pointer(client: TestClient):
    client.post("/specs", json=payload())
    client.post(f"/specs/{SPEC_ID}/publish")

    response = client.delete(f"/specs/{SPEC_ID}/publish")

    assert response.status_code == 204
    assert client.get(f"/specs/{SPEC_ID}/publication").json() is None


def test_publishing_does_not_rewrite_the_saved_graph(client: TestClient):
    """게시는 별도 pointer일 뿐 — 과거 판의 spec_json·상태를 고쳐 쓰지 않는다(append-only)."""
    before = client.post("/specs", json=payload()).json()["spec"]
    revisions_before = client.get(f"/specs/{SPEC_ID}/revisions").json()["revisions"]

    client.post(f"/specs/{SPEC_ID}/publish")

    after = client.get(f"/specs/{SPEC_ID}").json()["spec"]
    assert after == before
    assert client.get(f"/specs/{SPEC_ID}/revisions").json()["revisions"] == (
        revisions_before
    )
