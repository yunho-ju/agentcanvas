"""갈림길을 실제로 타는 실행 — 어느 길로 갔는가에 따라 다른 노드가 일한다.

판단은 밖에서 주입한다: 같은 그래프라도 판단이 다르면 다른 갈래가 돈다.
"""

from __future__ import annotations

from datetime import UTC, datetime

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
from agentcanvas_engine.fake_runtime import fake_run
from agentcanvas_engine.routed_runtime import (
    RouteAsk,
    first_way,
    judged_by,
    resume_routed_run,
    routed_run,
)

RUN_ID = "run_routed"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)
REVISION = "sha256:" + "0" * 64


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


def a_spec(
    nodes: list[Node], edges: list[Edge], state_schema: dict | None = None
) -> AgentSpec:
    return AgentSpec(
        schema_version="agent.spec/v1",
        id="branching",
        version=1,
        revision=REVISION,
        status=AgentStatus.DRAFT,
        input_schema={"type": "object", "properties": {}},
        state_schema=state_schema or {"type": "object", "properties": {}},
        nodes=nodes,
        edges=edges,
    )


def a_straight_line() -> AgentSpec:
    """갈림도 조건도 없는 그래프 — 데이터가 한 줄로 흐른다."""
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


def a_fork(
    left: str = "route == 'a'",
    right: str = "route == 'b'",
    state_schema: dict | None = None,
) -> AgentSpec:
    """갈림길 하나와 그 뒤의 두 갈래 — 조건이 어느 갈래로 갈지 정한다."""
    return a_spec(
        nodes=[
            a_node("input", "core.input"),
            a_node("triage", "llm.router"),
            a_node("a-way"),
            a_node("b-way"),
        ],
        edges=[
            an_edge("in-triage", "input", "triage"),
            an_edge("to-a", "triage", "a-way", source_port="route", expression=left),
            an_edge("to-b", "triage", "b-way", source_port="route", expression=right),
        ],
        state_schema=state_schema,
    )


def picks(way: str):
    """언제나 같은 길을 고르는 판단 주체."""
    return lambda ask: way


def a_run(spec: AgentSpec, judge=first_way) -> list[RunEvent]:
    return routed_run(
        spec, run_id=RUN_ID, started_at=STARTED_AT, model=judged_by(judge)
    )


def kinds(events: list[RunEvent]) -> list[EventType]:
    return [event.event_type for event in events]


def worked(events: list[RunEvent]) -> list[str | None]:
    return [
        event.node_id for event in events if event.event_type is EventType.NODE_STARTED
    ]


class TestAGraphWithNoForkInIt:
    def test_it_makes_the_same_events_in_the_same_order_as_the_older_runtime(self):
        spec = a_straight_line()

        assert kinds(a_run(spec)) == kinds(
            fake_run(spec, run_id=RUN_ID, started_at=STARTED_AT)
        )

    def test_every_node_gets_to_work(self):
        assert worked(a_run(a_straight_line())) == ["input", "agent", "output"]

    def test_the_beat_between_events_is_always_the_same(self):
        events = a_run(a_straight_line())

        assert events[0].timestamp == STARTED_AT
        assert [event.seq for event in events] == list(range(len(events)))
        assert {event.run_id for event in events} == {RUN_ID}
        assert {event.spec_revision for event in events} == {REVISION}


class TestAForkInTheGraph:
    def test_the_way_the_judge_picked_is_the_way_that_runs(self):
        assert worked(a_run(a_fork(), picks("b"))) == ["input", "triage", "b-way"]

    def test_picking_the_other_way_runs_the_other_branch(self):
        assert worked(a_run(a_fork(), picks("a"))) == ["input", "triage", "a-way"]

    def test_the_branch_that_was_not_picked_leaves_no_trace_at_all(self):
        events = a_run(a_fork(), picks("b"))

        assert [event for event in events if event.node_id == "a-way"] == []

    def test_the_judge_is_asked_with_the_ways_it_can_choose_from(self):
        asked: list[RouteAsk] = []

        a_run(a_fork(), lambda ask: (asked.append(ask), "a")[1])

        assert [ask.node.id for ask in asked] == ["triage"]
        assert asked[0].ways == ("a", "b")

    def test_a_way_nobody_leads_to_ends_the_flow_where_it_stands(self):
        events = a_run(a_fork(), picks("nowhere"))

        assert worked(events) == ["input", "triage"]
        assert events[-1].event_type is EventType.RUN_COMPLETED

    def test_both_branches_run_when_both_conditions_are_true(self):
        both = a_fork(left="route == 'a'", right="route != 'z'")

        assert worked(a_run(both, picks("a"))) == ["input", "triage", "a-way", "b-way"]

    def test_a_condition_with_no_condition_on_it_always_flows(self):
        spec = a_spec(
            nodes=[a_node("input", "core.input"), a_node("agent")],
            edges=[an_edge("in-agent", "input", "agent")],
        )

        assert worked(a_run(spec)) == ["input", "agent"]


class TestWritingDownWhichWayWasPicked:
    def decision(self, spec: AgentSpec, judge=first_way) -> RunEvent:
        return next(
            event
            for event in a_run(spec, judge)
            if event.event_type is EventType.DECISION_RECORDED
        )

    def test_the_run_says_which_way_was_picked_and_what_was_on_offer(self):
        decided = self.decision(a_fork(), picks("b"))

        assert decided.payload["route"] == "b"
        assert decided.payload["ways"] == ["a", "b"]

    def test_the_decision_belongs_to_the_node_that_made_it(self):
        assert self.decision(a_fork(), picks("b")).node_id == "triage"

    def test_it_is_written_down_while_that_node_is_still_working(self):
        events = a_run(a_fork(), picks("b"))
        of_the_router = [
            event.event_type for event in events if event.node_id == "triage"
        ]

        assert of_the_router == [
            EventType.NODE_QUEUED,
            EventType.NODE_STARTED,
            EventType.PROMPT_COMPILED,
            EventType.LLM_REQUESTED,
            EventType.LLM_COMPLETED,
            EventType.DECISION_RECORDED,
            EventType.NODE_COMPLETED,
        ]

    def test_a_graph_that_remembers_the_way_also_writes_it_into_its_state(self):
        remembers = a_fork(state_schema={"type": "object", "properties": {"route": {}}})

        patched = [
            event.payload
            for event in a_run(remembers, picks("b"))
            if event.event_type is EventType.STATE_PATCH
        ]

        assert patched == [
            {
                "from": "triage",
                "to": "route",
                "patch": [{"op": "replace", "path": "/route", "value": "b"}],
            }
        ]

    def test_a_graph_that_does_not_remember_it_keeps_no_such_state(self):
        events = a_run(a_fork(), picks("b"))

        assert [
            event for event in events if event.event_type is EventType.STATE_PATCH
        ] == []

    def test_the_judge_sees_the_state_that_flowed_this_far(self):
        seen: list[dict] = []
        remembers = a_spec(
            nodes=[
                a_node("input", "core.input"),
                a_node("triage", "llm.router"),
                a_node("a-way"),
            ],
            edges=[
                an_edge("in-triage", "input", "triage", target_port="question"),
                an_edge("to-a", "triage", "a-way", expression="route == 'a'"),
            ],
            state_schema={"type": "object", "properties": {"question": {}}},
        )

        a_run(remembers, lambda ask: (seen.append(dict(ask.state)), "a")[1])

        assert seen == [{"question": "result of input.output"}]


class TestAConditionThisRuntimeCannotRead:
    def test_the_run_fails_instead_of_quietly_going_on(self):
        spec = a_fork(left="route in ['a']")

        events = a_run(spec, picks("a"))

        assert events[-1].event_type is EventType.RUN_FAILED
        assert worked(events) == ["input", "triage"]

    def test_it_says_which_connection_and_which_words_it_could_not_read(self):
        failed = a_run(a_fork(left="route in ['a']"), picks("a"))[-1]

        assert failed.payload["edge_id"] == "to-a"
        assert failed.payload["expression"] == "route in ['a']"


class TestAGraphThatLoopsBackOnItself:
    def test_no_node_works_twice_and_the_run_still_ends(self):
        spec = a_spec(
            nodes=[a_node("input", "core.input"), a_node("first"), a_node("second")],
            edges=[
                an_edge("in-first", "input", "first"),
                an_edge("first-second", "first", "second"),
                an_edge("second-first", "second", "first"),
            ],
        )

        events = a_run(spec)

        assert worked(events) == ["input", "first", "second"]
        assert events[-1].event_type is EventType.RUN_COMPLETED


GATE = "human-gate"


def a_gate_with_both_ways(rejected_way: bool = True) -> AgentSpec:
    """사람 확인 하나와, 승인·거절이 각각 흘러가는 갈래."""
    edges = [
        an_edge("in-gate", "input", GATE, target_port="review"),
        an_edge("gate-yes", GATE, "yes-way", source_port="approved"),
    ]
    nodes = [
        a_node("input", "core.input"),
        a_node(GATE, "control.human_gate"),
        a_node("yes-way"),
    ]
    if rejected_way:
        edges.append(an_edge("gate-no", GATE, "no-way", source_port="rejected"))
        nodes.append(a_node("no-way"))
    return a_spec(nodes=nodes, edges=edges)


def answered(
    spec: AgentSpec, approval: ApprovalAnswer, judge=first_way
) -> list[RunEvent]:
    return resume_routed_run(spec, a_run(spec, judge), approval, model=judged_by(judge))


class TestARunThatReachesAHumanGate:
    def test_it_stops_right_there_and_asks_for_a_person(self):
        events = a_run(a_gate_with_both_ways())

        assert [event.event_type for event in events if event.node_id == GATE] == [
            EventType.NODE_QUEUED,
            EventType.NODE_STARTED,
            EventType.HUMAN_APPROVAL_REQUESTED,
            EventType.RUN_PAUSED,
        ]

    def test_it_ends_held_at_the_valve_instead_of_finishing(self):
        events = a_run(a_gate_with_both_ways())

        assert events[-1].event_type is EventType.RUN_PAUSED
        assert events[-1].node_id == GATE
        assert not any(e.event_type is EventType.RUN_COMPLETED for e in events)

    def test_neither_way_out_of_the_gate_moves_before_the_answer_comes(self):
        assert worked(a_run(a_gate_with_both_ways())) == ["input", GATE]


class TestAnsweringTheGate:
    def test_saying_yes_runs_the_way_that_leaves_the_approved_port(self):
        events = answered(a_gate_with_both_ways(), ApprovalAnswer(approved=True))

        assert worked(events) == ["input", GATE, "yes-way"]
        assert events[-1].event_type is EventType.RUN_COMPLETED

    def test_saying_no_runs_the_way_that_leaves_the_rejected_port(self):
        events = answered(a_gate_with_both_ways(), ApprovalAnswer(approved=False))

        assert worked(events) == ["input", GATE, "no-way"]
        assert events[-1].event_type is EventType.RUN_COMPLETED

    def test_saying_no_where_no_such_way_was_drawn_ends_the_run_right_there(self):
        events = answered(
            a_gate_with_both_ways(rejected_way=False), ApprovalAnswer(approved=False)
        )

        assert worked(events) == ["input", GATE]
        assert events[-1].event_type is EventType.RUN_COMPLETED

    def test_the_gate_node_finishes_its_own_work_once_the_answer_is_in(self):
        events = answered(a_gate_with_both_ways(), ApprovalAnswer(approved=True))

        assert [event.event_type for event in events if event.node_id == GATE] == [
            EventType.NODE_QUEUED,
            EventType.NODE_STARTED,
            EventType.HUMAN_APPROVAL_REQUESTED,
            EventType.RUN_PAUSED,
            EventType.RUN_RESUMED,
            EventType.NODE_COMPLETED,
        ]

    def test_what_the_person_decided_is_written_where_the_run_picked_up(self):
        events = answered(
            a_gate_with_both_ways(),
            ApprovalAnswer(approved=True, values={"comment": "looks right"}),
        )
        resumed = next(e for e in events if e.event_type is EventType.RUN_RESUMED)

        assert resumed.payload["approved"] is True
        assert resumed.payload["values"] == {"comment": "looks right"}
        assert resumed.payload["waiting_for"] == GATE

    def test_nothing_is_written_about_values_the_person_never_filled_in(self):
        events = answered(a_gate_with_both_ways(), ApprovalAnswer(approved=True))
        resumed = next(e for e in events if e.event_type is EventType.RUN_RESUMED)

        assert "values" not in resumed.payload

    def test_what_already_happened_is_kept_exactly_as_it_was(self):
        spec = a_gate_with_both_ways()
        held = a_run(spec)

        events = resume_routed_run(spec, held, ApprovalAnswer(approved=True))

        assert events[: len(held)] == held
        assert [event.seq for event in events] == list(range(len(events)))


SECOND_GATE = "second-gate"


def two_gates_in_a_row() -> AgentSpec:
    """사람 확인이 둘 잇따라 선 그래프 — 하나를 지나도 다음이 또 기다린다."""
    return a_spec(
        nodes=[
            a_node("input", "core.input"),
            a_node(GATE, "control.human_gate"),
            a_node(SECOND_GATE, "control.human_gate"),
            a_node("output", "core.output"),
        ],
        edges=[
            an_edge("in-gate", "input", GATE, target_port="review"),
            an_edge(
                "gate-second",
                GATE,
                SECOND_GATE,
                source_port="approved",
                target_port="review",
            ),
            an_edge("second-out", SECOND_GATE, "output", source_port="approved"),
        ],
    )


def a_gate_before_a_condition(state_schema: dict | None = None) -> AgentSpec:
    """갈림길에서 고른 길을 사람 확인 **뒤에야** 쓰는 그래프 — 답이 온 뒤에도 그 길을 기억해야 한다."""
    return a_spec(
        nodes=[
            a_node("input", "core.input"),
            a_node("triage", "llm.router"),
            a_node(GATE, "control.human_gate"),
            a_node("kept-way"),
            a_node("other-way"),
        ],
        edges=[
            an_edge("in-triage", "input", "triage"),
            an_edge(
                "triage-gate",
                "triage",
                GATE,
                target_port="review",
                expression="route == 'keep'",
            ),
            an_edge(
                "triage-other", "triage", "other-way", expression="route == 'drop'"
            ),
            an_edge(
                "gate-kept",
                GATE,
                "kept-way",
                source_port="approved",
                expression="route == 'keep'",
            ),
        ],
        state_schema=state_schema,
    )


class TestPickingUpFromWhatWasWrittenDown:
    def test_the_way_picked_before_the_pause_still_decides_after_it(self):
        spec = a_gate_before_a_condition()

        events = answered(spec, ApprovalAnswer(approved=True), picks("keep"))

        assert worked(events)[-1] == "kept-way"

    def test_picking_the_other_way_leads_the_other_side_of_the_gate(self):
        spec = a_gate_before_a_condition()

        events = answered(spec, ApprovalAnswer(approved=True), picks("drop"))

        assert worked(events)[-1] == "other-way"

    def test_it_reads_the_way_from_the_events_alone_and_nothing_else(self):
        """이어 걷는 데 필요한 것은 이벤트뿐이다 — 시작 때의 상태를 몰래 들고 있지 않다."""
        spec = a_gate_before_a_condition()
        held = a_run(spec, picks("keep"))

        events = resume_routed_run(
            spec,
            [event.model_copy(deep=True) for event in held],
            ApprovalAnswer(approved=True),
            model=judged_by(picks("drop")),
        )

        assert worked(events)[-1] == "kept-way"

    def test_a_value_that_crossed_a_connection_is_remembered_too(self):
        remembers = a_spec(
            nodes=[
                a_node("input", "core.input"),
                a_node(GATE, "control.human_gate"),
                a_node("after"),
            ],
            edges=[
                an_edge("in-gate", "input", GATE, target_port="answer"),
                an_edge(
                    "gate-after",
                    GATE,
                    "after",
                    source_port="approved",
                    expression="answer == 'result of input.output'",
                ),
            ],
            state_schema={"type": "object", "properties": {"answer": {}}},
        )

        events = answered(remembers, ApprovalAnswer(approved=True))

        assert worked(events) == ["input", GATE, "after"]


class TestTwoGatesOneAfterTheOther:
    def held_at_second(self) -> list[RunEvent]:
        spec = two_gates_in_a_row()
        return resume_routed_run(spec, a_run(spec), ApprovalAnswer(approved=True))

    def test_it_holds_at_the_first_gate_and_leaves_the_second_alone(self):
        events = a_run(two_gates_in_a_row())

        assert events[-1].event_type is EventType.RUN_PAUSED
        assert events[-1].node_id == GATE
        assert [event for event in events if event.node_id == SECOND_GATE] == []

    def test_it_holds_again_at_the_second_gate_once_the_first_is_answered(self):
        events = self.held_at_second()

        assert events[-1].event_type is EventType.RUN_PAUSED
        assert events[-1].node_id == SECOND_GATE
        assert not any(e.event_type is EventType.RUN_COMPLETED for e in events)

    def test_answering_the_second_gate_carries_the_run_to_the_end(self):
        events = resume_routed_run(
            two_gates_in_a_row(), self.held_at_second(), ApprovalAnswer(approved=True)
        )

        assert worked(events) == ["input", GATE, SECOND_GATE, "output"]
        assert events[-1].event_type is EventType.RUN_COMPLETED
        assert [event.seq for event in events] == list(range(len(events)))

    def test_the_first_gate_is_not_asked_to_work_all_over_again(self):
        events = resume_routed_run(
            two_gates_in_a_row(), self.held_at_second(), ApprovalAnswer(approved=True)
        )
        of_the_first = [event.event_type for event in events if event.node_id == GATE]

        assert of_the_first.count(EventType.NODE_COMPLETED) == 1


class TestWhatALreadyFlowsOrNeverPaused:
    def test_there_is_nothing_to_resume_when_the_run_is_not_held(self):
        finished = answered(a_gate_with_both_ways(), ApprovalAnswer(approved=True))

        assert (
            resume_routed_run(
                a_gate_with_both_ways(), finished, ApprovalAnswer(approved=True)
            )
            == finished
        )

    def test_a_run_with_no_events_at_all_has_nothing_to_resume(self):
        assert (
            resume_routed_run(
                a_gate_with_both_ways(), [], ApprovalAnswer(approved=True)
            )
            == []
        )

    def test_a_pause_that_names_no_node_has_nothing_to_answer(self):
        """누구를 기다리는지 적히지 않은 멈춤에는 답을 이을 자리가 없다 — 지어내지 않는다."""
        held = a_run(a_gate_with_both_ways())
        nameless = [*held[:-1], held[-1].model_copy(update={"node_id": None})]

        events = resume_routed_run(
            a_gate_with_both_ways(), nameless, ApprovalAnswer(approved=True)
        )

        assert events == nameless


class TestABranchThatWasStillWaitingWhenTheRunPaused:
    def a_gate_beside_another_branch(self) -> AgentSpec:
        return a_spec(
            nodes=[
                a_node("input", "core.input"),
                a_node(GATE, "control.human_gate"),
                a_node("beside"),
                a_node("yes-way"),
            ],
            edges=[
                an_edge("in-gate", "input", GATE, target_port="review"),
                an_edge("in-beside", "input", "beside"),
                an_edge("gate-yes", GATE, "yes-way", source_port="approved"),
            ],
        )

    def test_it_waits_with_the_gate_instead_of_being_forgotten(self):
        spec = self.a_gate_beside_another_branch()
        held = a_run(spec)

        assert worked(held) == ["input", GATE]

        events = resume_routed_run(spec, held, ApprovalAnswer(approved=True))

        # 먼저 기다린 갈래가 먼저 걷는다 — 답을 받은 갈래는 그 뒤에 붙는다.
        assert worked(events) == ["input", GATE, "beside", "yes-way"]


def a_graph_that_joins(edges_first: bool) -> AgentSpec:
    """두 갈래가 한 노드에서 합류하는 그래프 — 합류한 노드는 두 갈래를 다 받은 뒤에 일한다.

    `edges_first`는 연결을 적은 순서만 바꾼다: 적은 순서가 실행 순서를 바꾸면 안 된다.
    """
    joining = an_edge("in-merge", "input", "merge", target_port="messages")
    through = an_edge("in-a", "input", "a")
    from_a = an_edge(
        "a-merge", "a", "merge", source_port="passthrough", target_port="messages"
    )
    onward = an_edge(
        "merge-out",
        "merge",
        "out",
        expression="messages == 'result of a.passthrough'",
    )
    return a_spec(
        nodes=[
            a_node("input", "core.input"),
            a_node("merge"),
            a_node("a", "llm.router"),
            a_node("out"),
        ],
        edges=[joining, through, from_a, onward]
        if edges_first
        else [through, from_a, joining, onward],
        state_schema={"type": "object", "properties": {"messages": {}}},
    )


class TestANodeTwoBranchesFlowInto:
    def test_it_waits_for_both_branches_before_it_works(self):
        assert worked(a_run(a_graph_that_joins(edges_first=True))) == [
            "input",
            "a",
            "merge",
            "out",
        ]

    def test_the_order_connections_were_written_in_changes_nothing(self):
        assert worked(a_run(a_graph_that_joins(edges_first=True))) == worked(
            a_run(a_graph_that_joins(edges_first=False))
        )


class TestARouterWithNoWaysToChooseFrom:
    def a_router_with_only_a_passage(self) -> AgentSpec:
        return a_spec(
            nodes=[
                a_node("input", "core.input"),
                a_node("triage", "llm.router"),
                a_node("after"),
            ],
            edges=[
                an_edge("in-triage", "input", "triage"),
                an_edge("triage-after", "triage", "after", source_port="passthrough"),
            ],
            state_schema={"type": "object", "properties": {"route": {}}},
        )

    def test_it_writes_down_no_decision_because_none_was_made(self):
        events = a_run(self.a_router_with_only_a_passage())

        assert [
            event for event in events if event.event_type is EventType.DECISION_RECORDED
        ] == []

    def test_it_leaves_the_state_alone_instead_of_writing_an_empty_way(self):
        events = a_run(self.a_router_with_only_a_passage())

        assert [
            event for event in events if event.event_type is EventType.STATE_PATCH
        ] == []

    def test_nobody_is_asked_to_judge_when_there_is_nothing_to_judge(self):
        asked: list[RouteAsk] = []

        a_run(
            self.a_router_with_only_a_passage(),
            lambda ask: (asked.append(ask), "a")[1],
        )

        assert asked == []

    def test_the_passage_still_carries_the_run_onward(self):
        assert worked(a_run(self.a_router_with_only_a_passage())) == [
            "input",
            "triage",
            "after",
        ]


class TestResumingARunThatDoesNotBelongToThisGraph:
    def test_a_run_of_another_revision_is_left_untouched(self):
        spec = a_gate_with_both_ways()
        held = a_run(spec)
        another = spec.model_copy(update={"revision": "sha256:" + "1" * 64})

        assert resume_routed_run(another, held, ApprovalAnswer(approved=True)) == held


class TestEventsThatDoNotSayWhatTheyShould:
    def test_a_patch_that_is_not_a_list_of_changes_is_stepped_over(self):
        spec = a_gate_before_a_condition(
            state_schema={"type": "object", "properties": {"route": {}}}
        )
        held = a_run(spec, picks("keep"))
        muddled = [
            event.model_copy(update={"payload": {"patch": "nonsense"}})
            if event.event_type is EventType.STATE_PATCH
            else event
            for event in held
        ]

        events = resume_routed_run(spec, muddled, ApprovalAnswer(approved=True))

        assert events[-1].event_type is EventType.RUN_COMPLETED

    def test_a_change_that_is_not_a_change_at_all_is_stepped_over(self):
        spec = a_gate_before_a_condition(
            state_schema={"type": "object", "properties": {"route": {}}}
        )
        held = a_run(spec, picks("keep"))
        muddled = [
            event.model_copy(update={"payload": {"patch": ["nonsense"]}})
            if event.event_type is EventType.STATE_PATCH
            else event
            for event in held
        ]

        events = resume_routed_run(spec, muddled, ApprovalAnswer(approved=True))

        assert events[-1].event_type is EventType.RUN_COMPLETED


class TestAnOlderRunWhoseEventsSayLessThanTodaysDo:
    def a_log_that_never_wrote_the_answer_down(self) -> list[RunEvent]:
        """옛 실행기가 남긴 기록 — 승인은 사건에 적히지 않고 흐름이 이어졌다는 사실만 남았다."""
        spec = two_gates_in_a_row()
        held_at_second = resume_routed_run(
            spec, a_run(spec), ApprovalAnswer(approved=True)
        )
        return [
            event.model_copy(update={"payload": {"node_type": "control.human_gate"}})
            if event.event_type is EventType.NODE_COMPLETED and event.node_id == GATE
            else event
            for event in held_at_second
        ]

    def test_the_gate_that_already_worked_is_not_asked_all_over_again(self):
        older = self.a_log_that_never_wrote_the_answer_down()

        events = resume_routed_run(
            two_gates_in_a_row(), older, ApprovalAnswer(approved=True)
        )

        asked = [
            event
            for event in events[len(older) :]
            if event.event_type is EventType.HUMAN_APPROVAL_REQUESTED
        ]
        assert asked == []

    def test_the_answer_still_carries_the_run_to_the_end(self):
        older = self.a_log_that_never_wrote_the_answer_down()

        events = resume_routed_run(
            two_gates_in_a_row(), older, ApprovalAnswer(approved=True)
        )

        assert worked(events)[-1] == "output"
        assert events[-1].event_type is EventType.RUN_COMPLETED
