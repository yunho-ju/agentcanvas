"""카탈로그의 템플릿을 이 문서에 채운다 — 앵커가 실제 노드가 되는 자리 (설계 문서 D10·D12).

나오는 것은 새 계약이 아니라 `agent.patch/v1`의 작업들이다: 채운 결과는 기존 apply_patch와
미리보기·승인 게이트를 그대로 탄다. 채울 수 없으면 예외가 아니라 까닭을 값으로 돌려주고,
그 까닭은 사람이 읽는 두 언어의 문장이다(무엇이 모자란지 화면이 그대로 말할 수 있게).

앵커가 가리킬 노드가 여럿이면 지어내지 않는다: 사람이 고른 노드를 `anchor`로 받고, 받지
못했으면 그 종류의 노드가 하나일 때만 채운다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from agentcanvas_contracts.agent_spec import (
    AgentSpec,
    Edge,
    EdgeEndpoint,
    Node,
    Position,
)
from agentcanvas_contracts.architect_patch import (
    AddEdgeOperation,
    AddNodeOperation,
    PatchOperation,
    RemoveEdgeOperation,
    ReplaceNodeConfigOperation,
)
from agentcanvas_contracts.localized import LocalizedText
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES, resolve_ports
from agentcanvas_contracts.patterns import (
    ANY_PORT,
    AddEdgeTemplateOp,
    AddNodeTemplateOp,
    PatchTemplate,
    RemoveEdgeTemplateOp,
    ReplaceNodeConfigTemplateOp,
    RequireToolsTemplateOp,
    TemplateEndpoint,
    TemplateOp,
)

from .tool_reach import reaches_for_tools

#: 앵커가 찾는 노드의 종류 — 그 종류의 노드가 하나일 때만 말없이 그것이 된다.
ANCHOR_NODE_TYPES = {
    "{agent}": "llm.agent",
    "{input}": "core.input",
    "{output}": "core.output",
}

NEW_ANCHOR_PREFIX = "{new:"

#: 앉을 자리가 이미 차 있을 때 비켜 앉는 거리 — 카드 한 장 높이와 줄 사이 틈
#: (studio placement.ts의 NODE_SIZE.height + GAP_NEXT와 같은 수다).
NEW_NODE_DROP_Y = 64.0

#: 사이에 앉을 두 노드를 템플릿에서 찾지 못했을 때, 지금 노드들의 오른쪽으로 물러앉는 걸음.
NEW_NODE_STEP_X = 220.0

#: 못 채우는 까닭의 이름들 — 부르는 쪽(화면·서비스)은 이 이름으로 제 문구를 고른다.
#: 도구 사정이 둘인 것은 사람이 할 일이 다르기 때문이다: 고르기(needs_tools)와
#: 만들기(no_tools_anywhere)는 같은 이름을 쓸 수 없다.
type CannotFillReason = Literal[
    "missing_node",
    "ambiguous_anchor",
    "unknown_port",
    "needs_tools",
    "no_tools_anywhere",
]


@dataclass(frozen=True)
class TemplateCannotFill:
    """이 문서에는 템플릿을 채울 수 없다 — 무엇이 모자란지 사람이 읽는 말로."""

    reason: CannotFillReason
    message: LocalizedText


class _NothingToFillWith(Exception):
    """채우는 도중 알게 된 '없음' — fill_template의 문턱에서 값으로 바뀐다."""

    def __init__(self, cannot: TemplateCannotFill) -> None:
        super().__init__(cannot.message.en)
        self.cannot = cannot


def _kind_words(anchor: str) -> LocalizedText:
    """앵커가 찾는 노드 종류를 부르는 이름 — 팔레트가 쓰는 그 이름 그대로다."""
    return DEFAULT_NODE_TYPES[ANCHOR_NODE_TYPES[anchor]].display_name


def _no_such_node(anchor: str) -> _NothingToFillWith:
    named = _kind_words(anchor)
    return _NothingToFillWith(
        TemplateCannotFill(
            reason="missing_node",
            message=LocalizedText(
                ko=f"이 문서에는 '{named.ko}' 단계가 없어요.",
                en=f"This document has no '{named.en}' step.",
            ),
        )
    )


def _which_one(anchor: str) -> _NothingToFillWith:
    named = _kind_words(anchor)
    return _NothingToFillWith(
        TemplateCannotFill(
            reason="ambiguous_anchor",
            message=LocalizedText(
                ko=f"'{named.ko}' 단계가 여럿이에요 — 어느 것에 놓을지 골라 주세요.",
                en=(
                    f"There is more than one '{named.en}' step — "
                    "pick the one to work on."
                ),
            ),
        )
    )


@dataclass
class _Filling:
    """채우는 동안의 자리 배정 — 어느 앵커가 어느 노드가 되었고, 어디에 앉았는지 기억한다."""

    spec: AgentSpec
    template: PatchTemplate
    chosen: str | None = None
    taken_node_ids: set[str] = field(default_factory=set)
    taken_edge_ids: set[str] = field(default_factory=set)
    taken_spots: set[tuple[float, float]] = field(default_factory=set)
    named: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.taken_node_ids |= {node.id for node in self.spec.nodes}
        self.taken_edge_ids |= {edge.id for edge in self.spec.edges}
        self.taken_spots |= {
            (node.position.x, node.position.y) for node in self.spec.nodes
        }

    def node_id(self, anchor: str) -> str:
        if anchor.startswith(NEW_ANCHOR_PREFIX):
            if anchor not in self.named:
                self.named[anchor] = self._free_name(
                    anchor[len(NEW_ANCHOR_PREFIX) : -1], self.taken_node_ids
                )
            return self.named[anchor]
        return self.node(anchor).id

    def node(self, anchor: str) -> Node:
        """앵커가 선 문서의 노드 — 사람이 고른 것, 아니면 그 종류의 단 하나."""
        if anchor not in ANCHOR_NODE_TYPES:
            raise _NothingToFillWith(
                TemplateCannotFill(
                    reason="missing_node",
                    message=LocalizedText(
                        ko="아직 놓지 않은 단계는 이 문서에서 찾을 수 없어요.",
                        en="A step this template has not placed yet is not in the "
                        "document.",
                    ),
                )
            )
        wanted = ANCHOR_NODE_TYPES[anchor]
        standing = [node for node in self.spec.nodes if node.type == wanted]
        picked = next(
            (node for node in standing if node.id == self.chosen),
            None,
        )
        if picked is not None:
            return picked
        if not standing:
            raise _no_such_node(anchor)
        if len(standing) > 1:
            raise _which_one(anchor)
        return standing[0]

    def endpoint(self, endpoint: TemplateEndpoint, side: str) -> EdgeEndpoint:
        return EdgeEndpoint(
            node=self.node_id(endpoint.node), port=self._port(endpoint, side)
        )

    def edge_id(self, source: EdgeEndpoint, target: EdgeEndpoint) -> str:
        return self._free_name(f"{source.node}-{target.node}", self.taken_edge_ids)

    def a_spot_for(self, anchor: str) -> Position:
        """새 노드가 앉을 자리 — 이어 줄 두 노드의 사이, 그 자리가 차 있으면 한 장 아래로."""
        between = [
            self.node(other).position
            for other in self._neighbours_of(anchor)
            if other in ANCHOR_NODE_TYPES
        ]
        spot = (
            Position(
                x=sum(position.x for position in between) / len(between),
                y=sum(position.y for position in between) / len(between),
            )
            if between
            else self._beside_the_others()
        )
        while (spot.x, spot.y) in self.taken_spots:
            spot = Position(x=spot.x, y=spot.y + NEW_NODE_DROP_Y)
        self.taken_spots.add((spot.x, spot.y))
        return spot

    def _neighbours_of(self, anchor: str) -> list[str]:
        """템플릿이 이 새 노드를 무엇과 무엇 사이에 넣는지 — 들어오는 쪽과 나가는 쪽."""
        drawn = [op for op in self.template if isinstance(op, AddEdgeTemplateOp)]
        return [op.source.node for op in drawn if op.target.node == anchor] + [
            op.target.node for op in drawn if op.source.node == anchor
        ]

    def _beside_the_others(self) -> Position:
        rightmost = max(
            (node.position for node in self.spec.nodes),
            key=lambda position: position.x,
            default=Position(x=0.0, y=0.0),
        )
        return Position(x=rightmost.x + NEW_NODE_STEP_X, y=rightmost.y)

    def _port(self, endpoint: TemplateEndpoint, side: str) -> str:
        if endpoint.port != ANY_PORT:
            return endpoint.port
        node = self.node(endpoint.node)
        node_type = DEFAULT_NODE_TYPES.get(node.type)
        ports = (
            {}
            if node_type is None
            else getattr(
                resolve_ports(
                    node, node_type, self.spec.input_schema, self.spec.resources
                ),
                side,
            )
        )
        first = next(iter(ports), None)
        if first is None:
            raise _NothingToFillWith(
                TemplateCannotFill(
                    reason="unknown_port",
                    message=LocalizedText(
                        ko=f"'{node.id}' 단계가 내보내는 값이 없어요.",
                        en=f"The step '{node.id}' hands out no value to connect.",
                    ),
                )
            )
        return first

    @staticmethod
    def _free_name(wanted: str, taken: set[str]) -> str:
        name = wanted
        number = 2
        while name in taken:
            name = f"{wanted}-{number}"
            number += 1
        taken.add(name)
        return name


def _fill_add_node(op: AddNodeTemplateOp, filling: _Filling) -> list[PatchOperation]:
    return [
        AddNodeOperation(
            op="add_node",
            node=Node(
                id=filling.node_id(op.node),
                type=op.type,
                position=filling.a_spot_for(op.node),
                config=dict(op.config),
            ),
        )
    ]


def _fill_replace_node_config(
    op: ReplaceNodeConfigTemplateOp, filling: _Filling
) -> list[PatchOperation]:
    node = filling.node(op.node)
    return [
        ReplaceNodeConfigOperation(
            op="replace_node_config",
            node_id=node.id,
            config={**node.config, **op.config},
        )
    ]


#: 이 단계가 고르지 않았을 뿐, 고를 것은 문서에 있다.
PICK_THE_TOOLS = LocalizedText(
    ko="먼저 이 단계가 쓸 도구를 골라 주세요.",
    en="Pick the tools this step may use first.",
)

#: 고를 것 자체가 없다 — 고르라고 하지 않고 만드는 길을 가리킨다 (DESIGN §7 agent-turns).
NO_TOOLS_TO_PICK = LocalizedText(
    ko="이 문서에는 도구가 붙은 연결이 아직 없어요 — 연결 패널에서 만들면 이 단계가 쓸 수 있어요.",
    en=(
        "this document has no connection with tools yet — make one in the "
        "connections panel and this step can use it."
    ),
)


def _fill_requires_tools(
    op: RequireToolsTemplateOp, filling: _Filling
) -> list[PatchOperation]:
    node = filling.node(op.node)
    if not reaches_for_tools(node, filling.spec.resources):
        there_are_tools = any(binding.tools for binding in filling.spec.resources)
        raise _NothingToFillWith(
            TemplateCannotFill(
                reason="needs_tools" if there_are_tools else "no_tools_anywhere",
                message=PICK_THE_TOOLS if there_are_tools else NO_TOOLS_TO_PICK,
            )
        )
    return []


def _fill_add_edge(op: AddEdgeTemplateOp, filling: _Filling) -> list[PatchOperation]:
    source = filling.endpoint(op.source, "outputs")
    target = filling.endpoint(op.target, "inputs")
    return [
        AddEdgeOperation(
            op="add_edge",
            edge=Edge(
                id=filling.edge_id(source, target),
                kind=op.kind,
                source=source,
                target=target,
            ),
        )
    ]


def _fill_remove_edge(
    op: RemoveEdgeTemplateOp, filling: _Filling
) -> list[PatchOperation]:
    source = filling.node_id(op.source)
    target = filling.node_id(op.target)
    return [
        RemoveEdgeOperation(op="remove_edge", edge_id=edge.id)
        for edge in filling.spec.edges
        if edge.source.node == source and edge.target.node == target
    ]


FILLERS: dict[type, Callable[[TemplateOp, _Filling], list[PatchOperation]]] = {
    AddNodeTemplateOp: _fill_add_node,
    ReplaceNodeConfigTemplateOp: _fill_replace_node_config,
    RequireToolsTemplateOp: _fill_requires_tools,
    AddEdgeTemplateOp: _fill_add_edge,
    RemoveEdgeTemplateOp: _fill_remove_edge,
}


def fill_template(
    template: PatchTemplate, spec: AgentSpec, *, anchor: str | None = None
) -> list[PatchOperation] | TemplateCannotFill:
    """앵커를 이 문서의 노드로 바꿔 patch 작업들을 만든다 — 못 채우면 그 까닭을 돌려준다.

    `anchor`는 사람이 고른 노드의 id다: 그 종류가 맞는 앵커는 그 노드가 되고, 나머지 앵커는
    문서에 그 종류가 하나일 때만 선다.
    """
    filling = _Filling(spec=spec, template=template, chosen=anchor)
    try:
        return [
            operation for op in template for operation in FILLERS[type(op)](op, filling)
        ]
    except _NothingToFillWith as nothing:
        return nothing.cannot


__all__ = [
    "ANCHOR_NODE_TYPES",
    "FILLERS",
    "NEW_NODE_DROP_Y",
    "NEW_NODE_STEP_X",
    "NO_TOOLS_TO_PICK",
    "PICK_THE_TOOLS",
    "CannotFillReason",
    "TemplateCannotFill",
    "fill_template",
]
