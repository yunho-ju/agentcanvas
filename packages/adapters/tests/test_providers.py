"""물음마다 그 모델이 사는 곳에 묻는다 — provider 이름이 어느 자리에 묻는가를 정한다."""

from __future__ import annotations

from typing import get_args

from agentcanvas_adapters.anthropic_model import ANTHROPIC_API_KEY_REF
from agentcanvas_adapters.openai_model import OPENAI_API_KEY_REF
from agentcanvas_adapters.providers import (
    OPENS_BY_PROVIDER,
    asks_whoever_serves,
    nobody_to_ask,
)
from agentcanvas_adapters.secrets import env_vault
from agentcanvas_contracts.agent_spec import Node, Position
from agentcanvas_contracts.model_catalog import ModelDef, Provider
from agentcanvas_engine.model_call import ModelAsk, ModelBalked

AT_ANTHROPIC = ModelDef(
    ref="model://claude",
    title={"ko": "클로드", "en": "Claude"},
    provider="anthropic",
    model_id="claude-haiku-4-5",
)
AT_OPENAI = ModelDef(
    ref="model://gpt",
    title={"ko": "본사 모델", "en": "The company's model"},
    provider="openai_compatible",
    model_id="gpt-5",
)
CATALOG = {model.ref: model for model in [AT_ANTHROPIC, AT_OPENAI]}


def an_ask(model_ref: str) -> ModelAsk:
    return ModelAsk(
        node=Node(
            id="writer", type="llm.agent", position=Position(x=0, y=0), config={}
        ),
        state={},
        ways=(),
        model_ref=model_ref,
        prompt_ref="prompt://writer@1",
    )


def test_every_place_a_model_can_live_has_someone_who_asks_there():
    """표에 없는 provider는 KeyError가 되어 실행 전체의 사고로 샌다 — 늘리면 여기서 먼저 걸린다."""
    assert set(OPENS_BY_PROVIDER) == set(get_args(Provider))


class TestAskingWhoeverServesThatModel:
    def asks(self):
        return asks_whoever_serves(env_vault({}), CATALOG)

    def test_a_model_at_anthropic_is_asked_for_the_anthropic_key(self):
        said = self.asks()(an_ask("model://claude"))

        assert isinstance(said, ModelBalked)
        assert ANTHROPIC_API_KEY_REF in said.message

    def test_a_model_speaking_openai_is_asked_for_the_openai_key(self):
        said = self.asks()(an_ask("model://gpt"))

        assert isinstance(said, ModelBalked)
        assert OPENAI_API_KEY_REF in said.message

    def test_a_name_the_catalog_does_not_know_reaches_nobody_at_all(self):
        said = self.asks()(an_ask("model://nobody-set-this-up"))

        assert isinstance(said, ModelBalked)
        assert said.reason == "unknown_model"


class TestWhetherThereIsAnybodyToAskAtAll:
    def test_a_server_with_no_key_and_nothing_local_has_nobody_to_ask(self):
        assert nobody_to_ask(env_vault({}), CATALOG) is True

    def test_a_matching_key_is_enough_to_have_somebody_to_ask(self):
        vault = env_vault({"AGENTCANVAS_SECRET_OPENAI_API_KEY": "sk-not-a-real-key"})

        assert nobody_to_ask(vault, CATALOG) is False

    def test_a_model_on_my_own_computer_needs_no_key_to_be_somebody_to_ask(self):
        on_my_computer = ModelDef(
            ref="model://local",
            title={"ko": "내 컴퓨터의 모델", "en": "The model on my computer"},
            provider="openai_compatible",
            model_id="gemma4:26b",
            base_url="http://127.0.0.1:11434/v1",
        )

        assert (
            nobody_to_ask(
                env_vault({}), {**CATALOG, on_my_computer.ref: on_my_computer}
            )
            is False
        )

    def test_every_place_that_can_be_asked_says_which_key_it_wants(self):
        assert {door.key_ref for door in OPENS_BY_PROVIDER.values()} == {
            ANTHROPIC_API_KEY_REF,
            OPENAI_API_KEY_REF,
        }
