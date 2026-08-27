"""EvalCase / EvalDataset — 평가 케이스 하나와 그 모음의 모양을 고정한다."""

from __future__ import annotations

import pytest
from agentcanvas_contracts.eval_case import EvalCase, EvalDataset
from pydantic import ValidationError


def an_eval_case(**changes) -> EvalCase:
    return EvalCase(
        **{
            "id": "case_1",
            "title": "인사에 반갑다는 말이 들어가나",
            "input": {"message": "안녕"},
            "expected_phrases": ["반갑"],
            **changes,
        }
    )


def test_a_case_with_defaults_needs_one_run_and_one_pass():
    case = an_eval_case()

    assert case.runs_per_case == 1
    assert case.passes_needed == 1


def test_a_case_needs_at_least_one_expected_phrase():
    with pytest.raises(ValidationError):
        an_eval_case(expected_phrases=[])


def test_a_case_rejects_a_blank_expected_phrase():
    with pytest.raises(ValidationError):
        an_eval_case(expected_phrases=["반갑", "  "])


def test_a_case_cannot_ask_for_more_passes_than_it_runs():
    with pytest.raises(ValidationError):
        an_eval_case(runs_per_case=2, passes_needed=3)


@pytest.mark.parametrize("runs_per_case", [0, -1])
def test_a_case_must_run_at_least_once(runs_per_case):
    with pytest.raises(ValidationError):
        an_eval_case(runs_per_case=runs_per_case)


@pytest.mark.parametrize("passes_needed", [0, -1])
def test_a_case_must_need_at_least_one_pass(passes_needed):
    with pytest.raises(ValidationError):
        an_eval_case(passes_needed=passes_needed)


def test_a_dataset_may_start_with_no_cases():
    dataset = EvalDataset(id="ds_1", name="첫 데이터셋", cases=[])

    assert dataset.cases == []


def test_a_dataset_holds_the_cases_it_is_given():
    case = an_eval_case()
    dataset = EvalDataset(id="ds_1", name="첫 데이터셋", cases=[case])

    assert dataset.cases == [case]


def test_a_case_is_exactly_these_six_fields():
    """다음 티켓에서 tags·severity가 슬쩍 들어오면 여기가 먼저 red가 된다."""
    assert sorted(EvalCase.model_fields) == [
        "expected_phrases",
        "id",
        "input",
        "passes_needed",
        "runs_per_case",
        "title",
    ]


def test_a_dataset_is_exactly_these_three_fields():
    assert sorted(EvalDataset.model_fields) == ["cases", "id", "name"]
