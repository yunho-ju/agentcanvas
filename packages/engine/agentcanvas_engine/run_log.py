"""이미 일어난 일들이 적힌 모습 — 사건 하나의 최소 단위와, 그 기록에서 되살려 읽는 것들.

이 파일은 **로그의 모양**이 바뀔 때만 바뀐다: 어떤 payload에 무엇이 적히고, 그 적힌 것을
다시 읽어 지금의 상태·이미 일한 노드·사람의 답을 어떻게 되살리는가.
실행을 다시 계산하지 않는다 — 여기서 아는 것은 이벤트가 말해 준 것뿐이다.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace

from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.run import ApprovalAnswer
from agentcanvas_contracts.run_events import EventType, RunEvent

from .model_call import ModelTurn, ToolCall, TranscriptItem
from .tool_fence import NEVER_ANSWERED, declined_reply, failed_reply, reply_of

#: 갈림길이 고른 길이 적히는 상태의 자리 — 조건은 이 이름을 보고 갈래를 가른다.
ROUTE = "route"


@dataclass(frozen=True)
class _Emission:
    """아직 순번과 시각이 붙지 않은 사건 하나."""

    event_type: EventType
    payload: dict[str, object] = field(default_factory=dict)
    node_id: str | None = None
    #: 이 사건이 딸린 물음의 번호 — 한 번에 끝나는 노드의 사건은 이 자리가 비어 있다.
    turn: int | None = None


def _in_turn(emissions: Sequence[_Emission], turn: int) -> list[_Emission]:
    """이 사건들은 그 노드의 몇 번째 물음에 딸린 것인가 — 턴을 매기는 자리는 여기 하나다."""
    return [replace(emission, turn=turn) for emission in emissions]


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


@dataclass(frozen=True)
class _PickedUp:
    """멈춰 섰던 노드가 이어 달릴 자리 — 지금까지의 대화와, 아직 답을 못 받은 호출들.

    루프의 지금은 메모리가 아니라 이벤트에 있다 (설계 D8): 프로세스가 죽었다 살아나도
    같은 자리에서 이어진다.
    """

    transcript: tuple[TranscriptItem, ...] = ()
    #: 마지막 턴이 시킨 것 중 아직 부르지도, 거절되지도, 끝나지도 않은 호출들.
    calls_left: tuple[ToolCall, ...] = ()
    #: 그 노드가 지금까지 모델에게 물은 횟수 — 다음 물음의 번호다.
    turns: int = 0
    #: 사람에게 물어본 채로 답을 기다리는 호출의 표 — 사람의 답은 이 호출에만 쓰인다.
    waiting_on: str | None = None


def _calls_in(event: RunEvent) -> tuple[ToolCall, ...]:
    """한 턴이 시킨 도구 호출들 — 계약은 payload를 열어 두었으므로 모양을 확인한다."""
    told = event.payload.get("tool_calls")
    if not isinstance(told, list):
        return ()
    return tuple(
        ToolCall(
            call_id=str(one["call_id"]),
            name=str(one["name"]),
            arguments=one.get("arguments", {}),
        )
        for one in told
        if isinstance(one, dict) and "call_id" in one and "name" in one
    )


def _of(events: Sequence[RunEvent], node_id: str, kind: EventType) -> list[RunEvent]:
    return [
        event
        for event in events
        if event.node_id == node_id and event.event_type is kind
    ]


@dataclass(frozen=True)
class _HowTheCallsEnded:
    """호출마다 그 끝과, 아직 사람의 답을 기다리는 호출 하나."""

    ended: dict[str, TranscriptItem]
    waiting_on: str | None


def _how_the_calls_ended(events: Sequence[RunEvent], node_id: str) -> _HowTheCallsEnded:
    """호출마다 그 끝 — 도구가 낸 것, 어그러진 까닭, 사람이 멈춰 세운 일, 없는 이름이었던 일.

    사람이 멈춰 세운 일은 따로 적히지 않는다: 무엇을 승인해 달라 청했고(`human.approval_requested`)
    그 뒤에 아니라는 답이 왔다는(`run.resumed`) 두 사건이 그 사실이다. 답이 아직 오지 않은
    청함이 남아 있으면 그 호출이 사람을 기다리는 호출이다.
    """
    ended: dict[str, TranscriptItem] = {}
    asked: tuple[str, str] | None = None
    for event in events:
        if event.node_id != node_id:
            continue
        told = event.payload
        if event.event_type is EventType.HUMAN_APPROVAL_REQUESTED:
            call_id, name = told.get("call_id"), told.get("tool_name")
            asked = (call_id, name) if isinstance(call_id, str) else None
        elif event.event_type is EventType.RUN_RESUMED:
            if asked is not None and told.get("approved") is False:
                ended[asked[0]] = declined_reply(*asked)
            asked = None
        elif event.event_type is EventType.TOOL_POLICY_CHECKED:
            # 부르지 않기로 판정된 호출도 끝난 호출이다 — 재개가 그것을 되살리지 않는다.
            call_id, name = told.get("call_id"), told.get("tool_name")
            if isinstance(call_id, str) and told.get("allowed") is False:
                ended[call_id] = failed_reply(
                    call_id, str(name), str(told.get("reason", "not_allowed"))
                )
        elif event.event_type is EventType.TOOL_COMPLETED:
            call_id, name = told.get("call_id"), told.get("tool_name")
            if not isinstance(call_id, str):
                continue
            error = told.get("error")
            ended[call_id] = (
                reply_of(call_id, str(name), told.get("result"))
                if told.get("ok")
                else failed_reply(
                    call_id,
                    str(name),
                    str(error.get("reason")) if isinstance(error, dict) else "unknown",
                )
            )
    return _HowTheCallsEnded(
        ended=ended, waiting_on=None if asked is None else asked[0]
    )


def transcript_in(events: Sequence[RunEvent], node_id: str) -> _PickedUp:
    """이 노드가 지금까지 나눈 이야기를 이벤트에서 되살린다 — 실행을 다시 계산하지 않는다.

    부탁은 나갔는데 끝난 일이 적히지 않은 호출은 **다시 부르지 않는다**: 답을 못 봤다고
    회신하고 넘어간다 (설계 §8 — 바깥을 바꾸는 도구를 두 번 부르지 않는다).
    """
    how = _how_the_calls_ended(events, node_id)
    sent = {
        event.payload.get("call_id")
        for event in _of(events, node_id, EventType.TOOL_REQUESTED)
    }
    told: list[TranscriptItem] = []
    left: tuple[ToolCall, ...] = ()
    turns = 0
    for said in _of(events, node_id, EventType.LLM_COMPLETED):
        calls = _calls_in(said)
        text = said.payload.get("text")
        told.append(
            ModelTurn(text=text if isinstance(text, str) else None, tool_calls=calls)
        )
        turns += 1
        left = ()
        for call in calls:
            reply = how.ended.get(call.call_id)
            if reply is not None:
                told.append(reply)
            elif call.call_id in sent:
                told.append(failed_reply(call.call_id, call.name, NEVER_ANSWERED))
            else:
                left = (*left, call)
    return _PickedUp(
        transcript=tuple(told),
        calls_left=left,
        turns=turns,
        waiting_on=how.waiting_on,
    )


def _tells_of_another_graph(events: Sequence[RunEvent], spec: AgentSpec) -> bool:
    """이 이벤트들이 다른 판의 이야기인가 — 남의 실행에 이 그래프를 이어 붙이지 않는다."""
    return any(event.spec_revision != spec.revision for event in events)
