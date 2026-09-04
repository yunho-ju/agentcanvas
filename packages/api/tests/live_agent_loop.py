"""도구를 부르며 답을 다듬는 루프가 진짜 모델·진짜 그물에서도 도는가 — 실 열쇠로 한 번 본다.

곁의 `live_tool_calling.py`와 같은 자리에 사는 까닭도 같다: 이 서버가 실제로 세우는 모델
목록(`catalog_in`)을 그대로 지나가야 확인이 되기 때문이다. 기본으로는 돌지 않는다(파일 이름이
test_로 시작하지 않아 아무도 모으지 않는다) — 실 호출은 돈이 들고 그물을 탄다.

    (set -a; source ./.env; set +a); \
      uv run --frozen pytest packages/api/tests/live_agent_loop.py -m live -s

부르는 곳은 열쇠가 필요 없는 공개 주소다. 열쇠는 어디에도 적지 않는다 — 확인하는 것은
이벤트의 차례뿐이다: 0턴에 도구를 부르고, 그 결과를 받아 1턴에 말로 답하는가.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

import pytest
from agentcanvas_adapters.http_tool import calls_http, sends_with_httpx
from agentcanvas_adapters.openai_model import openai_from
from agentcanvas_adapters.providers import can_be_asked
from agentcanvas_adapters.secrets import env_vault
from agentcanvas_api.app import OPENAI_MODEL_REF, catalog_in
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.routed_runtime import routed_run

RUN_ID = "run_live_agent_loop"
STARTED_AT = datetime(2026, 9, 4, 12, 0, tzinfo=UTC)
REVISION = "sha256:" + "0" * 64

#: 열쇠 없이 부를 수 있는 공개 주소 — 건넨 값을 그대로 되읊어 준다.
A_PUBLIC_GET = "https://httpbin.org/get"


@pytest.fixture(autouse=True)
def no_real_model() -> None:
    """이 파일에서만 그 금지를 푼다 — 진짜 문에 닿는 것이 여기서 확인하려는 바로 그것이다."""


def a_spec() -> AgentSpec:
    return AgentSpec.model_validate(
        {
            "schema_version": "agent.spec/v1",
            "id": "live-loop",
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
                    "id": "echo-api",
                    "kind": "http.api",
                    "server_ref": "api://echo",
                    "tools": [
                        {
                            "name": "echo_back",
                            "plain_description": {
                                "ko": "건넨 말을 그대로 되읊어 주는 시험용 도구.",
                                "en": (
                                    "Echoes back whatever word you hand it. "
                                    "Call it to find out what the service says."
                                ),
                            },
                            "input_schema": {
                                "type": "object",
                                "properties": {"word": {"type": "string"}},
                                "required": ["word"],
                            },
                            "output_schema": {"type": "object", "properties": {}},
                            "timeout_ms": 10000,
                            "call": {
                                "transport": "http",
                                "method": "GET",
                                "url_template": A_PUBLIC_GET,
                            },
                        }
                    ],
                }
            ],
            "nodes": [
                {
                    "id": "agent",
                    "type": "llm.agent",
                    "position": {"x": 0, "y": 0},
                    "config": {
                        "model_ref": OPENAI_MODEL_REF,
                        "max_turns": 2,
                        "toolset_refs": ["echo-api"],
                        "instruction": (
                            "Call the echo_back tool with the word 'ping', then say "
                            "in one short sentence what came back."
                        ),
                    },
                }
            ],
            "edges": [],
        }
    )


def told(events: list[RunEvent]) -> list[str]:
    return [
        f"{event.seq} {event.event_type.value} turn={event.turn} node={event.node_id}"
        for event in events
    ]


@pytest.mark.live
def test_a_real_agent_calls_a_real_tool_and_then_answers_from_what_it_found():
    env = os.environ
    catalog = catalog_in(env)
    vault = env_vault(env)
    if not can_be_asked(OPENAI_MODEL_REF, vault, catalog):
        pytest.skip("no OpenAI key and model are set up in this shell")

    events = routed_run(
        a_spec(),
        run_id=RUN_ID,
        started_at=STARTED_AT,
        model=openai_from(vault, catalog),
        tool=calls_http(sends_with_httpx, vault),
    )
    print("\n".join(told(events)))

    of_the_agent = [event for event in events if event.node_id == "agent"]
    spoke = [
        event for event in of_the_agent if event.event_type is EventType.LLM_COMPLETED
    ]
    assert [call["name"] for call in spoke[0].payload["tool_calls"]] == ["echo_back"]
    assert spoke[0].turn == 0

    called = [
        event
        for event in of_the_agent
        if event.event_type in {EventType.TOOL_REQUESTED, EventType.TOOL_COMPLETED}
    ]
    assert [event.turn for event in called] == [0, 0]
    assert called[-1].payload["ok"] is True, called[-1].payload

    assert spoke[-1].turn == 1
    assert spoke[-1].payload["tool_calls"] == []
    assert spoke[-1].payload["text"]
    print(f"answered: {spoke[-1].payload['text']}")

    finished = next(
        event for event in events if event.event_type is EventType.NODE_COMPLETED
    )
    assert finished.payload["turns"] == 2
    assert finished.payload["closed_by"] == "answer"
