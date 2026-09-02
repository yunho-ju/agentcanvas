from __future__ import annotations

import json
from pathlib import Path

from agentcanvas_api.app import GUIDED_MODEL_REF, create_app
from agentcanvas_api.architect_service import (
    architect_request_fingerprint,
    blank_architect_seed,
)
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_contracts.agent_spec import AgentSpec, Node, Position
from agentcanvas_contracts.chat import CHAT_SAID_BINDING
from agentcanvas_engine.model_call import ModelBalked, ModelEvidence, ModelSaid
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)


def spec_payload() -> dict:
    return json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))


def patch_answer(base_revision: str, operation: dict) -> str:
    return json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base_revision,
            "operations": [operation],
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


def request_body(base: dict, request: str = "make a small change") -> dict:
    return {
        "model_ref": "model://default",
        "request": request,
        "base_spec": base,
    }


def draft_request_body(
    draft_id: str = "draft-provider", request: str = "make a helpful answer"
) -> dict:
    return {
        "model_ref": GUIDED_MODEL_REF,
        "request": request,
        "draft_id": draft_id,
    }


def draft_patch_answer(
    base_revision: str, request: str = "make a helpful answer"
) -> str:
    return json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base_revision,
            "operations": [
                {
                    "op": "add_node",
                    "node": {
                        "id": "llm-router",
                        "type": "llm.router",
                        "position": {"x": 280, "y": 0},
                        "config": {
                            "model_ref": "model://default",
                            "instruction": request,
                        },
                    },
                },
                {
                    "op": "add_node",
                    "node": {
                        "id": "llm-agent",
                        "type": "llm.agent",
                        "position": {"x": 560, "y": 0},
                        "config": {
                            "model_ref": "model://default",
                            "instruction": request,
                        },
                    },
                },
                {
                    "op": "add_edge",
                    "edge": {
                        "id": "edge-input-agent",
                        "kind": "data",
                        "source": {"node": "core-input", "port": "message"},
                        "target": {"node": "llm-router", "port": "input"},
                    },
                },
                {
                    "op": "add_edge",
                    "edge": {
                        "id": "edge-router-agent",
                        "kind": "control",
                        "source": {"node": "llm-router", "port": "passthrough"},
                        "target": {"node": "llm-agent", "port": "messages"},
                    },
                },
                {
                    "op": "add_edge",
                    "edge": {
                        "id": "edge-agent-output",
                        "kind": "data",
                        "source": {"node": "llm-agent", "port": "response"},
                        "target": {"node": "core-output", "port": "input"},
                    },
                },
            ],
        }
    )


def test_architect_patch_returns_a_valid_preview_without_saving_it():
    base = spec_payload()
    result = ModelSaid(
        input_tokens=19,
        output_tokens=7,
        text=patch_answer(
            base["revision"],
            {"op": "remove_edge", "edge_id": "human-output"},
        ),
        prompt="safe prompt",
    )
    client = a_client(result)

    response = client.post("/architect/patch", json=request_body(base))

    assert response.status_code == 200
    body = response.json()
    candidate = AgentSpec.model_validate(body["candidate"])
    assert candidate.version == base["version"] + 1
    assert candidate.status.value == "draft"
    assert candidate.revision == candidate.computed_revision()
    assert body["patch"]["base_revision"] == base["revision"]
    assert any(issue["code"] == "graph.unreachable_node" for issue in body["issues"])
    assert client.get(f"/specs/{base['id']}").status_code == 404


def test_a_stale_patch_is_a_conflict_and_does_not_save():
    base = spec_payload()
    result = ModelSaid(
        input_tokens=1,
        output_tokens=1,
        text=patch_answer(
            "sha256:" + "f" * 64,
            {"op": "remove_edge", "edge_id": "human-output"},
        ),
    )
    client = a_client(result)

    response = client.post("/architect/patch", json=request_body(base))

    assert response.status_code == 409
    assert "different graph revision" in response.json()["detail"]
    assert client.get(f"/specs/{base['id']}").status_code == 404


def test_a_base_spec_with_a_forged_revision_is_rejected():
    base = spec_payload()
    forged = {**base, "revision": "sha256:" + "f" * 64}
    client = a_client(
        ModelSaid(
            input_tokens=1,
            output_tokens=1,
            text=patch_answer(
                forged["revision"],
                {"op": "remove_edge", "edge_id": "human-output"},
            ),
        )
    )

    response = client.post("/architect/patch", json=request_body(forged))

    assert response.status_code == 422
    assert (
        response.json()["detail"]
        == "the base graph revision does not match its content"
    )


def test_malformed_model_output_is_a_safe_422():
    base = spec_payload()
    raw = "provider raw answer sk-never-return-this"
    client = a_client(ModelSaid(input_tokens=1, output_tokens=1, text=raw, prompt=raw))

    response = client.post("/architect/patch", json=request_body(base))

    assert response.status_code == 422
    assert "agent.patch/v1" in response.json()["detail"]
    assert raw not in response.text


def test_provider_failure_is_a_safe_503():
    base = spec_payload()
    client = a_client(
        ModelBalked(reason="provider_error", message="the model could not be reached")
    )

    response = client.post("/architect/patch", json=request_body(base))

    assert response.status_code == 503
    assert response.json()["detail"] == "the model could not be reached"


def test_graph_validation_error_is_not_returned_as_a_candidate():
    base = spec_payload()
    client = a_client(
        ModelSaid(
            input_tokens=1,
            output_tokens=1,
            text=patch_answer(
                base["revision"],
                {
                    "op": "add_edge",
                    "edge": {
                        "id": "orphan",
                        "kind": "data",
                        "source": {"node": "missing", "port": "out"},
                        "target": {"node": "output", "port": "input"},
                    },
                },
            ),
        )
    )

    response = client.post("/architect/patch", json=request_body(base))

    assert response.status_code == 422
    assert (
        response.json()["detail"] == "the proposed patch leaves graph validation errors"
    )
    assert "orphan" not in response.text


def unfinished_config_answer(base_revision: str) -> str:
    """모델은 설정 칸을 모른 채 노드를 제안한다 — 사람 확인 노드는 통째로 빈 채로."""
    return json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base_revision,
            "operations": [
                {
                    "op": "add_node",
                    "node": {
                        "id": "second-gate",
                        "type": "control.human_gate",
                        "position": {"x": 900, "y": 200},
                        "config": {},
                    },
                },
                {
                    "op": "add_node",
                    "node": {
                        "id": "second-agent",
                        "type": "llm.agent",
                        "position": {"x": 900, "y": 400},
                        "config": {"instruction": "summarise the answer"},
                    },
                },
            ],
        }
    )


def test_a_patch_whose_settings_are_not_filled_in_yet_is_still_previewed():
    """초안은 설정이 덜 찬 채로도 미리 볼 수 있다 — 빈 칸은 inspector에서 채우는 것이다.

    (짝: test_graph_validation_error_is_not_returned_as_a_candidate — 구조가 깨진
    제안은 여전히 거절된다.)
    """
    base = spec_payload()
    client = a_client(
        ModelSaid(
            input_tokens=1,
            output_tokens=1,
            text=unfinished_config_answer(base["revision"]),
        )
    )

    response = client.post("/architect/patch", json=request_body(base))

    assert response.status_code == 200
    body = response.json()
    unfinished = [
        issue for issue in body["issues"] if issue["code"] == "node.invalid_config"
    ]
    # 모델 이름은 서버가 채우므로(model_ref backfill) 남는 빈 칸은 사람 확인 노드뿐이다.
    assert {issue["node_id"] for issue in unfinished} == {"second-gate"}


def test_blank_architect_seed_is_canonical_and_not_saved():
    seed = blank_architect_seed("draft-seed")

    assert seed.revision == seed.computed_revision()
    assert seed.version == 1
    assert [node.id for node in seed.nodes] == ["core-input", "core-output"]
    # 사람이 하는 말이 들어오는 자리 이름은 계약이 정한 그 이름이다 — 대화(Talk)가 그것을 찾는다.
    assert seed.input_schema["required"] == [CHAT_SAID_BINDING]
    assert [node.config for node in seed.nodes if node.id == "core-input"] == [
        {"bindings": {CHAT_SAID_BINDING: f"input.{CHAT_SAID_BINDING}"}}
    ]
    assert seed.state_schema["properties"]["answer"] == {"type": "string"}


def test_the_seed_says_what_that_input_is_for_in_both_languages():
    """실행 입력 카드는 이 제목을 라벨로 쓴다 — 사람이 `message` 원문을 읽게 두지 않는다."""
    said = blank_architect_seed("draft-seed").input_schema["properties"][
        CHAT_SAID_BINDING
    ]

    assert said["title"] == "What you say"
    assert said["x-i18n"]["ko"]["title"] == "사람이 하는 말"


def test_architect_draft_returns_a_provider_candidate_without_saving_it():
    seed = blank_architect_seed("draft-provider")
    result = ModelSaid(
        input_tokens=4,
        output_tokens=9,
        text=draft_patch_answer(seed.revision),
        evidence=ModelEvidence(
            provider="openai_compatible",
            model_id="gpt-public-example",
            request_id="agentcanvas-test-request",
            latency_ms=17,
        ),
    )
    client = a_client(result)

    response = client.post("/architect/draft", json=draft_request_body())

    assert response.status_code == 200
    body = response.json()
    candidate = AgentSpec.model_validate(body["candidate"])
    assert candidate.id == "draft-provider"
    assert candidate.version == 2
    assert candidate.revision == candidate.computed_revision()
    assert len(candidate.nodes) == 4
    assert len(candidate.edges) == 3
    assert body["patch"]["base_revision"] == seed.revision
    assert body["evidence"] == {
        "provider": "openai_compatible",
        "model_ref": GUIDED_MODEL_REF,
        "model_id": "gpt-public-example",
        "request_id": "agentcanvas-test-request",
        "input_tokens": 4,
        "output_tokens": 9,
        "latency_ms": 17,
        "provider_processing_ms": None,
        "request_fingerprint": architect_request_fingerprint(
            model_ref=GUIDED_MODEL_REF,
            request="make a helpful answer",
            base_revision=seed.revision,
        ),
        "external_state": "preview_only",
        "persisted": False,
        "watermark": "not_applicable_json_candidate",
        "cost": {
            "status": "estimate_requires_price_snapshot",
            "estimated_usd": None,
        },
    }
    assert client.get("/specs/draft-provider").status_code == 404


def test_architect_draft_rejects_blank_identity_and_request():
    client = a_client(ModelBalked(reason="provider_error", message="not reached"))

    blank_id = client.post("/architect/draft", json=draft_request_body(draft_id="   "))
    blank_request = client.post(
        "/architect/draft", json=draft_request_body(request="   ")
    )

    assert blank_id.status_code == 422
    assert blank_request.status_code == 422


def test_architect_draft_malformed_provider_output_is_safe():
    raw = "provider raw answer sk-never-return-this"
    client = a_client(ModelSaid(input_tokens=1, output_tokens=1, text=raw, prompt=raw))

    response = client.post("/architect/draft", json=draft_request_body())

    assert response.status_code == 502
    assert response.json()["detail"] == "architect provider returned invalid output"
    assert raw not in response.text


def test_architect_draft_provider_failure_is_a_safe_503():
    client = a_client(
        ModelBalked(reason="provider_error", message="the model could not be reached")
    )

    response = client.post("/architect/draft", json=draft_request_body())

    assert response.status_code == 503
    assert response.json()["detail"] == "architect provider is unavailable"


def test_architect_draft_rejects_the_legacy_default_without_calling_a_model():
    called = False

    def model(_ask: object) -> ModelSaid:
        nonlocal called
        called = True
        raise AssertionError("legacy Guided ref must not reach a model")

    client = TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            model=model,
        )
    )

    response = client.post(
        "/architect/draft",
        json={
            "model_ref": "model://default",
            "request": "make a helpful answer",
            "draft_id": "draft-legacy-ref",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "architect provider is not configured"
    assert called is False


def test_architect_draft_does_not_turn_the_server_fallback_into_a_candidate():
    client = TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
        )
    )

    response = client.post(
        "/architect/draft",
        json={
            "model_ref": GUIDED_MODEL_REF,
            "request": "make a helpful answer",
            "draft_id": "draft-no-provider",
        },
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "architect provider is not configured"
    assert client.get("/specs/draft-no-provider").status_code == 404


def draft_patch_answer_without_a_model(base_revision: str) -> str:
    """모델이 model_ref 칸을 잊거나 비워 보낸 초안 — 실제로 관찰된 provider 답의 모양."""
    patch = json.loads(draft_patch_answer(base_revision))
    blanks = {"llm-router": None, "llm-agent": ""}
    for operation in patch["operations"]:
        if operation["op"] != "add_node":
            continue
        blank = blanks[operation["node"]["id"]]
        if blank is None:
            operation["node"]["config"].pop("model_ref")
        else:
            operation["node"]["config"]["model_ref"] = blank
    return json.dumps(patch)


def test_a_draft_llm_node_without_a_model_gets_the_one_the_architect_used():
    """검사를 통과한 초안은 곧바로 실행할 수 있어야 한다 — 빈 모델 칸을 서버가 채운다."""
    seed = blank_architect_seed("draft-fills-model")
    client = a_client(
        ModelSaid(
            input_tokens=1,
            output_tokens=1,
            text=draft_patch_answer_without_a_model(seed.revision),
        )
    )

    response = client.post(
        "/architect/draft", json=draft_request_body(draft_id="draft-fills-model")
    )

    assert response.status_code == 200
    body = response.json()
    candidate = AgentSpec.model_validate(body["candidate"])
    assert {
        node.id: node.config.get("model_ref")
        for node in candidate.nodes
        if node.type.startswith("llm.")
    } == {"llm-router": GUIDED_MODEL_REF, "llm-agent": GUIDED_MODEL_REF}
    assert candidate.revision == candidate.computed_revision()
    assert [
        issue for issue in body["issues"] if issue["code"] == "node.invalid_config"
    ] == []


def test_a_model_the_draft_itself_chose_is_left_alone():
    """짝: 모델이 고른 이름은 서버가 덮어쓰지 않는다."""
    seed = blank_architect_seed("draft-keeps-model")
    client = a_client(
        ModelSaid(
            input_tokens=1, output_tokens=1, text=draft_patch_answer(seed.revision)
        )
    )

    response = client.post(
        "/architect/draft", json=draft_request_body(draft_id="draft-keeps-model")
    )

    assert response.status_code == 200
    candidate = AgentSpec.model_validate(response.json()["candidate"])
    assert {
        node.config.get("model_ref")
        for node in candidate.nodes
        if node.type.startswith("llm.")
    } == {"model://default"}


def test_a_node_that_does_not_call_a_model_gets_no_model_name():
    """모델 칸을 요구하지 않는 노드(입력·출력)에는 아무것도 더하지 않는다."""
    seed = blank_architect_seed("draft-other-nodes")
    client = a_client(
        ModelSaid(
            input_tokens=1,
            output_tokens=1,
            text=draft_patch_answer_without_a_model(seed.revision),
        )
    )

    response = client.post(
        "/architect/draft", json=draft_request_body(draft_id="draft-other-nodes")
    )

    assert response.status_code == 200
    candidate = AgentSpec.model_validate(response.json()["candidate"])
    assert [node.config for node in candidate.nodes if node.id == "core-output"] == [
        {"binding": "state.answer"}
    ]
    assert [node.config for node in candidate.nodes if node.id == "core-input"] == [
        {"bindings": {"message": "input.message"}}
    ]


def a_base_with_an_empty_model(node_id: str) -> AgentSpec:
    """사람이 모델 이름을 아직 비워 둔 채 저장해 둔 그래프 — patch가 손대지 않는 노드다."""
    base = AgentSpec.model_validate(spec_payload())
    mine = Node(
        id=node_id,
        type="llm.agent",
        position=Position(x=0, y=600),
        config={"model_ref": ""},
    )
    grown = base.model_copy(update={"nodes": [*base.nodes, mine]})
    return grown.model_copy(update={"revision": grown.computed_revision()})


def test_a_node_the_patch_never_touched_keeps_the_model_name_its_owner_left():
    """서버가 채우는 것은 이 제안이 만든 노드뿐 — 사람이 비워 둔 기존 노드는 그대로 둔다."""
    base = a_base_with_an_empty_model("mine")
    client = a_client(
        ModelSaid(
            input_tokens=1,
            output_tokens=1,
            text=patch_answer(
                base.revision,
                {
                    "op": "add_node",
                    "node": {
                        "id": "added-agent",
                        "type": "llm.agent",
                        "position": {"x": 400, "y": 600},
                        "config": {"instruction": "summarise the answer"},
                    },
                },
            ),
        )
    )

    response = client.post(
        "/architect/patch",
        json=request_body(base.model_dump(mode="json")),
    )

    assert response.status_code == 200
    body = response.json()
    candidate = AgentSpec.model_validate(body["candidate"])
    assert {
        node.id: node.config.get("model_ref")
        for node in candidate.nodes
        if node.id in {"mine", "added-agent"}
    } == {"mine": "", "added-agent": "model://default"}
    assert candidate.revision == candidate.computed_revision()


def test_pulling_out_a_connection_a_node_still_uses_is_not_previewed():
    """도구 연결을 빼면 그것을 쓰던 노드가 없는 이름을 가리킨다 — 그림이 깨진 제안은 거절한다."""
    base = spec_payload()
    assert base["resources"][0]["id"] == "clinical-reference"
    client = a_client(
        ModelSaid(
            input_tokens=1,
            output_tokens=1,
            text=patch_answer(
                base["revision"],
                {"op": "remove_resource", "resource_id": "clinical-reference"},
            ),
        )
    )

    response = client.post("/architect/patch", json=request_body(base))

    assert response.status_code == 422
    assert (
        response.json()["detail"] == "the proposed patch leaves graph validation errors"
    )


def test_a_connection_a_patch_adds_arrives_in_the_previewed_candidate():
    """짝: 바인딩을 더하는 제안은 그대로 미리보기 candidate에 실린다."""
    base = spec_payload()
    client = a_client(
        ModelSaid(
            input_tokens=1,
            output_tokens=1,
            text=patch_answer(
                base["revision"],
                {
                    "op": "add_resource",
                    "resource": {
                        "id": "drug-database",
                        "kind": "mcp.toolset",
                        "server_ref": "mcp://drug-database",
                        "approval_policy": "read_only_auto",
                        "tools": [],
                    },
                },
            ),
        )
    )

    response = client.post("/architect/patch", json=request_body(base))

    assert response.status_code == 200
    candidate = response.json()["candidate"]
    assert [resource["id"] for resource in candidate["resources"]] == [
        "clinical-reference",
        "drug-database",
    ]
