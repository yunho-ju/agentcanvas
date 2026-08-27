"""EvalAttempt / EvalCaseResult / EvalBatch — 판정을 돌린 기록의 모양을 고정한다."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from agentcanvas_contracts.eval_result import EvalAttempt, EvalBatch, EvalCaseResult
from agentcanvas_contracts.revision import compute_revision
from pydantic import ValidationError

STARTED_AT = datetime(2026, 8, 20, 9, 0, tzinfo=UTC)


def an_attempt(**changes) -> EvalAttempt:
    return EvalAttempt(
        **{"run_id": "run_1", "passed": True, "output_text": "반갑습니다", **changes}
    )


def a_case_result(**changes) -> EvalCaseResult:
    return EvalCaseResult(
        **{
            "case_id": "case_1",
            "attempts": [an_attempt()],
            "passed": True,
            "evaluator": "expected_phrases",
            "evaluator_version": "v1",
            **changes,
        }
    )


def a_batch(**changes) -> EvalBatch:
    return EvalBatch(
        **{
            "id": "batch_1",
            "dataset_id": "ds_1",
            "spec_id": "clinical-assistant",
            "spec_revision": compute_revision({"schema_version": "agent.spec/v1"}),
            "started_at": STARTED_AT,
            "results": [a_case_result()],
            **changes,
        }
    )


def test_a_batch_carries_the_spec_revision_the_shared_revision_type_computes():
    revision = compute_revision({"schema_version": "agent.spec/v1"})
    batch = a_batch(spec_revision=revision)

    assert batch.spec_revision == revision
    assert batch.model_dump(mode="json")["spec_revision"] == revision


def test_a_batch_rejects_a_spec_revision_that_does_not_look_like_one():
    with pytest.raises(ValidationError):
        a_batch(spec_revision="not-a-revision")


def test_a_case_result_holds_every_attempt_it_was_given():
    result = a_case_result(attempts=[an_attempt(), an_attempt(run_id="run_2")])

    assert [attempt.run_id for attempt in result.attempts] == ["run_1", "run_2"]


def test_an_attempt_is_exactly_run_id_passed_and_output_text():
    assert sorted(EvalAttempt.model_fields) == ["output_text", "passed", "run_id"]


def test_a_case_result_is_exactly_these_five_fields():
    assert sorted(EvalCaseResult.model_fields) == [
        "attempts",
        "case_id",
        "evaluator",
        "evaluator_version",
        "passed",
    ]


def test_a_batch_is_exactly_these_six_fields():
    """v1 배치는 spec을 그대로 돈다 — model은 검증 안 된 주장이라 계약에 자리를 두지 않는다."""
    assert sorted(EvalBatch.model_fields) == [
        "dataset_id",
        "id",
        "results",
        "spec_id",
        "spec_revision",
        "started_at",
    ]
