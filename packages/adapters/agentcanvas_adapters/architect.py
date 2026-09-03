"""Provider-neutral Architect adapter — structured patch를 읽어 계약으로 옮긴다."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Literal

from agentcanvas_contracts.agent_spec import AgentSpec, Node, Position
from agentcanvas_contracts.architect_patch import (
    MAX_PATCH_OPERATIONS,
    AddNodeOperation,
    AddSkillOperation,
    AgentSpecPatch,
    PatchOperation,
    ReplaceNodeConfigOperation,
)
from agentcanvas_contracts.node_registry import (
    DEFAULT_NODE_TYPES,
    PortSpec,
    resolve_ports,
)
from agentcanvas_contracts.skill_def import SkillDef
from agentcanvas_contracts.starter_skills import starter_skills
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
ARCHITECT_PROMPT_REF = "prompt://architect@4"
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


def _skills_on_offer(skills: Iterable[SkillDef]) -> str:
    """고르는 데 필요한 것만 — 이름표와 이름과 쓰임새다.

    본문은 싣지 않는다: 모델은 skill을 **고르기만** 하고, 본문은 서버가 카탈로그에서
    그대로 넣는다 (지어낸 본문이 문서에 들어오지 않게).
    """
    return _as_json(
        [
            {"ref": skill.ref, "name": skill.name, "description": skill.description}
            for skill in skills
        ]
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
            (
                "When a node you add takes a model_ref setting: "
                f'Unless the request names a different model, set "model_ref" to '
                f'"{asked.model_ref}" — the model this request is being made with.'
            ),
            'An edge is only allowed when its two ports carry the same value type; a port whose value is "any" fits every type. Route a value through a port that takes "any" when the types would not match.',
            "Node types you may use (JSON):",
            _node_type_catalog(),
            "Ports of the nodes already in the base spec (JSON):",
            _base_node_ports(asked.base_spec),
            (
                "Each llm step may follow skills — writing they read before they work. "
                'Give a step the skills it needs with "skill_refs": a list of the refs '
                "below, spelled exactly as they are written. Do not invent skills and "
                "do not write skill bodies; a ref that is not listed below is dropped."
            ),
            "Skills the document holds (JSON: ref, name, description):",
            _skills_on_offer(asked.base_spec.skills),
            "Starter skills you may add (JSON: ref, name, description):",
            _skills_on_offer(starter_skills().values()),
            "Base AgentSpec:",
            base,
        ]
    )


#: 단계가 무엇을 따르는지 적는 자리 — 계약의 그 이름 하나다.
SKILL_REFS_FIELD = "skill_refs"


@dataclass(frozen=True)
class SkillsMadeReal:
    """고른 skill이 실체가 된 patch와, 아무도 모르는 이름이라 뺀 것들.

    걷어 내고 나니 할 일이 하나도 남지 않았으면 patch가 없다(None): 작업 없는 patch는
    계약이 patch라 부르지 않으므로, 부르는 쪽이 "쓸 수 없는 답"으로 다룬다.
    """

    patch: AgentSpecPatch | None
    dropped: tuple[str, ...]


def _refs_worn(config: dict[str, object]) -> list[str] | None:
    """이 설정이 입겠다고 적은 이름표들 — 적지 않았거나 모양이 다르면 없는 것이다."""
    worn = config.get(SKILL_REFS_FIELD)
    if not isinstance(worn, list) or not all(isinstance(one, str) for one in worn):
        return None
    return [str(one) for one in worn]


def _config_of(operation: PatchOperation) -> dict[str, object] | None:
    if isinstance(operation, AddNodeOperation):
        return operation.node.config
    if isinstance(operation, ReplaceNodeConfigOperation):
        return operation.config
    return None


def _wearing(operation: PatchOperation, refs: list[str]) -> PatchOperation:
    if isinstance(operation, AddNodeOperation):
        config = {**operation.node.config, SKILL_REFS_FIELD: refs}
        return operation.model_copy(
            update={"node": operation.node.model_copy(update={"config": config})}
        )
    return operation.model_copy(
        update={"config": {**operation.config, SKILL_REFS_FIELD: refs}}
    )


def _without_written_skills(
    operations: Iterable[PatchOperation],
) -> tuple[list[PatchOperation], list[str]]:
    """모델이 제 손으로 적어 보낸 skill을 걷어 낸다 — 본문을 짓는 자리는 카탈로그뿐이다.

    걷어 낸 이름표도 함께 돌려준다: 아무도 모르는 이름이었으면 그 사실을 사람에게 말해야
    한다(아는 이름이었으면 카탈로그의 원문이 대신 들어오므로 말할 것이 없다).
    """
    kept: list[PatchOperation] = []
    written: list[str] = []
    for operation in operations:
        if isinstance(operation, AddSkillOperation):
            written.append(operation.skill.ref)
            continue
        kept.append(operation)
    return kept, written


def _sorted_refs(
    worn: list[str],
    *,
    known: set[str],
    starters: Mapping[str, SkillDef],
) -> tuple[list[str], list[str], list[str]]:
    """입겠다고 적은 이름표들을 셋으로 나눈다 — 이미 가진 것, 들여올 것, 아무도 모르는 것."""
    held: list[str] = []
    bring: list[str] = []
    unknown: list[str] = []
    for ref in worn:
        if ref in known:
            held.append(ref)
        elif ref in starters:
            bring.append(ref)
        else:
            unknown.append(ref)
    return held, bring, unknown


def _once(refs: Iterable[str]) -> list[str]:
    """같은 이름표를 두 번 세지 않는다 — 차례는 그대로 둔다."""
    seen: list[str] = []
    for ref in refs:
        if ref not in seen:
            seen.append(ref)
    return seen


def with_skills_made_real(
    patch: AgentSpecPatch,
    *,
    held: Iterable[SkillDef],
    starters: Mapping[str, SkillDef],
) -> SkillsMadeReal:
    """모델이 고른 skill을 실체로 만든다 — 카탈로그의 원문을 patch 앞에 들인다.

    모델은 이름표만 고른다: 문서가 이미 가진 것은 그대로 두고, 시작 skill을 골랐으면 그
    SkillDef를 `add_skill`로 앞에 놓아 적용 한 번에 skill과 그것을 입은 단계가 함께 선다.
    모델이 스스로 적어 보낸 `add_skill`은 지어낸 글이라 걷어 낸다.
    아무도 모르는 이름표는 빼고 그 사실을 말한다 — 없는 것을 입은 단계를 만들지 않는다.

    자리가 모자라면(계약의 `MAX_PATCH_OPERATIONS`) skill이 아니라 patch를 지킨다: 들어가지
    못한 skill은 그 단계에서도 빠지고, 빠졌다는 사실이 함께 돌아간다.
    """
    known = {skill.ref for skill in held}
    given, written = _without_written_skills(patch.operations)
    dropped = [
        ref for ref in _once(written) if ref not in known and ref not in starters
    ]

    # 먼저 무엇을 입겠다고 했는지 읽고(고치지 않고), 자리가 얼마나 남는지 센 뒤에 고친다.
    worn_by = {
        index: _refs_worn(config)
        for index, operation in enumerate(given)
        if (config := _config_of(operation)) is not None
    }
    wanted = _once(
        ref
        for worn in worn_by.values()
        if worn is not None
        for ref in _sorted_refs(worn, known=known, starters=starters)[1]
    )
    room = MAX_PATCH_OPERATIONS - len(given)
    bringing, no_room = wanted[:room], wanted[room:]
    dropped = _once([*dropped, *no_room])

    operations: list[PatchOperation] = []
    for index, operation in enumerate(given):
        worn = worn_by.get(index)
        if worn is None:
            operations.append(operation)
            continue
        kept = [ref for ref in worn if ref in known or ref in bringing]
        dropped = _once([*dropped, *(ref for ref in worn if ref not in kept)])
        operations.append(_wearing(operation, kept) if kept != worn else operation)

    if not bringing and not dropped and not written:
        return SkillsMadeReal(patch=patch, dropped=())
    if not operations:
        return SkillsMadeReal(patch=None, dropped=tuple(dropped))
    brought: list[PatchOperation] = [
        AddSkillOperation(op="add_skill", skill=starters[ref]) for ref in bringing
    ]
    # 계약을 다시 거친다 — 우리가 앞에 놓은 것까지 합해 patch가 여전히 patch인지 묻는다.
    return SkillsMadeReal(
        patch=AgentSpecPatch(
            schema_version=patch.schema_version,
            base_revision=patch.base_revision,
            operations=[*brought, *operations],
        ),
        dropped=tuple(dropped),
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
    "SKILL_REFS_FIELD",
    "ArchitectBalked",
    "ArchitectCall",
    "ArchitectRequest",
    "ArchitectSaid",
    "ArchitectTrouble",
    "SkillsMadeReal",
    "architect_from",
    "patch_said",
    "with_skills_made_real",
]
