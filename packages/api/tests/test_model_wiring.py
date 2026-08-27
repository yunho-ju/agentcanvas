"""서버가 어느 모델에게 물을지 정하는 자리 — 열쇠가 있으면 진짜에게, 없으면 결정론 대역에게.

이 갈림은 조립 한 곳에만 있다: 실행기도 서비스도 provider를 알지 못한다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from agentcanvas_adapters.anthropic_model import ANTHROPIC_API_KEY_REF, anthropic_from
from agentcanvas_adapters.secrets import SECRET_ENV_PREFIX, env_name, env_vault
from agentcanvas_api.app import (
    DEFAULT_LOCAL_BASE_URL,
    LOCAL_BASE_URL_ENV,
    LOCAL_MODEL_ENV,
    LOCAL_MODEL_REF,
    OPENAI_MODEL_ENV,
    OPENAI_MODEL_REF,
    asks_the_model_in,
    catalog_in,
    create_app,
)
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.run_service import Work
from agentcanvas_contracts.agent_spec import Node, Position
from agentcanvas_contracts.model_catalog import DEFAULT_MODEL_CATALOG
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelCall, ModelSaid
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)
SPEC_ID = "clinical-assistant"
A_KEY = "sk-ant-not-a-real-key-000"
AN_OPENAI_KEY = "sk-not-a-real-openai-key-000"
STARTED_AT = datetime(2026, 8, 1, 12, 30, tzinfo=UTC)


def right_here(work: Work) -> None:
    """그 자리에서 곧장 하는 일꾼 — 시험은 배경을 기다리지 않고 결과를 본다."""
    work()


def an_ask(model_ref: str = "model://default") -> ModelAsk:
    return ModelAsk(
        node=Node(
            id="writer", type="llm.agent", position=Position(x=0, y=0), config={}
        ),
        state={},
        ways=(),
        model_ref=model_ref,
        prompt_ref="prompt://writer@1",
    )


def a_server(model: ModelCall | None = None) -> tuple[TestClient, InMemoryRunStore]:
    """실행을 기억만 하는 저장소를 곁에 둔 서버 — 남은 사건을 그대로 읽어 본다."""
    runs = InMemoryRunStore()
    client = TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=runs,
            clock=lambda: STARTED_AT,
            worker=right_here,
            model=model,
        )
    )
    client.post("/specs", json=json.loads(EXAMPLE_PATH.read_text(encoding="utf-8")))
    return client, runs


def events_of_a_run(client: TestClient, runs: InMemoryRunStore) -> list[RunEvent]:
    run_id = client.post(f"/specs/{SPEC_ID}/runs").json()["run"]["id"]
    return runs.events(run_id)


def only(events: list[RunEvent], event_type: EventType) -> RunEvent:
    return next(event for event in events if event.event_type is event_type)


class TestWhoTheServerAsks:
    def test_with_no_key_anywhere_it_asks_the_deterministic_stand_in(self):
        asks = asks_the_model_in({})

        assert isinstance(asks(an_ask()), ModelSaid)

    def test_the_stand_in_makes_up_nothing_it_never_heard(self):
        said = asks_the_model_in({})(an_ask())

        assert isinstance(said, ModelSaid)
        assert (said.text, said.prompt) == (None, None)

    def test_with_a_key_set_it_asks_the_real_provider(self):
        """진짜 provider는 카탈로그에 없는 이름을 그물에 나가기 전에 물린다 — 대역은 그러지 않는다."""
        asks = asks_the_model_in({SECRET_ENV_PREFIX + "ANTHROPIC_API_KEY": A_KEY})

        said = asks(an_ask("model://nobody-set-this-up"))

        assert isinstance(said, ModelBalked)
        assert said.reason == "unknown_model"

    def test_the_key_it_looks_for_is_the_one_the_vault_names(self):
        assert (
            env_name(ANTHROPIC_API_KEY_REF) == SECRET_ENV_PREFIX + "ANTHROPIC_API_KEY"
        )


class TestAServerWithNoKeyAtAll:
    def test_it_comes_up_and_runs_a_graph_just_as_it_always_did(self):
        client, runs = a_server()

        events = events_of_a_run(client, runs)

        assert events[-1].event_type is EventType.RUN_PAUSED

    def test_it_writes_down_the_stand_in_numbers_and_no_made_up_words(self):
        client, runs = a_server()

        completed = only(events_of_a_run(client, runs), EventType.LLM_COMPLETED)

        assert completed.payload["output_tokens"] == 128
        assert "text" not in completed.payload


class TestAServerToldToUseTheRealProviderWithoutAKey:
    @pytest.fixture
    def failure(self) -> RunEvent:
        client, runs = a_server(model=anthropic_from(env_vault({})))
        return events_of_a_run(client, runs)[-1]

    def test_the_run_ends_in_failure_rather_than_flowing_on(self, failure):
        assert failure.event_type is EventType.RUN_FAILED

    def test_it_says_the_trouble_was_a_key_nobody_set(self, failure):
        assert failure.payload["reason"] == "missing_secret"

    def test_it_asks_for_a_key_by_name_and_shows_none(self, failure):
        said = failure.payload["message"]

        assert ANTHROPIC_API_KEY_REF in said
        assert "sk-" not in said


class TestAServerWhoseGraphNamesAModelNobodySetUp:
    def test_the_run_fails_saying_that_name_is_not_set_up_here(self):
        spec = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
        for node in spec["nodes"]:
            if node["type"].startswith("llm."):
                node["config"]["model_ref"] = "model://nobody-set-this-up"
        client, runs = a_server(
            model=anthropic_from(
                env_vault({SECRET_ENV_PREFIX + "ANTHROPIC_API_KEY": A_KEY})
            )
        )
        current = client.get(f"/specs/{SPEC_ID}").json()["spec"]
        client.put(
            f"/specs/{SPEC_ID}",
            headers={"If-Match": current["revision"]},
            json=spec,
        )

        failed = events_of_a_run(client, runs)[-1]

        assert failed.event_type is EventType.RUN_FAILED
        assert failed.payload["reason"] == "unknown_model"


class TestTheModelOnMyOwnComputer:
    def a_local_env(self, **more: str) -> dict[str, str]:
        return {LOCAL_MODEL_ENV: "gemma4:26b", **more}

    def test_nothing_local_is_named_so_the_catalog_is_the_one_we_ship(self):
        assert catalog_in({}) == dict(DEFAULT_MODEL_CATALOG)

    def test_naming_a_local_model_puts_it_in_the_catalog_this_server_uses(self):
        local = catalog_in(self.a_local_env())[LOCAL_MODEL_REF]

        assert (local.provider, local.model_id) == ("openai_compatible", "gemma4:26b")

    def test_it_knocks_on_the_usual_local_door_unless_told_otherwise(self):
        local = catalog_in(self.a_local_env())[LOCAL_MODEL_REF]

        assert local.base_url == DEFAULT_LOCAL_BASE_URL

    def test_the_door_can_be_said_out_loud_when_it_is_somewhere_else(self):
        env = self.a_local_env(**{LOCAL_BASE_URL_ENV: "http://10.0.0.2:11434/v1"})

        assert catalog_in(env)[LOCAL_MODEL_REF].base_url == "http://10.0.0.2:11434/v1"

    def test_the_list_this_product_ships_is_never_touched_by_one_server_s_setup(self):
        """카탈로그 JSON은 git에 커밋되고 화면으로 나간다 — 내 컴퓨터 사정이 섞이면 안 된다."""
        catalog_in(self.a_local_env())

        assert LOCAL_MODEL_REF not in DEFAULT_MODEL_CATALOG

    def test_a_local_model_alone_is_reason_enough_to_ask_a_real_one(self):
        """열쇠가 하나도 없어도 내 컴퓨터의 모델에게는 물을 수 있다."""
        asks = asks_the_model_in(self.a_local_env())

        said = asks(an_ask("model://nobody-set-this-up"))

        assert isinstance(said, ModelBalked)
        assert said.reason == "unknown_model"


class TestTheModelAtTheCompanyDoor:
    def a_key_env(self, **more: str) -> dict[str, str]:
        return {SECRET_ENV_PREFIX + "OPENAI_API_KEY": AN_OPENAI_KEY, **more}

    def test_with_no_key_for_it_the_catalog_holds_no_such_model(self):
        assert OPENAI_MODEL_REF not in catalog_in({})

    def test_a_key_without_an_explicit_model_adds_no_openai_model(self):
        env = self.a_key_env()

        assert OPENAI_MODEL_REF not in catalog_in(env)
        assert isinstance(asks_the_model_in(env)(an_ask()), ModelSaid)

    def test_a_key_and_explicit_model_put_that_door_in_the_catalog(self):
        model = catalog_in(self.a_key_env(**{OPENAI_MODEL_ENV: "gpt-public-example"}))[
            OPENAI_MODEL_REF
        ]

        assert (model.provider, model.base_url) == ("openai_compatible", None)

    def test_the_model_to_ask_must_be_said_out_loud(self):
        env = self.a_key_env(**{OPENAI_MODEL_ENV: "gpt-public-example"})

        assert catalog_in(env)[OPENAI_MODEL_REF].model_id == "gpt-public-example"

    def test_it_says_which_model_it_is_in_both_languages(self):
        env = self.a_key_env(**{OPENAI_MODEL_ENV: "gpt-public-example"})
        title = catalog_in(env)[OPENAI_MODEL_REF].title

        assert "gpt-public-example" in title.ko
        assert "gpt-public-example" in title.en

    def test_the_list_this_product_ships_is_never_touched_by_one_server_s_key(self):
        catalog_in(self.a_key_env())

        assert OPENAI_MODEL_REF not in DEFAULT_MODEL_CATALOG

    def test_a_server_with_both_knows_the_local_model_and_the_company_door(self):
        both = self.a_key_env(
            **{
                OPENAI_MODEL_ENV: "gpt-public-example",
                LOCAL_MODEL_ENV: "gemma4:26b",
            }
        )

        assert {OPENAI_MODEL_REF, LOCAL_MODEL_REF} <= set(catalog_in(both))
