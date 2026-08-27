"""진짜 provider를 꽂은 실행 한 판 — 판단도 말도 모델에게서 오고, 열쇠는 어디에도 남지 않는다.

그물은 타지 않는다: 진짜 클라이언트 자리에 결정론 대역을 세우고, 나머지는 전부 진짜 코드다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import httpx
import openai
from agentcanvas_adapters.anthropic_model import anthropic_from
from agentcanvas_adapters.openai_model import openai_from
from agentcanvas_adapters.scripted import (
    ScriptedChoice,
    ScriptedLLM,
    ScriptedOpenAI,
    ScriptedReply,
)
from agentcanvas_adapters.secrets import SECRET_ENV_PREFIX, env_vault
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
from agentcanvas_contracts.model_catalog import ModelDef
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.routed_runtime import routed_run

A_KEY = "sk-ant-not-a-real-key-000"


def a_request() -> httpx.Request:
    return httpx.Request("POST", "http://127.0.0.1:11434/v1/chat/completions")


RUN_ID = "run_real"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)


def a_node(node_id: str, node_type: str, config: dict | None = None) -> Node:
    return Node(
        id=node_id, type=node_type, position=Position(x=0, y=0), config=config or {}
    )


def an_edge(
    edge_id: str, source: str, target: str, expression: str | None = None
) -> Edge:
    return Edge(
        id=edge_id,
        kind=EdgeKind.DATA,
        source=EdgeEndpoint(node=source, port="output"),
        target=EdgeEndpoint(node=target, port="input"),
        condition=(
            None
            if expression is None
            else EdgeCondition(language="cel", expression=expression)
        ),
    )


def a_fork_then_a_writer() -> AgentSpec:
    """갈림길 하나와 그 뒤에서 말하는 노드 — 판단과 말이 모두 모델에게서 온다."""
    return AgentSpec(
        schema_version="agent.spec/v1",
        id="real-branching",
        version=1,
        revision="sha256:" + "0" * 64,
        status=AgentStatus.DRAFT,
        input_schema={"type": "object", "properties": {}},
        state_schema={"type": "object", "properties": {"route": {}}},
        nodes=[
            a_node("input", "core.input"),
            a_node("triage", "llm.router", {"model_ref": "model://claude-haiku"}),
            a_node("careful", "llm.agent", {"model_ref": "model://claude-opus"}),
            a_node("quick", "llm.agent"),
        ],
        edges=[
            an_edge("in-triage", "input", "triage"),
            an_edge("triage-careful", "triage", "careful", "route == 'careful'"),
            an_edge("triage-quick", "triage", "quick", "route == 'quick'"),
        ],
    )


def a_run_asking(client: ScriptedLLM, key: str = A_KEY) -> list[RunEvent]:
    asks = anthropic_from(
        env_vault({SECRET_ENV_PREFIX + "ANTHROPIC_API_KEY": key}),
        client_from_key=lambda opened: client,
    )
    return routed_run(a_fork_then_a_writer(), RUN_ID, STARTED_AT, model=asks)


def worked(events: list[RunEvent]) -> list[str | None]:
    return [
        event.node_id for event in events if event.event_type is EventType.NODE_STARTED
    ]


def only(events: list[RunEvent], kind: EventType, node_id: str) -> RunEvent:
    return next(
        event
        for event in events
        if event.event_type is kind and event.node_id == node_id
    )


class TestAForkTheModelReallyDecides:
    def events(self) -> list[RunEvent]:
        return a_run_asking(
            ScriptedLLM(
                [
                    ScriptedReply(json.dumps({"way": "careful"})),
                    ScriptedReply("here is the careful answer", output_tokens=6),
                ]
            )
        )

    def test_the_way_the_model_chose_is_the_branch_that_runs(self):
        assert worked(self.events()) == ["input", "triage", "careful"]

    def test_the_decision_that_was_written_down_is_the_model_s_own(self):
        decided = only(self.events(), EventType.DECISION_RECORDED, "triage")

        assert decided.payload["route"] == "careful"
        assert decided.payload["ways"] == ["careful", "quick"]

    def test_the_answer_the_model_gave_is_written_down_word_for_word(self):
        completed = only(self.events(), EventType.LLM_COMPLETED, "careful")

        assert completed.payload["text"] == "here is the careful answer"
        assert completed.payload["output_tokens"] == 6

    def test_the_prompt_that_step_really_sent_is_written_down(self):
        compiled = only(self.events(), EventType.PROMPT_COMPILED, "careful")

        assert "prompt://careful@1" in str(compiled.payload["prompt"])

    def test_each_step_asked_the_model_its_own_node_named(self):
        client = ScriptedLLM(
            [
                ScriptedReply(json.dumps({"way": "careful"})),
                ScriptedReply("here is the careful answer"),
            ]
        )
        a_run_asking(client)

        assert [request["model"] for request in client.requests] == [
            "claude-haiku-4-5",
            "claude-opus-5",
        ]


class TestAWayNobodyLeadsTo:
    def test_the_run_ends_where_it_stands_instead_of_guessing(self):
        events = a_run_asking(
            ScriptedLLM([ScriptedReply(json.dumps({"way": "nowhere"}))])
        )

        assert worked(events) == ["input", "triage"]
        assert events[-1].event_type is EventType.RUN_COMPLETED


class TestTheKeyNeverTravelsWithTheRun:
    def test_no_event_of_a_run_that_used_a_key_holds_that_key(self):
        events = a_run_asking(
            ScriptedLLM(
                [
                    ScriptedReply(json.dumps({"way": "quick"})),
                    ScriptedReply("here is the quick answer"),
                ]
            )
        )

        written = json.dumps([event.model_dump(mode="json") for event in events])
        assert A_KEY not in written
        assert "sk-" not in written


LOCAL_URL = "http://127.0.0.1:11434/v1"
AN_OPENAI_KEY = "sk-not-a-real-openai-key-000"


def a_local_catalog() -> dict[str, ModelDef]:
    """내 컴퓨터에서 띄운 모델 하나뿐인 목록 — 그래프의 두 이름이 모두 그것을 가리킨다."""
    on_my_computer = ModelDef(
        ref="model://local",
        title={"ko": "내 컴퓨터의 모델", "en": "The model on my computer"},
        provider="openai_compatible",
        model_id="gemma4:26b",
        base_url=LOCAL_URL,
    )
    return {
        "model://claude-haiku": on_my_computer,
        "model://claude-opus": on_my_computer,
    }


def a_run_asking_openai(
    client: ScriptedOpenAI, given: dict | None = None
) -> list[RunEvent]:
    asks = openai_from(
        env_vault({"AGENTCANVAS_SECRET_OPENAI_API_KEY": AN_OPENAI_KEY}),
        a_local_catalog(),
        client_from=lambda base_url, key: client,
    )
    return routed_run(
        a_fork_then_a_writer(), RUN_ID, STARTED_AT, input=given, model=asks
    )


class TestARunWhoseModelSpeaksOpenAI:
    def events(self) -> list[RunEvent]:
        return a_run_asking_openai(
            ScriptedOpenAI(
                [
                    ScriptedChoice(json.dumps({"way": "careful"})),
                    ScriptedChoice("here is the careful answer", completion_tokens=6),
                ]
            )
        )

    def test_the_way_that_model_chose_is_the_branch_that_runs(self):
        assert worked(self.events()) == ["input", "triage", "careful"]

    def test_the_answer_it_gave_is_written_down_word_for_word(self):
        completed = only(self.events(), EventType.LLM_COMPLETED, "careful")

        assert completed.payload["text"] == "here is the careful answer"
        assert completed.payload["output_tokens"] == 6

    def test_the_prompt_that_step_really_sent_is_written_down(self):
        compiled = only(self.events(), EventType.PROMPT_COMPILED, "careful")

        assert "prompt://careful@1" in str(compiled.payload["prompt"])

    def test_no_event_of_that_run_holds_the_key_it_used(self):
        written = json.dumps([event.model_dump(mode="json") for event in self.events()])

        assert AN_OPENAI_KEY not in written
        assert "sk-" not in written

    def test_what_the_run_was_started_with_is_in_the_prompt_the_model_really_got(self):
        """건넨 값은 상태를 거쳐 프롬프트에 실린다 — 모델은 정말로 그것을 읽고 판단한다."""
        client = ScriptedOpenAI(
            [
                ScriptedChoice(json.dumps({"way": "careful"})),
                ScriptedChoice("here is the careful answer"),
            ]
        )

        a_run_asking_openai(client, given={"question": "is it raining"})

        assert "is it raining" in client.requests[0]["messages"][1]["content"]

    def test_neither_what_flowed_in_nor_the_answer_carries_the_key_along(self):
        """실행에 진짜 값이 오갈수록 실려 나갈 것이 늘어난다 — 열쇠는 그중에 없다."""
        events = a_run_asking_openai(
            ScriptedOpenAI(
                [
                    ScriptedChoice(json.dumps({"way": "quick"})),
                    ScriptedChoice("here is the quick answer"),
                ]
            ),
            given={"question": "is it raining"},
        )

        written = json.dumps([event.model_dump(mode="json") for event in events])
        assert "is it raining" in written
        assert AN_OPENAI_KEY not in written
        assert "sk-" not in written

    def test_trouble_at_that_door_ends_the_run_with_a_reason_not_a_crash(self):
        events = a_run_asking_openai(
            ScriptedOpenAI([openai.APIConnectionError(request=a_request())])
        )

        assert events[-1].event_type is EventType.RUN_FAILED
        assert events[-1].payload["reason"] == "provider_error"
