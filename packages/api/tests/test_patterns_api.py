"""화면과 Architect가 "이 서버가 할 수 있는 모양"을 아는 길.

카탈로그는 제품이 싣고 다니는 목록이지만, 도구를 건넬 수 있는 모델이 하나도 없는 서버에서
'찾아보게 하기'를 권하면 화면이 이 서버가 못 하는 일을 말하게 된다(증거의 한계). 그래서
`needs`를 서버 사정으로 판정해 할 수 있는 것만 내보낸다.
"""

from __future__ import annotations

import pytest
from agentcanvas_api.app import create_app
from agentcanvas_api.auth import AuthSettings
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_api.pattern_catalog_service import patterns_this_server_can_do
from agentcanvas_contracts.model_catalog import ModelDef
from fastapi.testclient import TestClient

PASSWORD = "correct horse battery"
SECRET = "s" * 32


def a_model(tool_calling: bool) -> ModelDef:
    return ModelDef.model_validate(
        {
            "ref": "model://made-up",
            "provider": "openai_compatible",
            "model_id": "made-up",
            "title": {"ko": "지어낸 모델", "en": "A made-up model"},
            "tool_calling": tool_calling,
        }
    )


def offered(catalog: dict[str, ModelDef]) -> list[str]:
    return [pattern.id for pattern in patterns_this_server_can_do(catalog)]


class TestOnlyWhatThisServerCanActuallyDo:
    def test_a_server_with_no_model_that_takes_tools_does_not_offer_looking_up(self):
        assert "react" not in offered({"model://made-up": a_model(tool_calling=False)})

    def test_one_model_that_takes_tools_is_enough_to_offer_it(self):
        assert "react" in offered({"model://made-up": a_model(tool_calling=True)})

    def test_a_person_checking_and_forking_stand_on_the_engine_alone(self):
        """사람 확인과 갈림길은 엔진에 이미 있다 — 모델 사정과 무관하게 언제나 선다."""
        assert offered({}) == ["human_gate", "router"]


class TestTheDoorThatTellsWhichShapesStand:
    @pytest.fixture
    def client(self) -> TestClient:
        return TestClient(
            create_app(store=InMemorySpecStore(), run_store=InMemoryRunStore())
        )

    def test_it_answers_with_the_shapes_this_server_can_put_in_a_document(self, client):
        answered = client.get("/patterns")

        assert answered.status_code == 200
        assert [pattern["id"] for pattern in answered.json()["patterns"]] == [
            "react",
            "human_gate",
            "router",
        ]

    def test_every_shape_it_offers_carries_the_three_sentences_a_person_reads(
        self, client: TestClient
    ):
        first = client.get("/patterns").json()["patterns"][0]

        assert first["question"]["ko"] and first["question"]["en"]
        assert first["applies_when"]["en"] and first["cost"]["en"]

    def test_a_stranger_cannot_ask_which_shapes_this_server_can_put_in_a_document(self):
        locked = TestClient(
            create_app(
                store=InMemorySpecStore(),
                run_store=InMemoryRunStore(),
                auth_settings=AuthSettings(
                    enabled=True,
                    admin_password=PASSWORD,
                    session_secret=SECRET.encode(),
                    session_ttl_seconds=3600,
                ),
            )
        )

        assert locked.get("/patterns").status_code == 401
