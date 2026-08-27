"""모델에게 물어보는 일이 주입된다 — 판단도 말하기도 같은 자리에서 온다.

이 층에는 여전히 모델이 없다: 무엇을 물었고 무엇을 들었는지만 다루고, 어떻게 묻는지는 밖의 일이다.
"""

from __future__ import annotations

from typing import get_args

from agentcanvas_contracts.agent_spec import AgentSpec, Node, Position
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.model_call import (
    ModelAsk,
    ModelBalked,
    ModelCall,
    ModelSaid,
    ModelTrouble,
    says_the_first_way,
)
from agentcanvas_engine.routed_runtime import routed_run
from test_routed_runtime import RUN_ID, STARTED_AT, a_fork, a_node, a_spec, an_edge


def a_model(said: ModelSaid | ModelBalked, asked: list[ModelAsk]) -> ModelCall:
    """무엇을 물어 왔는지 적어 두고 언제나 같은 답을 하는 것 — 실 모델이 설 자리의 대역."""

    def call(ask: ModelAsk) -> ModelSaid | ModelBalked:
        asked.append(ask)
        return said

    return call


def a_talking_node(model_ref: str = "model://claude-haiku") -> AgentSpec:
    """모델에게 말을 시키는 노드 하나뿐인 그래프."""
    return a_spec(
        nodes=[
            a_node("input", "core.input"),
            Node(
                id="writer",
                type="llm.agent",
                position=Position(x=0, y=0),
                config={"model_ref": model_ref, "prompt_ref": "prompt://writer@3"},
            ),
        ],
        edges=[an_edge("in-writer", "input", "writer")],
    )


def a_node_told_what_to_do(instruction: object) -> AgentSpec:
    """지시문을 직접 적어 둔 말하기 노드 하나뿐인 그래프."""
    return a_spec(
        nodes=[
            a_node("input", "core.input"),
            Node(
                id="writer",
                type="llm.agent",
                position=Position(x=0, y=0),
                config={"model_ref": "model://default", "instruction": instruction},
            ),
        ],
        edges=[an_edge("in-writer", "input", "writer")],
    )


def a_run(spec: AgentSpec, model: ModelCall) -> list[RunEvent]:
    return routed_run(spec, run_id=RUN_ID, started_at=STARTED_AT, model=model)


def only(events: list[RunEvent], kind: EventType) -> RunEvent:
    return next(event for event in events if event.event_type is kind)


class TestWhatTheModelIsAskedFor:
    def test_it_is_asked_once_for_every_node_that_talks_to_a_model(self):
        asked: list[ModelAsk] = []

        a_run(a_talking_node(), a_model(ModelSaid(11, 7, text="hello"), asked))

        assert [ask.node.id for ask in asked] == ["writer"]

    def test_it_is_told_which_model_and_which_instruction_the_node_named(self):
        asked: list[ModelAsk] = []

        a_run(a_talking_node(), a_model(ModelSaid(11, 7, text="hello"), asked))

        assert asked[0].model_ref == "model://claude-haiku"
        assert asked[0].prompt_ref == "prompt://writer@3"

    def test_a_node_that_named_nothing_still_names_the_default_model(self):
        asked: list[ModelAsk] = []
        spec = a_spec(
            nodes=[a_node("input", "core.input"), a_node("plain")],
            edges=[an_edge("in-plain", "input", "plain")],
        )

        a_run(spec, a_model(ModelSaid(11, 7, text="hello"), asked))

        assert asked[0].model_ref == "model://default"
        assert asked[0].prompt_ref == "prompt://plain@1"

    def test_the_instruction_someone_wrote_travels_with_the_ask(self):
        asked: list[ModelAsk] = []
        spec = a_node_told_what_to_do("answer in exactly three words")

        a_run(spec, a_model(ModelSaid(11, 7, text="hello"), asked))

        assert asked[0].instruction == "answer in exactly three words"

    def test_a_node_with_no_written_instruction_carries_none(self):
        asked: list[ModelAsk] = []

        a_run(a_talking_node(), a_model(ModelSaid(11, 7, text="hello"), asked))

        assert asked[0].instruction is None

    def test_an_instruction_of_nothing_but_spaces_is_no_instruction(self):
        """공백 한 칸은 적은 것이 아니다 — 이름표 폴백이 살아 있어야 한다."""
        asked: list[ModelAsk] = []

        a_run(
            a_node_told_what_to_do("  \n "), a_model(ModelSaid(11, 7, text="hi"), asked)
        )

        assert asked[0].instruction is None

    def test_an_instruction_that_is_not_words_is_quietly_none(self):
        """옛 문서나 깨진 문서가 이상한 값을 들고 있어도 실행은 터지지 않는다."""
        asked: list[ModelAsk] = []

        a_run(a_node_told_what_to_do(7), a_model(ModelSaid(11, 7, text="hi"), asked))

        assert asked[0].instruction is None

    def test_a_fork_asks_which_of_the_ways_on_offer_to_take(self):
        asked: list[ModelAsk] = []

        a_run(a_fork(), a_model(ModelSaid(11, 7, way="b"), asked))

        assert asked[0].ways == ("a", "b")

    def test_a_node_that_only_speaks_is_offered_no_ways(self):
        asked: list[ModelAsk] = []

        a_run(a_talking_node(), a_model(ModelSaid(11, 7, text="hello"), asked))

        assert asked[0].ways == ()


class TestWhatTheModelSaidIsWrittenDown:
    def said(self) -> list[RunEvent]:
        return a_run(
            a_talking_node(),
            a_model(
                ModelSaid(
                    input_tokens=91,
                    output_tokens=13,
                    text="the answer is yes",
                    prompt="you are a step in a graph\n\nsay something",
                ),
                [],
            ),
        )

    def test_the_prompt_the_model_really_saw_is_kept(self):
        compiled = only(self.said(), EventType.PROMPT_COMPILED)

        assert (
            compiled.payload["prompt"] == "you are a step in a graph\n\nsay something"
        )

    def test_the_measured_size_of_that_prompt_is_kept_not_a_made_up_one(self):
        compiled = only(self.said(), EventType.PROMPT_COMPILED)

        assert compiled.payload["total_tokens"] == 91
        assert compiled.payload["blocks"][0]["token_count"] == 91

    def test_the_answer_the_model_gave_is_kept_word_for_word(self):
        completed = only(self.said(), EventType.LLM_COMPLETED)

        assert completed.payload["text"] == "the answer is yes"

    def test_the_measured_size_of_that_answer_is_kept(self):
        completed = only(self.said(), EventType.LLM_COMPLETED)

        assert completed.payload["output_tokens"] == 13

    def test_the_way_the_model_picked_is_the_decision_that_was_recorded(self):
        events = a_run(a_fork(), a_model(ModelSaid(11, 7, way="b"), []))

        assert only(events, EventType.DECISION_RECORDED).payload["route"] == "b"

    def test_a_model_with_nothing_to_add_leaves_the_old_payload_alone(self):
        """대역이 남길 말이 없으면 payload에 없는 자리를 지어내지 않는다."""
        events = a_run(a_talking_node(), a_model(ModelSaid(512, 128), []))

        assert "prompt" not in only(events, EventType.PROMPT_COMPILED).payload
        assert "text" not in only(events, EventType.LLM_COMPLETED).payload


class TestAModelThatCouldNotBeAsked:
    def balked(self) -> list[RunEvent]:
        return a_run(
            a_talking_node(),
            a_model(
                ModelBalked(
                    reason="provider_error",
                    message="nobody answered, so this run stopped here",
                ),
                [],
            ),
        )

    def test_the_run_fails_saying_what_kind_of_trouble_it_was(self):
        failed = only(self.balked(), EventType.RUN_FAILED)

        assert failed.payload["reason"] == "provider_error"
        assert failed.payload["message"] == "nobody answered, so this run stopped here"

    def test_the_trouble_belongs_to_the_node_that_could_not_be_worked(self):
        assert only(self.balked(), EventType.RUN_FAILED).node_id == "writer"

    def test_the_node_that_never_heard_an_answer_does_not_claim_to_be_done(self):
        events = self.balked()

        assert [
            event.node_id
            for event in events
            if event.event_type is EventType.NODE_COMPLETED
        ] == ["input"]

    def test_nothing_is_written_down_as_heard_when_nothing_was_heard(self):
        kinds = [event.event_type for event in self.balked()]

        assert EventType.LLM_COMPLETED not in kinds
        assert EventType.PROMPT_COMPILED not in kinds

    def test_the_run_stops_there_instead_of_walking_on(self):
        events = self.balked()

        assert events[-1].event_type is EventType.RUN_FAILED
        assert EventType.RUN_COMPLETED not in [event.event_type for event in events]

    def test_a_fork_that_could_not_be_asked_records_no_decision(self):
        events = a_run(
            a_fork(),
            a_model(ModelBalked(reason="unknown_model", message="no such model"), []),
        )

        assert EventType.DECISION_RECORDED not in [event.event_type for event in events]
        assert only(events, EventType.RUN_FAILED).payload["reason"] == "unknown_model"


class TestTheModelNobodyInjected:
    def test_the_run_asks_the_deterministic_stand_in_and_takes_the_first_way(self):
        assert says_the_first_way(
            ModelAsk(
                node=a_node("triage", "llm.router"),
                state={},
                ways=("a", "b"),
                model_ref="model://default",
                prompt_ref="prompt://triage@1",
            )
        ) == ModelSaid(input_tokens=512, output_tokens=128, way="a")

    def test_it_says_nothing_at_all_where_there_is_no_way_to_pick(self):
        assert says_the_first_way(
            ModelAsk(
                node=a_node("writer"),
                state={},
                ways=(),
                model_ref="model://default",
                prompt_ref="prompt://writer@1",
            )
        ) == ModelSaid(input_tokens=512, output_tokens=128)


def test_the_kinds_of_trouble_a_run_can_name_are_fixed():
    """실행이 사람에게 말할 수 있는 까닭은 이 셋뿐이다 — 늘리려면 여기서 먼저 정한다."""
    assert get_args(ModelTrouble) == (
        "unknown_model",
        "missing_secret",
        "provider_error",
    )


class TestWhoIsEverAskedToDecide:
    def a_speaking_node_with_a_fork_shaped_edge(self) -> AgentSpec:
        """길 이름을 보는 조건이 달렸지만 갈림길 노드는 아닌 것 — 말하는 노드는 판단하지 않는다."""
        return a_spec(
            nodes=[
                a_node("input", "core.input"),
                a_node("writer"),
                a_node("after"),
            ],
            edges=[
                an_edge("in-writer", "input", "writer"),
                an_edge("writer-after", "writer", "after", expression="route == 'a'"),
            ],
        )

    def test_a_node_that_only_speaks_is_never_offered_ways_to_choose_from(self):
        asked: list[ModelAsk] = []

        a_run(
            self.a_speaking_node_with_a_fork_shaped_edge(),
            a_model(ModelSaid(11, 7, text="hello"), asked),
        )

        assert [ask.ways for ask in asked] == [()]

    def test_a_way_it_happened_to_say_is_not_written_down_as_a_decision(self):
        events = a_run(
            self.a_speaking_node_with_a_fork_shaped_edge(),
            a_model(ModelSaid(11, 7, way="a", text="hello"), []),
        )

        assert EventType.DECISION_RECORDED not in [event.event_type for event in events]
