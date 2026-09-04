"""지금 그래프에 어떤 모양이 빠져 있는가 — 순수 규칙의 표 (설계 문서 D13).

규칙 하나는 문서를 읽고 관찰을 돌려준다: 무엇을 본 노드들이고, 왜 그렇게 말하는지, 그리고
그것이 문서에서 본 사실인지 정황뿐인 짐작인지. "이 모양을 넣으라"고 말하지 않는다 — 그
판단은 사람이 하고, Improve는 이것을 근거 줄로만 싣는다. 예외를 던지지 않고, 아무것도
바꾸지 않는다.

새 패턴을 더하는 일은 카탈로그에 항목 하나와 여기 표에 규칙 하나를 더하는 일이다
(기존 규칙을 고치지 않는다 — OCP).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from agentcanvas_contracts.agent_spec import AgentSpec, Node
from agentcanvas_contracts.localized import LocalizedText
from agentcanvas_contracts.patterns import DEFAULT_PATTERNS

from ..node_work import DEFAULT_MAX_TURNS
from .tool_reach import acts_on_its_own, reaches_for_tools

AGENT_NODE_TYPE = "llm.agent"
GATE_NODE_TYPE = "control.human_gate"
ROUTER_NODE_TYPE = "llm.router"

#: 문서에서 본 사실(strong)과 정황뿐인 짐작(weak) — 화면은 짐작을 권하기 전에 사람에게 묻는다.
type SignalStrength = Literal["strong", "weak"]


@dataclass(frozen=True)
class PatternSignal:
    """이 문서에서 본 것 하나 — 어느 모양의 이야기이고, 어느 노드를 보고 하는 말인가."""

    pattern_id: str
    node_ids: tuple[str, ...]
    why: LocalizedText
    strength: SignalStrength


def _max_turns(node: Node) -> int:
    turns = node.config.get("max_turns")
    return turns if isinstance(turns, int) else DEFAULT_MAX_TURNS


def _ids_of(spec: AgentSpec, node_type: str) -> list[str]:
    return [node.id for node in spec.nodes if node.type == node_type]


def _downstream_of(spec: AgentSpec, node_id: str) -> set[str]:
    """이 노드에서 값이 흘러갈 수 있는 노드들 — 이어지지 않은 노드는 아래쪽이 아니다."""
    walked: set[str] = set()
    walking = [node_id]
    while walking:
        here = walking.pop()
        for edge in spec.edges:
            if edge.source.node == here and edge.target.node not in walked:
                walked.add(edge.target.node)
                walking.append(edge.target.node)
    return walked


def _a_person_waits_after(spec: AgentSpec, node_id: str) -> bool:
    gates = set(_ids_of(spec, GATE_NODE_TYPE))
    return bool(gates & _downstream_of(spec, node_id))


def _signal(
    pattern_id: str,
    node_ids: list[str],
    why: LocalizedText,
    strength: SignalStrength = "strong",
) -> PatternSignal:
    return PatternSignal(
        pattern_id=pattern_id, node_ids=tuple(node_ids), why=why, strength=strength
    )


def agent_calls_tools_once(spec: AgentSpec) -> list[PatternSignal]:
    caught = [
        node.id
        for node in spec.nodes
        if node.type == AGENT_NODE_TYPE
        and reaches_for_tools(node, spec.resources)
        and _max_turns(node) == DEFAULT_MAX_TURNS
    ]
    if not caught:
        return []
    return [
        _signal(
            "react",
            caught,
            LocalizedText(
                ko="도구를 쓸 수 있지만 한 번 부르고 끝나요.",
                en="It can reach for tools, but it stops after one go.",
            ),
        )
    ]


def acts_without_a_person(spec: AgentSpec) -> list[PatternSignal]:
    acting = [
        node.id
        for node in spec.nodes
        if acts_on_its_own(node, spec.resources)
        and not _a_person_waits_after(spec, node.id)
    ]
    if not acting:
        return []
    return [
        _signal(
            "human_gate",
            acting,
            LocalizedText(
                ko="사람에게 묻지 않고 바깥에 무언가 하는 단계가 있어요.",
                en="Something here acts outside without asking a person.",
            ),
        )
    ]


def one_path_only(spec: AgentSpec) -> list[PatternSignal]:
    """갈림길이 없다는 것은 갈래가 필요 없다는 뜻일 수도 있다 — 그래서 짐작(weak)이다."""
    agents = _ids_of(spec, AGENT_NODE_TYPE)
    if not agents or _ids_of(spec, ROUTER_NODE_TYPE):
        return []
    return [
        _signal(
            "router",
            agents,
            LocalizedText(
                ko="무엇이 들어오든 같은 길로만 가요.",
                en="Whatever comes in, it goes down the one path.",
            ),
            strength="weak",
        )
    ]


DETECTORS: dict[str, Callable[[AgentSpec], list[PatternSignal]]] = {
    "agent_calls_tools_once": agent_calls_tools_once,
    "acts_without_a_person": acts_without_a_person,
    "one_path_only": one_path_only,
}


def _says_nothing(spec: AgentSpec) -> list[PatternSignal]:
    """규칙이 아직 없는 이름 — 카탈로그가 앞서 나가도 실행이 멈추지 않는다."""
    return []


def detect_all(spec: AgentSpec) -> list[PatternSignal]:
    """카탈로그 차례대로 규칙을 돌려 이 문서에서 본 것을 모은다."""
    return [
        signal
        for pattern in DEFAULT_PATTERNS.values()
        for signal in DETECTORS.get(pattern.detects, _says_nothing)(spec)
    ]


__all__ = [
    "DETECTORS",
    "PatternSignal",
    "SignalStrength",
    "acts_without_a_person",
    "agent_calls_tools_once",
    "detect_all",
    "one_path_only",
]
