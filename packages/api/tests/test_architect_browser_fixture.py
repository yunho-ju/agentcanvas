from __future__ import annotations

import json
import sys
from pathlib import Path

from agentcanvas_api.architect_service import blank_architect_seed
from agentcanvas_contracts.agent_spec import AgentSpec, Node, Position
from agentcanvas_engine.model_call import ModelAsk, ModelSaid
from agentcanvas_engine.validator import Severity, validate_graph
from fastapi.testclient import TestClient

# The runner is intentionally a root-level development script, not a workspace package.
_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from scripts.serve_architect_browser_fixture import (
    FixtureArchitectModel,
    create_fixture_app,
    main,
)


def fixture_ask(draft_id: str = "fixture-draft") -> ModelAsk:
    seed = blank_architect_seed(draft_id)
    return ModelAsk(
        node=Node(
            id="architect",
            type="llm.agent",
            position=Position(x=0, y=0),
            config={"model_ref": "model://openai"},
        ),
        state={},
        ways=(),
        model_ref="model://openai",
        prompt_ref="prompt://architect@1",
        instruction="ignored request\nBase AgentSpec:\n"
        + json.dumps(seed.model_dump(mode="json")),
    )


def test_fixture_model_returns_a_valid_provider_free_patch_without_evidence():
    model = FixtureArchitectModel()

    result = model(fixture_ask())

    assert isinstance(result, ModelSaid)
    assert result.evidence is None
    assert model.metrics.model_calls == 1
    payload = json.loads(result.text or "{}")
    assert payload["schema_version"] == "agent.patch/v1"
    assert len(payload["operations"]) == 5


def test_fixture_api_returns_candidate_and_keeps_specs_empty():
    app, model, metrics = create_fixture_app()
    client = TestClient(app)

    before = client.get("/specs").json()
    response = client.post(
        "/architect/draft",
        json={
            "model_ref": "model://openai",
            "request": "make a small fixture answer",
            "draft_id": "fixture-draft",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["evidence"] is None
    assert len(body["candidate"]["nodes"]) == 4
    assert len(body["candidate"]["edges"]) == 3
    assert not any(
        issue["severity"] == Severity.ERROR.value for issue in body["issues"]
    )
    after = client.get("/specs").json()
    assert before == after
    assert client.get("/specs/fixture-draft").status_code == 404

    status = client.get("/__fixture/status").json()
    assert status["fixture_only"] is True
    assert status["provenance"] == "scripted_candidate_not_real_provider_evidence"
    # 빈 캔버스 초안은 두 번 묻는다 — 무엇을 되물을까(P6a), 그리고 그림(patch).
    assert status["model_calls"] == 2
    assert status["saved_spec_ids"] == []
    assert model.metrics is metrics


def test_fixture_candidate_is_graph_valid_after_patch_application():
    app, _, _ = create_fixture_app()
    client = TestClient(app)

    response = client.post(
        "/architect/draft",
        json={
            "model_ref": "model://openai",
            "request": "make a small fixture answer",
            "draft_id": "fixture-validity",
        },
    )

    body = response.json()
    candidate = AgentSpec.model_validate(body["candidate"])
    assert validate_graph(candidate) == []


def test_fixture_refuses_local_model_environment(monkeypatch):
    monkeypatch.setenv("AGENTCANVAS_LOCAL_MODEL", "ollama-do-not-call")

    assert main([]) == 2
