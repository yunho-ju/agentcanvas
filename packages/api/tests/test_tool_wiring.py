"""서버가 어느 도구를 부를지 정하는 자리 — 부를 곳이 있으면 진짜, 없으면 결정론 대역.

모델 배선(test_model_wiring)과 같은 문법이다: 갈림은 조립 한 곳뿐이고, 실행기도 서비스도
transport를 알지 못한다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from agentcanvas_api.app import create_app, tools_in
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.run_service import Work
from agentcanvas_contracts.agent_spec import (
    AgentSpec,
    Edge,
    EdgeEndpoint,
    Node,
    Position,
)
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_contracts.tool_def import ToolDef
from agentcanvas_engine.tool_call import CallsATool, ToolAsk, ToolBalked, ToolReturned
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)


def right_here(work: Work) -> None:
    work()


def with_a_tool_node() -> dict:
    """예제 문서의 연결을 그대로 쓰는 작은 문서 — 입력에서 도구로, 도구에서 답으로."""
    raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    spec = AgentSpec.model_validate(raw)
    lifted = spec.model_copy(
        update={
            "id": "tool-runner",
            "nodes": [
                Node(
                    id="input",
                    type="core.input",
                    position=Position(x=0, y=0),
                    config={"bindings": {"question": "input.question"}},
                ),
                Node(
                    id="lookup",
                    type="tool.mcp",
                    position=Position(x=200, y=0),
                    config={
                        "resource_ref": "clinical-reference",
                        "tool_name": "search_article",
                    },
                ),
                Node(
                    id="answer",
                    type="core.output",
                    position=Position(x=400, y=0),
                    config={"binding": "state.answer"},
                ),
            ],
            "edges": [
                Edge(
                    id="input-lookup",
                    kind="data",
                    source=EdgeEndpoint(node="input", port="question"),
                    target=EdgeEndpoint(node="lookup", port="input"),
                ),
                Edge(
                    id="lookup-answer",
                    kind="data",
                    source=EdgeEndpoint(node="lookup", port="result"),
                    target=EdgeEndpoint(node="answer", port="answer"),
                ),
            ],
        }
    )
    numbered = lifted.model_copy(update={"revision": lifted.computed_revision()})
    return numbered.model_dump(mode="json")


def a_server(
    tool: CallsATool | None = None,
) -> tuple[TestClient, InMemoryRunStore, dict]:
    runs = InMemoryRunStore()
    client = TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=runs,
            clock=lambda: STARTED_AT,
            worker=right_here,
            **({"tool": tool} if tool is not None else {}),
        )
    )
    spec = with_a_tool_node()
    client.post("/specs", json=spec)
    return client, runs, spec


def ran(client: TestClient, runs: InMemoryRunStore, spec: dict) -> list[RunEvent]:
    run_id = client.post(f"/specs/{spec['id']}/runs").json()["run"]["id"]
    return runs.events(run_id)


class TestWhatTheServerCallsWhenAToolNodeRuns:
    def test_a_kind_of_connection_nobody_can_run_yet_never_turns_green(self):
        """예제의 연결은 아직 부를 수 없는 종류다 — 서버는 그 사실을 말하고 멈춘다.

        모델과 다른 점이 여기 있다: 도구는 "열쇠가 없으니 대역에게 묻자"가 성립하지 않는다.
        지어낸 도구 답으로 초록불을 켜면 그것이 바로 이 브리프가 없애는 거짓 성공이다.
        """
        client, runs, spec = a_server()

        events = ran(client, runs, spec)

        assert events[-1].event_type is EventType.RUN_FAILED
        assert events[-1].payload["reason"] == "no_adapter"
        assert not [
            event for event in events if event.event_type is EventType.TOOL_COMPLETED
        ]

    def test_the_tool_the_server_was_given_is_the_one_that_gets_called(self):
        asked: list[ToolAsk] = []

        def counts(ask: ToolAsk) -> ToolReturned:
            asked.append(ask)
            return ToolReturned(result={"ok": True}, original_chars=2, loaded_chars=2)

        client, runs, spec = a_server(counts)

        ran(client, runs, spec)

        assert [ask.tool.name for ask in asked] == ["search_article"]

    def test_a_tool_that_could_not_finish_does_not_pretend_it_did(self):
        def balks(ask: ToolAsk) -> ToolBalked:
            return ToolBalked(reason="timeout", message="waited too long")

        client, runs, spec = a_server(balks)

        events = ran(client, runs, spec)

        completed = next(
            event for event in events if event.event_type is EventType.TOOL_COMPLETED
        )
        assert completed.payload["ok"] is False
        assert completed.payload["error"]["reason"] == "timeout"

    def test_a_graph_with_no_tool_node_runs_exactly_as_it_always_did(self):
        runs = InMemoryRunStore()
        client = TestClient(
            create_app(
                store=InMemorySpecStore(),
                run_store=runs,
                clock=lambda: STARTED_AT,
                worker=right_here,
            )
        )
        raw = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
        client.post("/specs", json=raw)

        events = ran(client, runs, raw)

        assert not [
            event
            for event in events
            if event.event_type
            in {
                EventType.TOOL_POLICY_CHECKED,
                EventType.TOOL_REQUESTED,
                EventType.TOOL_COMPLETED,
            }
        ]


class TestWhoTheServerAsksToCallTools:
    def test_the_server_can_always_run_a_tool_node_even_with_nothing_set_up(self):
        """열쇠가 없어도 서버는 뜬다 — 열쇠가 필요한 도구만 그때 그 까닭을 말한다."""
        calling = tools_in({})

        assert callable(calling)

    def test_it_hands_the_servers_own_keys_to_the_adapter(self):
        """금고는 서버를 띄운 자리다 — 그 자리에 없는 열쇠는 부를 때 그 까닭으로 돌아온다."""
        calling = tools_in({})
        binding = AgentSpec.model_validate(
            json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
        ).resources[0]
        wants_a_key = ToolDef.model_validate(
            {
                **binding.tools[0].model_dump(mode="json"),
                "call": {
                    "transport": "http",
                    "method": "GET",
                    "url_template": "https://api.example.com/articles",
                    "auth": "secret://nobody-set-this",
                },
            }
        )

        answer = calling(
            ToolAsk(
                node=Node(
                    id="lookup",
                    type="tool.mcp",
                    position=Position(x=0, y=0),
                    config={},
                ),
                binding=binding.model_copy(update={"kind": "http.api"}),
                tool=wants_a_key,
                input={},
            )
        )

        assert isinstance(answer, ToolBalked)
        assert answer.reason == "missing_secret"

    def test_a_kind_of_connection_nobody_can_run_yet_says_so(self):
        binding = AgentSpec.model_validate(
            json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
        ).resources[0]

        answer = tools_in({})(
            ToolAsk(
                node=Node(
                    id="lookup",
                    type="tool.mcp",
                    position=Position(x=0, y=0),
                    config={},
                ),
                binding=binding,
                tool=binding.tools[0],
                input={},
            )
        )

        assert isinstance(answer, ToolBalked)
        assert answer.reason == "no_adapter"
