"""그래프를 도는 차례 — 어떤 연결이 어디로 이어지고, 다음에 누구의 차례인가.

이 파일은 **어떤 차례로 도는가**가 바뀔 때만 바뀐다: 무슨 일이 일어나는지도, 그 일이 어떤
사건으로 적히는지도 여기서는 모른다. 그래프의 모양만 보고 순서를 말한다.
"""

from __future__ import annotations

from collections.abc import Sequence

from agentcanvas_contracts.agent_spec import AgentSpec, Edge

from .edge_condition import named_value
from .run_log import ROUTE


def _state_keys(spec: AgentSpec) -> set[str]:
    """이 그래프가 기억하는 상태의 이름들 — 없는 자리에 쓴 patch는 가짜 상태를 지어내는 것이다."""
    known = spec.state_schema.get("properties")
    return set(known) if isinstance(known, dict) else set()


def _feeding_edges(spec: AgentSpec, node_id: str) -> list[Edge]:
    """이 노드로 들어오는 연결들 — 자기 자신과 없는 노드에서 온 것은 세지 않는다."""
    known = {node.id for node in spec.nodes}
    return [
        edge
        for edge in spec.edges
        if edge.target.node == node_id
        and edge.source.node != edge.target.node
        and edge.source.node in known
    ]


def _leaving_edges(spec: AgentSpec, node_id: str) -> list[Edge]:
    """이 노드에서 나가는 연결들 — 자기 자신과 없는 노드로 가는 것은 세지 않는다."""
    known = {node.id for node in spec.nodes}
    return [
        edge
        for edge in spec.edges
        if edge.source.node == node_id
        and edge.source.node != edge.target.node
        and edge.target.node in known
    ]


def _ways_from(spec: AgentSpec, node_id: str) -> tuple[str, ...]:
    """이 갈림길이 고를 수 있는 길 이름들 — 나가는 조건들이 바라는 값에서 읽는다."""
    ways: list[str] = []
    for edge in spec.edges:
        if edge.source.node != node_id or edge.condition is None:
            continue
        way = named_value(edge.condition.expression, ROUTE)
        if way is not None and way not in ways:
            ways.append(way)
    return tuple(ways)


class _Walk:
    """다음 차례가 누구인가만 아는 것 — 무슨 일이 일어나는지는 모른다.

    앞선 노드가 모두 결판나야 다음 노드의 차례가 온다(층위 순서). 흐르지 않기로 결판난 연결도
    결판이다 — 오지 않을 값을 영영 기다리지 않는다. 같은 층에서는 그래프에 적힌 **노드** 순서를
    따른다: 연결을 적어 넣은 순서는 실행 순서를 바꾸지 않는다.
    """

    def __init__(self, spec: AgentSpec, already_reached: Sequence[str] = ()) -> None:
        self._order = [node.id for node in spec.nodes]
        self._leaving = {
            node_id: _leaving_edges(spec, node_id) for node_id in self._order
        }
        self._waiting = {
            node_id: len(_feeding_edges(spec, node_id)) for node_id in self._order
        }
        # 이미 사건을 남긴 노드는 닿았다는 것이 사실로 적혀 있다 — 다시 따져 볼 일이 아니다.
        self._reached = {
            node_id for node_id in self._order if self._waiting[node_id] == 0
        } | {node_id for node_id in already_reached if node_id in self._waiting}
        self._settled: set[str] = set()

    def next_to_settle(self) -> str | None:
        """차례가 된 노드 — 아무도 차례가 아니면 서로 되먹이는 무리에서 하나를 푼다."""
        waited_out = [
            node_id
            for node_id in self._order
            if node_id not in self._settled and self._waiting[node_id] == 0
        ]
        if waited_out:
            return waited_out[0]
        # 서로 되먹이는 무리는 아무도 0이 되지 않는다 — 이미 닿은 것 중 첫 노드부터 푼다.
        stuck = [
            node_id
            for node_id in self._order
            if node_id not in self._settled and node_id in self._reached
        ]
        return stuck[0] if stuck else None

    def was_reached(self, node_id: str) -> bool:
        """흐르는 연결이 닿은 노드인가 — 닿지 않은 노드는 일하지 않는다."""
        return node_id in self._reached

    def settle(self, node_id: str, chosen: Sequence[Edge]) -> None:
        """이 노드는 결판났다 — 나가는 연결마다 뒤 노드의 기다림을 하나씩 던다."""
        self._settled.add(node_id)
        flowing = {edge.id for edge in chosen}
        for edge in self._leaving[node_id]:
            target = edge.target.node
            if target in self._settled:
                continue
            self._waiting[target] = max(self._waiting[target] - 1, 0)
            if edge.id in flowing:
                self._reached.add(target)
