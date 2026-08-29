"""도구 노드가 무엇을 가리키고 무엇을 건네는가, 그리고 그 일이 사건으로 남는 모습.

이 파일은 **도구 실행이 남기는 기록의 모양**이 바뀔 때만 바뀐다. 무엇을 가리키는지는
registry의 마커가 말해 준다 — 노드 타입 이름으로 분기하지 않는다.
"""

from __future__ import annotations

from collections.abc import Mapping

from agentcanvas_contracts.agent_spec import AgentSpec, Node, ResourceBinding
from agentcanvas_contracts.node_registry import (
    DEFAULT_NODE_TYPES,
    TOOL_NAME_FIELD,
    TOOL_PORTS_MARKER,
    binding_refs,
)
from agentcanvas_contracts.run_events import EventType
from agentcanvas_contracts.tool_def import ToolDef

from .run_log import _Emission
from .tool_call import ToolBalked, ToolReturned

#: 도구가 잘 끝났을 때와 어그러졌을 때, 그 결과가 나가는 포트.
#: 사람의 답이 나가는 두 포트(PORT_BY_ANSWER)와 같은 문법이다 — 결과에 따라 한쪽만 흐른다.
PORT_BY_OUTCOME = {True: "result", False: "error"}


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


def input_for(tool: ToolDef, state: Mapping[str, object]) -> dict[str, object]:
    """도구에게 건널 값 — 도구가 받겠다고 적어 둔 이름만 지금 상태에서 골라 담는다."""
    properties = tool.input_schema.get("properties")
    if not isinstance(properties, dict):
        return {}
    return {name: state[name] for name in properties if name in state}


def checked(
    node: Node, binding: ResourceBinding, tool: ToolDef, allowed: bool
) -> _Emission:
    """정책을 확인한 일 — 부르기 전에 적는다(부르지 못했어도 확인한 사실은 남는다)."""
    return _Emission(
        EventType.TOOL_POLICY_CHECKED,
        {
            "node_id": node.id,
            "resource_ref": binding.id,
            "tool_name": tool.name,
            "allowed": allowed,
        },
    )


def requested(
    node: Node, binding: ResourceBinding, tool: ToolDef, given: Mapping[str, object]
) -> _Emission:
    """도구에게 부탁한 일 — 무엇을 건넸는지 함께 적는다."""
    return _Emission(
        EventType.TOOL_REQUESTED,
        {
            "node_id": node.id,
            "resource_ref": binding.id,
            "tool_name": tool.name,
            "input": dict(given),
        },
    )


def completed(
    node: Node,
    binding: ResourceBinding,
    tool: ToolDef,
    answer: ToolReturned | ToolBalked,
) -> _Emission:
    """도구가 끝난 일 — 잘 끝났으면 받은 것과 크기를, 어그러졌으면 그 까닭을 적는다.

    받은 것의 크기를 두 값으로 적는 것은 정직 때문이다: 지금은 통째로 실으므로 둘이 같다.
    """
    told: dict[str, object] = {
        "node_id": node.id,
        "resource_ref": binding.id,
        "tool_name": tool.name,
        "ok": isinstance(answer, ToolReturned),
    }
    if isinstance(answer, ToolReturned):
        told["result"] = answer.result
        told["original_chars"] = answer.original_chars
        told["loaded_chars"] = answer.loaded_chars
    else:
        told["error"] = {"reason": answer.reason, "message": answer.message}
        told["original_chars"] = 0
        told["loaded_chars"] = 0
    return _Emission(EventType.TOOL_COMPLETED, told)


__all__ = [
    "PORT_BY_OUTCOME",
    "checked",
    "completed",
    "input_for",
    "is_allowed",
    "points_at",
    "requested",
    "tool_name_field",
]
