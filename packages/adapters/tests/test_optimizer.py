"""Optimizer 어댑터 — objective + 증거를 받아 후보 patch + 제안문 봉투로 옮긴다.

Architect와 같은 골격(같은 patch 계약·같은 물러섬·같은 허용 op)을 쓰고, 다른 것은 둘뿐이다:
입력(request 대신 objective+증거)과, patch에 덧붙는 제안문(가설·대상·기대효과).
"""

from __future__ import annotations

import json

from agentcanvas_adapters.architect import ArchitectBalked, ArchitectSaid
from agentcanvas_adapters.optimizer import (
    OPTIMIZER_PROMPT_REF,
    OptimizerRequest,
    OptimizerSaid,
    optimizer_from,
)
from agentcanvas_contracts.agent_spec import AgentSpec, AgentStatus, Node, Position
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelSaid


def a_spec() -> AgentSpec:
    draft = AgentSpec(
        schema_version="agent.spec/v1",
        id="demo",
        name=None,
        version=1,
        revision="sha256:" + "0" * 64,
        status=AgentStatus.DRAFT,
        input_schema={"type": "object"},
        state_schema={"type": "object", "properties": {"answer": {"type": "string"}}},
        nodes=[
            Node(
                id="core-input",
                type="core.input",
                position=Position(x=0, y=0),
                config={"bindings": {"question": "input.question"}},
            ),
            Node(
                id="writer",
                type="llm.agent",
                position=Position(x=200, y=0),
                config={"model_ref": "model://big"},
            ),
            Node(
                id="core-output",
                type="core.output",
                position=Position(x=400, y=0),
                config={"binding": "state.answer"},
            ),
        ],
        edges=[],
        resources=[],
        execution=None,
    )
    return draft.model_copy(update={"revision": draft.computed_revision()})


def a_request(
    objective: str = "cut the cost", evidence: str = "batch shows gaps"
) -> OptimizerRequest:
    return OptimizerRequest(
        base_spec=a_spec(),
        objective=objective,
        evidence=evidence,
        model_ref="model://optimizer",
    )


def envelope(
    base_revision: str, op: dict | None = None, proposal: dict | None = None
) -> str:
    return json.dumps(
        {
            "patch": {
                "schema_version": "agent.patch/v1",
                "base_revision": base_revision,
                "operations": [
                    op
                    or {
                        "op": "replace_node_config",
                        "node_id": "writer",
                        "config": {"model_ref": "model://small"},
                    }
                ],
            },
            "proposal": proposal
            or {
                "objective": {"ko": "비용을 줄인다", "en": "cut the cost"},
                "hypothesis": {
                    "ko": "큰 모델을 쓴다",
                    "en": "it uses too large a model",
                },
                "target_nodes": ["writer"],
                "expected_effect": {"ko": "비용이 준다", "en": "cost goes down"},
            },
        }
    )


def asked_with(text: str) -> tuple[list[ModelAsk], object]:
    seen: list[ModelAsk] = []

    def model(ask: ModelAsk) -> ModelSaid:
        seen.append(ask)
        return ModelSaid(input_tokens=7, output_tokens=3, text=text)

    return seen, optimizer_from(model)


def test_the_prompt_carries_the_objective_and_the_evidence():
    spec = a_spec()
    seen, optimize = asked_with(envelope(spec.revision))

    optimize(a_request(objective="make it cheaper", evidence="case 3 missed 'refund'"))

    ask = seen[0]
    assert ask.prompt_ref == OPTIMIZER_PROMPT_REF
    assert "make it cheaper" in ask.instruction
    assert "case 3 missed 'refund'" in ask.instruction


def test_it_returns_the_patch_and_the_proposal_narrative():
    spec = a_spec()
    _seen, optimize = asked_with(envelope(spec.revision))

    result = optimize(a_request())

    assert isinstance(result, OptimizerSaid)
    assert isinstance(result.said, ArchitectSaid)
    assert [op.op for op in result.said.patch.operations] == ["replace_node_config"]
    assert result.narrative.objective.en == "cut the cost"
    assert result.narrative.target_nodes == ["writer"]


def a_narrative(**overrides) -> dict:
    return {
        "objective": {"ko": "비용을 줄인다", "en": "cut the cost"},
        "hypothesis": {"ko": "큰 모델을 쓴다", "en": "it uses too large a model"},
        "target_nodes": ["writer"],
        "expected_effect": {"ko": "비용이 준다", "en": "cost goes down"},
        **overrides,
    }


def test_the_prompt_asks_the_model_to_name_the_shape_it_chose():
    spec = a_spec()
    seen, optimize = asked_with(envelope(spec.revision))

    optimize(a_request())

    assert "pattern_id" in seen[0].instruction


def test_the_proposal_carries_the_shape_the_model_named():
    spec = a_spec()
    _seen, optimize = asked_with(
        envelope(spec.revision, proposal=a_narrative(pattern_id="react"))
    )

    result = optimize(a_request())

    assert isinstance(result, OptimizerSaid)
    assert result.narrative.pattern_id == "react"


def test_a_proposal_that_names_no_shape_is_still_the_whole_envelope():
    spec = a_spec()
    _seen, optimize = asked_with(envelope(spec.revision, proposal=a_narrative()))

    result = optimize(a_request())

    assert isinstance(result, OptimizerSaid)
    assert result.narrative.pattern_id is None


def test_an_answer_that_is_not_the_envelope_balks_without_repeating_it():
    raw = "here is your plan, sk-never-return-this"
    _seen, optimize = asked_with(raw)

    result = optimize(a_request())

    assert isinstance(result, ArchitectBalked)
    assert result.reason == "invalid_patch"
    assert raw not in result.message


def test_an_op_outside_the_architect_table_is_refused():
    spec = a_spec()
    _seen, optimize = asked_with(
        envelope(
            spec.revision,
            op={
                "op": "add_resource",
                "resource": {
                    "id": "x",
                    "kind": "http.api",
                    "server_ref": "api://x",
                    "approval_policy": "read_only_auto",
                    "tools": [],
                },
            },
        )
    )

    result = optimize(a_request())

    assert isinstance(result, ArchitectBalked)
    assert result.reason == "invalid_patch"


def test_a_provider_that_balks_is_carried_through():
    def model(_ask: ModelAsk) -> ModelBalked:
        return ModelBalked(reason="provider_error", message="nobody answered")

    result = optimizer_from(model)(a_request())

    assert isinstance(result, ArchitectBalked)
    assert result.reason == "provider_error"
