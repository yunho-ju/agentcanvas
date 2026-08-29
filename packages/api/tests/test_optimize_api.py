"""POST /optimize/preview — preview 기계의 세 번째 소비자, endpoint 배선.

_architected 응답 조립·_live_provider_or_503 게이트·preview_of 거절 관례를 그대로 재사용하고,
proposal 필드만 더한다. 승인 전 spec·eval·run은 불변이다(저장하지 않는다).
"""

from __future__ import annotations

import json
from pathlib import Path

from agentcanvas_api.app import GUIDED_MODEL_REF, create_app
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_engine.model_call import ModelBalked, ModelSaid
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)


def spec_payload() -> dict:
    return json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))


def envelope(base_revision: str, op: dict | None = None) -> str:
    return json.dumps(
        {
            "patch": {
                "schema_version": "agent.patch/v1",
                "base_revision": base_revision,
                "operations": [op or {"op": "remove_edge", "edge_id": "human-output"}],
            },
            "proposal": {
                "objective": {"ko": "비용을 줄인다", "en": "cut the cost"},
                "hypothesis": {"ko": "가설", "en": "hypothesis"},
                "target_nodes": ["triage"],
                "expected_effect": {"ko": "효과", "en": "effect"},
            },
        }
    )


def a_client(result: ModelSaid | ModelBalked) -> TestClient:
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            model=lambda _ask: result,
        )
    )


def optimize_body(base: dict, objective: str = "cut the cost") -> dict:
    return {"model_ref": GUIDED_MODEL_REF, "objective": objective, "base_spec": base}


def test_a_candidate_and_a_proposal_come_back_without_saving():
    base = spec_payload()
    client = a_client(
        ModelSaid(input_tokens=1, output_tokens=1, text=envelope(base["revision"]))
    )

    response = client.post("/optimize/preview", json=optimize_body(base))

    assert response.status_code == 200
    body = response.json()
    candidate = AgentSpec.model_validate(body["candidate"])
    assert candidate.version == base["version"] + 1
    assert body["proposal"]["objective"]["en"] == "cut the cost"
    assert body["proposal"]["target_nodes"] == ["triage"]
    assert body["proposal"]["evidence"]["batch_id"] is None  # 시험 없음: 정직 표시
    # 승인 전에는 저장되지 않는다.
    assert client.get(f"/specs/{base['id']}").status_code == 404


def test_a_graph_breaking_candidate_is_refused():
    base = spec_payload()
    breaks = envelope(
        base["revision"],
        op={
            "op": "add_edge",
            "edge": {
                "id": "orphan",
                "kind": "data",
                "source": {"node": "missing", "port": "out"},
                "target": {"node": "output", "port": "input"},
            },
        },
    )
    client = a_client(ModelSaid(input_tokens=1, output_tokens=1, text=breaks))

    response = client.post("/optimize/preview", json=optimize_body(base))

    assert response.status_code == 422
    assert "orphan" not in response.text


def test_a_provider_that_returns_garbage_is_a_safe_502():
    base = spec_payload()
    raw = "provider raw answer sk-never-return-this"
    client = a_client(ModelSaid(input_tokens=1, output_tokens=1, text=raw, prompt=raw))

    response = client.post("/optimize/preview", json=optimize_body(base))

    assert response.status_code == 502
    assert raw not in response.text


def test_a_blank_objective_is_rejected():
    base = spec_payload()
    client = a_client(ModelBalked(reason="provider_error", message="unused"))

    response = client.post(
        "/optimize/preview", json={**optimize_body(base), "objective": "   "}
    )

    assert response.status_code == 422


def test_a_provider_that_is_not_configured_never_reaches_a_model():
    called: list[object] = []

    def model(ask: object) -> ModelSaid:
        called.append(ask)
        raise AssertionError("no model may be asked without a live provider")

    client = TestClient(
        create_app(store=InMemorySpecStore(), run_store=InMemoryRunStore(), model=model)
    )

    response = client.post(
        "/optimize/preview",
        json={**optimize_body(spec_payload()), "model_ref": "model://default"},
    )

    assert response.status_code == 503
    assert called == []
