"""계약에 도구 자리가 생기면 canonical 내용이 달라진다 — 저장된 판의 revision을 맞춘다.

옛 파일을 그냥 열면 저장된 revision과 다시 센 값이 어긋나, 사람이 고칠 길 없이
architect 저장이 422로 막힌다. 마이그레이션은 그 어긋남을 파일 하나에서 끝낸다.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from agentcanvas_api.app import create_app
from agentcanvas_api.sqlite_database import CURRENT_SCHEMA_VERSION, prepare_database
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.revision import compute_revision
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)
SPEC_ID = "clinical-assistant"
PLAIN_SPEC_ID = "no-resources"
STORED_AT = "2026-08-01T00:00:00+00:00"


def example_spec() -> dict:
    return json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))


def before_tools(raw: dict) -> dict:
    """도구 자리가 생기기 전에 서버가 저장했을 모양 — 그 시절의 revision까지 그대로."""
    stored = AgentSpec.model_validate(raw).model_dump(mode="json")
    for resource in stored["resources"]:
        resource.pop("tools")
    stored["revision"] = compute_revision(stored)
    return stored


def without_resources(raw: dict) -> dict:
    """서버가 쓸 것이 없는 그래프 — 도구 자리가 생겨도 내용이 그대로다."""
    stored = AgentSpec.model_validate(
        {**raw, "id": PLAIN_SPEC_ID, "resources": []}
    ).model_dump(mode="json")
    stored["revision"] = compute_revision(stored)
    return stored


def _insert_spec(connection: sqlite3.Connection, stored: dict) -> None:
    connection.execute(
        "INSERT INTO spec_revisions"
        " (spec_id, version, revision, spec_json, created_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (
            stored["id"],
            stored["version"],
            stored["revision"],
            json.dumps(stored, ensure_ascii=False),
            STORED_AT,
        ),
    )


def a_database_from_before_tools(path: Path) -> dict[str, dict]:
    """도구 자리가 생기기 전 파일 하나 — 그래프 둘, 실행 둘, 배치 하나가 들어 있다."""
    prepare_database(path)
    old = before_tools(example_spec())
    plain = without_resources(example_spec())
    with sqlite3.connect(path) as connection:
        connection.execute(
            "DELETE FROM schema_migrations WHERE version = ?", (CURRENT_SCHEMA_VERSION,)
        )
        _insert_spec(connection, old)
        _insert_spec(connection, plain)
        connection.executemany(
            "INSERT INTO runs (run_id, spec_id, spec_revision, created_at)"
            " VALUES (?, ?, ?, ?)",
            [
                ("run_old", SPEC_ID, old["revision"], STORED_AT),
                ("run_plain", PLAIN_SPEC_ID, plain["revision"], STORED_AT),
            ],
        )
        connection.execute(
            "INSERT INTO eval_datasets (dataset_id, dataset_json) VALUES (?, ?)",
            (
                "greetings",
                json.dumps(
                    {
                        "id": "greetings",
                        "name": "Greetings",
                        "cases": [
                            {
                                "id": "greeting",
                                "title": "Greeting",
                                "input": {"question": "hi"},
                                "expected_phrases": ["hello"],
                                "runs_per_case": 1,
                                "passes_needed": 1,
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
            ),
        )
        connection.execute(
            "INSERT INTO eval_batches (batch_id, dataset_id, batch_json)"
            " VALUES (?, ?, ?)",
            (
                "batch_old",
                "greetings",
                json.dumps(
                    {
                        "id": "batch_old",
                        "dataset_id": "greetings",
                        "spec_id": SPEC_ID,
                        "spec_revision": old["revision"],
                        "started_at": datetime(2026, 8, 1, tzinfo=UTC).isoformat(),
                        "results": [],
                    },
                    ensure_ascii=False,
                ),
            ),
        )
    return {"old": old, "plain": plain}


def a_run_paused_before_the_upgrade(path: Path, spec_revision: str) -> None:
    """업그레이드 이전에 사람을 기다리며 멈춘 실행 — 기록은 그 시절의 판을 가리킨다."""
    events = [
        {
            "seq": 0,
            "run_id": "run_paused",
            "event_type": "run.started",
            "timestamp": "2026-08-01T00:00:00Z",
            "spec_revision": spec_revision,
            "payload": {},
        },
        {
            "seq": 1,
            "run_id": "run_paused",
            "event_type": "run.paused",
            "timestamp": "2026-08-01T00:00:01Z",
            "spec_revision": spec_revision,
            "node_id": "human-gate",
            "payload": {},
        },
    ]
    with sqlite3.connect(path) as connection:
        connection.execute(
            "INSERT INTO runs (run_id, spec_id, spec_revision, created_at)"
            " VALUES (?, ?, ?, ?)",
            ("run_paused", SPEC_ID, spec_revision, STORED_AT),
        )
        connection.executemany(
            "INSERT INTO run_events (run_id, seq, event_json) VALUES (?, ?, ?)",
            [
                ("run_paused", event["seq"], json.dumps(event, ensure_ascii=False))
                for event in events
            ],
        )


def test_a_run_paused_before_the_upgrade_says_why_it_cannot_carry_on(tmp_path: Path):
    """일어난 일은 역사다 — 다시 적지 않는다. 대신 이어 달릴 수 없다는 말을 사람이 듣는다."""
    database = tmp_path / "agentcanvas.db"
    before = a_database_from_before_tools(database)
    a_run_paused_before_the_upgrade(database, before["old"]["revision"])

    client = TestClient(create_app())
    answer = client.post("/runs/run_paused/approval", json={"approved": True})

    assert answer.status_code == 409
    assert "cannot carry on" in answer.json()["detail"]
    assert "another revision of the graph" in answer.json()["detail"]


def rows(path: Path, query: str) -> list[sqlite3.Row]:
    with sqlite3.connect(path) as connection:
        connection.row_factory = sqlite3.Row
        return connection.execute(query).fetchall()


def stored_spec(path: Path, spec_id: str) -> dict:
    (row,) = rows(
        path,
        f"SELECT revision, spec_json FROM spec_revisions WHERE spec_id = '{spec_id}'",
    )
    return {"revision": row["revision"], "spec": json.loads(row["spec_json"])}


def test_an_old_graph_is_stored_again_under_the_revision_it_computes_now(
    tmp_path: Path,
):
    database = tmp_path / "agentcanvas.db"
    before = a_database_from_before_tools(database)

    prepare_database(database)

    after = stored_spec(database, SPEC_ID)
    assert after["revision"] != before["old"]["revision"]
    assert (
        after["revision"] == AgentSpec.model_validate(after["spec"]).computed_revision()
    )
    assert after["spec"]["resources"][0]["tools"] == []


def test_a_graph_whose_content_did_not_change_is_left_alone(tmp_path: Path):
    """건드릴 까닭이 없는 판은 건드리지 않는다 — 쓸 것이 없는 그래프는 그대로다."""
    database = tmp_path / "agentcanvas.db"
    before = a_database_from_before_tools(database)

    prepare_database(database)

    after = stored_spec(database, PLAIN_SPEC_ID)
    assert after["revision"] == before["plain"]["revision"]
    assert after["spec"] == before["plain"]


def test_what_pointed_at_the_old_revision_points_at_the_new_one(tmp_path: Path):
    """저장된 문자열끼리의 대조가 계속 맞아야 한다 — 실행과 배치가 가리키는 판을 함께 옮긴다."""
    database = tmp_path / "agentcanvas.db"
    before = a_database_from_before_tools(database)

    prepare_database(database)

    new_revision = stored_spec(database, SPEC_ID)["revision"]
    runs = {
        row["run_id"]: row["spec_revision"]
        for row in rows(database, "SELECT * FROM runs")
    }
    assert runs["run_old"] == new_revision
    assert runs["run_plain"] == before["plain"]["revision"]
    (batch,) = rows(database, "SELECT batch_json FROM eval_batches")
    assert json.loads(batch["batch_json"])["spec_revision"] == new_revision


def test_opening_the_same_file_twice_changes_nothing_more(tmp_path: Path):
    database = tmp_path / "agentcanvas.db"
    a_database_from_before_tools(database)

    first = prepare_database(database)
    after_first = stored_spec(database, SPEC_ID)
    second = prepare_database(database)

    assert first.migrated is True
    assert second.migrated is False
    assert stored_spec(database, SPEC_ID) == after_first


def test_an_old_graph_can_be_changed_again_after_the_upgrade(tmp_path: Path):
    """리뷰가 재현한 자리 — 옛 파일을 연 뒤 architect가 그래프를 고칠 수 있어야 한다."""
    database = tmp_path / "agentcanvas.db"
    a_database_from_before_tools(database)

    client = TestClient(create_app())
    saved = client.get(f"/specs/{SPEC_ID}").json()["spec"]
    answer = client.put(
        f"/specs/{SPEC_ID}",
        json={**saved, "name": "임상 도우미"},
        headers={"If-Match": saved["revision"]},
    )

    assert answer.status_code == 200
    assert answer.json()["spec"]["version"] == saved["version"] + 1


def test_saving_the_same_graph_again_does_not_make_a_new_version(tmp_path: Path):
    """업그레이드 뒤 첫 저장이 내용이 같은데도 새 판을 만들면, 사람은 까닭 없는 판을 본다."""
    database = tmp_path / "agentcanvas.db"
    a_database_from_before_tools(database)

    client = TestClient(create_app())
    saved = client.get(f"/specs/{SPEC_ID}").json()["spec"]
    answer = client.put(
        f"/specs/{SPEC_ID}", json=saved, headers={"If-Match": saved["revision"]}
    )

    assert answer.status_code == 200
    assert answer.json()["spec"]["version"] == saved["version"]


def test_what_was_stored_before_the_upgrade_is_still_listed(tmp_path: Path):
    database = tmp_path / "agentcanvas.db"
    a_database_from_before_tools(database)

    client = TestClient(create_app())

    assert {row["id"] for row in client.get("/specs").json()["documents"]} == {
        PLAIN_SPEC_ID,
        SPEC_ID,
    }
    assert client.get("/runs/run_old").status_code == 200
    assert [
        batch["id"]
        for batch in client.get("/eval/datasets/greetings/batches").json()["batches"]
    ] == ["batch_old"]
