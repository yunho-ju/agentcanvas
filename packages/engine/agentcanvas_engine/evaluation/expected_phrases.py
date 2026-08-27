"""expected_phrases 판정기 — 답에 기대하는 말이 들어있는지 확인하는 가장 단순한 판정.

이 모듈은 순수 함수만 담는다: 부수효과가 없고, contracts 외에는 아무것도 import하지 않는다.
정규화 규칙은 이것이 전부다 — unicode NFC로 맞추고, casefold로 대소문자를 지우고,
연속된 공백(개행 포함)을 1칸으로 좁힌다. 따옴표 통일 같은 추가 규칙은 없다.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence

from agentcanvas_contracts.eval_case import EvalCase

#: 카탈로그 안에서 이 판정기를 가리키는 이름 — EvalCaseResult.evaluator가 이 값을 싣는다.
EVALUATOR_NAME = "expected_phrases"

_WHITESPACE_RUN = re.compile(r"\s+")


def _normalized(text: str) -> str:
    """NFC로 맞추고, 대소문자를 지우고, 연속 공백(개행 포함)을 1칸으로 좁힌다."""
    return _WHITESPACE_RUN.sub(" ", unicodedata.normalize("NFC", text).casefold())


def judge_expected_phrases(output_text: str, expected_phrases: Sequence[str]) -> bool:
    """기대하는 말이 **모두** 정규화 후 포함되면 통과다(AND)."""
    normalized_output = _normalized(output_text)
    return all(_normalized(phrase) in normalized_output for phrase in expected_phrases)


def passes(case: EvalCase, attempt_passed_list: Sequence[bool]) -> bool:
    """돌린 시도 중 몇 번 통과했는지 세어, passes_needed를 채웠는지 답한다."""
    return sum(1 for passed in attempt_passed_list if passed) >= case.passes_needed


__all__ = ["EVALUATOR_NAME", "judge_expected_phrases", "passes"]
