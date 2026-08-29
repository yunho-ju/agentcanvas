"""도구 노드가 진짜로 일한다 — 무엇을 부르고, 무엇이 사건으로 남고, 실패는 어디로 흐르는가.

도구를 부르는 자리는 밖에서 주입한다(ModelCall 선례): 이 층에는 HTTP도 MCP도 없다.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from agentcanvas_contracts.agent_spec import (
    AgentSpec,
    AgentStatus,
    Edge,
    EdgeEndpoint,
    Node,
    Position,
    ResourceBinding,
)
from agentcanvas_contracts.run import ApprovalAnswer
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.routed_runtime import resume_routed_run, routed_run
from agentcanvas_engine.tool_call import (
    CallsATool,
    ToolAsk,
    ToolBalked,
    ToolReturned,
    echoes_the_input,
)

RUN_ID = "run_tools"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)

SEARCH = {
    "name": "search_article",
    "plain_description": {"ko": "찾는다.", "en": "Finds."},
    "input_schema": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    },
    "output_schema": {"type": "object"},
    "timeout_ms": 8000,
    "call": {
        "transport": "http",
        "method": "GET",
        "url_template": "https://api.example.com/search",
    },
}


def a_binding(**overrides) -> dict:
    return {
        "id": "article-api",
        "kind": "http.api",
        "server_ref": "api://article-api",
        "allowed_tools": [],
        "approval_policy": "read_only_auto",
        "tools": [SEARCH],
        **overrides,
    }


def a_spec(
    config: dict | None = None,
    binding: dict | None = None,
    error_edge: bool = False,
) -> AgentSpec:
    """input -> lookup(도구) -> output. 도구가 실패하면 error 갈래로 흐른다."""
    draft = AgentSpec(
        schema_version="agent.spec/v1",
        id="tool-runner",
        name=None,
        version=1,
        revision="sha256:" + "0" * 64,
        status=AgentStatus.DRAFT,
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
        state_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "answer": {"type": "object"},
                "trouble": {"type": "object"},
            },
        },
        nodes=[
            Node(
                id="input",
                type="core.input",
                position=Position(x=0, y=0),
                config={"bindings": {"query": "input.query"}},
            ),
            Node(
                id="lookup",
                type="tool.mcp",
                position=Position(x=200, y=0),
                config=config
                if config is not None
                else {"resource_ref": "article-api", "tool_name": "search_article"},
            ),
            Node(
                id="answer",
                type="core.output",
                position=Position(x=400, y=0),
                config={"binding": "state.answer"},
            ),
            Node(
                id="trouble",
                type="core.output",
                position=Position(x=400, y=200),
                config={"binding": "state.trouble"},
            ),
        ],
        edges=[
            Edge(
                id="input-lookup",
                kind="data",
                source=EdgeEndpoint(node="input", port="query"),
                target=EdgeEndpoint(node="lookup", port="input"),
            ),
            Edge(
                id="lookup-answer",
                kind="data",
                source=EdgeEndpoint(node="lookup", port="result"),
                target=EdgeEndpoint(node="answer", port="answer"),
            ),
            *(
                [
                    Edge(
                        id="lookup-trouble",
                        kind="data",
                        source=EdgeEndpoint(node="lookup", port="error"),
                        target=EdgeEndpoint(node="trouble", port="trouble"),
                    )
                ]
                if error_edge
                else []
            ),
        ],
        resources=[ResourceBinding.model_validate(binding if binding else a_binding())],
        execution=None,
    )
    return draft.model_copy(update={"revision": draft.computed_revision()})


def balks(reason: str, message: str = "nope") -> CallsATool:
    return lambda ask: ToolBalked(reason=reason, message=message)


def ran(spec: AgentSpec, tool: CallsATool | None = None) -> list[RunEvent]:
    return routed_run(
        spec,
        RUN_ID,
        STARTED_AT,
        input={"query": "asthma"},
        **({"tool": tool} if tool is not None else {}),
    )


def kinds(events: list[RunEvent]) -> list[str]:
    return [event.event_type.value for event in events]


def payload_of(events: list[RunEvent], event_type: EventType) -> dict:
    return next(event.payload for event in events if event.event_type is event_type)


def with_a_gate(spec: AgentSpec, gate_port: str = "result") -> AgentSpec:
    """도구 → 사람 확인 → 또 하나의 도구. 멈췄다 이어 달리는 자리를 만든다.

    뒤의 도구는 앞의 도구가 낸 것을 상태에서 받는다 — 이어 달리는 실행이 그 값을
    이벤트에서 되살렸는지 그 자리에서 드러난다.
    """
    binding = spec.resources[0].model_copy(
        update={
            "tools": [
                *spec.resources[0].tools,
                spec.resources[0]
                .tools[0]
                .model_copy(
                    update={
                        "name": "read_review",
                        "input_schema": {
                            "type": "object",
                            "properties": {"review": {"type": "object"}},
                        },
                    }
                ),
            ]
        }
    )
    gated = spec.model_copy(
        update={
            "state_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "review": {"type": "object"},
                    "answer": {"type": "object"},
                },
            },
            "resources": [binding],
            "nodes": [
                *spec.nodes,
                Node(
                    id="gate",
                    type="control.human_gate",
                    position=Position(x=300, y=0),
                    config={"approval_schema_ref": "schema://answer@1"},
                ),
                Node(
                    id="after",
                    type="tool.mcp",
                    position=Position(x=500, y=0),
                    config={
                        "resource_ref": "article-api",
                        "tool_name": "read_review",
                    },
                ),
            ],
            "edges": [
                Edge(
                    id="input-lookup",
                    kind="data",
                    source=EdgeEndpoint(node="input", port="query"),
                    target=EdgeEndpoint(node="lookup", port="input"),
                ),
                Edge(
                    id="lookup-gate",
                    kind="approval",
                    source=EdgeEndpoint(node="lookup", port=gate_port),
                    target=EdgeEndpoint(node="gate", port="review"),
                ),
                Edge(
                    id="gate-after",
                    kind="control",
                    source=EdgeEndpoint(node="gate", port="approved"),
                    target=EdgeEndpoint(node="after", port="input"),
                ),
            ],
        }
    )
    return gated.model_copy(update={"revision": gated.computed_revision()})


def approved() -> ApprovalAnswer:
    return ApprovalAnswer(approved=True)


class TestAToolNodeThatWorks:
    def test_it_asks_the_tool_and_writes_down_what_happened(self):
        events = ran(a_spec())

        assert kinds(events).count("tool.policy_checked") == 1
        assert kinds(events).count("tool.requested") == 1
        assert kinds(events).count("tool.completed") == 1
        assert payload_of(events, EventType.TOOL_COMPLETED)["ok"] is True
        assert any(
            event.event_type is EventType.NODE_COMPLETED and event.node_id == "lookup"
            for event in events
        )

    def test_the_three_events_are_written_down_in_the_shape_we_promised(self):
        events = ran(a_spec())
        checked = payload_of(events, EventType.TOOL_POLICY_CHECKED)
        requested = payload_of(events, EventType.TOOL_REQUESTED)
        completed = payload_of(events, EventType.TOOL_COMPLETED)

        assert checked == {
            "node_id": "lookup",
            "resource_ref": "article-api",
            "tool_name": "search_article",
            "allowed": True,
        }
        assert requested == {
            "node_id": "lookup",
            "resource_ref": "article-api",
            "tool_name": "search_article",
            "input": {"query": "asthma"},
        }
        # 이 모양이 곧 계약이다 — 화면과 이어 달리는 실행이 이 자리만 보고 결과를 되살린다.
        assert completed == {
            "node_id": "lookup",
            "resource_ref": "article-api",
            "tool_name": "search_article",
            "ok": True,
            "result": {"input": {"query": "asthma"}, "tool": "search_article"},
            "original_chars": completed["original_chars"],
            "loaded_chars": completed["loaded_chars"],
        }
        assert completed["original_chars"] == completed["loaded_chars"] > 0

    def test_the_stand_in_says_only_what_it_was_given(self):
        """지어낸 답을 진짜처럼 꾸미지 않는다 — 대역이 낸 것은 건넨 것의 되읊음뿐이다."""
        spec = a_spec()
        node = next(one for one in spec.nodes if one.id == "lookup")

        echoed = echoes_the_input(
            ToolAsk(
                node=node,
                binding=spec.resources[0],
                tool=spec.resources[0].tools[0],
                input={"query": "asthma"},
            )
        )

        assert echoed.result == {"tool": "search_article", "input": {"query": "asthma"}}
        assert echoed.original_chars == echoed.loaded_chars

    def test_what_the_tool_gave_back_flows_on_to_the_next_node(self):
        events = ran(a_spec())

        crossings = [
            event.payload
            for event in events
            if event.event_type is EventType.STATE_PATCH
            and event.payload.get("edge_id") == "lookup-answer"
        ]
        assert (
            crossings[0]["patch"][0]["value"]
            == payload_of(events, EventType.TOOL_COMPLETED)["result"]
        )

    def test_the_run_ends_the_way_it_always_did(self):
        events = ran(a_spec())

        assert events[-1].event_type is EventType.RUN_COMPLETED


class TestAToolTheConnectionDoesNotAllow:
    def test_it_is_written_down_as_not_allowed_and_the_run_stops(self):
        spec = a_spec(binding=a_binding(allowed_tools=["get_article"]))

        events = ran(spec)

        assert payload_of(events, EventType.TOOL_POLICY_CHECKED)["allowed"] is False
        assert events[-1].event_type is EventType.RUN_FAILED
        assert events[-1].payload["reason"] == "not_allowed"

    def test_nothing_says_the_tool_was_asked_or_the_node_finished(self):
        spec = a_spec(binding=a_binding(allowed_tools=["get_article"]))

        events = ran(spec)

        assert "tool.requested" not in kinds(events)
        assert not any(
            event.event_type is EventType.NODE_COMPLETED and event.node_id == "lookup"
            for event in events
        )

    def test_a_connection_that_has_not_narrowed_its_tools_allows_them_all(self):
        """빈 목록은 '아직 좁히지 않았다'는 뜻이다 — 아무것도 못 쓴다는 뜻이 아니다."""
        events = ran(a_spec(binding=a_binding(allowed_tools=[])))

        assert payload_of(events, EventType.TOOL_POLICY_CHECKED)["allowed"] is True

    def test_a_tool_on_the_list_is_allowed(self):
        events = ran(a_spec(binding=a_binding(allowed_tools=["search_article"])))

        assert payload_of(events, EventType.TOOL_POLICY_CHECKED)["allowed"] is True


class TestWhenTheToolItselfCouldNotFinish:
    @pytest.mark.parametrize("reason", ["timeout", "http_error", "bad_output"])
    def test_the_trouble_flows_out_of_the_error_port(self, reason: str):
        events = ran(a_spec(error_edge=True), balks(reason, "it did not work"))

        completed = payload_of(events, EventType.TOOL_COMPLETED)
        assert completed["ok"] is False
        assert completed["error"] == {"reason": reason, "message": "it did not work"}
        assert events[-1].event_type is EventType.RUN_COMPLETED
        assert any(
            event.payload.get("edge_id") == "lookup-trouble"
            for event in events
            if event.event_type is EventType.STATE_PATCH
        )

    def test_the_good_way_does_not_flow_when_the_tool_could_not_finish(self):
        events = ran(a_spec(error_edge=True), balks("timeout"))

        assert not any(
            event.payload.get("edge_id") == "lookup-answer"
            for event in events
            if event.event_type is EventType.STATE_PATCH
        )

    def test_the_node_still_finishes_so_the_graph_can_carry_on(self):
        events = ran(a_spec(error_edge=True), balks("http_error"))

        assert any(
            event.event_type is EventType.NODE_COMPLETED and event.node_id == "lookup"
            for event in events
        )


class TestWhenTheDocumentItselfIsBroken:
    @pytest.mark.parametrize(
        ("config", "reason"),
        [
            ({"tool_name": "search_article"}, "unknown_binding"),
            (
                {"resource_ref": "nowhere", "tool_name": "search_article"},
                "unknown_binding",
            ),
            ({"resource_ref": "article-api"}, "unknown_tool"),
            (
                {"resource_ref": "article-api", "tool_name": "no_such_tool"},
                "unknown_tool",
            ),
        ],
    )
    def test_the_run_stops_and_says_why(self, config: dict, reason: str):
        events = ran(a_spec(config=config))

        assert events[-1].event_type is EventType.RUN_FAILED
        assert events[-1].payload["reason"] == reason
        assert not any(
            event.event_type is EventType.NODE_COMPLETED and event.node_id == "lookup"
            for event in events
        )

    @pytest.mark.parametrize(
        "reason", ["missing_secret", "no_adapter", "missing_input"]
    )
    def test_trouble_with_the_document_is_not_a_way_the_graph_can_take(
        self, reason: str
    ):
        events = ran(a_spec(error_edge=True), balks(reason))

        assert events[-1].event_type is EventType.RUN_FAILED
        assert events[-1].payload["reason"] == reason
        assert "tool.completed" not in kinds(events)

    def test_a_kind_of_connection_nobody_can_run_yet_says_so(self):
        """mcp 연결은 아직 실행할 수 없다 — 아무 일도 안 하고 초록불을 켜지 않는다."""
        mcp = a_binding(kind="mcp.toolset", server_ref="mcp://article")

        events = ran(a_spec(binding=mcp), balks("no_adapter", "not yet"))

        assert events[-1].payload["reason"] == "no_adapter"


class TestPickingTheRunBackUp:
    def test_a_tool_that_already_finished_is_not_asked_again(self):
        """이어 달리는 실행은 이벤트에서 결과를 되살린다 — 부수효과를 두 번 내지 않는다."""
        spec = with_a_gate(a_spec())
        asked: list[ToolAsk] = []

        def counts(ask: ToolAsk) -> ToolReturned:
            asked.append(ask)
            return echoes_the_input(ask)

        first = routed_run(
            spec, RUN_ID, STARTED_AT, input={"query": "asthma"}, tool=counts
        )
        assert [ask.node.id for ask in asked] == ["lookup"]

        carried_on = resume_routed_run(spec, first, approved(), tool=counts)

        # 이어 달리며 부른 것은 아직 일하지 않은 뒤의 도구뿐이다 — 앞의 도구는 다시 부르지 않는다.
        assert [ask.node.id for ask in asked] == ["lookup", "after"]
        assert carried_on[-1].event_type is EventType.RUN_COMPLETED

    def test_the_trouble_a_tool_ran_into_also_survives_the_pause(self):
        """어그러진 갈래로 멈췄다 이어 달려도, 뒤의 노드는 그 까닭을 그대로 받는다."""
        spec = with_a_gate(a_spec(), gate_port="error")
        first = routed_run(
            spec,
            RUN_ID,
            STARTED_AT,
            input={"query": "asthma"},
            tool=balks("timeout", "waited too long"),
        )
        assert payload_of(first, EventType.TOOL_COMPLETED)["ok"] is False

        carried_on = resume_routed_run(
            spec, first, approved(), tool=balks("timeout", "waited too long")
        )

        asked_after = [
            event.payload
            for event in carried_on
            if event.event_type is EventType.TOOL_REQUESTED
            and event.payload["node_id"] == "after"
        ]
        assert asked_after[0]["input"] == {
            "review": {"reason": "timeout", "message": "waited too long"}
        }

    def test_what_the_tool_gave_back_survives_the_pause(self):
        """이어 달리는 실행도 앞 도구가 낸 것을 그대로 본다 — 지어낸 자리 표시로 덮지 않는다."""
        spec = with_a_gate(a_spec())
        first = routed_run(spec, RUN_ID, STARTED_AT, input={"query": "asthma"})
        gave = payload_of(first, EventType.TOOL_COMPLETED)["result"]

        carried_on = resume_routed_run(spec, first, approved())

        asked_after = [
            event.payload
            for event in carried_on
            if event.event_type is EventType.TOOL_REQUESTED
            and event.payload["node_id"] == "after"
        ]
        assert asked_after[0]["input"] == {"review": gave}
