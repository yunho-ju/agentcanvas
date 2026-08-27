"""데이터셋을 저장하고 되찾는 규칙 — 저장을 물리는 판단(이미 있는가, 남의 것인가)은 서비스가 한다.

SpecService/SaveRefused와 같은 결이다: 라우트는 상태코드 표 매핑만 하면 된다.
"""

from __future__ import annotations

from agentcanvas_api.eval_dataset_service import EvalDatasetRefused, EvalDatasetService
from agentcanvas_api.memory_eval_dataset_store import InMemoryEvalDatasetStore
from agentcanvas_contracts.eval_case import EvalCase, EvalDataset


def a_case(**overrides) -> EvalCase:
    base = {
        "id": "case-1",
        "title": "인사에 반갑다는 말이 있는가",
        "input": {},
        "expected_phrases": ["반갑습니다"],
    }
    return EvalCase.model_validate({**base, **overrides})


def a_dataset(**overrides) -> EvalDataset:
    base = {"id": "greetings", "name": "인사 데이터셋", "cases": [a_case()]}
    return EvalDataset.model_validate({**base, **overrides})


def a_service() -> EvalDatasetService:
    return EvalDatasetService(InMemoryEvalDatasetStore())


def test_creating_a_new_dataset_saves_it():
    service = a_service()

    outcome = service.create(a_dataset())

    assert outcome == a_dataset()
    assert service.read("greetings") == a_dataset()


def test_creating_a_dataset_that_already_exists_is_refused():
    service = a_service()
    service.create(a_dataset())

    outcome = service.create(a_dataset(name="다시 만든 것"))

    assert isinstance(outcome, EvalDatasetRefused)
    assert outcome.reason == "already_saved"
    assert service.read("greetings").name == "인사 데이터셋"  # 거절됐으니 그대로다


def test_updating_a_dataset_with_a_mismatched_id_is_refused():
    service = a_service()
    service.create(a_dataset())

    outcome = service.update("greetings", a_dataset(id="other"))

    assert isinstance(outcome, EvalDatasetRefused)
    assert outcome.reason == "id_mismatch"


def test_updating_an_unknown_dataset_is_refused():
    service = a_service()

    outcome = service.update("nobody-here", a_dataset(id="nobody-here"))

    assert isinstance(outcome, EvalDatasetRefused)
    assert outcome.reason == "unknown"


def test_updating_a_known_dataset_overwrites_it():
    service = a_service()
    service.create(a_dataset())

    outcome = service.update("greetings", a_dataset(name="고친 이름"))

    assert outcome == a_dataset(name="고친 이름")
    assert service.read("greetings").name == "고친 이름"


def test_reading_an_unknown_dataset_is_none():
    service = a_service()

    assert service.read("nobody-here") is None


def test_listing_summaries_delegates_to_the_store():
    service = a_service()
    service.create(a_dataset())

    listed = service.list_summaries()

    assert [summary.id for summary in listed] == ["greetings"]


def test_deleting_says_whether_it_existed():
    service = a_service()
    service.create(a_dataset())

    assert service.delete("greetings") is True
    assert service.delete("greetings") is False
