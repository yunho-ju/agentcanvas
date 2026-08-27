"""배치 평가 문들 — 데이터셋을 CRUD하고, 배치를 열고, 그 지금 모습을 듣는다.

실행 이름과 시계는 주입한다: 시험은 언제나 같은 답을 본다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from agentcanvas_api.app import create_app
from agentcanvas_api.memory_eval_batch_store import InMemoryEvalBatchStore
from agentcanvas_api.memory_eval_dataset_store import InMemoryEvalDatasetStore
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.run_service import Work, Worker
from fastapi.testclient import TestClient

STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)
SPEC_ID = "clinical-assistant"
EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)


def right_here(work: Work) -> None:
    """그 자리에서 곧장 하는 일꾼 — 시험은 배경을 기다리지 않고 결과를 본다."""
    work()


def spec_payload(**overrides) -> dict:
    import json

    raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    return {**raw, **overrides}


def a_dataset_payload(**overrides) -> dict:
    base = {
        "id": "greetings",
        "name": "인사 데이터셋",
        "cases": [
            {
                "id": "greeting",
                "title": "반갑다는 인사",
                "input": {"question": "hi"},
                "expected_phrases": ["hello"],
                "runs_per_case": 1,
                "passes_needed": 1,
            }
        ],
    }
    return {**base, **overrides}


class LaterWhenAsked:
    """맡기면 받아만 두는 일꾼 — 시킬 때까지 아무 일도 일어나지 않는다."""

    def __init__(self) -> None:
        self.taken: list[Work] = []

    def __call__(self, work: Work) -> None:
        self.taken.append(work)

    def get_on_with_it(self) -> None:
        for work in self.taken:
            work()
        self.taken = []


@pytest.fixture
def worker() -> Worker:
    return right_here


@pytest.fixture
def client(worker: Worker) -> TestClient:
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            eval_dataset_store=InMemoryEvalDatasetStore(),
            eval_batch_store=InMemoryEvalBatchStore(),
            clock=lambda: STARTED_AT,
            worker=worker,
        )
    )


def test_a_saved_dataset_round_trips_through_get(client: TestClient):
    posted = client.post("/eval/datasets", json=a_dataset_payload())
    assert posted.status_code == 201

    got = client.get("/eval/datasets/greetings")

    assert got.status_code == 200
    assert got.json()["name"] == "인사 데이터셋"


def test_a_dataset_shows_up_in_the_list(client: TestClient):
    client.post("/eval/datasets", json=a_dataset_payload())

    listed = client.get("/eval/datasets")

    assert listed.status_code == 200
    assert [entry["id"] for entry in listed.json()] == ["greetings"]
    assert listed.json()[0]["case_count"] == 1


def test_put_updates_a_saved_dataset(client: TestClient):
    client.post("/eval/datasets", json=a_dataset_payload())

    updated = client.put(
        "/eval/datasets/greetings", json=a_dataset_payload(name="고친 이름")
    )

    assert updated.status_code == 200
    assert client.get("/eval/datasets/greetings").json()["name"] == "고친 이름"


def test_delete_removes_a_saved_dataset(client: TestClient):
    client.post("/eval/datasets", json=a_dataset_payload())

    deleted = client.delete("/eval/datasets/greetings")

    assert deleted.status_code == 204
    assert client.get("/eval/datasets/greetings").status_code == 404


def test_reading_an_unknown_dataset_is_404(client: TestClient):
    """B8: 없는 데이터셋."""
    assert client.get("/eval/datasets/nobody-here").status_code == 404


def test_starting_a_batch_on_an_unknown_dataset_is_404(client: TestClient):
    """B8: 없는 데이터셋으로 배치를 시작할 수 없다."""
    client.post("/specs", json=spec_payload())
    spec = client.get(f"/specs/{SPEC_ID}").json()["spec"]

    response = client.post(
        "/eval/datasets/nobody-here/batches",
        json={
            "spec_id": SPEC_ID,
            "spec_revision": spec["revision"],
        },
    )

    assert response.status_code == 404


def test_starting_a_batch_on_an_unknown_spec_is_404(client: TestClient):
    """B8: 없는 그래프로 배치를 시작할 수 없다."""
    client.post("/eval/datasets", json=a_dataset_payload())

    response = client.post(
        "/eval/datasets/greetings/batches",
        json={
            "spec_id": "nobody-here",
            "spec_revision": "sha256:" + "0" * 64,
        },
    )

    assert response.status_code == 404


def test_a_batch_not_yet_finished_reads_as_running_then_reads_as_completed():
    """B9: 완결 전 GET batch는 running 표시, 완결 후 GET은 저장된 EvalBatch다."""
    later = LaterWhenAsked()
    client = TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            eval_dataset_store=InMemoryEvalDatasetStore(),
            eval_batch_store=InMemoryEvalBatchStore(),
            clock=lambda: STARTED_AT,
            worker=later,
        )
    )
    client.post("/specs", json=spec_payload())
    spec = client.get(f"/specs/{SPEC_ID}").json()["spec"]
    client.post("/eval/datasets", json=a_dataset_payload())

    started = client.post(
        "/eval/datasets/greetings/batches",
        json={
            "spec_id": SPEC_ID,
            "spec_revision": spec["revision"],
        },
    )
    assert started.status_code == 202
    batch_id = started.json()["batch_id"]

    running = client.get(f"/eval/batches/{batch_id}")
    assert running.status_code == 200
    assert running.json()["status"] == "running"
    assert running.json()["batch"] is None

    later.get_on_with_it()

    completed = client.get(f"/eval/batches/{batch_id}")
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"
    assert completed.json()["batch"]["id"] == batch_id
    assert completed.json()["batch"]["dataset_id"] == "greetings"


def test_reading_an_unknown_batch_is_404(client: TestClient):
    assert client.get("/eval/batches/nobody-here").status_code == 404


def test_listing_batches_for_a_dataset_is_a_summary_with_has_more(client: TestClient):
    """minor 6: 목록은 output_text 전문이 없는 요약이고, has_more를 함께 센다."""
    client.post("/specs", json=spec_payload())
    spec = client.get(f"/specs/{SPEC_ID}").json()["spec"]
    client.post("/eval/datasets", json=a_dataset_payload())

    started = client.post(
        "/eval/datasets/greetings/batches",
        json={
            "spec_id": SPEC_ID,
            "spec_revision": spec["revision"],
        },
    )
    batch_id = started.json()["batch_id"]

    listed = client.get("/eval/datasets/greetings/batches")

    assert listed.status_code == 200
    body = listed.json()
    assert [batch["id"] for batch in body["batches"]] == [batch_id]
    assert body["has_more"] is False
    assert "results" not in body["batches"][0]


def test_listing_batches_for_an_unknown_dataset_is_404(client: TestClient):
    assert client.get("/eval/datasets/nobody-here/batches").status_code == 404


class BreaksWhileSaving:
    """배경에서 배치를 저장하다 어그러지는 저장소 — 조회가 running인 척 영영 기다리게 하지 않는다."""

    def save(self, batch) -> None:
        raise RuntimeError("the disk went away")

    def get(self, batch_id: str):
        return None

    def list_for_dataset(self, dataset_id: str, limit: int | None = None) -> list:
        return []


def test_a_batch_that_breaks_while_saving_reads_as_failed():
    """major 1: 배경에서 죽은 배치는 running인 척하지 않고, 조회가 실패를 말한다."""
    later = LaterWhenAsked()
    client = TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            eval_dataset_store=InMemoryEvalDatasetStore(),
            eval_batch_store=BreaksWhileSaving(),
            clock=lambda: STARTED_AT,
            worker=later,
        )
    )
    client.post("/specs", json=spec_payload())
    spec = client.get(f"/specs/{SPEC_ID}").json()["spec"]
    client.post("/eval/datasets", json=a_dataset_payload())

    started = client.post(
        "/eval/datasets/greetings/batches",
        json={"spec_id": SPEC_ID, "spec_revision": spec["revision"]},
    )
    batch_id = started.json()["batch_id"]

    later.get_on_with_it()

    failed = client.get(f"/eval/batches/{batch_id}")
    assert failed.status_code == 200
    assert failed.json()["status"] == "failed"
    assert failed.json()["message"]
