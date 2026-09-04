"""Optimizer 어댑터 — objective + eval 증거를 후보 patch + 제안문 봉투로 옮긴다.

Architect와 같은 골격을 쓴다(같은 patch 계약, 같은 허용 op, 같은 물러섬, 같은 노드 카탈로그).
다른 것은 둘뿐이다: 입력이 request가 아니라 objective+증거이고, patch에 제안문(가설·대상·
기대효과)이 덧붙는다. 제안문은 실행물이 아니다 — 번역(제약 생성)은 여전히 patch 하나뿐이다.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass

from agentcanvas_contracts.agent_spec import AgentSpec, Node, Position
from agentcanvas_contracts.architect_patch import AgentSpecPatch
from agentcanvas_contracts.base import ContractModel
from agentcanvas_contracts.localized import LocalizedText
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelCall, ModelSaid
from pydantic import Field, ValidationError

from .architect import (
    ALLOWED_OPERATIONS,
    OPERATION_NOT_ALLOWED_MESSAGE,
    ArchitectBalked,
    ArchitectSaid,
    _as_json,
    _base_node_ports,
    _invalid_patch,
    _node_type_catalog,
)

OPTIMIZER_PROMPT_REF = "prompt://optimizer@1"
OPTIMIZER_SCHEMA_NAME = "optimization_candidate"


class _Narrative(ContractModel):
    """모델이 내는 제안문 조각 — 근거(evidence)는 서버가 읽어 붙이므로 여기 없다."""

    objective: LocalizedText
    hypothesis: LocalizedText
    target_nodes: list[str] = Field(default_factory=list)
    expected_effect: LocalizedText
    #: 근거에 실린 모양 중 무엇을 골랐나 — 카탈로그 밖 이름은 서버가 버린다.
    pattern_id: str | None = None


@dataclass(frozen=True)
class OptimizerRequest:
    base_spec: AgentSpec
    #: 사람이 무엇을 개선하고 싶은가 (Architect의 request 자리).
    objective: str
    #: 서버가 읽어 온 eval 근거의 요약 (읽기 전용 — 모델이 지어내지 않는다).
    evidence: str
    model_ref: str
    prompt_ref: str = OPTIMIZER_PROMPT_REF


@dataclass(frozen=True)
class OptimizerSaid:
    """후보 patch(Architect와 같은 봉투) + 제안문 서술."""

    said: ArchitectSaid
    narrative: _Narrative


type OptimizerCall = Callable[[OptimizerRequest], OptimizerSaid | ArchitectBalked]


def _optimizer_prompt(asked: OptimizerRequest) -> str:
    """모델에게 보내는 입력 — 목표와 증거를 딛고, 가설을 세워, 제약된 patch로 옮기게 한다."""
    base = _as_json(asked.base_spec.model_dump(mode="json"))
    operations = ", ".join(ALLOWED_OPERATIONS)
    return "\n".join(
        [
            "You improve an existing AgentSpec toward a stated objective.",
            "Return JSON only, an object with two keys: 'patch' and 'proposal'.",
            "Do not return markdown, prose, or executable code.",
            f"The exact base revision is {asked.base_spec.revision}.",
            f"The objective to optimize for is: {asked.objective}",
            "Evidence read from recent eval results (read-only, do not invent more):",
            asked.evidence,
            (
                "The 'patch' uses schema_version agent.patch/v1 and only these "
                f"operations: {operations}. Do not change id, version, status, "
                "schemas, resources, or execution. A node with attached edges must "
                "have those edges removed first."
            ),
            (
                "The 'proposal' explains, in both ko and en, the objective, the "
                "hypothesis (why the graph is weak and what you change), the "
                "target_nodes (ids you touch), and the expected_effect (a description "
                "only — invent no numbers for cost or latency you did not measure)."
            ),
            (
                "If the evidence above names shapes and your change is one of them, "
                "put that shape's id in 'pattern_id'. Leave pattern_id out when your "
                "change is not one of them — do not invent an id."
            ),
            (
                "Every node you add must use a type from the list below, and every "
                "edge must name a port that exists on its node. Do not invent type or "
                "port names."
            ),
            "Node types you may use (JSON):",
            _node_type_catalog(),
            "Ports of the nodes already in the base spec (JSON):",
            _base_node_ports(asked.base_spec),
            "Base AgentSpec:",
            base,
        ]
    )


def _response_schema() -> dict[str, object]:
    """모델이 맞춰 낼 응답 모양 — patch(계약)와 proposal(서술)을 한 봉투로."""
    return {
        "type": "object",
        "required": ["patch", "proposal"],
        "properties": {
            "patch": AgentSpecPatch.model_json_schema(),
            "proposal": _Narrative.model_json_schema(),
        },
    }


def _ask_for(asked: OptimizerRequest) -> ModelAsk:
    return ModelAsk(
        node=Node(
            id="optimizer",
            type="llm.agent",
            position=Position(x=0, y=0),
            config={"model_ref": asked.model_ref},
        ),
        state={},
        ways=(),
        model_ref=asked.model_ref,
        prompt_ref=asked.prompt_ref,
        instruction=_optimizer_prompt(asked),
        response_schema=_response_schema(),
        response_name=OPTIMIZER_SCHEMA_NAME,
    )


def optimizer_said(said: ModelSaid | ModelBalked) -> OptimizerSaid | ArchitectBalked:
    """모델이 말한 봉투를 patch 계약 + 제안문으로 옮긴다 — 고쳐 쓰지 않고, 아니면 물러선다."""
    if isinstance(said, ModelBalked):
        return ArchitectBalked(reason=said.reason, message=said.message)
    if not isinstance(said, ModelSaid) or not said.text:
        return _invalid_patch()
    try:
        data = json.loads(said.text)
        patch = AgentSpecPatch.model_validate(data["patch"])
        narrative = _Narrative.model_validate(data["proposal"])
    except (json.JSONDecodeError, TypeError, KeyError, ValidationError):
        return _invalid_patch()
    if any(operation.op not in ALLOWED_OPERATIONS for operation in patch.operations):
        return _invalid_patch(OPERATION_NOT_ALLOWED_MESSAGE)
    return OptimizerSaid(
        said=ArchitectSaid(
            patch=patch,
            input_tokens=said.input_tokens,
            output_tokens=said.output_tokens,
            prompt=said.prompt,
            evidence=said.evidence,
        ),
        narrative=narrative,
    )


def optimizer_from(model: ModelCall) -> OptimizerCall:
    """기존 ModelCall을 후보 patch + 제안문 반환 자리로 감싼다."""

    def asks(asked: OptimizerRequest) -> OptimizerSaid | ArchitectBalked:
        return optimizer_said(model(_ask_for(asked)))

    return asks


__all__ = [
    "OPTIMIZER_PROMPT_REF",
    "OPTIMIZER_SCHEMA_NAME",
    "OptimizerCall",
    "OptimizerRequest",
    "OptimizerSaid",
    "optimizer_from",
    "optimizer_said",
]
