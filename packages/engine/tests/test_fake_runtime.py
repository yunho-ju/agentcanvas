"""가짜 실행 — 진짜 모델을 부르지 않고도 그래프가 움직이는 것을 보여 주는 이벤트들.

studio의 `fakeRun.ts`와 같은 규칙을 따른다 (같은 spec·같은 시작 시각 → 같은 이벤트).
여기 케이스는 studio의 `tests/gate-run.test.ts`와 짝을 이룬다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from agentcanvas_contracts.agent_spec import AgentSpec, Edge, EdgeEndpoint, EdgeKind
from agentcanvas_contracts.run import ApprovalAnswer
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.fake_runtime import fake_run, resume_fake_run

EXAMPLE_DIR = Path(__file__).resolve().parents[3] / "examples/basic-agent"

RUN_ID = "run_example"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)

GATE = "human-gate"
SECOND_GATE = "second-gate"


def example_spec() -> AgentSpec:
    return AgentSpec.model_validate(
        json.loads((EXAMPLE_DIR / "agent_spec.json").read_text(encoding="utf-8"))
    )


def held_run(spec: AgentSpec | None = None) -> list[RunEvent]:
    return fake_run(spec or example_spec(), run_id=RUN_ID, started_at=STARTED_AT)


def approved_run() -> list[RunEvent]:
    spec = example_spec()
    return resume_fake_run(spec, held_run(spec), ApprovalAnswer(approved=True))


def rejected_run() -> list[RunEvent]:
    spec = example_spec()
    return resume_fake_run(spec, held_run(spec), ApprovalAnswer(approved=False))


def types_of(events: list[RunEvent], node_id: str) -> list[EventType]:
    return [event.event_type for event in events if event.node_id == node_id]


def without_the_gate() -> AgentSpec:
    spec = example_spec()
    return spec.model_copy(
        update={
            "nodes": [node for node in spec.nodes if node.id != GATE],
            "edges": [
                edge
                for edge in spec.edges
                if edge.source.node != GATE and edge.target.node != GATE
            ],
        }
    )


def an_approval_edge(edge_id: str, source: str, target: str, port: str) -> Edge:
    return Edge(
        id=edge_id,
        kind=EdgeKind.APPROVAL,
        source=EdgeEndpoint(node=source, port="approved"),
        target=EdgeEndpoint(node=target, port=port),
    )


def with_two_gates() -> AgentSpec:
    """사람 확인 노드가 둘 잇따라 선 그래프 — 하나를 지나도 다음이 또 기다린다."""
    spec = example_spec()
    gate = next(node for node in spec.nodes if node.id == GATE)
    kept = [edge for edge in spec.edges if edge.id != "human-output"]
    return spec.model_copy(
        update={
            "nodes": [*spec.nodes, gate.model_copy(update={"id": SECOND_GATE})],
            "edges": [
                *kept,
                an_approval_edge("human-second", GATE, SECOND_GATE, "review"),
                an_approval_edge("second-output", SECOND_GATE, "output", "input"),
            ],
        }
    )


class TestARunThatReachesAHumanGate:
    def test_it_stops_right_there_and_asks_for_a_person(self):
        assert types_of(held_run(), GATE) == [
            EventType.NODE_QUEUED,
            EventType.NODE_STARTED,
            EventType.HUMAN_APPROVAL_REQUESTED,
            EventType.RUN_PAUSED,
        ]

    def test_it_ends_held_at_the_valve_instead_of_finishing(self):
        events = held_run()

        assert events[-1].event_type is EventType.RUN_PAUSED
        assert not any(e.event_type is EventType.RUN_COMPLETED for e in events)

    def test_it_says_which_node_the_run_is_held_at(self):
        assert held_run()[-1].node_id == GATE

    def test_it_leaves_the_nodes_behind_the_valve_untouched(self):
        assert types_of(held_run(), "output") == []

    def test_a_graph_without_a_gate_runs_to_the_end_as_before(self):
        events = held_run(without_the_gate())

        assert events[-1].event_type is EventType.RUN_COMPLETED
        assert not any(e.event_type is EventType.RUN_PAUSED for e in events)

    def test_every_event_belongs_to_the_run_and_the_revision_it_ran(self):
        spec = example_spec()
        events = held_run(spec)

        assert {event.run_id for event in events} == {RUN_ID}
        assert {event.spec_revision for event in events} == {spec.revision}

    def test_the_beat_between_events_is_always_the_same(self):
        events = held_run()

        assert events[0].timestamp == STARTED_AT
        assert [event.seq for event in events] == list(range(len(events)))


class TestApprovingTheGate:
    def test_it_picks_up_where_it_stopped_and_finishes(self):
        events = approved_run()

        assert events[len(held_run())].event_type is EventType.RUN_RESUMED
        assert events[-1].event_type is EventType.RUN_COMPLETED

    def test_it_finishes_the_gate_node_itself(self):
        assert types_of(approved_run(), GATE) == [
            EventType.NODE_QUEUED,
            EventType.NODE_STARTED,
            EventType.HUMAN_APPROVAL_REQUESTED,
            EventType.RUN_PAUSED,
            EventType.RUN_RESUMED,
            EventType.NODE_COMPLETED,
        ]

    def test_it_carries_the_run_through_every_node_in_the_order_data_flows(self):
        started = [
            event.node_id
            for event in approved_run()
            if event.event_type is EventType.NODE_STARTED
        ]

        assert started == ["input", "triage", "clinical-agent", GATE, "output"]

    def test_it_keeps_everything_that_already_happened_as_it_was(self):
        held = held_run()

        assert approved_run()[: len(held)] == held

    def test_it_writes_down_what_the_person_decided(self):
        resumed = next(
            e for e in approved_run() if e.event_type is EventType.RUN_RESUMED
        )

        assert resumed.payload["approved"] is True

    def test_it_carries_the_values_the_person_filled_in(self):
        spec = example_spec()
        events = resume_fake_run(
            spec,
            held_run(spec),
            ApprovalAnswer(approved=True, values={"comment": "looks right to me"}),
        )
        resumed = next(e for e in events if e.event_type is EventType.RUN_RESUMED)

        assert resumed.payload["values"] == {"comment": "looks right to me"}
        assert resumed.payload["approved"] is True

    def test_it_writes_no_values_at_all_when_the_person_filled_nothing_in(self):
        resumed = next(
            e for e in approved_run() if e.event_type is EventType.RUN_RESUMED
        )

        assert "values" not in resumed.payload

    def test_there_is_nothing_to_resume_when_the_run_is_not_held(self):
        finished = approved_run()

        assert (
            resume_fake_run(example_spec(), finished, ApprovalAnswer(approved=True))
            == finished
        )

    def test_the_seq_keeps_counting_where_the_held_run_left_off(self):
        events = approved_run()

        assert [event.seq for event in events] == list(range(len(events)))


class TestTurningTheGateDown:
    def test_it_writes_down_that_the_person_said_no(self):
        resumed = next(
            e for e in rejected_run() if e.event_type is EventType.RUN_RESUMED
        )

        assert resumed.payload["approved"] is False

    def test_it_finishes_the_gate_node_itself(self):
        assert types_of(rejected_run(), GATE) == [
            EventType.NODE_QUEUED,
            EventType.NODE_STARTED,
            EventType.HUMAN_APPROVAL_REQUESTED,
            EventType.RUN_PAUSED,
            EventType.RUN_RESUMED,
            EventType.NODE_COMPLETED,
        ]

    def test_that_finish_says_a_person_turned_it_down(self):
        finished = [
            event
            for event in rejected_run()
            if event.node_id == GATE and event.event_type is EventType.NODE_COMPLETED
        ][-1]

        assert finished.payload["approved"] is False

    def test_it_closes_the_run_instead_of_leaving_it_hanging(self):
        assert rejected_run()[-1].event_type is EventType.RUN_COMPLETED

    def test_it_counts_only_the_nodes_that_worked(self):
        completed = rejected_run()[-1]

        assert completed.payload["node_count"] == 4

    def test_it_never_lets_the_nodes_behind_the_valve_work(self):
        events = rejected_run()

        assert types_of(events, "output") == []
        assert [
            event.node_id
            for event in events
            if event.event_type is EventType.NODE_STARTED
        ] == ["input", "triage", "clinical-agent", GATE]

    def test_it_keeps_everything_that_already_happened_as_it_was(self):
        held = held_run()

        assert rejected_run()[: len(held)] == held

    def test_the_seq_keeps_counting_without_going_back(self):
        events = rejected_run()

        assert [event.seq for event in events] == list(range(len(events)))


class TestTwoGatesOneAfterTheOther:
    def held_at_first(self) -> list[RunEvent]:
        return held_run(with_two_gates())

    def held_at_second(self) -> list[RunEvent]:
        spec = with_two_gates()
        return resume_fake_run(
            spec, self.held_at_first(), ApprovalAnswer(approved=True)
        )

    def test_it_holds_at_the_first_gate_and_leaves_the_second_alone(self):
        events = self.held_at_first()

        assert events[-1].event_type is EventType.RUN_PAUSED
        assert events[-1].node_id == GATE
        assert types_of(events, SECOND_GATE) == []

    def test_it_holds_again_at_the_second_gate_once_the_first_is_approved(self):
        events = self.held_at_second()

        assert events[-1].event_type is EventType.RUN_PAUSED
        assert events[-1].node_id == SECOND_GATE
        assert not any(e.event_type is EventType.RUN_COMPLETED for e in events)

    def test_it_can_be_turned_down_at_the_second_gate(self):
        spec = with_two_gates()
        events = resume_fake_run(
            spec, self.held_at_second(), ApprovalAnswer(approved=False)
        )

        assert types_of(events, SECOND_GATE)[-1] is EventType.NODE_COMPLETED
        assert events[-1].event_type is EventType.RUN_COMPLETED
        assert types_of(events, "output") == []

    def test_it_runs_to_the_end_when_both_gates_are_approved(self):
        spec = with_two_gates()
        events = resume_fake_run(
            spec, self.held_at_second(), ApprovalAnswer(approved=True)
        )

        assert events[-1].event_type is EventType.RUN_COMPLETED
        assert EventType.NODE_COMPLETED in types_of(events, "output")
