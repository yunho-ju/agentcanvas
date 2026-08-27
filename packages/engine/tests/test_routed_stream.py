"""실행이 흐르는 동안 사건이 묶음으로 하나씩 나온다 — 끝나야 볼 수 있는 것이 아니다.

시각은 밖에서 온다: 스트리밍 실행기는 이벤트마다 주입된 시계에게 지금이 언제인지 묻는다.
일괄 실행은 그 위에 균일한 박자의 시계를 꽂은 것뿐이라, 예전과 똑같은 이벤트가 나온다.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from itertools import chain, count

from agentcanvas_contracts.agent_spec import (
    AgentSpec,
    AgentStatus,
    Edge,
    EdgeCondition,
    EdgeEndpoint,
    EdgeKind,
    Node,
    Position,
)
from agentcanvas_contracts.run import ApprovalAnswer
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.fake_runtime import EVENT_STEP_MS
from agentcanvas_engine.routed_runtime import (
    cannot_resume,
    resume_routed_run,
    resume_routed_run_stream,
    routed_run,
    routed_run_stream,
)

RUN_ID = "run_routed"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)
REVISION = "sha256:" + "0" * 64

#: 실측 시계를 흉내 내는 박자 — 균일하지 않아야 "시계가 준 값 그대로"인지 알 수 있다.
ODD_STEPS = (7, 11, 13, 29, 31, 37, 41, 43, 47, 53)


def a_node(node_id: str, node_type: str = "llm.agent") -> Node:
    return Node(id=node_id, type=node_type, position=Position(x=0, y=0), config={})


def an_edge(
    edge_id: str,
    source: str,
    target: str,
    *,
    source_port: str = "output",
    target_port: str = "input",
    expression: str | None = None,
) -> Edge:
    return Edge(
        id=edge_id,
        kind=EdgeKind.DATA,
        source=EdgeEndpoint(node=source, port=source_port),
        target=EdgeEndpoint(node=target, port=target_port),
        condition=(
            None
            if expression is None
            else EdgeCondition(language="cel", expression=expression)
        ),
    )


def a_spec(nodes: list[Node], edges: list[Edge]) -> AgentSpec:
    return AgentSpec(
        schema_version="agent.spec/v1",
        id="streaming",
        version=1,
        revision=REVISION,
        status=AgentStatus.DRAFT,
        input_schema={"type": "object", "properties": {}},
        state_schema={"type": "object", "properties": {}},
        nodes=nodes,
        edges=edges,
    )


def a_straight_line() -> AgentSpec:
    return a_spec(
        nodes=[
            a_node("input", "core.input"),
            a_node("agent"),
            a_node("output", "core.output"),
        ],
        edges=[
            an_edge("in-agent", "input", "agent"),
            an_edge("agent-out", "agent", "output"),
        ],
    )


def a_gate_in_the_middle() -> AgentSpec:
    return a_spec(
        nodes=[
            a_node("input", "core.input"),
            a_node("gate", "control.human_gate"),
            a_node("output", "core.output"),
        ],
        edges=[
            an_edge("in-gate", "input", "gate"),
            an_edge("gate-out", "gate", "output", source_port="approved"),
        ],
    )


def a_condition_nobody_reads() -> AgentSpec:
    return a_spec(
        nodes=[a_node("input", "core.input"), a_node("agent")],
        edges=[an_edge("in-agent", "input", "agent", expression="route in ['a']")],
    )


def an_even_beat(start: int = 0) -> Callable[[], datetime]:
    """예전 실행이 흐르던 균일한 박자 — 부를 때마다 한 걸음씩 나아간다."""
    beats = count(start)
    return lambda: STARTED_AT + timedelta(milliseconds=next(beats) * EVENT_STEP_MS)


def an_odd_beat(start: int = 0) -> Callable[[], datetime]:
    """실측 시계처럼 들쭉날쭉한 박자 — 이벤트마다 다른 간격으로 시간이 흐른다."""
    steps = iter(ODD_STEPS * 20)
    moment = STARTED_AT + timedelta(seconds=start)

    def now() -> datetime:
        nonlocal moment
        moment = moment + timedelta(seconds=next(steps))
        return moment

    return now


def a_stream(
    spec: AgentSpec, clock: Callable[[], datetime] | None = None
) -> list[list[RunEvent]]:
    return list(
        routed_run_stream(
            spec, run_id=RUN_ID, clock=clock if clock is not None else an_even_beat()
        )
    )


def flat(batches: list[list[RunEvent]]) -> list[RunEvent]:
    return list(chain.from_iterable(batches))


def kinds(events: list[RunEvent]) -> list[EventType]:
    return [event.event_type for event in events]


def held_at_the_gate() -> list[RunEvent]:
    return routed_run(a_gate_in_the_middle(), run_id=RUN_ID, started_at=STARTED_AT)


def carried_on(
    events: list[RunEvent],
    approval: ApprovalAnswer,
    clock: Callable[[], datetime] | None = None,
    spec: AgentSpec | None = None,
) -> Iterator[list[RunEvent]]:
    return resume_routed_run_stream(
        spec if spec is not None else a_gate_in_the_middle(),
        events,
        approval,
        clock=clock if clock is not None else an_even_beat(len(events)),
    )


class TestARunThatComesOutInPieces:
    def test_the_first_piece_says_the_run_has_started(self):
        assert kinds(a_stream(a_straight_line())[0]) == [EventType.RUN_STARTED]

    def test_the_last_piece_says_how_the_run_ended(self):
        assert a_stream(a_straight_line())[-1][-1].event_type is EventType.RUN_COMPLETED

    def test_a_piece_is_what_one_node_did(self):
        """묶음 하나는 노드 하나의 사건들이다 — 한 묶음에 두 노드의 일이 섞이지 않는다."""
        pieces = a_stream(a_straight_line())[1:-1]

        assert [{event.node_id for event in piece} for piece in pieces] == [
            {"input"},
            {"agent"},
            {"output"},
        ]

    def test_no_piece_arrives_empty(self):
        """빈 묶음은 듣는 쪽에 아무 말도 하지 않는다 — 그런 것은 흘려보내지 않는다."""
        assert all(piece for piece in a_stream(a_straight_line()))

    def test_the_pieces_together_are_one_run_numbered_from_the_start(self):
        events = flat(a_stream(a_straight_line()))

        assert [event.seq for event in events] == list(range(len(events)))

    def test_every_event_carries_the_run_and_the_revision_it_belongs_to(self):
        spec = a_straight_line()

        events = flat(a_stream(spec))

        assert {event.run_id for event in events} == {RUN_ID}
        assert {event.spec_revision for event in events} == {spec.revision}


class TestTheClockThatWasHandedIn:
    def test_every_event_is_stamped_with_what_the_clock_said(self):
        """이 층에는 시계가 없다 — 시각은 언제나 밖에서 온 것 그대로다."""
        told = an_odd_beat()
        said: list[datetime] = []

        events = flat(a_stream(a_straight_line(), clock=lambda: _remember(told, said)))

        assert [event.timestamp for event in events] == said

    def test_an_even_beat_makes_the_run_the_batch_runtime_makes(self):
        """일괄 실행은 이 스트림에 균일한 박자를 꽂은 것 — 이벤트 하나까지 같아야 한다."""
        spec = a_straight_line()

        assert flat(a_stream(spec)) == routed_run(
            spec, run_id=RUN_ID, started_at=STARTED_AT
        )


def _remember(clock: Callable[[], datetime], said: list[datetime]) -> datetime:
    """시계가 무엇이라 답했는지 받아 적는다 — 그대로 찍혔는지 보려면 답을 알아야 한다."""
    said.append(clock())
    return said[-1]


class TestARunThatStopsBeforeItEnds:
    def test_the_pieces_stop_at_the_valve(self):
        pieces = a_stream(a_gate_in_the_middle())

        assert pieces[-1][-1].event_type is EventType.RUN_PAUSED
        assert not any(event.node_id == "output" for event in flat(pieces)), (
            "아직 답하지 않은 밸브 뒤는 아무 일도 하지 않는다"
        )

    def test_a_condition_nobody_reads_ends_the_run_in_a_piece_of_its_own(self):
        pieces = a_stream(a_condition_nobody_reads())

        assert pieces[-1][-1].event_type is EventType.RUN_FAILED


class TestCarryingOnFromWhereItStopped:
    def test_only_what_is_new_comes_out(self):
        held = held_at_the_gate()

        fresh = flat(list(carried_on(held, ApprovalAnswer(approved=True))))

        assert fresh[0].event_type is EventType.RUN_RESUMED
        assert [event.seq for event in fresh] == list(
            range(len(held), len(held) + len(fresh))
        )

    def test_the_first_piece_is_the_valve_finishing_its_work(self):
        held = held_at_the_gate()

        first = next(iter(carried_on(held, ApprovalAnswer(approved=True))))

        assert kinds(first) == [EventType.RUN_RESUMED, EventType.NODE_COMPLETED]

    def test_an_even_beat_makes_the_run_the_batch_runtime_makes(self):
        held = held_at_the_gate()

        fresh = flat(list(carried_on(held, ApprovalAnswer(approved=True))))

        assert [*held, *fresh] == resume_routed_run(
            a_gate_in_the_middle(), held, ApprovalAnswer(approved=True)
        )


class TestARunThatCannotBeCarriedOn:
    def test_a_run_with_nothing_in_it_says_so(self):
        assert cannot_resume(a_gate_in_the_middle(), []) == "no_events"

    def test_a_run_that_is_still_flowing_says_so(self):
        assert (
            cannot_resume(
                a_straight_line(), routed_run(a_straight_line(), RUN_ID, STARTED_AT)
            )
            == "not_paused"
        )

    def test_a_run_that_does_not_say_where_it_stopped_says_so(self):
        held = held_at_the_gate()
        nameless = [*held[:-1], held[-1].model_copy(update={"node_id": None})]

        assert cannot_resume(a_gate_in_the_middle(), nameless) == "nowhere_to_answer"

    def test_a_run_of_another_revision_says_so(self):
        another = a_gate_in_the_middle().model_copy(
            update={"revision": "sha256:" + "1" * 64}
        )

        assert cannot_resume(another, held_at_the_gate()) == "another_revision"

    def test_a_run_waiting_at_a_valve_has_nothing_in_its_way(self):
        assert cannot_resume(a_gate_in_the_middle(), held_at_the_gate()) is None

    def test_nothing_comes_out_of_a_run_with_nothing_in_it(self):
        assert list(carried_on([], ApprovalAnswer(approved=True))) == []

    def test_nothing_comes_out_of_a_run_that_is_still_flowing(self):
        spec = a_straight_line()
        done = routed_run(spec, run_id=RUN_ID, started_at=STARTED_AT)

        assert list(carried_on(done, ApprovalAnswer(approved=True), spec=spec)) == []
