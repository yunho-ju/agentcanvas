"""진짜 모델에게 말을 거는 자리 — 무엇을 보내고, 들은 것을 어떻게 계약의 말로 옮기는가.

여기서는 실제 그물을 타지 않는다: 진짜 클라이언트가 설 자리에 결정론 대역을 세운다.
"""

from __future__ import annotations

import inspect
import json

import anthropic
import httpx
import pytest
from agentcanvas_adapters.anthropic_model import (
    ANTHROPIC_API_KEY_REF,
    MAX_TOKENS,
    anthropic_from,
    asks_anthropic,
    opens_anthropic,
)
from agentcanvas_adapters.scripted import ScriptedLLM, ScriptedReply
from agentcanvas_adapters.secrets import env_vault
from agentcanvas_contracts.agent_spec import Node, Position
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelSaid

A_KEY = "sk-ant-not-a-real-key-000"


def a_node(node_id: str = "writer", node_type: str = "llm.agent") -> Node:
    return Node(id=node_id, type=node_type, position=Position(x=0, y=0), config={})


def an_ask(
    ways: tuple[str, ...] = (),
    model_ref: str = "model://claude-haiku",
    state: dict | None = None,
    instruction: str | None = None,
) -> ModelAsk:
    return ModelAsk(
        node=a_node("triage", "llm.router") if ways else a_node(),
        state=state or {},
        ways=ways,
        model_ref=model_ref,
        prompt_ref="prompt://writer@3",
        instruction=instruction,
    )


def a_provider_error() -> anthropic.APIConnectionError:
    return anthropic.APIConnectionError(
        request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    )


class TestAskingAModelToSpeak:
    def test_it_asks_the_model_the_catalog_named_not_the_ref_people_pick(self):
        client = ScriptedLLM([ScriptedReply("hello there")])

        asks_anthropic(client)(an_ask())

        assert client.requests[0]["model"] == "claude-haiku-4-5"

    def test_it_brings_back_what_the_model_said_word_for_word(self):
        client = ScriptedLLM([ScriptedReply("hello there")])

        said = asks_anthropic(client)(an_ask())

        assert isinstance(said, ModelSaid)
        assert said.text == "hello there"

    def test_it_brings_back_the_sizes_the_provider_measured(self):
        client = ScriptedLLM([ScriptedReply("hello", input_tokens=77, output_tokens=4)])

        said = asks_anthropic(client)(an_ask())

        assert (said.input_tokens, said.output_tokens) == (77, 4)

    def test_the_prompt_it_brings_back_is_the_one_it_really_sent(self):
        client = ScriptedLLM([ScriptedReply("hello")])

        said = asks_anthropic(client)(an_ask(state={"question": "is it raining"}))

        sent = client.requests[0]
        assert isinstance(said.prompt, str)
        assert sent["system"] in said.prompt
        assert sent["messages"][0]["content"] in said.prompt

    def test_what_flowed_in_so_far_is_part_of_what_the_model_sees(self):
        client = ScriptedLLM([ScriptedReply("hello")])

        said = asks_anthropic(client)(an_ask(state={"question": "is it raining"}))

        assert "is it raining" in str(said.prompt)

    def test_the_instruction_the_node_named_is_part_of_what_the_model_sees(self):
        client = ScriptedLLM([ScriptedReply("hello")])

        said = asks_anthropic(client)(an_ask())

        assert "prompt://writer@3" in str(said.prompt)

    def test_words_someone_wrote_are_what_the_model_reads_not_the_name(self):
        """지시문을 직접 적었으면 모델은 그 말을 읽는다 — 이름표(prompt_ref)가 아니라."""
        client = ScriptedLLM([ScriptedReply("hello")])

        asks_anthropic(client)(an_ask(instruction="answer in exactly three words"))

        sent = client.requests[0]["messages"][0]["content"]
        assert "answer in exactly three words" in sent
        assert "prompt://writer@3" not in sent

    def test_a_fork_reads_written_words_the_same_way(self):
        client = ScriptedLLM([ScriptedReply(json.dumps({"way": "simple"}))])

        asks_anthropic(client)(
            an_ask(ways=("clinical", "simple"), instruction="pick by urgency")
        )

        sent = client.requests[0]["messages"][0]["content"]
        assert "pick by urgency" in sent
        assert "prompt://writer@3" not in sent

    def test_it_never_sends_the_dials_this_provider_refuses(self):
        """thinking·temperature 따위를 함께 보내면 그 요청은 통째로 거절된다."""
        client = ScriptedLLM([ScriptedReply("hello")])

        asks_anthropic(client)(an_ask())

        forbidden = {"temperature", "top_p", "top_k", "thinking", "budget_tokens"}
        assert forbidden.isdisjoint(client.requests[0])

    def test_it_leaves_room_for_a_real_answer(self):
        client = ScriptedLLM([ScriptedReply("hello")])

        asks_anthropic(client)(an_ask())

        assert client.requests[0]["max_tokens"] == MAX_TOKENS
        assert MAX_TOKENS >= 4096

    def test_a_node_that_only_speaks_is_not_forced_into_a_shape(self):
        client = ScriptedLLM([ScriptedReply("hello")])

        asks_anthropic(client)(an_ask())

        assert "output_config" not in client.requests[0]


class TestAskingAModelToPickAWay:
    def picked(self, answer: str, ways: tuple[str, ...] = ("clinical", "simple")):
        client = ScriptedLLM([ScriptedReply(answer)])
        said = asks_anthropic(client)(an_ask(ways=ways))
        return client, said

    def test_the_ways_on_offer_are_the_only_answers_the_model_may_give(self):
        client, _ = self.picked(json.dumps({"way": "clinical"}))

        shape = client.requests[0]["output_config"]["format"]
        assert shape["type"] == "json_schema"
        assert shape["schema"]["properties"]["way"]["enum"] == ["clinical", "simple"]

    def test_the_shape_leaves_no_room_for_anything_else(self):
        client, _ = self.picked(json.dumps({"way": "clinical"}))

        shape = client.requests[0]["output_config"]["format"]["schema"]
        assert shape["required"] == ["way"]
        assert shape["additionalProperties"] is False

    def test_the_ways_on_offer_are_said_in_the_prompt_too(self):
        _, said = self.picked(json.dumps({"way": "clinical"}))

        assert "clinical" in str(said.prompt)

    def test_the_way_the_model_chose_is_the_way_that_comes_back(self):
        _, said = self.picked(json.dumps({"way": "simple"}))

        assert isinstance(said, ModelSaid)
        assert said.way == "simple"

    def test_what_it_answered_is_kept_as_well_as_the_way_it_means(self):
        _, said = self.picked(json.dumps({"way": "simple"}))

        assert said.text == json.dumps({"way": "simple"})

    def test_a_way_nobody_offered_is_still_reported_as_the_answer(self):
        """막다른 길인지는 그래프가 정한다 — 여기서 답을 고쳐 쓰지 않는다."""
        _, said = self.picked(json.dumps({"way": "nowhere"}))

        assert said.way == "nowhere"

    def test_an_answer_that_is_not_the_shape_asked_for_is_trouble_not_a_guess(self):
        _, said = self.picked("clinical, I think")

        assert said == ModelBalked(
            reason="provider_error",
            message="the model did not answer in the shape this run asked for",
        )

    def test_an_answer_with_no_way_in_it_is_trouble_too(self):
        _, said = self.picked(json.dumps({"thoughts": "hmm"}))

        assert isinstance(said, ModelBalked)
        assert said.reason == "provider_error"


class TestAModelNobodySetUp:
    def test_a_ref_the_catalog_does_not_know_is_never_even_asked(self):
        client = ScriptedLLM([ScriptedReply("hello")])

        said = asks_anthropic(client)(an_ask(model_ref="model://nobody-set-this-up"))

        assert isinstance(said, ModelBalked)
        assert said.reason == "unknown_model"
        assert client.requests == []

    def test_it_says_which_name_nobody_set_up_in_plain_words(self):
        said = asks_anthropic(ScriptedLLM())(an_ask(model_ref="model://nope"))

        assert isinstance(said, ModelBalked)
        assert "model://nope" in said.message
        assert said.message.islower() or said.message[0].islower()


class TestTheKeyThatOpensTheDoor:
    def test_the_key_has_one_proper_name_in_the_vault(self):
        assert ANTHROPIC_API_KEY_REF == "secret://anthropic-api-key"

    def test_with_no_key_set_nobody_is_asked_and_the_run_is_told_why(self):
        asks = anthropic_from(env_vault({}))

        said = asks(an_ask())

        assert isinstance(said, ModelBalked)
        assert said.reason == "missing_secret"

    def test_it_asks_for_a_key_without_ever_showing_one(self):
        said = anthropic_from(env_vault({}))(an_ask())

        assert isinstance(said, ModelBalked)
        assert ANTHROPIC_API_KEY_REF in said.message
        assert "sk-" not in said.message

    def test_the_key_is_looked_up_once_when_the_door_is_built(self):
        """물을 때마다 금고를 여는 것은 열쇠를 그만큼 더 흘리는 일이다."""
        looked_up: list[str] = []
        asks = anthropic_from(
            lambda ref: looked_up.append(ref) or A_KEY,
            client_from_key=lambda key: ScriptedLLM(
                [ScriptedReply("hi"), ScriptedReply("hi")]
            ),
        )
        assert looked_up == [ANTHROPIC_API_KEY_REF]

        asks(an_ask())
        asks(an_ask())

        assert looked_up == [ANTHROPIC_API_KEY_REF]

    def test_the_door_it_opens_by_default_is_a_real_client_holding_that_key(self):
        assert opens_anthropic(A_KEY).api_key == A_KEY

    def test_the_key_opens_a_client_and_never_travels_in_the_answer(self):
        client = ScriptedLLM([ScriptedReply("hello")])
        opened: list[str] = []

        asks = anthropic_from(
            env_vault({"AGENTCANVAS_SECRET_ANTHROPIC_API_KEY": A_KEY}),
            client_from_key=lambda key: (opened.append(key), client)[1],
        )
        said = asks(an_ask())

        assert opened == [A_KEY]
        assert A_KEY not in str(said)


class TestWhenTheProviderCannotAnswer:
    def test_trouble_on_the_wire_is_an_answer_not_a_crash(self):
        client = ScriptedLLM([a_provider_error()])

        said = asks_anthropic(client)(an_ask())

        assert isinstance(said, ModelBalked)
        assert said.reason == "provider_error"

    def test_it_tells_the_person_what_happened_without_the_machine_talk(self):
        said = asks_anthropic(ScriptedLLM([a_provider_error()]))(an_ask())

        assert isinstance(said, ModelBalked)
        assert "Traceback" not in said.message
        assert "anthropic" not in said.message.lower()

    def test_a_refusal_is_read_before_anything_the_answer_might_hold(self):
        """거절은 200으로 온다 — content를 먼저 열어 보면 있지도 않은 말을 읽게 된다."""
        client = ScriptedLLM([ScriptedReply("", stop_reason="refusal")])

        said = asks_anthropic(client)(an_ask())

        assert isinstance(said, ModelBalked)
        assert said.reason == "provider_error"

    def test_a_refusal_says_the_model_declined_rather_than_blaming_the_wire(self):
        client = ScriptedLLM([ScriptedReply("", stop_reason="refusal")])

        said = asks_anthropic(client)(an_ask())

        assert isinstance(said, ModelBalked)
        assert "declined" in said.message

    def test_an_answer_cut_off_by_the_size_cap_is_trouble_not_half_an_answer(self):
        """반쪽 답이 정상 완료로 기록되면 그 기록을 읽는 모든 자리가 그것을 온 답으로 믿는다."""
        client = ScriptedLLM(
            [ScriptedReply("half of what I mea", stop_reason="max_tokens")]
        )

        said = asks_anthropic(client)(an_ask())

        assert isinstance(said, ModelBalked)
        assert said.reason == "provider_error"
        assert "cut off" in said.message

    def test_an_answer_of_empty_words_is_trouble_just_like_no_words_at_all(self):
        """빈 문자열 하나가 담긴 응답 — 말 조각이 없는 응답과 같은 규칙으로 본다 (openai와 동일)."""
        client = ScriptedLLM([ScriptedReply("")])

        said = asks_anthropic(client)(an_ask())

        assert isinstance(said, ModelBalked)
        assert said.reason == "provider_error"

    def test_an_answer_with_no_words_in_it_is_trouble_rather_than_silence(self):
        client = ScriptedLLM([ScriptedReply.with_no_text()])

        said = asks_anthropic(client)(an_ask())

        assert isinstance(said, ModelBalked)
        assert said.reason == "provider_error"


class TestTheStandInItself:
    def test_it_answers_in_the_order_it_was_written(self):
        client = ScriptedLLM([ScriptedReply("first"), ScriptedReply("second")])
        asks = asks_anthropic(client)

        assert [asks(an_ask()).text, asks(an_ask()).text] == ["first", "second"]

    def test_it_remembers_every_request_it_was_given(self):
        client = ScriptedLLM([ScriptedReply("first"), ScriptedReply("second")])
        asks = asks_anthropic(client)

        asks(an_ask())
        asks(an_ask(model_ref="model://claude-opus"))

        assert [request["model"] for request in client.requests] == [
            "claude-haiku-4-5",
            "claude-opus-5",
        ]

    def test_it_says_so_loudly_when_the_script_runs_out(self):
        client = ScriptedLLM([])

        with pytest.raises(AssertionError):
            client.messages.create(model="claude-haiku-4-5", max_tokens=1, messages=[])


@pytest.mark.parametrize("ways", [(), ("clinical", "simple")])
def test_every_word_this_adapter_sends_is_a_word_the_real_client_takes(ways):
    """대역은 아무 말이나 받아 준다 — 진짜 클라이언트가 받지 않는 말을 보내면 여기서 걸린다.

    받지 않는 말은 TypeError가 되어 provider 오류가 아니라 실행 전체의 사고로 샌다.
    """
    client = ScriptedLLM([ScriptedReply(json.dumps({"way": "clinical"}))])
    asks_anthropic(client)(an_ask(ways=ways))

    taken = inspect.signature(anthropic.resources.messages.Messages.create).parameters

    assert set(client.requests[0]) <= set(taken)
