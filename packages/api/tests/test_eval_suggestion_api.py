"""시험 케이스를 지어 달라는 문 — 지어 주기만 하고, 담는 일은 사람이 한다."""

from __future__ import annotations

import json
from pathlib import Path

from agentcanvas_api.app import create_app
from agentcanvas_api.memory_eval_dataset_store import InMemoryEvalDatasetStore
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelSaid
from fastapi.testclient import TestClient

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)


def spec_payload() -> dict:
    return json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))


def a_client(result: ModelSaid | ModelBalked) -> TestClient:
    return TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            eval_dataset_store=InMemoryEvalDatasetStore(),
            model=lambda _ask: result,
        )
    )


def suggestion(title: str) -> dict:
    return {
        "title": title,
        "input": {"question": "머리가 아파요"},
        "expected_phrases": ["병원"],
    }


def said(*cases: dict) -> ModelSaid:
    return ModelSaid(
        input_tokens=11,
        output_tokens=22,
        text=json.dumps({"cases": list(cases)}),
    )


def request_body(how_many: int = 5, include_edge_cases: bool = True) -> dict:
    return {
        "model_ref": "model://default",
        "spec": spec_payload(),
        "how_many": how_many,
        "include_edge_cases": include_edge_cases,
        "existing_titles": ["이미 지은 시험"],
    }


def ask_for_cases(client: TestClient, body: dict | None = None):
    return client.post("/eval/case-suggestions", json=body or request_body())


def test_five_valid_cases_come_back_as_five_suggestions():
    client = a_client(said(*[suggestion(f"시험 {n}") for n in range(1, 6)]))

    answered = ask_for_cases(client)

    assert answered.status_code == 200
    body = answered.json()
    assert body["asked_for"] == 5
    assert [case["title"] for case in body["cases"]] == [
        f"시험 {n}" for n in range(1, 6)
    ]


def test_a_suggestion_has_no_name_of_its_own_until_someone_keeps_it():
    """id는 담는 쪽이 발급한다 — 응답에 자리표시자 이름을 계약처럼 실어 보내지 않는다."""
    client = a_client(said(suggestion("첫 시험")))

    offered = ask_for_cases(client).json()["cases"][0]

    assert set(offered) == {"title", "input", "expected_phrases"}


def test_only_the_cases_that_hold_up_come_back_and_the_count_stays_honest():
    client = a_client(
        said(
            suggestion("첫 시험"),
            {"title": "", "input": {}, "expected_phrases": ["병원"]},
            suggestion("둘째 시험"),
            {"title": "말이 없는 시험", "input": {}, "expected_phrases": []},
            suggestion("셋째 시험"),
        )
    )

    body = ask_for_cases(client).json()

    assert body["asked_for"] == 5
    assert len(body["cases"]) == 3


def test_an_answer_that_is_not_json_is_refused_without_touching_any_dataset():
    client = a_client(
        ModelSaid(input_tokens=1, output_tokens=1, text="시험 다섯 개예요")
    )

    answered = ask_for_cases(client)

    assert answered.status_code == 502
    assert client.get("/eval/datasets").json() == []


def test_a_provider_that_cannot_be_asked_says_so():
    client = a_client(ModelBalked(reason="missing_secret", message="no key here"))

    assert ask_for_cases(client).status_code == 503


def test_suggesting_never_saves_a_dataset_by_itself():
    client = a_client(said(suggestion("첫 시험")))

    assert ask_for_cases(client).status_code == 200
    assert client.get("/eval/datasets").json() == []


def test_asking_for_none_or_more_than_twenty_is_refused_at_the_door():
    client = a_client(said(suggestion("첫 시험")))

    assert ask_for_cases(client, request_body(how_many=0)).status_code == 422
    assert ask_for_cases(client, request_body(how_many=21)).status_code == 422


def test_the_graph_the_person_is_looking_at_is_what_the_model_reads():
    seen: list[ModelAsk] = []

    def model(ask: ModelAsk) -> ModelSaid:
        seen.append(ask)
        return said(suggestion("첫 시험"))

    client = TestClient(
        create_app(
            store=InMemorySpecStore(),
            run_store=InMemoryRunStore(),
            eval_dataset_store=InMemoryEvalDatasetStore(),
            model=model,
        )
    )

    ask_for_cases(client)

    assert "이미 지은 시험" in (seen[0].instruction or "")
