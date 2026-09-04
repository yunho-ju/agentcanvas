"""이 노드가 실제로 손을 뻗을 수 있는 연결들 — 규칙과 템플릿이 함께 보는 하나의 판정.

노드 타입으로 분기하지 않는다: registry가 "여기 적힌 이름은 연결을 가리킨다"고 표시한 자리를
읽는다(에이전트의 쓸 도구든, 도구 노드의 연결이든 같은 표식이다). 문서에 없는 이름은 손이
닿지 않는 이름이라 도구로 세지 않는다 — 그 빨간 줄은 검증기의 몫이다.
"""

from __future__ import annotations

from agentcanvas_contracts.agent_spec import ApprovalPolicy, Node, ResourceBinding
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES, binding_refs


def bindings_in_reach(
    node: Node, resources: list[ResourceBinding]
) -> list[ResourceBinding]:
    node_type = DEFAULT_NODE_TYPES.get(node.type)
    if node_type is None:
        return []
    wanted = set(binding_refs(node, node_type))
    return [resource for resource in resources if resource.id in wanted]


def reaches_for_tools(node: Node, resources: list[ResourceBinding]) -> bool:
    return bool(bindings_in_reach(node, resources))


def acts_on_its_own(node: Node, resources: list[ResourceBinding]) -> bool:
    """사람에게 묻지 않고 부를 수 있는 연결이 하나라도 있는가."""
    return any(
        binding.approval_policy is not ApprovalPolicy.ASK_FIRST
        for binding in bindings_in_reach(node, resources)
    )


__all__ = ["acts_on_its_own", "bindings_in_reach", "reaches_for_tools"]
