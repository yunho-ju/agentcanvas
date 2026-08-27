"""expected_phrases 판정기 — 답에 기대하는 말이 들어있는지 확인하는 가장 단순한 판정.

이 모듈은 순수 함수만 담는다: 부수효과가 없고, contracts와 같은 갈래의 evaluator 타입만 안다
(registry도, api도, 화면도 모른다 — 부르는 쪽이 이쪽을 알지 그 반대가 아니다).
정규화 규칙은 이것이 전부다 — unicode NFC로 맞추고, casefold로 대소문자를 지우고,
연속된 공백(개행 포함)을 1칸으로 좁힌다. 따옴표 통일 같은 추가 규칙은 없다.
판정은 통과 여부만이 아니라 근거(답에 없던 말)를 함께 돌려준다 — 화면이 그 근거를 그린다.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence

from agentcanvas_contracts.eval_case import EvalCase
from agentcanvas_contracts.evaluator_catalog import DEFAULT_EVALUATOR_CATALOG

from .evaluator import Evaluator, Judgement

#: 카탈로그 안에서 이 판정기를 가리키는 이름 — EvalCaseResult.evaluator가 이 값을 싣는다.
EVALUATOR_NAME = "expected_phrases"

_WHITESPACE_RUN = re.compile(r"\s+")


def _normalized(text: str) -> str:
    """NFC로 맞추고, 대소문자를 지우고, 연속 공백(개행 포함)을 1칸으로 좁힌다."""
    return _WHITESPACE_RUN.sub(" ", unicodedata.normalize("NFC", text).casefold())


def judge_expected_phrases(
    expected_phrases: Sequence[str], output_text: str
) -> Judgement:
    """기대하는 말이 **모두** 정규화 후 포함되면 통과다(AND). 빠진 말은 적힌 그대로 돌려준다."""
    normalized_output = _normalized(output_text)
    missing = [
        phrase
        for phrase in expected_phrases
        if _normalized(phrase) not in normalized_output
    ]
    return Judgement(passed=not missing, missing_phrases=missing)


#: registry에 얹히는 이 층 — 이름·판은 카탈로그가, 판정은 위 순수 함수가 안다.
EXPECTED_PHRASES = Evaluator(
    definition=DEFAULT_EVALUATOR_CATALOG[EVALUATOR_NAME],
    judge=judge_expected_phrases,
)


def passes(case: EvalCase, attempt_passed_list: Sequence[bool]) -> bool:
    """돌린 시도 중 몇 번 통과했는지 세어, passes_needed를 채웠는지 답한다."""
    return sum(1 for passed in attempt_passed_list if passed) >= case.passes_needed


__all__ = [
    "EVALUATOR_NAME",
    "EXPECTED_PHRASES",
    "judge_expected_phrases",
    "passes",
]
