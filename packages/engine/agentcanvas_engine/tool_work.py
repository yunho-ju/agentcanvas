"""도구 노드가 무엇을 가리키고 무엇을 건네는가, 그리고 그 일이 사건으로 남는 모습.

이 파일은 **도구 실행이 남기는 기록의 모양**이 바뀔 때만 바뀐다. 무엇을 가리키는지는
registry의 마커가 말해 준다 — 노드 타입 이름으로 분기하지 않는다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from agentcanvas_contracts.agent_spec import (
    AgentSpec,
    ApprovalPolicy,
    Node,
    ResourceBinding,
)
from agentcanvas_contracts.node_registry import (
    DEFAULT_NODE_TYPES,
    TOOL_NAME_FIELD,
    TOOL_PORTS_MARKER,
    binding_refs,
)
from agentcanvas_contracts.run_events import EventType
from agentcanvas_contracts.tool_def import ToolDef

from .model_call import ToolBrief
from .run_log import _Emission
from .tool_call import ToolBalked, ToolReturned

#: 도구가 잘 끝났을 때와 어그러졌을 때, 그 결과가 나가는 포트.
#: 사람의 답이 나가는 두 포트(PORT_BY_ANSWER)와 같은 문법이다 — 결과에 따라 한쪽만 흐른다.
PORT_BY_OUTCOME = {True: "result", False: "error"}

#: 사람이 도구 실행을 멈춰 세웠을 때 error 포트로 흐르는 값의 까닭.
STOPPED_BY_PERSON = "stopped_by_person"

#: 모델이 문서에 없는 이름을 불렀다는 판정 — 부르지 않은 까닭이자 모델에게 돌려주는 말이다.
NO_SUCH_TOOL = "no_such_tool"

#: 예산이 다해 부르지 못했다는 판정 — 같은 자리에서 같은 문법으로 말한다.
TOOL_BUDGET_SPENT = "tool_budget_spent"


def wants_approval(binding: ResourceBinding) -> bool:
    """이 연결은 도구를 부르기 전에 사람에게 물어보는가 — 정책이 정한다."""
    return binding.approval_policy is ApprovalPolicy.ASK_FIRST


def _about(
    node: Node, binding: ResourceBinding, tool: ToolDef, call_id: str | None
) -> dict[str, object]:
    """도구 사건마다 앞머리에 적히는 것 — 어느 노드가 어느 연결의 어느 도구를 두고 한 일인가.

    루프 안에서 부른 도구는 그 호출의 표(call_id)까지 적는다: 한 노드가 여러 번 부르므로
    이름만으로는 어느 부탁의 짝인지 알 수 없다. 한 번만 부르는 도구 노드는 표가 없다.
    """
    told: dict[str, object] = {
        "node_id": node.id,
        "resource_ref": binding.id,
        "tool_name": tool.name,
    }
    if call_id is not None:
        told["call_id"] = call_id
    return told


def asks_the_person(
    node: Node,
    binding: ResourceBinding,
    tool: ToolDef,
    call_id: str | None = None,
) -> _Emission:
    """도구를 부르기 전에 사람에게 청하는 일 — 무엇을 승인하는지 함께 적는다.

    사람 확인 밸브(control.human_gate)와 같은 이벤트를 쓰되, 이 승인이 **어느 도구
    호출을 위한 것인지**를 payload에 실어 카드가 무엇을 묻는지 알 수 있게 한다.
    """
    return _Emission(
        EventType.HUMAN_APPROVAL_REQUESTED,
        _about(node, binding, tool, call_id),
        node.id,
    )


def not_called(node: Node, call_id: str, tool_name: str, why: str) -> _Emission:
    """부르지 않기로 판정한 호출 — 무엇을 왜 부르지 않았는지 화면과 재개가 함께 본다.

    가리킬 연결이 없으므로(없는 이름이거나 예산이 다했다) 연결 자리는 비어 있다. 판정을
    적는 사건은 정책 확인과 같은 것이다: 부르기 전에 내린 판단이 사는 곳은 하나다.
    """
    return _Emission(
        EventType.TOOL_POLICY_CHECKED,
        {
            "node_id": node.id,
            "tool_name": tool_name,
            "call_id": call_id,
            "allowed": False,
            "reason": why,
        },
    )


def stopped(node: Node) -> dict[str, object]:
    """사람이 멈춰 세운 자리 — error 포트로 흐르는 값(도구 실패와 같은 모양)."""
    return {
        "reason": STOPPED_BY_PERSON,
        "message": f"a person stopped the tool on node {node.id!r} before it ran",
    }


def tool_name_field(node: Node) -> str | None:
    """이 노드에서 도구 이름을 적는 칸의 이름 — registry의 마커가 가리킨다."""
    node_type = DEFAULT_NODE_TYPES.get(node.type)
    if node_type is None:
        return None
    plan = node_type.config_schema.get(TOOL_PORTS_MARKER)
    if not isinstance(plan, dict):
        return None
    field = plan.get(TOOL_NAME_FIELD)
    return field if isinstance(field, str) else None


def points_at(
    spec: AgentSpec, node: Node
) -> tuple[ResourceBinding, ToolDef] | ToolBalked:
    """이 노드가 가리키는 연결과 도구 — 가리킨 것이 문서에 없으면 그 까닭을 값으로 답한다."""
    node_type = DEFAULT_NODE_TYPES.get(node.type)
    if node_type is None:
        return ToolBalked(
            reason="no_adapter",
            message=f"node type {node.type!r} is not one this runtime can run",
        )
    refs = binding_refs(node, node_type)
    binding = next(
        (resource for resource in spec.resources if refs and resource.id == refs[0]),
        None,
    )
    if binding is None:
        named = refs[0] if refs else ""
        return ToolBalked(
            reason="unknown_binding",
            message=(
                f"node {node.id!r} points at a connection named {named!r} "
                "that this document does not have"
            )
            if named
            else f"node {node.id!r} does not say which connection to use",
        )
    field = tool_name_field(node)
    wanted = node.config.get(field) if isinstance(field, str) else None
    if not isinstance(wanted, str) or not wanted.strip():
        return ToolBalked(
            reason="unknown_tool",
            message=f"node {node.id!r} does not say which tool to run",
        )
    tool = next((one for one in binding.tools if one.name == wanted), None)
    if tool is None:
        return ToolBalked(
            reason="unknown_tool",
            message=(
                f"connection {binding.id!r} does not have a tool named {wanted!r}"
            ),
        )
    return binding, tool


def is_allowed(binding: ResourceBinding, tool: ToolDef) -> bool:
    """이 연결이 이 도구를 부르게 하는가.

    좁혀 둔 목록이 없으면 아직 좁히지 않은 것이다(아무것도 못 쓴다는 뜻이 아니다).
    목록이 있으면 그 목록이 전부다.

    지금 확인하는 것은 이 목록 하나뿐이다. 연결의 `approval_policy`(사람이 확인해야
    부를 수 있는가)는 **아직 집행하지 않는다** — 그 값은 문서에 적히기만 하고 실행은
    보지 않는다(P3b에서 사람 확인 멈춤과 함께 붙인다). 없는 규율을 있는 척하지 않기
    위해 여기 적어 둔다.
    """
    return not binding.allowed_tools or tool.name in binding.allowed_tools


def input_for(tool: ToolDef, given: Mapping[str, object]) -> dict[str, object]:
    """도구에게 건널 값 — 도구가 받겠다고 적어 둔 이름만 골라 담는다.

    건네받은 것이 지금 상태일 수도(도구 노드), 모델이 시킨 인자일 수도(루프 안의 호출)
    있다. 어느 쪽이든 도구의 입력 모양 밖의 이름은 버린다: 문서에 적히지 않은 것을
    바깥으로 흘려보내지 않는다.
    """
    properties = tool.input_schema.get("properties")
    if not isinstance(properties, dict):
        return {}
    return {name: given[name] for name in properties if name in given}


def tools_offered(
    spec: AgentSpec, node: Node
) -> tuple[tuple[ResourceBinding, ToolDef], ...] | ToolBalked:
    """이 노드가 쓸 수 있는 도구들 — 적어 둔 연결의 도구 가운데 그 연결이 허락한 것만.

    가리킨 연결이 문서에 없으면 아무것도 부르기 전에 그 까닭을 값으로 답한다: 없는 연결을
    모델에게 이름만 흘려 보내지 않는다.
    """
    node_type = DEFAULT_NODE_TYPES.get(node.type)
    if node_type is None:
        return ToolBalked(
            reason="no_adapter",
            message=f"node type {node.type!r} is not one this runtime can run",
        )
    held = {resource.id: resource for resource in spec.resources}
    offered: list[tuple[ResourceBinding, ToolDef]] = []
    for ref in binding_refs(node, node_type):
        binding = held.get(ref)
        if binding is None:
            return ToolBalked(
                reason="unknown_binding",
                message=(
                    f"node {node.id!r} points at a connection named {ref!r} "
                    "that this document does not have"
                ),
            )
        offered.extend(
            (binding, tool) for tool in binding.tools if is_allowed(binding, tool)
        )
    return tuple(offered)


def briefs_of(
    offered: Sequence[tuple[ResourceBinding, ToolDef]],
) -> tuple[ToolBrief, ...]:
    """모델에게 보일 도구 한 벌씩 — 문서를 뒤지는 일은 여기서 끝난다.

    설명은 영어 쪽을 싣는다: 모델에게 가는 글이지 화면의 글이 아니다 (Architect와 같은 규칙).
    """
    return tuple(
        ToolBrief(
            name=tool.name,
            description=tool.plain_description.en,
            input_schema=tool.input_schema,
        )
        for _binding, tool in offered
    )


def checked(
    node: Node,
    binding: ResourceBinding,
    tool: ToolDef,
    allowed: bool,
    call_id: str | None = None,
) -> _Emission:
    """정책을 확인한 일 — 부르기 전에 적는다(부르지 못했어도 확인한 사실은 남는다)."""
    return _Emission(
        EventType.TOOL_POLICY_CHECKED,
        {**_about(node, binding, tool, call_id), "allowed": allowed},
    )


def requested(
    node: Node,
    binding: ResourceBinding,
    tool: ToolDef,
    given: Mapping[str, object],
    call_id: str | None = None,
) -> _Emission:
    """도구에게 부탁한 일 — 무엇을 건넸는지 함께 적는다."""
    return _Emission(
        EventType.TOOL_REQUESTED,
        {**_about(node, binding, tool, call_id), "input": dict(given)},
    )


def completed(
    node: Node,
    binding: ResourceBinding,
    tool: ToolDef,
    answer: ToolReturned | ToolBalked,
    call_id: str | None = None,
) -> _Emission:
    """도구가 끝난 일 — 잘 끝났으면 받은 것과 크기를, 어그러졌으면 그 까닭을 적는다.

    받은 것의 크기를 두 값으로 적는 것은 정직 때문이다: 지금은 통째로 실으므로 둘이 같다.
    """
    told: dict[str, object] = {
        **_about(node, binding, tool, call_id),
        "ok": isinstance(answer, ToolReturned),
    }
    if isinstance(answer, ToolReturned):
        told["result"] = answer.result
        told["original_chars"] = answer.original_chars
        told["loaded_chars"] = answer.loaded_chars
        if answer.handling is not None:
            # 후처리가 남긴 것(고른 섹션·원문 ref)을 그대로 싣는다 — 무엇을 근거로 골랐나 리플레이.
            told.update(answer.handling)
    else:
        told["error"] = {"reason": answer.reason, "message": answer.message}
        told["original_chars"] = 0
        told["loaded_chars"] = 0
    return _Emission(EventType.TOOL_COMPLETED, told)


__all__ = [
    "NO_SUCH_TOOL",
    "PORT_BY_OUTCOME",
    "STOPPED_BY_PERSON",
    "TOOL_BUDGET_SPENT",
    "asks_the_person",
    "briefs_of",
    "checked",
    "completed",
    "input_for",
    "is_allowed",
    "not_called",
    "points_at",
    "requested",
    "stopped",
    "tool_name_field",
    "tools_offered",
    "wants_approval",
]
