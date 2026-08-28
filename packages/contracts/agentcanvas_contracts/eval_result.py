"""EvalAttempt / EvalCaseResult / EvalBatch — 판정을 돌린 기록 (Evaluate 슬라이스).

판정 로직(정규화·contains 비교)은 여기 없다 — 이 모듈은 판정이 남긴 데이터의 모양만 고정한다.
"""

from __future__ import annotations

from pydantic import Field

from .agent_spec import ContractModel, UtcDatetime
from .revision import REVISION_PATTERN


class EvalAttempt(ContractModel):
    """케이스 하나를 한 번 돌린 시도 — 어느 실행이었고, 통과했는가, 무엇을 답했는가."""

    run_id: str = Field(min_length=1)
    passed: bool
    #: 판정 대상이 된 최종 출력 원문 — 정규화 전 그대로다.
    output_text: str
    #: 판정이 남긴 근거 — 기대한 말 중 **최종적으로** 이 답에서 못 건진 것(사람이 적은 그대로).
    #: 사다리의 윗층(뜻 검사)이 건져 낸 말은 여기 남지 않는다.
    #: 나중에 생긴 자리라 기본은 비어 있다: 이 자리가 없는 옛 저장분도 그대로 읽힌다.
    missing_phrases: list[str] = Field(default_factory=list)
    #: 이 회차를 최종 판정한 판정기의 이름(카탈로그의 name) — 사다리 어느 층에서 결론이 났는가.
    #: 0층만 있던 시절의 저장분에는 이 자리가 없다: 없는 이름은 없음으로 읽힌다.
    judged_by: str | None = None


class EvalCaseResult(ContractModel):
    """케이스 하나의 결론 — 몇 번 돌렸고, passes_needed를 채웠는가."""

    case_id: str = Field(min_length=1)
    attempts: list[EvalAttempt]
    passed: bool
    #: 카탈로그의 name — evaluator_catalog.py 참고.
    evaluator: str = Field(min_length=1)
    evaluator_version: str = Field(min_length=1)


class EvalBatch(ContractModel):
    """데이터셋 하나를 어느 판에 대고 돌린 한 벌의 결과.

    v1 배치는 spec을 그대로 돈다 — 스펙이 쓰는 모델은 spec_revision이 가리키는 그래프
    안에 있다. 검증하지 않은 모델 이름을 여기 따로 적어 두지 않는다(모델 비교 배치는 v2).
    """

    id: str = Field(min_length=1)
    dataset_id: str = Field(min_length=1)
    spec_id: str = Field(min_length=1)
    spec_revision: str = Field(pattern=REVISION_PATTERN)
    started_at: UtcDatetime
    results: list[EvalCaseResult]


__all__ = ["EvalAttempt", "EvalBatch", "EvalCaseResult"]
