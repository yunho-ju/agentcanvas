"""OpenAI 말투를 쓰는 곳에 물어보는 자리 — 본사도, 내 컴퓨터에서 띄운 것도 같은 계약이다.

여기서도 그물은 타지 않는다: 진짜 클라이언트가 설 자리에 결정론 대역을 세운다.
"""

from __future__ import annotations

import inspect
import json

import openai
import pytest
from agentcanvas_adapters.openai_model import (
    LOCAL_KEY,
    MAX_TOKENS,
    OPENAI_API_KEY_REF,
    openai_from,
    opens_openai,
)
from agentcanvas_adapters.scripted import ScriptedChoice, ScriptedOpenAI
from agentcanvas_adapters.secrets import env_vault
from agentcanvas_contracts.model_catalog import ModelDef
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelSaid

A_KEY = "sk-not-a-real-openai-key-000"
LOCAL_URL = "http://127.0.0.1:11434/v1"

AT_THE_COMPANY_DOOR = ModelDef(
    ref="model://gpt",
    title={"ko": "본사 모델", "en": "The company's model"},
    provider="openai_compatible",
    model_id="gpt-5",
)
ON_MY_COMPUTER = ModelDef(
    ref="model://local",
    title={"ko": "내 컴퓨터의 모델", "en": "The model on my computer"},
    provider="openai_compatible",
    model_id="gemma4:26b",
    base_url=LOCAL_URL,
)
CATALOG = {model.ref: model for model in [AT_THE_COMPANY_DOOR, ON_MY_COMPUTER]}


def an_ask(
    ways: tuple[str, ...] = (),
    model_ref: str = "model://local",
    state: dict | None = None,
    shape: dict | None = None,
) -> ModelAsk:
    from agentcanvas_contracts.agent_spec import Node, Position

    node = Node(
        id="triage" if ways else "writer",
        type="llm.router" if ways else "llm.agent",
        position=Position(x=0, y=0),
        config={},
    )
    return ModelAsk(
        node=node,
        state=state or {},
        ways=ways,
        model_ref=model_ref,
        prompt_ref="prompt://writer@3",
        response_schema=shape,
        response_name="a_shape" if shape else None,
    )


def asking(
    client: ScriptedOpenAI, key: str | None = None, opened: list[tuple] | None = None
):
    """대역 하나를 꽂아 둔 물음 자리 — 어떤 문이 어떤 열쇠로 열렸는지도 적어 둔다."""
    vault = env_vault({} if key is None else {"AGENTCANVAS_SECRET_OPENAI_API_KEY": key})

    def opens(base_url: str | None, with_key: str):
        if opened is not None:
            opened.append((base_url, with_key))
        return client

    return openai_from(vault, CATALOG, client_from=opens)


def a_provider_error() -> openai.APIConnectionError:
    import httpx

    return openai.APIConnectionError(
        request=httpx.Request("POST", f"{LOCAL_URL}/chat/completions")
    )


class TestAskingAModelToSpeak:
    def test_it_asks_the_model_the_catalog_named(self):
        client = ScriptedOpenAI([ScriptedChoice("hello there")])

        asking(client)(an_ask())

        assert client.requests[0]["model"] == "gemma4:26b"

    def test_it_brings_back_what_the_model_said_word_for_word(self):
        client = ScriptedOpenAI([ScriptedChoice("hello there")])

        said = asking(client)(an_ask())

        assert isinstance(said, ModelSaid)
        assert said.text == "hello there"

    def test_it_brings_back_the_sizes_the_provider_measured(self):
        client = ScriptedOpenAI(
            [ScriptedChoice("hello", prompt_tokens=91, completion_tokens=13)]
        )

        said = asking(client)(an_ask())

        assert (said.input_tokens, said.output_tokens) == (91, 13)

    def test_the_prompt_it_brings_back_is_the_one_it_really_sent(self):
        client = ScriptedOpenAI([ScriptedChoice("hello")])

        said = asking(client)(an_ask(state={"question": "is it raining"}))

        sent = client.requests[0]["messages"]
        assert isinstance(said.prompt, str)
        assert sent[0]["content"] in said.prompt
        assert sent[1]["content"] in said.prompt

    def test_what_flowed_in_so_far_is_part_of_what_the_model_sees(self):
        client = ScriptedOpenAI([ScriptedChoice("hello")])

        said = asking(client)(an_ask(state={"question": "is it raining"}))

        assert "is it raining" in str(said.prompt)

    def test_it_leaves_room_for_an_answer_after_the_thinking(self):
        """생각하는 데 먼저 쓰이는 판이 있다 — 인색하게 잡으면 답할 몫이 남지 않는다."""
        client = ScriptedOpenAI([ScriptedChoice("hello")])

        asking(client)(an_ask())

        assert client.requests[0]["max_tokens"] == MAX_TOKENS
        assert MAX_TOKENS >= 2000

    def test_the_company_door_is_told_the_room_in_the_words_it_takes(self):
        """본사의 생각하는 모델은 옛 이름으로 크기를 말하면 아예 받지 않는다."""
        client = ScriptedOpenAI([ScriptedChoice("hello")])

        asking(client, key=A_KEY)(an_ask(model_ref="model://gpt"))

        assert client.requests[0]["max_completion_tokens"] == MAX_TOKENS
        assert "max_tokens" not in client.requests[0]

    def test_a_serving_somewhere_else_keeps_the_words_it_has_always_taken(self):
        """내 컴퓨터에서 띄운 서빙은 옛 이름으로 받는다 — 실측으로 확인한 자리다."""
        client = ScriptedOpenAI([ScriptedChoice("hello")])

        asking(client)(an_ask())

        assert "max_completion_tokens" not in client.requests[0]

    def test_a_node_that_only_speaks_is_not_forced_into_a_shape(self):
        client = ScriptedOpenAI([ScriptedChoice("hello")])

        asking(client)(an_ask())

        assert "response_format" not in client.requests[0]


class TestAskingAModelToPickAWay:
    def picked(
        self,
        answer: str | None,
        ways: tuple[str, ...] = ("revise", "ship"),
        model_ref: str = "model://local",
    ):
        client = ScriptedOpenAI([ScriptedChoice(answer)])
        said = asking(client, key=A_KEY)(an_ask(ways=ways, model_ref=model_ref))
        return client, said

    def test_the_ways_on_offer_are_the_only_answers_the_model_may_give(self):
        client, _ = self.picked(json.dumps({"way": "revise"}))

        shape = client.requests[0]["response_format"]
        assert shape["type"] == "json_schema"
        assert shape["json_schema"]["schema"]["properties"]["way"]["enum"] == [
            "revise",
            "ship",
        ]

    def test_the_shape_it_asks_for_has_a_name_because_this_provider_wants_one(self):
        client, _ = self.picked(json.dumps({"way": "revise"}))

        assert client.requests[0]["response_format"]["json_schema"]["name"]

    def test_the_company_door_is_asked_strictly_so_the_ways_really_bind(self):
        """엄격하게 청하지 않으면 저쪽은 모양을 참고만 한다 — 없는 길이 답으로 올 수 있다."""
        client, _ = self.picked(json.dumps({"way": "revise"}), model_ref="model://gpt")

        assert client.requests[0]["response_format"]["json_schema"]["strict"] is True

    def test_a_serving_somewhere_else_is_asked_the_way_it_always_was(self):
        """내 컴퓨터에서 띄운 서빙에 보내는 모양은 실측으로 확인한 그대로 둔다."""
        client, _ = self.picked(json.dumps({"way": "revise"}))

        assert "strict" not in client.requests[0]["response_format"]["json_schema"]

    def test_the_shape_leaves_no_room_for_anything_else(self):
        client, _ = self.picked(json.dumps({"way": "revise"}))

        shape = client.requests[0]["response_format"]["json_schema"]["schema"]
        assert shape["required"] == ["way"]
        assert shape["additionalProperties"] is False

    def test_the_way_the_model_chose_is_the_way_that_comes_back(self):
        _, said = self.picked(json.dumps({"way": "ship"}))

        assert isinstance(said, ModelSaid)
        assert said.way == "ship"

    def test_a_way_nobody_offered_is_still_reported_as_the_answer(self):
        _, said = self.picked(json.dumps({"way": "nowhere"}))

        assert said.way == "nowhere"

    def test_an_answer_that_is_not_the_shape_asked_for_is_trouble_not_a_guess(self):
        _, said = self.picked("revise, I think")

        assert isinstance(said, ModelBalked)
        assert said.reason == "provider_error"


#: 선택 열쇠와 자유로운 판을 함께 지닌 모양 — 우리가 실제로 청하는 모양의 축소판이다.
A_SHAPE = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "note": {"anyOf": [{"type": "string"}, {"type": "null"}]},
        "config": {"type": "object", "additionalProperties": True},
    },
    "required": ["id"],
}


class TestAskingAModelForAShapeOfOurOwn:
    """갈림길이 아니라 우리가 지은 모양 한 벌을 청하는 자리."""

    def asked_for(self, model_ref: str) -> dict:
        client = ScriptedOpenAI([ScriptedChoice(json.dumps({"id": "x"}))])
        asking(client, key=A_KEY)(an_ask(model_ref=model_ref, shape=A_SHAPE))
        return client.requests[0]["response_format"]["json_schema"]

    def test_the_company_door_is_not_asked_strictly_for_a_shape_of_our_own(self):
        """엄격은 모든 열쇠가 required이고 여분을 막을 것을 요구한다 — 우리 모양에는 선택 열쇠와
        자유로운 판이 있어 그 요구를 만족할 수 없다. 엄격을 얹으면 저쪽이 청을 통째로 물린다.
        """
        assert "strict" not in self.asked_for("model://gpt")

    def test_the_shape_that_travels_is_the_one_the_ask_named(self):
        shape = self.asked_for("model://gpt")

        assert shape["name"] == "a_shape"
        assert shape["schema"] == A_SHAPE


def test_company_response_carries_non_secret_request_evidence():
    client = ScriptedOpenAI([ScriptedChoice("hello")])

    said = asking(client, key=A_KEY)(an_ask(model_ref="model://gpt"))

    assert isinstance(said, ModelSaid)
    assert said.evidence is not None
    assert said.evidence.provider == "openai_compatible"
    assert said.evidence.model_id == "gpt-5"
    assert said.evidence.request_id
    assert said.evidence.latency_ms is not None
    assert client.requests[0]["store"] is False
    assert str(client.requests[0]["extra_headers"]["X-Client-Request-Id"]).startswith(
        "agentcanvas-"
    )
    assert A_KEY not in str(said.evidence)


class TestTheKeyThatOpensTheDoor:
    def test_the_key_has_one_proper_name_in_the_vault(self):
        assert OPENAI_API_KEY_REF == "secret://openai-api-key"

    def test_a_model_at_the_company_door_needs_a_real_key(self):
        said = asking(ScriptedOpenAI())(an_ask(model_ref="model://gpt"))

        assert isinstance(said, ModelBalked)
        assert said.reason == "missing_secret"

    def test_it_asks_for_that_key_by_name_without_ever_showing_one(self):
        said = asking(ScriptedOpenAI())(an_ask(model_ref="model://gpt"))

        assert isinstance(said, ModelBalked)
        assert OPENAI_API_KEY_REF in said.message
        assert "sk-" not in said.message

    def test_a_model_on_my_own_computer_needs_no_key_at_all(self):
        opened: list[tuple] = []
        client = ScriptedOpenAI([ScriptedChoice("hello")])

        said = asking(client, opened=opened)(an_ask())

        assert isinstance(said, ModelSaid)
        assert opened == [(LOCAL_URL, LOCAL_KEY)]

    def test_the_key_the_vault_holds_opens_the_company_door(self):
        opened: list[tuple] = []
        client = ScriptedOpenAI([ScriptedChoice("hello")])

        asking(client, key=A_KEY, opened=opened)(an_ask(model_ref="model://gpt"))

        assert opened == [(None, A_KEY)]

    def test_the_key_is_looked_up_once_when_the_door_is_built(self):
        looked_up: list[str] = []
        client = ScriptedOpenAI([ScriptedChoice("hi"), ScriptedChoice("hi")])
        asks = openai_from(
            lambda ref: looked_up.append(ref) or A_KEY,
            CATALOG,
            client_from=lambda base_url, key: client,
        )
        assert looked_up == [OPENAI_API_KEY_REF]

        asks(an_ask())
        asks(an_ask())

        assert looked_up == [OPENAI_API_KEY_REF]

    def test_one_door_is_opened_once_however_often_it_is_used(self):
        opened: list[tuple] = []
        client = ScriptedOpenAI([ScriptedChoice("hi"), ScriptedChoice("hi")])
        asks = asking(client, opened=opened)

        asks(an_ask())
        asks(an_ask())

        assert opened == [(LOCAL_URL, LOCAL_KEY)]

    def test_the_key_never_travels_in_the_answer(self):
        client = ScriptedOpenAI([ScriptedChoice("hello")])

        said = asking(client, key=A_KEY)(an_ask(model_ref="model://gpt"))

        assert A_KEY not in str(said)


class TestAModelNobodySetUp:
    def test_a_ref_the_catalog_does_not_know_is_never_even_asked(self):
        client = ScriptedOpenAI([ScriptedChoice("hello")])

        said = asking(client)(an_ask(model_ref="model://nobody-set-this-up"))

        assert isinstance(said, ModelBalked)
        assert said.reason == "unknown_model"
        assert client.requests == []


class TestWhenTheProviderCannotAnswer:
    def test_trouble_on_the_wire_is_an_answer_not_a_crash(self):
        said = asking(ScriptedOpenAI([a_provider_error()]))(an_ask())

        assert isinstance(said, ModelBalked)
        assert said.reason == "provider_error"

    def test_it_tells_the_person_what_happened_without_the_machine_talk(self):
        said = asking(ScriptedOpenAI([a_provider_error()]))(an_ask())

        assert isinstance(said, ModelBalked)
        assert "Traceback" not in said.message
        assert "openai" not in said.message.lower()

    def test_an_answer_that_was_stopped_by_a_filter_says_the_model_declined(self):
        client = ScriptedOpenAI([ScriptedChoice(None, finish_reason="content_filter")])

        said = asking(client)(an_ask())

        assert isinstance(said, ModelBalked)
        assert "declined" in said.message

    def test_an_answer_cut_off_before_it_finished_is_trouble_not_half_an_answer(self):
        """생각에 판을 다 쓰면 말이 잘린 채 온다 — 반쪽을 답으로 치지 않는다."""
        client = ScriptedOpenAI([ScriptedChoice("here is half a th", "length")])

        said = asking(client)(an_ask())

        assert isinstance(said, ModelBalked)
        assert "cut off" in said.message

    def test_an_answer_with_no_words_in_it_is_trouble_rather_than_silence(self):
        client = ScriptedOpenAI([ScriptedChoice("")])

        said = asking(client)(an_ask())

        assert isinstance(said, ModelBalked)
        assert said.reason == "provider_error"

    def test_an_answer_that_chose_nothing_at_all_is_trouble_too(self):
        client = ScriptedOpenAI([ScriptedChoice.with_no_choice_at_all()])

        said = asking(client)(an_ask())

        assert isinstance(said, ModelBalked)
        assert said.reason == "provider_error"


@pytest.mark.parametrize("model_ref", ["model://local", "model://gpt"])
@pytest.mark.parametrize("ways", [(), ("revise", "ship")])
def test_every_word_this_adapter_sends_is_a_word_the_real_client_takes(ways, model_ref):
    """대역은 아무 말이나 받아 준다 — 진짜 클라이언트가 받지 않는 말을 보내면 여기서 걸린다.

    두 문은 서로 다른 말로 크기를 말한다 — 어느 쪽도 진짜가 모르는 말을 쓰지 않는다.
    """
    client = ScriptedOpenAI([ScriptedChoice(json.dumps({"way": "revise"}))])
    asking(client, key=A_KEY)(an_ask(ways=ways, model_ref=model_ref))

    taken = inspect.signature(
        openai.resources.chat.completions.Completions.create
    ).parameters

    assert set(client.requests[0]) <= set(taken)


def test_the_door_it_opens_by_default_is_a_real_client_at_that_address():
    opened = opens_openai(LOCAL_URL, LOCAL_KEY)

    assert opened.api_key == LOCAL_KEY
    assert str(opened.base_url).startswith(LOCAL_URL)
