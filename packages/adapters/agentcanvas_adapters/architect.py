"""Provider-neutral Architect adapter — structured patch를 읽어 계약으로 옮긴다."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from agentcanvas_contracts.agent_spec import AgentSpec, Node, Position
from agentcanvas_contracts.architect_patch import AgentSpecPatch
from agentcanvas_contracts.node_registry import (
    DEFAULT_NODE_TYPES,
    PortSpec,
    resolve_ports,
)
from agentcanvas_engine.model_call import (
    ModelAsk,
    ModelBalked,
    ModelCall,
    ModelEvidence,
    ModelSaid,
    ModelTrouble,
)
from pydantic import ValidationError

ARCHITECT_PATCH_SCHEMA_NAME = "agent_spec_patch"
ARCHITECT_PROMPT_REF = "prompt://architect@2"
INVALID_PATCH_MESSAGE = "the model returned a patch that does not match agent.patch/v1"
OPERATION_NOT_ALLOWED_MESSAGE = (
    "the model returned an operation this service is not allowed to make"
)
ALLOWED_OPERATIONS = (
    "add_node",
    "remove_node",
    "replace_node_config",
    "add_edge",
    "remove_edge",
)

type ArchitectTrouble = ModelTrouble | Literal["invalid_patch"]


@dataclass(frozen=True)
class ArchitectRequest:
    base_spec: AgentSpec
    request: str
    model_ref: str
    prompt_ref: str = ARCHITECT_PROMPT_REF


@dataclass(frozen=True)
class ArchitectSaid:
    patch: AgentSpecPatch
    input_tokens: int
    output_tokens: int
    prompt: str | None = None
    evidence: ModelEvidence | None = None


@dataclass(frozen=True)
class ArchitectBalked:
    reason: ArchitectTrouble
    message: str


type ArchitectCall = Callable[[ArchitectRequest], ArchitectSaid | ArchitectBalked]


def _as_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


ANY_VALUE = "any"


def _port_shape(port: PortSpec) -> dict[str, str]:
    """포트 하나 = 이름 + 흐르는 값의 타입. 타입을 말하지 않는 포트는 무엇이든 받는다."""
    return {"id": port.id, "value": str(port.schema_.get("type", ANY_VALUE))}


def _node_type_catalog() -> str:
    """registry가 아는 노드 타입 — 이름·설명·포트와 그 값 타입만 추려서 한 덩어리로 보여 준다."""
    return _as_json(
        [
            {
                "type": node_type.type,
                "what_it_does": node_type.plain_description.en,
                "inputs": [_port_shape(port) for port in node_type.ports.inputs],
                "outputs": [_port_shape(port) for port in node_type.ports.outputs],
            }
            for node_type in sorted(DEFAULT_NODE_TYPES.values(), key=lambda t: t.type)
        ]
    )


def _port_names_of(node: Node, spec: AgentSpec) -> dict[str, object]:
    resolved = resolve_ports(
        node, DEFAULT_NODE_TYPES[node.type], spec.input_schema, spec.resources
    )
    return {
        "type": node.type,
        "inputs": [_port_shape(port) for port in resolved.inputs.values()],
        "outputs": [_port_shape(port) for port in resolved.outputs.values()],
    }


def _base_node_ports(spec: AgentSpec) -> str:
    """base spec 노드가 실제로 가진 포트 — config에서 생기는 동적 포트까지 해석해서 보여 준다."""
    return _as_json(
        {
            node.id: _port_names_of(node, spec)
            for node in spec.nodes
            if node.type in DEFAULT_NODE_TYPES
        }
    )


def _architect_prompt(asked: ArchitectRequest) -> str:
    """모델에게 보내는 입력 — 전체 spec을 읽되 허용된 작업만 쓰게 한다."""
    base = _as_json(asked.base_spec.model_dump(mode="json"))
    operations = ", ".join(ALLOWED_OPERATIONS)
    return "\n".join(
        [
            "You propose a safe incremental patch for an AgentSpec.",
            "Return JSON only. Do not return markdown, prose, or executable code.",
            f"The exact base revision is {asked.base_spec.revision}.",
            f"The user's requested change is: {asked.request}",
            f"Use schema_version agent.patch/v1 and only these operations: {operations}.",
            "Do not change id, version, status, schemas, resources, or execution.",
            "A node with attached edges must have those edges removed first.",
            "For a blank draft, keep the existing core-input and core-output nodes; add and connect the processing nodes instead of duplicating them.",
            "Every node you add must use a type from the list below, and every edge must name a port that exists on its node. Do not invent type names or port names.",
            'An edge is only allowed when its two ports carry the same value type; a port whose value is "any" fits every type. Route a value through a port that takes "any" when the types would not match.',
            "Node types you may use (JSON):",
            _node_type_catalog(),
            "Ports of the nodes already in the base spec (JSON):",
            _base_node_ports(asked.base_spec),
            "Base AgentSpec:",
            base,
        ]
    )


def _ask_for(asked: ArchitectRequest) -> ModelAsk:
    return ModelAsk(
        node=Node(
            id="architect",
            type="llm.agent",
            position=Position(x=0, y=0),
            config={"model_ref": asked.model_ref},
        ),
        state={},
        ways=(),
        model_ref=asked.model_ref,
        prompt_ref=asked.prompt_ref,
        instruction=_architect_prompt(asked),
        response_schema=AgentSpecPatch.model_json_schema(),
        response_name=ARCHITECT_PATCH_SCHEMA_NAME,
    )


def _invalid_patch(message: str = INVALID_PATCH_MESSAGE) -> ArchitectBalked:
    return ArchitectBalked(reason="invalid_patch", message=message)


def patch_said(
    said: ModelSaid | ModelBalked, allowed: tuple[str, ...] | None = None
) -> ArchitectSaid | ArchitectBalked:
    """모델이 말한 것을 patch 계약으로 옮긴다 — 고쳐 쓰지 않고, 아니면 물러선다.

    `allowed` 표를 건넨 서비스는 그 표 밖의 작업이 섞여 오면 통째로 물러선다.
    """

    if isinstance(said, ModelBalked):
        return ArchitectBalked(reason=said.reason, message=said.message)
    if not isinstance(said, ModelSaid) or not said.text:
        return _invalid_patch()
    try:
        patch = AgentSpecPatch.model_validate(json.loads(said.text))
    except (json.JSONDecodeError, TypeError, ValidationError):
        return _invalid_patch()
    if allowed is not None and any(
        operation.op not in allowed for operation in patch.operations
    ):
        return _invalid_patch(OPERATION_NOT_ALLOWED_MESSAGE)
    return ArchitectSaid(
        patch=patch,
        input_tokens=said.input_tokens,
        output_tokens=said.output_tokens,
        prompt=said.prompt,
        evidence=said.evidence,
    )


def architect_from(model: ModelCall) -> ArchitectCall:
    """기존 ModelCall을 Architect patch 반환 자리로 감싼다."""

    def asks(asked: ArchitectRequest) -> ArchitectSaid | ArchitectBalked:
        return patch_said(model(_ask_for(asked)))

    return asks


__all__ = [
    "ALLOWED_OPERATIONS",
    "ARCHITECT_PATCH_SCHEMA_NAME",
    "ARCHITECT_PROMPT_REF",
    "OPERATION_NOT_ALLOWED_MESSAGE",
    "ArchitectBalked",
    "ArchitectCall",
    "ArchitectRequest",
    "ArchitectSaid",
    "ArchitectTrouble",
    "architect_from",
    "patch_said",
]
