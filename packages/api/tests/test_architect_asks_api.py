from __future__ import annotations

import json

from agentcanvas_adapters.pattern_asker import PATTERN_ASKS_PROMPT_REF
from agentcanvas_api.app import GUIDED_MODEL_REF, create_app
from agentcanvas_api.architect_service import blank_architect_seed
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_engine.model_call import ModelAsk, ModelSaid
from fastapi.testclient import TestClient

REQUEST = "Answer customer questions and get approval before it sends"
DRAFT_ID = "draft-asking"


def a_draft_patch(base_revision: str) -> str:
    return json.dumps(
        {
            "schema_version": "agent.patch/v1",
            "base_revision": base_revision,
            "operations": [
                {
                    "op": "add_node",
                    "node": {
                        "id": "llm-agent",
                        "type": "llm.agent",
                        "position": {"x": 280, "y": 0},
                        "config": {
                            "model_ref": GUIDED_MODEL_REF,
                            "instruction": REQUEST,
                        },
                    },
                },
                {
                    "op": "add_edge",
                    "edge": {
                        "id": "edge-input-agent",
                        "kind": "data",
                        "source": {"node": "core-input", "port": "message"},
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


def proposing(*pairs: tuple[str, str]) -> str:
    return json.dumps({"asks": [{"pattern_id": one, "why": why} for one, why in pairs]})


def a_client(
    proposed: str, *, draft_id: str = DRAFT_ID
) -> tuple[TestClient, list[str]]:
    """모델은 두 자리에서 불린다 — 무엇을 물을까(되묻기)와 초안(patch)."""
    patch = a_draft_patch(blank_architect_seed(draft_id).revision)
    rounds: list[str] = []

    def model(ask: ModelAsk) -> ModelSaid:
        rounds.append(ask.prompt_ref)
        asking = ask.prompt_ref == PATTERN_ASKS_PROMPT_REF
        return ModelSaid(
            input_tokens=1, output_tokens=1, text=proposed if asking else patch
        )

    client = TestClient(
        create_app(store=InMemorySpecStore(), run_store=InMemoryRunStore(), model=model)
    )
    return client, rounds


def draft_body(answers: list[dict] | None = None, *, draft_id: str = DRAFT_ID) -> dict:
    body = {"model_ref": GUIDED_MODEL_REF, "request": REQUEST, "draft_id": draft_id}
    return body if answers is None else {**body, "answers": answers}


def test_the_questions_come_back_alone_without_a_draft():
    """되묻기와 초안은 둘 중 하나만 온다 — 화면이 두 상태를 동시에 만나지 않는다."""
    client, _ = a_client(
        proposing(
            ("human_gate", "approval before it sends"),
            ("router", "customer questions"),
        )
    )

    body = client.post("/architect/draft", json=draft_body()).json()

    assert [ask["pattern_id"] for ask in body["asks"]] == ["human_gate", "router"]
    assert body["asks"][0]["question"]["ko"] and body["asks"][0]["cost"]["en"]
    assert body["patch"] is None
    assert body["candidate"] is None


def test_a_reason_the_request_never_gave_is_not_asked_and_the_draft_comes_instead():
    client, _ = a_client(proposing(("react", "translate it into French")))

    body = client.post("/architect/draft", json=draft_body()).json()

    assert body["asks"] == []
    assert AgentSpec.model_validate(body["candidate"]).id == DRAFT_ID


def test_the_second_call_draws_the_shape_the_person_said_yes_to():
    client, _ = a_client(proposing(("human_gate", "approval before it sends")))

    body = client.post(
        "/architect/draft",
        json=draft_body([{"pattern_id": "human_gate", "answer": "yes"}]),
    ).json()

    candidate = AgentSpec.model_validate(body["candidate"])
    assert body["asks"] == []
    assert [node.type for node in candidate.nodes].count("control.human_gate") == 1
    assert body["skipped_patterns"] == []


def test_a_call_that_carries_answers_is_never_asked_what_to_ask():
    """되묻기는 한 번뿐이다 — 답을 들고 온 부름에는 물을 자리가 없다."""
    client, rounds = a_client(proposing(("human_gate", "approval before it sends")))

    client.post(
        "/architect/draft",
        json=draft_body([{"pattern_id": "human_gate", "answer": "no"}]),
    )

    assert PATTERN_ASKS_PROMPT_REF not in rounds


def test_two_shapes_said_yes_to_both_stand_in_the_draft():
    client, _ = a_client(proposing(("human_gate", "approval before it sends")))

    body = client.post(
        "/architect/draft",
        json=draft_body(
            [
                {"pattern_id": "human_gate", "answer": "yes"},
                {"pattern_id": "router", "answer": "yes"},
            ]
        ),
    ).json()

    types = [node.type for node in AgentSpec.model_validate(body["candidate"]).nodes]
    assert types.count("control.human_gate") == 1
    assert types.count("llm.router") == 1


def test_a_shape_the_server_added_calls_a_model_this_server_can_actually_call():
    """검사 3개를 통과했는데 실행이 거절되는 거짓 통과를 만들지 않는다 (DESIGN §7)."""
    client, _ = a_client(proposing(("router", "customer questions")))

    body = client.post(
        "/architect/draft", json=draft_body([{"pattern_id": "router", "answer": "yes"}])
    ).json()

    candidate = AgentSpec.model_validate(body["candidate"])
    router = next(node for node in candidate.nodes if node.type == "llm.router")
    assert router.config["model_ref"] == GUIDED_MODEL_REF


def test_a_shape_this_draft_cannot_take_is_said_out_loud_and_the_draft_survives():
    """예고한 일이 일어나지 않았는데 아무 말도 없는 길을 만들지 않는다."""
    client, _ = a_client(proposing(("react", "customer questions")))

    body = client.post(
        "/architect/draft", json=draft_body([{"pattern_id": "react", "answer": "yes"}])
    ).json()

    [skipped] = body["skipped_patterns"]
    assert skipped["pattern_id"] == "react"
    assert skipped["why"]["ko"] and skipped["why"]["en"]
    assert AgentSpec.model_validate(body["candidate"]).id == DRAFT_ID


def test_a_shape_the_person_did_not_say_yes_to_is_left_out():
    client, _ = a_client(proposing(("human_gate", "approval before it sends")))

    body = client.post(
        "/architect/draft",
        json=draft_body(
            [
                {"pattern_id": "human_gate", "answer": "skipped"},
                {"pattern_id": "router", "answer": "no"},
            ]
        ),
    ).json()

    types = [node.type for node in AgentSpec.model_validate(body["candidate"]).nodes]
    assert "control.human_gate" not in types
    assert types.count("llm.router") == 0
    assert body["skipped_patterns"] == []
