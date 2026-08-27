"""진짜 모델을 부르지 않고도 그래프가 움직이는 것을 보여 주는 실행 — 계약 그대로의 RunEvent.

시계와 실행 이름은 밖에서 받는다: 같은 spec과 같은 시작 시각이면 언제나 같은 이벤트가 나온다.
studio의 `src/run/fakeRun.ts`와 같은 규칙을 따르는 대등한 구현이다 (같은 입력 → 같은 출력).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta

from agentcanvas_contracts.agent_spec import AgentSpec, Edge, Node
from agentcanvas_contracts.run import ApprovalAnswer
from agentcanvas_contracts.run_events import EventType, RunEvent

#: 이벤트 사이의 간격. 가짜 실행은 일정한 박자로 흐른다.
EVENT_STEP_MS = 400

#: 가짜 실행이 지어내는 숫자들 — 진짜 모델을 부르지 않았다는 뜻으로 언제나 같은 값이다.
FAKE_PROMPT_TOKENS = 512
FAKE_ANSWER_TOKENS = 128


@dataclass(frozen=True)
class _Emission:
    """아직 순번과 시각이 붙지 않은 사건 하나."""

    event_type: EventType
    payload: dict[str, object] = field(default_factory=dict)
    #: 어느 노드의 일인가 — 실행 전체의 일이면 비운다.
    node_id: str | None = None


#: 노드가 일하는 동안 무슨 일이 일어나는가.
_Work = Callable[[Node], list[_Emission]]


def _ref_of(node: Node, key: str, fallback: str) -> str:
    value = node.config.get(key)
    return value if isinstance(value, str) else fallback


def _asks_a_model(node: Node) -> list[_Emission]:
    """모델에게 물어보는 노드: 프롬프트를 만들고, 물어보고, 답을 받는다."""
    prompt_ref = _ref_of(node, "prompt_ref", f"prompt://{node.id}@1")
    model_ref = _ref_of(node, "model_ref", "model://default")
    return [
        _Emission(
            EventType.PROMPT_COMPILED,
            {
                "prompt_ref": prompt_ref,
                "blocks": [
                    {
                        "id": "system-role",
                        "included": True,
                        "token_count": FAKE_PROMPT_TOKENS,
                    }
                ],
                "total_tokens": FAKE_PROMPT_TOKENS,
            },
        ),
        _Emission(EventType.LLM_REQUESTED, {"model_ref": model_ref}),
        _Emission(
            EventType.LLM_COMPLETED,
            {"model_ref": model_ref, "output_tokens": FAKE_ANSWER_TOKENS},
        ),
    ]


def _waits_for_a_person(node: Node) -> list[_Emission]:
    """사람에게 물어보는 노드: 확인을 청하고 흐름을 멈춘다.

    멈춤과 재개 사이에서 시퀀스가 끊긴다 — 뒤 이벤트는 사람이 답한 뒤에야 생긴다 (설계 §11).
    """
    return [
        _Emission(
            EventType.HUMAN_APPROVAL_REQUESTED,
            {
                "approval_schema_ref": _ref_of(
                    node, "approval_schema_ref", f"schema://{node.id}@1"
                )
            },
        ),
        _Emission(EventType.RUN_PAUSED, {"waiting_for": node.id}),
        _Emission(EventType.RUN_RESUMED, {"waiting_for": node.id}),
    ]


#: 노드 타입마다 실행 중에 일어나는 일 — 새 타입을 흉내 내려면 여기 한 줄을 더한다.
#: 표에 없는 타입은 일을 하고 끝날 뿐 따로 남기는 이벤트가 없다.
WORK_BY_NODE_TYPE: dict[str, _Work] = {
    "llm.router": _asks_a_model,
    "llm.agent": _asks_a_model,
    "control.human_gate": _waits_for_a_person,
}


def _work_of(node: Node) -> list[_Emission]:
    return WORK_BY_NODE_TYPE.get(node.type, lambda _: [])(node)


def _state_patch(edge: Edge) -> _Emission:
    """연결을 건너간 값이 상태에 적히는 일 — 실행 상태의 사건이므로 node_id를 달지 않는다."""
    return _Emission(
        EventType.STATE_PATCH,
        {
            "edge_id": edge.id,
            "from": edge.source.node,
            "to": edge.target.node,
            "patch": [
                {
                    "op": "replace",
                    "path": f"/{edge.target.port}",
                    # payload는 기계가 주고받는 자리다 — 화면 문구가 아니므로 언어를 타지 않는다.
                    "value": f"result of {edge.source.node}.{edge.source.port}",
                }
            ],
        },
    )


def _state_keys(spec: AgentSpec) -> set[str]:
    """이 그래프가 기억하는 상태의 이름들 — 없는 자리에 쓴 patch는 가짜 상태를 지어내는 것이다."""
    known = spec.state_schema.get("properties")
    return set(known) if isinstance(known, dict) else set()


def _node_emissions(node: Node, spec: AgentSpec) -> list[_Emission]:
    """노드 하나가 일을 맡아 끝내고, 그 결과가 이어진 연결을 건너가기까지."""
    own = [
        _Emission(EventType.NODE_QUEUED, {"node_type": node.type}),
        _Emission(EventType.NODE_STARTED, {"node_type": node.type}),
        *_work_of(node),
        _Emission(EventType.NODE_COMPLETED, {"node_type": node.type}),
    ]
    kept = _state_keys(spec)
    return [
        *(replace(emission, node_id=node.id) for emission in own),
        *(
            _state_patch(edge)
            for edge in spec.edges
            if edge.source.node == node.id and edge.target.port in kept
        ),
    ]


def _feeder_counts(spec: AgentSpec) -> dict[str, int]:
    """자기를 먹여 주는 노드가 몇 개인가 — 자기 자신과 없는 노드는 세지 않는다."""
    counts = {node.id: 0 for node in spec.nodes}
    for edge in spec.edges:
        source, target = edge.source.node, edge.target.node
        if source == target or source not in counts or target not in counts:
            continue
        counts[target] += 1
    return counts


def _step_of(spec: AgentSpec) -> dict[str, int]:
    """각 노드가 몇 번째 칸에 서는가. 줄 세울 수 없는 노드(서로 되먹이는 무리)는 맨 뒤 칸이다."""
    waiting = _feeder_counts(spec)
    step: dict[str, int] = {}
    queue = [node.id for node in spec.nodes if waiting[node.id] == 0]
    for node_id in queue:
        step[node_id] = 0

    while queue:
        following: list[str] = []
        for node_id in queue:
            for edge in spec.edges:
                target = edge.target.node
                if edge.source.node != node_id:
                    continue
                if target == node_id or target not in waiting:
                    continue
                step[target] = max(step.get(target, 0), step.get(node_id, 0) + 1)
                waiting[target] -= 1
                if waiting[target] == 0:
                    following.append(target)
        queue = following

    last = max([-1, *step.values()]) + 1
    for node in spec.nodes:
        step.setdefault(node.id, last)
    return step


def _flow_order(spec: AgentSpec) -> list[str]:
    """데이터가 닿는 순서대로 늘어놓은 노드 이름. 같은 칸에 선 노드는 적힌 순서를 지킨다."""
    step = _step_of(spec)
    placed = sorted(enumerate(spec.nodes), key=lambda pair: (step[pair[1].id], pair[0]))
    return [node.id for _, node in placed]


def _answer_payload(approval: ApprovalAnswer) -> dict[str, object]:
    """사람이 내린 답이 이벤트에 적히는 모습 — 적어 넣은 값이 없으면 그 자리도 없다."""
    written: dict[str, object] = {"approved": approval.approved}
    if approval.values is not None:
        written["values"] = approval.values
    return written


def _until_the_valve(events: list[RunEvent], start: int) -> list[RunEvent]:
    """밸브에 닿으면 시퀀스는 거기서 끊긴다 — 멈춘 사건까지만 세상에 나온다."""
    rest = events[start:]
    for index, event in enumerate(rest):
        if event.event_type is EventType.RUN_PAUSED:
            return rest[: index + 1]
    return rest


def _record_approval(
    events: list[RunEvent], approval: ApprovalAnswer
) -> list[RunEvent]:
    """승인은 흐름이 다시 열린 사건에 적힌다 — 무엇을 허락해 다시 흐르는가."""
    answer = _answer_payload(approval)
    return [
        event.model_copy(update={"payload": {**event.payload, **answer}})
        if event.event_type is EventType.RUN_RESUMED
        else event
        for event in events
    ]


def _stamped(
    spec: AgentSpec,
    run_id: str,
    started_at: datetime,
    emissions: Sequence[_Emission],
    start: int = 0,
) -> list[RunEvent]:
    """아직 순번과 시각이 없는 사건들에 그것을 매긴다 — 실행은 일정한 박자로 흐른다.

    `start`는 이미 세상에 나온 사건의 수다: 이어 붙이는 사건은 그 뒤 박자에서 시작한다.
    """
    stamped = []
    for index, emission in enumerate(emissions):
        seq = start + index
        stamped.append(
            RunEvent(
                seq=seq,
                run_id=run_id,
                event_type=emission.event_type,
                timestamp=started_at + timedelta(milliseconds=seq * EVENT_STEP_MS),
                spec_revision=spec.revision,
                payload=emission.payload,
                node_id=emission.node_id,
            )
        )
    return stamped


def _whole_run(spec: AgentSpec, run_id: str, started_at: datetime) -> list[RunEvent]:
    """아무도 멈춰 세우지 않았을 때의 실행 전체 — 여기서 밸브까지를 잘라 내보낸다."""
    by_id = {node.id: node for node in spec.nodes}
    emissions = [
        _Emission(EventType.RUN_STARTED, {"spec_id": spec.id}),
        *(
            emission
            for node_id in _flow_order(spec)
            for emission in _node_emissions(by_id[node_id], spec)
        ),
        _Emission(EventType.RUN_COMPLETED, {"node_count": len(spec.nodes)}),
    ]
    return _stamped(spec, run_id, started_at, emissions)


def fake_run(spec: AgentSpec, run_id: str, started_at: datetime) -> list[RunEvent]:
    """AgentSpec 하나를 처음부터 끝까지 흉내 내어 실행한 이벤트들 — 밸브에 닿으면 거기까지."""
    return _until_the_valve(_whole_run(spec, run_id, started_at), 0)


def _nodes_that_worked(events: Sequence[RunEvent]) -> int:
    """이 실행에서 실제로 일을 마친 노드의 수 — 끝까지 가지 못한 실행은 그래프보다 적다."""
    return len(
        {
            event.node_id
            for event in events
            if event.event_type is EventType.NODE_COMPLETED
        }
    )


def _refusal(
    spec: AgentSpec, events: Sequence[RunEvent], approval: ApprovalAnswer
) -> list[_Emission]:
    """사람이 거절하면 흐름은 그 자리에서 마친다 — 기다리던 노드가 일을 마치고 실행이 닫힌다.

    뒤에 선 노드들은 한 걸음도 움직이지 않는다 (거절은 실패가 아니라 다른 결말이다).
    """
    node_id = events[-1].node_id if events else None
    node = next((one for one in spec.nodes if one.id == node_id), None)
    answer = _answer_payload(approval)
    finished = (
        [
            _Emission(
                EventType.NODE_COMPLETED, {"node_type": node.type, **answer}, node.id
            )
        ]
        if node is not None
        else []
    )
    return [
        _Emission(EventType.RUN_RESUMED, {"waiting_for": node_id, **answer}, node_id),
        *finished,
        _Emission(
            EventType.RUN_COMPLETED,
            {"node_count": _nodes_that_worked(events) + len(finished)},
        ),
    ]


def resume_fake_run(
    spec: AgentSpec, events: Sequence[RunEvent], approval: ApprovalAnswer
) -> list[RunEvent]:
    """밸브 앞에 멈춰 선 실행에 사람이 답한다 — 지금까지의 이벤트에 그 뒤를 잇는다.

    승인이면 다음 밸브(또는 끝)까지 흐르고, 거절이면 그 자리에서 실행을 마친다.
    이미 흐르고 있는(멈춰 있지 않은) 실행에는 아무 일도 일어나지 않는다.
    """
    so_far = list(events)
    if not so_far or so_far[-1].event_type is not EventType.RUN_PAUSED:
        return so_far
    run_id, started_at = so_far[0].run_id, so_far[0].timestamp
    if not approval.approved:
        refused = _refusal(spec, so_far, approval)
        return [*so_far, *_stamped(spec, run_id, started_at, refused, len(so_far))]
    whole = _whole_run(spec, run_id, started_at)
    return [*so_far, *_record_approval(_until_the_valve(whole, len(so_far)), approval)]


__all__ = [
    "EVENT_STEP_MS",
    "FAKE_ANSWER_TOKENS",
    "FAKE_PROMPT_TOKENS",
    "WORK_BY_NODE_TYPE",
    "fake_run",
    "resume_fake_run",
]
