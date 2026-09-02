"""화면이 "이 서버가 부를 수 있는 모델"을 아는 길 — 투영 하나와 그 길 하나.

번들 카탈로그는 제품이 싣고 다니는 목록일 뿐이라, OpenAI만 설정된 서버에서는 화면이
부를 수 없는 이름만 보여 준다. 여기서 서버가 자기 사정을 말한다: 무엇을 알고, 그중
무엇을 지금 부를 수 있는가. 열쇠는 어느 자리에도 나가지 않는다.
"""

from __future__ import annotations

import json

import pytest
from agentcanvas_adapters.secrets import SECRET_ENV_PREFIX, env_vault
from agentcanvas_api.app import (
    LOCAL_MODEL_ENV,
    LOCAL_MODEL_REF,
    OPENAI_MODEL_ENV,
    OPENAI_MODEL_REF,
    catalog_in,
    create_app,
)
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.model_catalog_service import models_standing
from agentcanvas_engine.model_call import ModelSaid
from fastapi.testclient import TestClient

AN_OPENAI_KEY = "sk-not-a-real-openai-key-000"
DEFAULT_MODEL_REF = "model://default"
#: 화면이 읽는 것만 나간다 — 서버를 띄운 자리의 설정(주소·모델 ID)조차 실리지 않는다.
PUBLIC_FIELDS = {"ref", "title", "callable", "reason"}


def a_key_env(**more: str) -> dict[str, str]:
    return {SECRET_ENV_PREFIX + "OPENAI_API_KEY": AN_OPENAI_KEY, **more}


def standing_in(env: dict[str, str]) -> dict[str, dict[str, object]]:
    """투영을 ref로 찾아 읽기 좋게 — 순서를 보는 시험은 목록 그대로 쓴다."""
    return {
        model.ref: model.model_dump()
        for model in models_standing(catalog_in(env), env_vault(env))
    }


class TestWhatThisServerCanCall:
    def test_a_model_whose_key_this_server_holds_can_be_called(self):
        env = a_key_env(**{OPENAI_MODEL_ENV: "gpt-public-example"})

        openai = standing_in(env)[OPENAI_MODEL_REF]

        assert (openai["callable"], openai["reason"]) == (True, None)

    def test_a_model_with_no_key_here_says_why_it_cannot_be_called(self):
        default = standing_in({})[DEFAULT_MODEL_REF]

        assert (default["callable"], default["reason"]) == (False, "missing_secret")

    def test_a_model_on_my_own_computer_needs_no_key_to_be_callable(self):
        local = standing_in({LOCAL_MODEL_ENV: "gemma4:26b"})[LOCAL_MODEL_REF]

        assert (local["callable"], local["reason"]) == (True, None)

    def test_a_key_for_one_place_does_not_open_the_other(self):
        env = a_key_env(**{OPENAI_MODEL_ENV: "gpt-public-example"})

        assert standing_in(env)[DEFAULT_MODEL_REF]["callable"] is False

    def test_it_says_every_model_this_server_knows(self):
        env = a_key_env(
            **{OPENAI_MODEL_ENV: "gpt-public-example", LOCAL_MODEL_ENV: "gemma4:26b"}
        )

        assert set(standing_in(env)) == set(catalog_in(env))

    def test_it_carries_only_the_public_fields_of_a_model(self):
        default = standing_in({})[DEFAULT_MODEL_REF]

        assert set(default) == PUBLIC_FIELDS

    def test_the_key_itself_never_travels_with_the_answer(self):
        env = a_key_env(**{OPENAI_MODEL_ENV: "gpt-public-example"})

        written = json.dumps(standing_in(env), default=str)

        assert AN_OPENAI_KEY not in written


def a_server() -> TestClient:
    """서버를 띄운 자리의 설정을 그대로 읽는 서버 — 배선은 조립 때 한 번 정해진다."""
    return TestClient(
        create_app(store=InMemorySpecStore(), run_store=InMemoryRunStore())
    )


class TestTheDoorThatTellsWhichModelsStand:
    @pytest.fixture
    def client(self, monkeypatch: pytest.MonkeyPatch) -> TestClient:
        monkeypatch.setenv(SECRET_ENV_PREFIX + "OPENAI_API_KEY", AN_OPENAI_KEY)
        monkeypatch.setenv(OPENAI_MODEL_ENV, "gpt-public-example")
        return TestClient(
            create_app(store=InMemorySpecStore(), run_store=InMemoryRunStore())
        )

    def test_it_answers_with_this_server_s_own_catalog(self, client: TestClient):
        answered = client.get("/models")

        assert answered.status_code == 200
        assert {model["ref"] for model in answered.json()["models"]} >= {
            OPENAI_MODEL_REF,
            DEFAULT_MODEL_REF,
        }

    def test_it_says_which_of_them_it_can_call_now(self, client: TestClient):
        by_ref = {
            model["ref"]: model for model in client.get("/models").json()["models"]
        }

        assert by_ref[OPENAI_MODEL_REF]["callable"] is True
        assert by_ref[DEFAULT_MODEL_REF] == {
            **by_ref[DEFAULT_MODEL_REF],
            "callable": False,
            "reason": "missing_secret",
        }

    def test_a_server_with_a_key_says_it_runs_on_the_real_thing(self, client):
        assert client.get("/models").json()["mode"] == "live"

    def test_no_key_leaves_this_server_through_that_door(self, client: TestClient):
        assert AN_OPENAI_KEY not in client.get("/models").text


class TestItSaysWhatTheRunningServerActuallyHolds:
    """조립 때 닫힌 카탈로그가 답이다 — 뒤에 바뀐 환경은 실행이 보지 못하므로 말하지도 않는다."""

    def test_a_model_named_after_the_server_was_built_is_not_offered(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        client = a_server()

        monkeypatch.setenv(LOCAL_MODEL_ENV, "gemma4:26b")

        offered = {model["ref"] for model in client.get("/models").json()["models"]}
        assert LOCAL_MODEL_REF not in offered

    def test_a_key_added_after_the_server_was_built_changes_no_judgement(
        self, monkeypatch: pytest.MonkeyPatch
    ):
        client = a_server()

        monkeypatch.setenv(SECRET_ENV_PREFIX + "ANTHROPIC_API_KEY", "sk-ant-000")

        by_ref = {m["ref"]: m for m in client.get("/models").json()["models"]}
        assert by_ref[DEFAULT_MODEL_REF]["callable"] is False


class TestWhenNobodyCanBeAsked:
    """열쇠도 내 컴퓨터의 모델도 없는 서버 — 실행은 연습용 답으로 모든 이름에 답한다."""

    def test_it_says_it_runs_on_stand_in_answers(self):
        assert a_server().get("/models").json()["mode"] == "stand_in"

    def test_it_still_says_no_key_opens_those_doors(self):
        by_ref = {m["ref"]: m for m in a_server().get("/models").json()["models"]}

        assert by_ref[DEFAULT_MODEL_REF]["callable"] is False


class TestWhenSomebodyElseWiredTheModel:
    """모델을 건네받은 배선에서는 무엇이 답하는지 건넨 쪽이 안다 — 서버는 판정하지 않는다."""

    def test_it_offers_no_judgement_of_its_own(self):
        client = TestClient(
            create_app(
                store=InMemorySpecStore(),
                run_store=InMemoryRunStore(),
                model=lambda ask: ModelSaid(text="hello", raw={}),
            )
        )

        assert client.get("/models").json()["models"] == []
