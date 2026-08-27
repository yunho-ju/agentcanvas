"""실행에 진짜 데이터가 흐른다 — 시작하며 건넨 값과, 앞 노드가 낸 말이 다음 노드에 닿는다.

모델은 여기서도 밖에서 온다: 적어 둔 말을 차례로 하는 대역을 세우고, 그물은 타지 않는다.
"""

from __future__ import annotations

import json
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
from agentcanvas_engine.model_call import ModelAsk, ModelSaid
from agentcanvas_engine.routed_runtime import resume_routed_run, routed_run

RUN_ID = "run_flowing"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)
REVISION = "sha256:" + "0" * 64


class Says:
    """적어 둔 말을 차례로 하는 모델 — 무엇을 보고 답했는지 물음 그대로 적어 둔다."""

    def __init__(self, *texts: str) -> None:
        self._texts = list(texts)
        self.asks: list[ModelAsk] = []

    def __call__(self, ask: ModelAsk) -> ModelSaid:
        self.asks.append(ask)
        assert len(self.asks) <= len(self._texts), (
            "the stand-in was asked more times than it was given answers"
        )
        return ModelSaid(
            input_tokens=7, output_tokens=3, text=self._texts[len(self.asks) - 1]
        )


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
        id="flowing",
        version=1,
        revision=REVISION,
        status=AgentStatus.DRAFT,
        input_schema={"type": "object", "properties": {}},
        state_schema=state_schema or {"type": "object", "properties": {}},
        nodes=nodes,
        edges=edges,
    )


def one_after_another() -> AgentSpec:
    """묻는 자리 하나와 말하는 노드 둘 — 앞이 낸 말이 뒤에게 흘러가야 하는 줄."""
    return a_spec(
        nodes=[
            a_node("input", "core.input"),
            a_node("writer"),
            a_node("reader"),
        ],
        edges=[
            an_edge("in-writer", "input", "writer", target_port="question"),
            an_edge("writer-reader", "writer", "reader", target_port="draft"),
        ],
        state_schema={
            "type": "object",
            "properties": {"question": {}, "draft": {}},
        },
    )


def a_writer_a_gate_and_a_reader(when: str | None = None) -> AgentSpec:
    """말하고, 사람의 확인을 기다렸다가, 그 말을 읽는 줄 — 이어 달려도 그 말이 살아 있어야 한다."""
    return a_spec(
        nodes=[
            a_node("writer"),
            a_node("gate", "control.human_gate"),
            a_node("reader"),
        ],
        edges=[
            an_edge(
                "writer-gate",
                "writer",
                "gate",
                target_port="draft",
                expression=when,
            ),
            an_edge(
                "gate-reader",
                "gate",
                "reader",
                source_port="approved",
                target_port="note",
            ),
        ],
        state_schema={"type": "object", "properties": {"draft": {}, "note": {}}},
    )


def a_fork_and_the_way_it_takes() -> AgentSpec:
    """갈림길 하나와 그 뒤의 노드 — 고른 길은 route에 적히고, 통로로는 산출이 흐르지 않는다."""
    return a_spec(
        nodes=[
            a_node("triage", "llm.router"),
            a_node("a-way"),
        ],
        edges=[
            an_edge(
                "to-a",
                "triage",
                "a-way",
                source_port="route",
                target_port="note",
                expression="route == 'a'",
            )
        ],
        state_schema={"type": "object", "properties": {"route": {}, "note": {}}},
    )


class Picks:
    """길을 고르는 모델 — 고른 길은 저쪽이 조인 봉투(JSON)에 담겨 말로도 온다."""

    def __init__(self, way: str) -> None:
        self._way = way
        self.asks: list[ModelAsk] = []

    def __call__(self, ask: ModelAsk) -> ModelSaid:
        self.asks.append(ask)
        return ModelSaid(
            input_tokens=7,
            output_tokens=3,
            way=self._way,
            text=json.dumps({"way": self._way}),
        )


def a_run(spec: AgentSpec, model, given: dict | None = None) -> list[RunEvent]:
    return routed_run(
        spec, run_id=RUN_ID, started_at=STARTED_AT, input=given, model=model
    )


def written_to(events: list[RunEvent], where: str) -> list[object]:
    """그 자리에 적힌 값들 — 상태에 무엇이 흘러 들어갔는지 사건에서 읽는다."""
    return [
        written["value"]
        for event in events
        if event.event_type is EventType.STATE_PATCH
        for written in event.payload["patch"]
        if written["path"] == f"/{where}"
    ]


class TestWhatAStepSaysFlowsToTheNextOne:
    def test_the_words_that_step_said_are_the_value_that_crosses(self):
        events = a_run(one_after_another(), Says("here is the draft", "read it"))

        assert written_to(events, "draft") == ["here is the draft"]

    def test_the_next_step_sees_those_words_in_what_flowed_in(self):
        says = Says("here is the draft", "read it")

        a_run(one_after_another(), says)

        assert says.asks[1].state["draft"] == "here is the draft"

    def test_a_step_that_said_nothing_leaves_the_words_it_always_left(self):
        """말한 적 없는 노드에서 건너간 값은 예나 지금이나 같은 자리표시다."""
        events = a_run(one_after_another(), Says("here is the draft", "read it"))

        assert written_to(events, "question") == ["result of input.output"]


class TestWhatAForkPutsOutIsTheWayNotTheEnvelope:
    def test_the_way_it_chose_is_written_where_ways_are_written(self):
        events = a_run(a_fork_and_the_way_it_takes(), Picks("a"))

        assert written_to(events, "route") == ["a"]

    def test_the_envelope_it_answered_in_never_flows_on_as_an_output(self):
        """갈림길의 산출은 고른 길이다 — 저쪽이 조인 봉투가 다음 노드의 상태로 새면 안 된다."""
        events = a_run(a_fork_and_the_way_it_takes(), Picks("a"))

        assert written_to(events, "note") == ["result of triage.route"]

    def test_the_next_step_reads_the_way_and_never_the_envelope(self):
        picks = Picks("a")

        a_run(a_fork_and_the_way_it_takes(), picks)

        flowed_in = picks.asks[1].state
        assert flowed_in["route"] == "a"
        assert flowed_in["note"] == "result of triage.route"


def opening(events: list[RunEvent]) -> RunEvent:
    return next(event for event in events if event.event_type is EventType.RUN_STARTED)


class TestStartingARunWithSomethingInHand:
    def test_what_the_run_was_given_is_what_the_first_step_sees(self):
        says = Says("here is the draft", "read it")

        a_run(one_after_another(), says, given={"topic": "rain"})

        assert says.asks[0].state["topic"] == "rain"

    def test_a_name_the_graph_never_kept_still_opens_the_run(self):
        """건넨 값은 patch가 아니라 실행이 여는 상태다 — 기억하는 자리 목록으로 거르지 않는다."""
        says = Says("here is the draft", "read it")

        a_run(one_after_another(), says, given={"nowhere_in_the_schema": "still here"})

        assert says.asks[0].state["nowhere_in_the_schema"] == "still here"

    def test_the_run_writes_down_what_it_was_started_with(self):
        events = a_run(
            one_after_another(),
            Says("here is the draft", "read it"),
            given={"topic": "rain"},
        )

        assert opening(events).payload["input"] == {"topic": "rain"}

    def test_a_run_started_with_nothing_says_nothing_about_it(self):
        events = a_run(one_after_another(), Says("here is the draft", "read it"))

        assert opening(events).payload == {"spec_id": "flowing"}


class TestCarryingOnAfterSomeoneAnswered:
    def carried_on(self, said_first: str = "here is the real draft") -> Says:
        """멈춰 선 실행에 사람이 답한 뒤, 이어 달리는 노드가 본 것을 돌려준다."""
        spec = a_writer_a_gate_and_a_reader()
        held = a_run(spec, Says(said_first), given={"topic": "rain"})
        reads = Says("I have read it")

        resume_routed_run(spec, held, ApprovalAnswer(approved=True), model=reads)

        return reads

    def test_the_step_after_the_gate_still_sees_what_the_run_was_given(self):
        assert self.carried_on().asks[0].state["topic"] == "rain"

    def test_the_words_the_first_step_said_are_still_there_after_the_answer(self):
        """이어 달리며 다시 지나는 연결이 진짜 답을 자리표시로 덮으면 안 된다."""
        assert self.carried_on().asks[0].state["draft"] == "here is the real draft"

    def test_words_survive_even_when_a_condition_hangs_off_that_step(self):
        """말하는 노드는 뒤에 길 이름을 보는 조건이 달려 있어도 길을 고르지 않는다 (P3-1).

        그러니 이어 달릴 때도 그 노드가 낸 것은 말이다 — 시작한 실행과 같은 규칙이어야 한다.
        """
        spec = a_writer_a_gate_and_a_reader(when="route == 'go'")
        held = a_run(spec, Says("here is the real draft"), given={"route": "go"})
        reads = Says("I have read it")

        resume_routed_run(spec, held, ApprovalAnswer(approved=True), model=reads)

        assert reads.asks[0].state["draft"] == "here is the real draft"

    def test_the_run_that_was_held_really_wrote_those_words_down(self):
        """위 시험이 무엇을 지키는지의 근거 — 멈추기 전 기록에 진짜 답이 적혀 있다."""
        spec = a_writer_a_gate_and_a_reader()

        held = a_run(spec, Says("here is the real draft"), given={"topic": "rain"})

        assert written_to(held, "draft") == ["here is the real draft"]
