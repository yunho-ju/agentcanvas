from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from agentcanvas_api.app import create_app
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.sqlite_job_store import SqliteJobStore
from agentcanvas_engine.model_call import ModelAsk, ModelSaid
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)
SPEC_ID = "clinical-assistant"


def spec_payload(**overrides: object) -> dict[str, object]:
    raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    return {**raw, **overrides}


def dataset_payload(**overrides: object) -> dict[str, object]:
    base = {
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
    }
    return {**base, **overrides}


def says_hello(_ask: ModelAsk) -> ModelSaid:
    return ModelSaid(input_tokens=1, output_tokens=1, text="hello")


def routes_to_gate(ask: ModelAsk) -> ModelSaid:
    if ask.ways:
        return ModelSaid(
            input_tokens=1,
            output_tokens=1,
            way=ask.ways[0],
            text=json.dumps({"way": ask.ways[0]}),
        )
    return says_hello(ask)


def wait_until(predicate, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("durable API did not converge in time")


class PausedClaimJobStore(SqliteJobStore):
    """Lifespan worker는 살아 있지만 claim만 멈춰 deterministic queue를 만든다."""

    def claim(self, _owner: str, _now: datetime, _lease_expires_at: datetime):
        return None


def test_http_idempotency_replays_original_run_and_eval_after_source_changes(
    tmp_path: Path,
):
    with TestClient(create_app(model=says_hello)) as client:
        assert client.get("/health/ready").status_code == 200
        saved = client.post("/specs", json=spec_payload()).json()["spec"]
        run_headers = {"Idempotency-Key": "run-command"}
        run_body = {"input": {"question": "hello"}}
        first_run = client.post(
            f"/specs/{SPEC_ID}/runs", json=run_body, headers=run_headers
        )
        assert first_run.status_code == 201

        updated = client.put(
            f"/specs/{SPEC_ID}",
            headers={"If-Match": saved["revision"]},
            json=spec_payload(name="Updated graph"),
        )
        assert updated.status_code == 200
        replayed_run = client.post(
            f"/specs/{SPEC_ID}/runs", json=run_body, headers=run_headers
        )
        assert replayed_run.status_code == 201
        assert replayed_run.json()["run"]["id"] == first_run.json()["run"]["id"]
        conflict = client.post(
            f"/specs/{SPEC_ID}/runs",
            json={"input": {"question": "different"}},
            headers=run_headers,
        )
        assert conflict.status_code == 409
        assert "idempotency key" in conflict.json()["detail"]

        current_revision = updated.json()["spec"]["revision"]
        assert client.post("/eval/datasets", json=dataset_payload()).status_code == 201
        eval_headers = {"Idempotency-Key": "eval-command"}
        eval_body = {"spec_id": SPEC_ID, "spec_revision": current_revision}
        first_eval = client.post(
            "/eval/datasets/greetings/batches",
            json=eval_body,
            headers=eval_headers,
        )
        assert first_eval.status_code == 202

        assert (
            client.put(
                "/eval/datasets/greetings",
                json=dataset_payload(name="Updated dataset"),
            ).status_code
            == 200
        )
        replayed_eval = client.post(
            "/eval/datasets/greetings/batches",
            json=eval_body,
            headers=eval_headers,
        )
        assert replayed_eval.status_code == 202
        assert replayed_eval.json()["batch_id"] == first_eval.json()["batch_id"]
        eval_conflict = client.post(
            "/eval/datasets/greetings/batches",
            json={**eval_body, "spec_revision": "sha256:" + "0" * 64},
            headers=eval_headers,
        )
        assert eval_conflict.status_code == 409
        assert "idempotency key" in eval_conflict.json()["detail"]


def test_new_app_lifespan_reclaims_an_expired_job_from_the_same_database(
    tmp_path: Path,
):
    path = tmp_path / "agentcanvas.db"
    paused_jobs = PausedClaimJobStore(path)
    with TestClient(create_app(job_store=paused_jobs, model=says_hello)) as client:
        client.post("/specs", json=spec_payload())
        accepted = client.post(
            f"/specs/{SPEC_ID}/runs",
            headers={"Idempotency-Key": "restart-command"},
        )
        assert accepted.status_code == 201
        run_id = accepted.json()["run"]["id"]
        assert accepted.json()["status"] == "running"

    jobs = SqliteJobStore(path)
    now = datetime.now(UTC)
    abandoned = jobs.claim(
        "dead-worker",
        now,
        now - timedelta(seconds=1),
    )
    assert abandoned is not None

    with TestClient(create_app(model=says_hello)) as restarted:
        assert restarted.get("/health/ready").status_code == 200
        wait_until(
            lambda: jobs.latest_for_reference("run", run_id).status == "succeeded"
        )
        assert restarted.get(f"/runs/{run_id}").json()["status"] in {
            "paused",
            "completed",
        }

    assert jobs.latest_for_reference("run", run_id).attempt == 2


def test_run_and_eval_cancellation_routes_survive_an_app_restart(tmp_path: Path):
    path = tmp_path / "agentcanvas.db"
    jobs = PausedClaimJobStore(path)
    with TestClient(create_app(job_store=jobs, model=says_hello)) as client:
        saved = client.post("/specs", json=spec_payload()).json()["spec"]
        run = client.post(
            f"/specs/{SPEC_ID}/runs",
            headers={"Idempotency-Key": "cancel-run"},
        ).json()
        run_id = run["run"]["id"]
        cancelled_run = client.post(f"/runs/{run_id}/cancel")
        assert cancelled_run.status_code == 200
        assert cancelled_run.json()["status"] == "failed"

        client.post("/eval/datasets", json=dataset_payload())
        eval_started = client.post(
            "/eval/datasets/greetings/batches",
            json={"spec_id": SPEC_ID, "spec_revision": saved["revision"]},
            headers={"Idempotency-Key": "cancel-eval"},
        ).json()
        batch_id = eval_started["batch_id"]
        cancelled_eval = client.post(f"/eval/batches/{batch_id}/cancel")
        assert cancelled_eval.status_code == 200
        assert cancelled_eval.json()["status"] == "failed"

    with TestClient(create_app(model=says_hello)) as restarted:
        assert restarted.get(f"/runs/{run_id}").json()["status"] == "failed"
        assert restarted.get(f"/eval/batches/{batch_id}").json()["status"] == "failed"

    persisted = SqliteJobStore(path)
    assert persisted.latest_for_reference("run", run_id).status == "cancelled"
    assert persisted.latest_for_reference("eval", batch_id).status == "cancelled"


def test_a_naturally_paused_run_can_be_cancelled(tmp_path: Path):
    path = tmp_path / "agentcanvas.db"
    with TestClient(create_app(model=routes_to_gate)) as client:
        client.post("/specs", json=spec_payload())
        accepted = client.post(
            f"/specs/{SPEC_ID}/runs",
            headers={"Idempotency-Key": "pause-then-cancel"},
        )
        run_id = accepted.json()["run"]["id"]
        wait_until(lambda: client.get(f"/runs/{run_id}").json()["status"] == "paused")

        cancelled = client.post(f"/runs/{run_id}/cancel")

        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "failed"

    job = SqliteJobStore(path).latest_for_reference("run", run_id)
    assert job is not None
    assert job.status == "cancelled"


def a_run_id(client: TestClient, key: str) -> str:
    """같은 요청을 같은 열쇠로 다시 보냈을 때 무엇이 돌아오는지 본다."""
    accepted = client.post(
        f"/specs/{SPEC_ID}/runs",
        json={"input": {"question": "hello"}},
        headers={"Idempotency-Key": key},
    )
    assert accepted.status_code == 201
    return str(accepted.json()["run"]["id"])


def test_durability_is_asked_for_explicitly_and_stays_on():
    with TestClient(create_app(model=says_hello, durability=True)) as client:
        client.post("/specs", json=spec_payload())

        assert a_run_id(client, "asked-for") == a_run_id(client, "asked-for")


def test_durability_that_cannot_be_honoured_refuses_to_start():
    with pytest.raises(RuntimeError, match="durable jobs"):
        create_app(
            model=says_hello,
            durability=True,
            store=InMemorySpecStore(),
        )


def test_durability_turned_off_explicitly_stops_replaying_the_same_run():
    with TestClient(create_app(model=says_hello, durability=False)) as client:
        client.post("/specs", json=spec_payload())

        assert a_run_id(client, "not-durable") != a_run_id(client, "not-durable")


def test_durability_that_switches_itself_off_says_why(caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.WARNING):
        create_app(model=says_hello, store=InMemorySpecStore())

    assert any(
        "durable jobs are off" in record.message and "store" in record.message
        for record in caplog.records
    )


def test_durability_turned_off_while_a_job_store_is_injected_refuses_to_start(
    tmp_path: Path,
):
    with pytest.raises(RuntimeError, match="durable job store"):
        create_app(
            model=says_hello,
            durability=False,
            job_store=SqliteJobStore(tmp_path / "agentcanvas.db"),
        )
