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


def test_an_attempt_is_exactly_run_id_passed_output_text_and_missing_phrases():
    assert sorted(EvalAttempt.model_fields) == [
        "missing_phrases",
        "output_text",
        "passed",
        "run_id",
    ]


def test_an_attempt_carries_the_words_the_answer_was_missing():
    """실패한 회차의 까닭은 서버(권위)가 적는다 — 화면은 다시 세지 않고 이 값을 그린다."""
    attempt = an_attempt(passed=False, missing_phrases=["감사합니다"])

    assert attempt.missing_phrases == ["감사합니다"]
    assert attempt.model_dump(mode="json")["missing_phrases"] == ["감사합니다"]


def test_an_old_stored_attempt_without_the_field_still_reads():
    """이미 저장된 배치 JSON에는 이 자리가 없다 — 마이그레이션 없이 빈 근거로 읽힌다."""
    old = {"run_id": "run_1", "passed": False, "output_text": "반갑습니다"}

    assert EvalAttempt.model_validate(old).missing_phrases == []


def test_an_old_stored_batch_json_still_reads_whole():
    """옛 배치 한 벌이 통째로 그대로 읽힌다 — 저장분을 고쳐 쓰게 만들지 않는다."""
    stored = {
        "id": "batch_1",
        "dataset_id": "ds_1",
        "spec_id": "clinical-assistant",
        "spec_revision": compute_revision({"schema_version": "agent.spec/v1"}),
        "started_at": "2026-08-20T09:00:00Z",
        "results": [
            {
                "case_id": "case_1",
                "attempts": [
                    {"run_id": "run_1", "passed": False, "output_text": "반갑습니다"}
                ],
                "passed": False,
                "evaluator": "expected_phrases",
                "evaluator_version": "v1",
            }
        ],
    }

    batch = EvalBatch.model_validate(stored)

    assert batch.results[0].attempts[0].missing_phrases == []


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
