"""이미 일어난 일들이 적힌 모습 — 사건 하나의 최소 단위와, 그 기록에서 되살려 읽는 것들.

이 파일은 **로그의 모양**이 바뀔 때만 바뀐다: 어떤 payload에 무엇이 적히고, 그 적힌 것을
다시 읽어 지금의 상태·이미 일한 노드·사람의 답을 어떻게 되살리는가.
실행을 다시 계산하지 않는다 — 여기서 아는 것은 이벤트가 말해 준 것뿐이다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.run import ApprovalAnswer
from agentcanvas_contracts.run_events import EventType, RunEvent

#: 갈림길이 고른 길이 적히는 상태의 자리 — 조건은 이 이름을 보고 갈래를 가른다.
ROUTE = "route"


@dataclass(frozen=True)
class _Emission:
    """아직 순번과 시각이 붙지 않은 사건 하나."""

    event_type: EventType
    payload: dict[str, object] = field(default_factory=dict)
    node_id: str | None = None


def _answer_payload(approval: ApprovalAnswer) -> dict[str, object]:
    """사람이 내린 답이 이벤트에 적히는 모습 — 적어 넣은 값이 없으면 그 자리도 없다."""
    written: dict[str, object] = {"approved": approval.approved}
    if approval.values is not None:
        written["values"] = approval.values
    return written


def _written_in(event: RunEvent) -> list[dict[str, object]]:
    """한 사건이 상태에 적은 변경들 — 계약은 payload를 자유롭게 열어 두었으므로 모양을 확인한다."""
    patch = event.payload.get("patch")
    if not isinstance(patch, list):
        return []
    return [written for written in patch if isinstance(written, dict)]


def _given_at(event: RunEvent) -> Mapping[str, object]:
    """실행이 열리며 건네받은 것 — 계약은 payload를 자유롭게 열어 두었으므로 모양을 확인한다."""
    given = event.payload.get("input")
    return given if isinstance(given, Mapping) else {}


def _state_from(events: Sequence[RunEvent]) -> dict[str, object]:
    """이미 일어난 일들이 말하는 지금의 상태 — 실행을 다시 계산하지 않고 이벤트에서 읽는다.

    실행이 무엇을 건네받고 열렸는지가 상태의 첫 줄이다: 이어 달리는 노드도 그것을 본다.
    """
    state: dict[str, object] = {}
    for event in events:
        if event.event_type is EventType.RUN_STARTED:
            state.update(_given_at(event))
        elif event.event_type is EventType.DECISION_RECORDED:
            state[ROUTE] = event.payload.get("route")
        elif event.event_type is EventType.STATE_PATCH:
            for written in _written_in(event):
                path = written.get("path", "")
                if isinstance(path, str) and path.startswith("/"):
                    state[path[1:]] = written.get("value")
    return state


def _nodes_that_worked(events: Sequence[RunEvent]) -> list[str]:
    """이미 일을 마친 노드들 — 다시 걸어도 그 노드는 사건을 두 번 내지 않는다."""
    return [
        event.node_id
        for event in events
        if event.event_type is EventType.NODE_COMPLETED and event.node_id is not None
    ]


def _answers_from(events: Sequence[RunEvent]) -> dict[str, ApprovalAnswer]:
    """이미 사람이 답한 밸브들 — 답은 그 노드가 일을 마친 사건에 적혀 있다.

    답을 알아야 그 밸브에서 어느 갈래가 흘렀는지 다시 알 수 있다 (승인과 거절은 다른 갈래다).
    """
    return {
        event.node_id: ApprovalAnswer(approved=event.payload["approved"])
        for event in events
        if event.event_type is EventType.NODE_COMPLETED
        and event.node_id is not None
        and isinstance(event.payload.get("approved"), bool)
    }


def _tells_of_another_graph(events: Sequence[RunEvent], spec: AgentSpec) -> bool:
    """이 이벤트들이 다른 판의 이야기인가 — 남의 실행에 이 그래프를 이어 붙이지 않는다."""
    return any(event.spec_revision != spec.revision for event in events)
