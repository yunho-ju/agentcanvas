"""판정기 카탈로그 — 답이 맞았는지 무엇으로 확인할지 고르는 목록.

사다리의 세 층이 있다: 답에 기대하는 말이 들어있는지 보는 싼 확인(0층), 글자가 달라도 뜻이
담겼는지 보는 확인(1층), 그리고 사람이 켰을 때만 서는 심판 모델의 판정(2층)이다.
판정 로직 자체(정규화·contains 비교)는 여기 없다 — EVAL-2가 이 이름을 보고 무엇을 돌릴지 고른다.
"""

from __future__ import annotations

from pydantic import Field

from .agent_spec import ContractModel
from .localized import LocalizedText


class EvaluatorDef(ContractModel):
    """판정기 하나 — 이름과 버전, 그리고 무엇을 확인하는지 쉬운 말로 설명과 예시."""

    #: 카탈로그 안에서 이 판정기를 가리키는 이름 — EvalCaseResult.evaluator가 이 값을 싣는다.
    name: str = Field(min_length=1)
    version: str = Field(min_length=1)
    plain_description: LocalizedText
    example: LocalizedText


DEFAULT_EVALUATOR_CATALOG: dict[str, EvaluatorDef] = {
    evaluator.name: evaluator
    for evaluator in [
        EvaluatorDef.model_validate(
            {
                "name": "expected_phrases",
                "version": "v1",
                "plain_description": {
                    "ko": "답에 이 말이 들어있는지 확인해요",
                    "en": "Checks whether the answer contains this phrase",
                },
                "example": {
                    "ko": (
                        '기대하는 말이 "반갑습니다"라면, 답이 "만나서 반갑습니다"일 때 '
                        "통과예요."
                    ),
                    "en": (
                        'If the expected phrase is "nice to meet you", an answer '
                        'like "it is nice to meet you" passes.'
                    ),
                },
            }
        ),
        EvaluatorDef.model_validate(
            {
                "name": "nli_entailment",
                "version": "v1",
                "plain_description": {
                    "ko": "글자가 달라도 답이 그 뜻을 담고 있는지 확인해요",
                    "en": "Checks whether the answer means this, even in other words",
                },
                "example": {
                    "ko": (
                        '기대하는 말이 "반갑습니다"라면, 답이 "만나 뵙게 되어 기뻐요"일 때도 '
                        "뜻이 같아 통과예요."
                    ),
                    "en": (
                        'If the expected phrase is "nice to meet you", an answer '
                        'like "I am glad we could meet" passes too, because it '
                        "means the same thing."
                    ),
                },
            }
        ),
        EvaluatorDef.model_validate(
            {
                "name": "llm_judge",
                "version": "v1",
                "plain_description": {
                    "ko": "심판 모델에게 이 뜻이 답에 담겼는지 물어봐요",
                    "en": "Asks a judge model whether the answer says this",
                },
                "example": {
                    "ko": (
                        '기대하는 말이 "반갑습니다"라면, 답이 "얼굴 뵙게 되어 좋네요"일 때도 '
                        "심판 모델이 같은 뜻으로 보면 통과예요."
                    ),
                    "en": (
                        'If the expected phrase is "nice to meet you", an answer '
                        'like "good to see you in person" passes when the judge '
                        "model reads it as the same thing."
                    ),
                },
            }
        ),
    ]
}


def resolve_evaluator(name: str) -> EvaluatorDef | None:
    """name이 가리키는 판정기를 돌려준다 — 정확히 같은 이름만 찾고, 못 찾으면 없다고 말한다."""
    return DEFAULT_EVALUATOR_CATALOG.get(name)


__all__ = ["DEFAULT_EVALUATOR_CATALOG", "EvaluatorDef", "resolve_evaluator"]
