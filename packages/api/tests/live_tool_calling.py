"""도구가 붙은 물음이 진짜 모델에게 정말 닿는가 — 실 열쇠로 한 번 확인하는 자리.

api 곁에 사는 까닭: 이 서버가 실제로 세우는 모델 목록(`catalog_in`)을 그대로 지나가야 확인이
되기 때문이다 — 어댑터 시험이 api를 거꾸로 부르지 않게 이 자리에 둔다. 기본으로는 돌지 않는다
(파일 이름이 test_로 시작하지 않아 아무도 모으지 않는다): 실 호출은 돈이 들고 그물을 타므로,
사람이 이 파일을 이름으로 부를 때만 돈다.

    (set -a; source ./.env; set +a); \
      uv run --frozen pytest packages/api/tests/live_tool_calling.py -m live -s

열쇠는 서버를 띄운 자리의 금고에서만 읽고, 어디에도 적지 않는다 — 확인하는 것은 모델이
어떤 도구를 어떤 인자로 불렀는가와, 그 결과를 회신했을 때 말로 답하는가뿐이다.
"""

from __future__ import annotations

import os

import pytest
from agentcanvas_adapters.openai_model import openai_from
from agentcanvas_adapters.providers import can_be_asked
from agentcanvas_adapters.secrets import env_vault
from agentcanvas_api.app import OPENAI_MODEL_REF, catalog_in
from agentcanvas_contracts.agent_spec import Node, Position
from agentcanvas_engine.model_call import (
    ModelAsk,
    ModelSaid,
    ModelTurn,
    ToolBrief,
    ToolReply,
)


@pytest.fixture(autouse=True)
def no_real_model() -> None:
    """이 파일에서만 그 금지를 푼다 — 진짜 문에 닿는 것이 여기서 확인하려는 바로 그것이다.

    곁의 conftest는 시험이 실수로 그물을 타지 않게 열쇠를 지운다(옳은 기본값). 이 파일은
    기본 수집 대상이 아니고 사람이 이름으로 부를 때만 도는 자리라, 같은 이름의 자리를 덮어
    비워 둔다 — 다른 시험의 안전망은 그대로다.
    """


GET_WEATHER = ToolBrief(
    name="get_weather",
    description="tells today's weather in one city",
    input_schema={
        "type": "object",
        "properties": {"city": {"type": "string"}},
        "required": ["city"],
        "additionalProperties": False,
    },
)

WHAT_THE_TOOL_FOUND = "서울: 맑음, 20도"


def an_ask(**more: object) -> ModelAsk:
    return ModelAsk(
        node=Node(
            id="writer", type="llm.agent", position=Position(x=0, y=0), config={}
        ),
        state={},
        ways=(),
        model_ref=OPENAI_MODEL_REF,
        prompt_ref="prompt://writer@1",
        instruction="서울 날씨 알려줘",
        tools=(GET_WEATHER,),
        **more,
    )


@pytest.mark.live
def test_a_real_model_calls_the_tool_and_then_answers_from_what_it_found():
    env = os.environ
    catalog = catalog_in(env)
    vault = env_vault(env)
    if not can_be_asked(OPENAI_MODEL_REF, vault, catalog):
        pytest.skip("no OpenAI key and model are set up in this shell")
    asks = openai_from(vault, catalog)

    said = asks(an_ask())

    assert isinstance(said, ModelSaid), said
    assert [call.name for call in said.tool_calls] == ["get_weather"]
    called = said.tool_calls[0]
    print(f"asked for: {called.name}({dict(called.arguments)})")

    answered = asks(
        an_ask(
            transcript=(
                ModelTurn(text=said.text, tool_calls=said.tool_calls),
                ToolReply(
                    call_id=called.call_id,
                    name=called.name,
                    content=WHAT_THE_TOOL_FOUND,
                ),
            )
        )
    )

    assert isinstance(answered, ModelSaid), answered
    assert answered.text
    print(f"answered: {answered.text}")
