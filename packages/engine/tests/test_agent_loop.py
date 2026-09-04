"""AI 에이전트 노드가 도구를 부르며 답을 다듬는 루프 (설계 AGENT_PATTERNS D2~D9, §4).

각본대로 답하는 모델 대역으로 본다: 같은 각본이면 언제나 같은 이벤트가 나온다 — 루프도,
한도도, 마무리 호출도, 사람을 기다리다 이어 달리는 일도 결정론이다.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime

from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.run import ApprovalAnswer, RunStatus, run_status
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.model_call import (
    ModelAsk,
    ModelBalked,
    ModelSaid,
    ModelTurn,
    ToolCall,
    ToolReply,
)
from agentcanvas_engine.routed_runtime import (
    DEFAULT_MAX_TOOL_CALLS,
    resume_routed_run,
    routed_run,
)
from agentcanvas_engine.tool_call import ToolAsk, ToolBalked, measured
from agentcanvas_engine.tool_fence import tool_result_fence

RUN_ID = "run_loop"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)
REVISION = "sha256:" + "0" * 64

TOOL_NAME = "shelf_count"
CALL_ID = "call-1"


def a_tool(name: str = TOOL_NAME) -> dict:
    return {
        "name": name,
        "plain_description": {
            "ko": "창고에 몇 개 있는지 센다.",
            "en": "Counts what is on the shelf.",
        },
        "input_schema": {
            "type": "object",
            "properties": {"item": {"type": "string"}},
        },
        "output_schema": {
            "type": "object",
            "properties": {"count": {"type": "integer"}},
        },
        "timeout_ms": 5000,
        "call": {
            "transport": "http",
            "method": "GET",
            "url_template": "https://shelf.example.com/count",
        },
    }


def a_spec(
    *,
    max_turns: int = 2,
    toolset_refs: Sequence[str] = ("shelf",),
    approval_policy: str = "read_only_auto",
    tools: Sequence[dict] = (a_tool(),),
    max_tool_calls: int | None = None,
) -> AgentSpec:
    """도구가 든 연결 하나와, 그 연결을 쓰겠다고 적어 둔 에이전트 하나."""
    doc: dict = {
        "schema_version": "agent.spec/v1",
        "id": "shelf-agent",
        "version": 1,
        "revision": REVISION,
        "status": "draft",
        "input_schema": {"type": "object", "properties": {}},
        "state_schema": {
            "type": "object",
            "properties": {"answer": {"type": "string"}},
        },
        "resources": [
            {
                "id": "shelf",
                "kind": "http.api",
                "server_ref": "api://shelf",
                "approval_policy": approval_policy,
                "tools": list(tools),
            }
        ],
        "nodes": [
            {
                "id": "agent",
                "type": "llm.agent",
                "position": {"x": 0, "y": 0},
                "config": {
                    "model_ref": "model://default",
                    "max_turns": max_turns,
                    "toolset_refs": list(toolset_refs),
                },
            }
        ],
        "edges": [],
    }
    if max_tool_calls is not None:
        doc["execution"] = {
            "checkpointer": "postgres",
            "replay_policy": "recorded_tools_first",
            "limits": {
                "max_total_tokens": 20000,
                "max_runtime_ms": 120000,
                "max_tool_calls": max_tool_calls,
            },
        }
    return AgentSpec.model_validate(doc)


class Script:
    """각본대로 한 번에 하나씩 답하는 모델 — 받은 물음을 그대로 들고 있는다."""

    def __init__(self, *said: ModelSaid | ModelBalked) -> None:
        self._said = list(said)
        self.asked: list[ModelAsk] = []

    def __call__(self, ask: ModelAsk) -> ModelSaid | ModelBalked:
        self.asked.append(ask)
        assert len(self.asked) <= len(self._said), (
            f"the model was asked {len(self.asked)} times "
            f"but the script only says {len(self._said)}"
        )
        return self._said[len(self.asked) - 1]


def wants(name: str = TOOL_NAME, call_id: str = CALL_ID, **arguments) -> ModelSaid:
    """도구를 시키는 답 — 말은 없고 시킨 것만 있다."""
    return ModelSaid(
        input_tokens=11,
        output_tokens=7,
        tool_calls=(ToolCall(call_id=call_id, name=name, arguments=arguments),),
    )


def wants_all(*call_ids: str, name: str = TOOL_NAME) -> ModelSaid:
    """한 턴에 도구를 여럿 시키는 답 — 적힌 차례대로 부를 것들이다."""
    return ModelSaid(
        input_tokens=11,
        output_tokens=7,
        tool_calls=tuple(
            ToolCall(call_id=call_id, name=name, arguments={"item": "apple"})
            for call_id in call_ids
        ),
    )


def says(text: str | None) -> ModelSaid:
    """도구를 시키지 않고 말만 하는 답."""
    return ModelSaid(input_tokens=11, output_tokens=7, text=text)


def gives(result: object):
    """언제나 같은 것을 돌려주는 도구 대역."""
    return lambda ask: measured(result)


def breaks(reason: str = "http_error"):
    """언제나 어그러지는 도구 대역 — error 포트로 흐르는 갈래다."""
    return lambda ask: ToolBalked(reason=reason, message="the shelf did not answer")


def never_called(ask: ToolAsk):
    raise AssertionError(f"the tool {ask.tool.name!r} should not have been called")


def a_run(spec: AgentSpec, model, tool=never_called) -> list[RunEvent]:
    return routed_run(
        spec, run_id=RUN_ID, started_at=STARTED_AT, model=model, tool=tool
    )


def answered(
    spec: AgentSpec,
    events: list[RunEvent],
    approved: bool,
    model,
    tool=never_called,
) -> list[RunEvent]:
    return resume_routed_run(
        spec, events, ApprovalAnswer(approved=approved), model=model, tool=tool
    )


def shape(events: Sequence[RunEvent]) -> list[tuple[EventType, int | None]]:
    """일어난 일과 그것이 몇 번째 물음에 딸린 것인가."""
    return [(event.event_type, event.turn) for event in events]


def of_the_agent(events: Sequence[RunEvent]) -> list[RunEvent]:
    return [event for event in events if event.node_id == "agent"]


def one(events: Sequence[RunEvent], kind: EventType) -> RunEvent:
    return next(event for event in events if event.event_type is kind)


def every(events: Sequence[RunEvent], kind: EventType) -> list[RunEvent]:
    return [event for event in events if event.event_type is kind]


def what_the_tool_said(result: object, name: str = TOOL_NAME) -> ToolReply:
    """도구가 돌려준 것이 모델에게 회신되는 모습 — 펜싱까지 마친 그 글자 그대로."""
    return ToolReply(
        call_id=CALL_ID,
        name=name,
        content=tool_result_fence(
            json.dumps(result, ensure_ascii=False, sort_keys=True), name
        ),
    )


class TestAnAgentWithNoToolsToUse:
    def test_it_makes_the_very_same_events_it_always_did(self):
        events = a_run(a_spec(toolset_refs=(), max_turns=1), Script(says("hello")))

        assert shape(events) == [
            (EventType.RUN_STARTED, None),
            (EventType.NODE_QUEUED, None),
            (EventType.NODE_STARTED, None),
            (EventType.PROMPT_COMPILED, None),
            (EventType.LLM_REQUESTED, None),
            (EventType.LLM_COMPLETED, None),
            (EventType.NODE_COMPLETED, None),
            (EventType.RUN_COMPLETED, None),
        ]

    def test_nothing_in_what_it_wrote_down_speaks_of_turns(self):
        events = a_run(a_spec(toolset_refs=(), max_turns=1), Script(says("hello")))

        assert "closing" not in one(events, EventType.LLM_REQUESTED).payload
        assert "tool_calls" not in one(events, EventType.LLM_COMPLETED).payload
        assert one(events, EventType.NODE_COMPLETED).payload == {
            "node_type": "llm.agent"
        }

    def test_the_model_is_offered_no_tools(self):
        model = Script(says("hello"))

        a_run(a_spec(toolset_refs=(), max_turns=1), model)

        assert model.asked[0].tools == ()


class TestAnAgentThatCallsOneToolAndThenAnswers:
    def events(self) -> list[RunEvent]:
        return a_run(
            a_spec(max_turns=2),
            Script(wants(item="apple"), says("there are 3 apples")),
            gives({"count": 3}),
        )

    def test_the_tool_it_asked_for_runs_between_the_two_turns(self):
        assert shape(of_the_agent(self.events())) == [
            (EventType.NODE_QUEUED, None),
            (EventType.NODE_STARTED, None),
            (EventType.PROMPT_COMPILED, 0),
            (EventType.LLM_REQUESTED, 0),
            (EventType.LLM_COMPLETED, 0),
            (EventType.TOOL_POLICY_CHECKED, 0),
            (EventType.TOOL_REQUESTED, 0),
            (EventType.TOOL_COMPLETED, 0),
            (EventType.PROMPT_COMPILED, 1),
            (EventType.LLM_REQUESTED, 1),
            (EventType.LLM_COMPLETED, 1),
            (EventType.NODE_COMPLETED, None),
        ]

    def test_the_tool_events_belong_to_the_agent_and_name_the_call(self):
        requested = one(self.events(), EventType.TOOL_REQUESTED)

        assert requested.node_id == "agent"
        assert requested.payload["call_id"] == CALL_ID
        assert requested.payload["tool_name"] == TOOL_NAME
        assert requested.payload["resource_ref"] == "shelf"

    def test_what_the_model_asked_for_is_what_the_tool_is_given(self):
        assert one(self.events(), EventType.TOOL_REQUESTED).payload["input"] == {
            "item": "apple"
        }

    def test_the_turn_that_called_a_tool_says_what_it_called(self):
        first, second = every(self.events(), EventType.LLM_COMPLETED)

        assert first.payload["tool_calls"] == [
            {"call_id": CALL_ID, "name": TOOL_NAME, "arguments": {"item": "apple"}}
        ]
        assert second.payload["tool_calls"] == []

    def test_it_says_how_many_turns_it_took_and_why_it_stopped(self):
        assert one(self.events(), EventType.NODE_COMPLETED).payload == {
            "node_type": "llm.agent",
            "turns": 2,
            "closed_by": "answer",
        }

    def test_the_second_turn_hears_what_the_first_turn_found(self):
        model = Script(wants(item="apple"), says("there are 3 apples"))

        a_run(a_spec(max_turns=2), model, gives({"count": 3}))

        assert model.asked[1].transcript == (
            ModelTurn(
                text=None,
                tool_calls=(
                    ToolCall(
                        call_id=CALL_ID, name=TOOL_NAME, arguments={"item": "apple"}
                    ),
                ),
            ),
            what_the_tool_said({"count": 3}),
        )

    def test_only_the_turns_that_may_still_call_a_tool_are_offered_one(self):
        model = Script(wants(item="apple"), says("there are 3 apples"))

        a_run(a_spec(max_turns=2), model, gives({"count": 3}))

        assert [brief.name for brief in model.asked[0].tools] == [TOOL_NAME]
        assert model.asked[0].tools[0].description == "Counts what is on the shelf."


class TestAnAgentThatRunsOutOfTurns:
    def events(self):
        return a_run(
            a_spec(max_turns=1),
            Script(wants(item="apple"), says("what I found is enough")),
            gives({"count": 3}),
        )

    def test_the_last_call_is_made_with_no_tools_at_all(self):
        model = Script(wants(item="apple"), says("what I found is enough"))

        a_run(a_spec(max_turns=1), model, gives({"count": 3}))

        assert model.asked[1].tools == ()

    def test_the_run_says_which_call_was_the_closing_one(self):
        first, second = every(self.events(), EventType.LLM_REQUESTED)

        assert first.payload["closing"] is False
        assert second.payload["closing"] is True

    def test_what_it_said_at_the_end_is_the_answer_and_it_says_why_it_stopped(self):
        assert one(self.events(), EventType.NODE_COMPLETED).payload == {
            "node_type": "llm.agent",
            "turns": 2,
            "closed_by": "turn_limit",
        }


class TestAnAgentThatRunsOutOfToolCalls:
    def events(self):
        return a_run(
            a_spec(max_turns=5, max_tool_calls=1),
            Script(wants(item="apple"), says("one look was all I got")),
            gives({"count": 3}),
        )

    def test_the_tool_is_called_only_as_often_as_the_document_allows(self):
        assert len(every(self.events(), EventType.TOOL_REQUESTED)) == 1

    def test_it_closes_with_a_call_that_carries_no_tools(self):
        model = Script(wants(item="apple"), says("one look was all I got"))

        a_run(a_spec(max_turns=5, max_tool_calls=1), model, gives({"count": 3}))

        assert model.asked[1].tools == ()

    def test_it_says_the_tool_budget_is_what_stopped_it(self):
        assert one(self.events(), EventType.NODE_COMPLETED).payload == {
            "node_type": "llm.agent",
            "turns": 2,
            "closed_by": "tool_budget",
        }

    def test_a_document_that_sets_no_limit_gets_the_engines_own_budget(self):
        script = [wants(item="apple")] * DEFAULT_MAX_TOOL_CALLS
        model = Script(*script, says("that is all I could look up"))

        events = a_run(a_spec(max_turns=50), model, gives({"count": 3}))

        assert len(every(events, EventType.TOOL_REQUESTED)) == DEFAULT_MAX_TOOL_CALLS
        assert one(events, EventType.NODE_COMPLETED).payload["closed_by"] == (
            "tool_budget"
        )


class TestAnAgentThatHasNothingToSayAtTheEnd:
    def events(self):
        return a_run(
            a_spec(max_turns=1),
            Script(wants(item="apple"), says(None)),
            gives({"count": 3}),
        )

    def test_the_node_fails_and_says_it_never_reached_an_answer(self):
        failed = one(self.events(), EventType.NODE_FAILED)

        assert failed.node_id == "agent"
        assert failed.payload["reason"] == "no_final_answer"

    def test_it_does_not_pretend_the_node_finished(self):
        assert every(self.events(), EventType.NODE_COMPLETED) == []


class TestAToolThatAsksThePersonFirst:
    def spec(self) -> AgentSpec:
        return a_spec(max_turns=2, approval_policy="ask_first")

    def held(self) -> list[RunEvent]:
        return a_run(self.spec(), Script(wants(item="apple")))

    def test_the_run_stops_at_the_agent_before_the_tool_is_called(self):
        events = self.held()

        assert events[-1].event_type is EventType.RUN_PAUSED
        assert events[-1].node_id == "agent"
        assert every(events, EventType.TOOL_REQUESTED) == []

    def test_what_the_person_is_asked_about_names_the_call(self):
        asked = one(self.held(), EventType.HUMAN_APPROVAL_REQUESTED)

        assert asked.node_id == "agent"
        assert asked.payload["call_id"] == CALL_ID
        assert asked.payload["tool_name"] == TOOL_NAME
        assert asked.turn == 0

    def test_saying_yes_calls_that_very_call_and_carries_the_loop_on(self):
        events = answered(
            self.spec(),
            self.held(),
            True,
            Script(says("there are 3 apples")),
            gives({"count": 3}),
        )

        # 멈춰 설 때 이미 적힌 정책 확인은 두 번 적히지 않는다 — 부탁부터 이어진다.
        assert shape(of_the_agent(events))[-7:] == [
            (EventType.RUN_RESUMED, None),
            (EventType.TOOL_REQUESTED, 0),
            (EventType.TOOL_COMPLETED, 0),
            (EventType.PROMPT_COMPILED, 1),
            (EventType.LLM_REQUESTED, 1),
            (EventType.LLM_COMPLETED, 1),
            (EventType.NODE_COMPLETED, None),
        ]
        assert one(events, EventType.NODE_COMPLETED).payload["turns"] == 2

    def test_the_talk_so_far_is_rebuilt_from_what_was_written_down(self):
        model = Script(says("there are 3 apples"))

        answered(self.spec(), self.held(), True, model, gives({"count": 3}))

        assert model.asked[0].transcript == (
            ModelTurn(
                text=None,
                tool_calls=(
                    ToolCall(
                        call_id=CALL_ID, name=TOOL_NAME, arguments={"item": "apple"}
                    ),
                ),
            ),
            what_the_tool_said({"count": 3}),
        )


class TestAPersonWhoStopsTheCall:
    def spec(self) -> AgentSpec:
        return a_spec(max_turns=2, approval_policy="ask_first")

    def refused(self, model) -> list[RunEvent]:
        held = a_run(self.spec(), Script(wants(item="apple")))
        return answered(self.spec(), held, False, model)

    def test_the_tool_is_never_called_and_the_agent_still_answers(self):
        events = self.refused(Script(says("I could not check the shelf")))

        assert every(events, EventType.TOOL_REQUESTED) == []
        assert one(events, EventType.NODE_COMPLETED).payload["closed_by"] == "answer"

    def test_the_model_is_told_the_person_declined(self):
        model = Script(says("I could not check the shelf"))

        self.refused(model)

        assert model.asked[0].transcript[-1] == ToolReply(
            call_id=CALL_ID,
            name=TOOL_NAME,
            content="the person declined this call",
        )


class TestAToolThatFails:
    def test_the_loop_carries_on_with_the_failure_as_the_answer_it_got(self):
        model = Script(wants(item="apple"), says("the shelf would not answer"))

        events = a_run(a_spec(max_turns=2), model, breaks("http_error"))

        assert one(events, EventType.TOOL_COMPLETED).payload["ok"] is False
        assert model.asked[1].transcript[-1] == ToolReply(
            call_id=CALL_ID, name=TOOL_NAME, content="tool failed: http_error"
        )
        assert events[-1].event_type is EventType.RUN_COMPLETED


class TestAnAgentPointingAtAConnectionThatIsNotThere:
    def test_the_run_stops_before_anybody_is_asked_anything(self):
        model = Script()

        events = a_run(a_spec(toolset_refs=("nowhere",)), model)

        assert model.asked == []
        assert every(events, EventType.LLM_REQUESTED) == []
        assert one(events, EventType.RUN_FAILED).payload["reason"] == "unknown_binding"


class TestAModelThatCannotTakeTools:
    def test_the_run_stops_and_says_the_model_cannot_use_tools(self):
        balks = Script(
            ModelBalked(
                reason="tools_unsupported",
                message="this model cannot be given tools",
            )
        )

        events = a_run(a_spec(max_turns=2), balks)

        assert every(events, EventType.TOOL_REQUESTED) == []
        assert one(events, EventType.RUN_FAILED).payload["reason"] == (
            "tools_unsupported"
        )


def asks_the_person_first() -> AgentSpec:
    return a_spec(max_turns=2, approval_policy="ask_first")


def crashed_mid_call() -> list[RunEvent]:
    """부탁은 나갔는데 답을 못 본 채로 멈춰 선 실행 — 프로세스가 죽었던 자리."""
    held = a_run(asks_the_person_first(), Script(wants(item="apple")))
    paused = held[-1]
    sent = RunEvent(
        seq=paused.seq,
        run_id=paused.run_id,
        event_type=EventType.TOOL_REQUESTED,
        timestamp=paused.timestamp,
        spec_revision=paused.spec_revision,
        payload={
            "node_id": "agent",
            "call_id": CALL_ID,
            "resource_ref": "shelf",
            "tool_name": TOOL_NAME,
            "input": {"item": "apple"},
        },
        node_id="agent",
        turn=0,
    )
    return [*held[:-1], sent, paused.model_copy(update={"seq": paused.seq + 1})]


class TestACallThatWasSentButNeverAnswered:
    def spec(self) -> AgentSpec:
        return asks_the_person_first()

    def crashed_mid_call(self) -> list[RunEvent]:
        return crashed_mid_call()

    def test_it_is_not_called_a_second_time(self):
        events = answered(
            self.spec(),
            self.crashed_mid_call(),
            True,
            Script(says("I could not check the shelf")),
        )

        assert len(every(events, EventType.TOOL_REQUESTED)) == 1

    def test_the_model_hears_that_the_call_ended_with_no_answer(self):
        model = Script(says("I could not check the shelf"))

        answered(self.spec(), self.crashed_mid_call(), True, model)

        assert model.asked[0].transcript[-1] == ToolReply(
            call_id=CALL_ID,
            name=TOOL_NAME,
            content="tool failed: no answer was ever seen for this call",
        )


class TestWhatThePersonAgreedTo:
    """사람이 허락한 것은 그 호출 하나다 — 다른 호출이 그 동의를 물려받지 않는다."""

    def test_a_new_call_in_the_same_turn_asks_the_person_again(self):
        # 앞선 호출은 답을 못 본 채 끝났다: 사람의 답은 그 호출의 것이지 다음 호출의 것이 아니다.
        model = Script(wants_all("call-2"))

        events = answered(
            asks_the_person_first(),
            crashed_mid_call(),
            True,
            model,
            gives({"count": 3}),
        )

        asked = every(events, EventType.HUMAN_APPROVAL_REQUESTED)
        assert [event.payload["call_id"] for event in asked] == [CALL_ID, "call-2"]
        assert events[-1].event_type is EventType.RUN_PAUSED

    def test_the_call_it_never_agreed_to_is_not_made(self):
        events = answered(
            asks_the_person_first(),
            crashed_mid_call(),
            True,
            Script(wants_all("call-2")),
            never_called,
        )

        # 기록에 남은 부탁은 죽기 전에 나갔던 그 하나뿐이다 (도구 대역은 불리면 터진다).
        assert len(every(events, EventType.TOOL_REQUESTED)) == 1


class TestAnAgentThatNeverReachesAnAnswer:
    def silent(self, **spec_args) -> list[RunEvent]:
        return a_run(
            a_spec(**spec_args),
            Script(wants(item="apple"), says(None)),
            gives({"count": 3}),
        )

    def test_the_run_ends_with_a_terminal_event_that_says_why(self):
        events = self.silent(max_turns=1)

        assert shape(events)[-2:] == [
            (EventType.NODE_FAILED, None),
            (EventType.RUN_FAILED, None),
        ]
        assert events[-1].payload["reason"] == "no_final_answer"
        assert events[-1].node_id == "agent"

    def test_the_run_is_a_failed_one_to_anybody_reading_the_events(self):
        assert run_status(self.silent(max_turns=1)) is RunStatus.FAILED


class TestAStandInWithNoWordsToGive:
    """진짜 모델이 없는 실행 — 지어낸 말 없이, 그래도 그래프를 끝까지 걷는다.

    진짜 제공자는 말도 시킨 것도 없는 답을 이 자리로 보내지 않는다: 어댑터가 먼저 물러서고
    (`model_talk.heard` → NOTHING_SAID) 그 실행은 run.failed로 끝난다. 여기 오는 말 없는
    답은 대역의 것이고, 대역 실행(api RunMode "stand_in")은 걷는 것 자체가 하는 일이다.
    """

    def test_the_run_still_walks_to_the_end(self):
        events = a_run(a_spec(max_turns=4), Script(says(None)))

        assert one(events, EventType.NODE_COMPLETED).payload["closed_by"] == "answer"
        assert events[-1].event_type is EventType.RUN_COMPLETED

    def test_no_words_are_made_up_for_it(self):
        events = a_run(a_spec(max_turns=4), Script(says(None)))

        assert "text" not in one(events, EventType.LLM_COMPLETED).payload


class TestATurnThatAsksForMoreToolsThanTheBudgetAllows:
    def events(self) -> list[RunEvent]:
        return a_run(
            a_spec(max_turns=5, max_tool_calls=1),
            Script(
                wants_all("call-1", "call-2", "call-3"),
                says("one look was all I got"),
            ),
            gives({"count": 3}),
        )

    def test_only_what_the_budget_allows_is_ever_called(self):
        assert [
            event.payload["call_id"]
            for event in every(self.events(), EventType.TOOL_REQUESTED)
        ] == ["call-1"]

    def test_the_calls_it_could_not_afford_are_written_down_as_not_called(self):
        spent = [
            event
            for event in every(self.events(), EventType.TOOL_POLICY_CHECKED)
            if event.payload["allowed"] is False
        ]

        assert [event.payload["call_id"] for event in spent] == ["call-2", "call-3"]
        assert {event.payload["reason"] for event in spent} == {"tool_budget_spent"}

    def test_the_model_is_told_which_calls_the_budget_would_not_pay_for(self):
        model = Script(
            wants_all("call-1", "call-2", "call-3"), says("one look was all I got")
        )

        a_run(a_spec(max_turns=5, max_tool_calls=1), model, gives({"count": 3}))

        assert [
            reply.content
            for reply in model.asked[1].transcript
            if isinstance(reply, ToolReply)
        ][1:] == ["tool failed: tool_budget_spent"] * 2

    def test_it_then_closes_and_says_the_budget_is_what_stopped_it(self):
        assert one(self.events(), EventType.NODE_COMPLETED).payload["closed_by"] == (
            "tool_budget"
        )


class TestAToolNameNobodyHas:
    def spec(self) -> AgentSpec:
        return a_spec(max_turns=3, approval_policy="ask_first")

    def held(self) -> list[RunEvent]:
        """지어낸 이름 하나와 진짜 도구 하나를 같은 턴에 시킨 실행 — 진짜 앞에서 멈춰 선다."""
        return a_run(
            self.spec(),
            Script(
                ModelSaid(
                    input_tokens=11,
                    output_tokens=7,
                    tool_calls=(
                        ToolCall(call_id="ghost", name="no_such_shelf", arguments={}),
                        ToolCall(
                            call_id=CALL_ID, name=TOOL_NAME, arguments={"item": "apple"}
                        ),
                    ),
                )
            ),
        )

    def test_the_name_that_does_not_exist_is_written_down_as_not_called(self):
        checked = one(self.held(), EventType.TOOL_POLICY_CHECKED)

        assert checked.node_id == "agent"
        assert checked.turn == 0
        assert checked.payload["allowed"] is False
        assert checked.payload["reason"] == "no_such_tool"
        assert checked.payload["call_id"] == "ghost"
        assert checked.payload["tool_name"] == "no_such_shelf"

    def test_the_run_carries_on_to_the_real_call_behind_it(self):
        assert (
            one(self.held(), EventType.HUMAN_APPROVAL_REQUESTED).payload["call_id"]
            == CALL_ID
        )

    def test_the_invented_call_does_not_come_back_to_life_on_resume(self):
        model = Script(says("there are 3 apples"))

        events = answered(self.spec(), self.held(), True, model, gives({"count": 3}))

        assert [
            event.payload["call_id"]
            for event in every(events, EventType.TOOL_REQUESTED)
        ] == [CALL_ID]
        # 이미 판정이 끝난 호출은 이어 달리는 실행이 다시 판정하지 않는다.
        assert [
            event.payload["call_id"]
            for event in every(events, EventType.TOOL_POLICY_CHECKED)
            if event.payload["allowed"] is False
        ] == ["ghost"]
        assert [
            reply.content
            for reply in model.asked[0].transcript
            if isinstance(reply, ToolReply)
        ] == [
            "tool failed: no_such_tool",
            what_the_tool_said({"count": 3}).content,
        ]
