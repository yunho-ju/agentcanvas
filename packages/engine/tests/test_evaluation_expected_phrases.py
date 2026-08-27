"""expected_phrases 판정기 — 정규화 후 포함 여부(AND)와 passes_needed 집계.

이 판정은 순수 함수다: 부수효과 없이 값만 받아 값만 낸다.
"""

from __future__ import annotations

import unicodedata

from agentcanvas_contracts.eval_case import EvalCase
from agentcanvas_engine.evaluation.expected_phrases import (
    judge_expected_phrases,
    passes,
)


def a_case(**overrides) -> EvalCase:
    base = {
        "id": "case-1",
        "title": "인사에 반갑다는 말이 있는가",
        "input": {},
        "expected_phrases": ["반갑습니다"],
        "runs_per_case": 1,
        "passes_needed": 1,
    }
    return EvalCase.model_validate({**base, **overrides})


class TestJudgeExpectedPhrases:
    """B1~B2 — 정규화 후 모든 문구가 포함되면 통과, 하나라도 빠지면 불통과."""

    def test_case_difference_is_ignored(self):
        """B1: 대소문자 차이는 무시하고 매치한다."""
        assert judge_expected_phrases("Nice to meet YOU", ["nice to meet you"]) is True

    def test_repeated_whitespace_and_newlines_are_collapsed(self):
        """B1: 연속 공백·개행은 1칸으로 좁혀 매치한다."""
        output = "hello,\n\n  nice   to\nmeet   you  world"
        assert judge_expected_phrases(output, ["nice to meet you"]) is True

    def test_nfc_and_nfd_forms_of_the_same_text_match(self):
        """B1: 결합형(NFC)과 분해형(NFD)으로 적힌 같은 글자는 같은 것으로 본다."""
        composed = unicodedata.normalize("NFC", "café")
        decomposed = unicodedata.normalize("NFD", "café")
        assert composed != decomposed  # 바이트로는 서로 다름을 확인해 둔다

        assert (
            judge_expected_phrases(f"welcome to the {decomposed}", [composed]) is True
        )

    def test_one_of_two_expected_phrases_missing_fails(self):
        """B2: expected_phrases 2개 중 1개만 들어있으면 불통과(AND)."""
        output = "반갑습니다, 오늘도 좋은 하루예요"

        assert judge_expected_phrases(output, ["반갑습니다", "감사합니다"]) is False

    def test_both_expected_phrases_present_passes(self):
        output = "반갑습니다, 감사합니다"

        assert judge_expected_phrases(output, ["반갑습니다", "감사합니다"]) is True

    def test_empty_output_never_passes(self):
        """minor 10: 빈 출력은 그 어떤(비어있지 않은) 기대 문구도 담을 수 없다 — 언제나 불통과다.

        배치 서비스는 실패·게이트 정지 시 output_text=""만 만들고 따로 분기하지 않는다 —
        이 결합이 성립하는 자리를 여기서 못박는다.
        """
        assert judge_expected_phrases("", ["아무 말이나"]) is False


class TestPasses:
    """B3 — runs_per_case/passes_needed로 케이스 통과 여부를 집계한다."""

    def test_two_passes_out_of_three_runs_meets_two_needed(self):
        """B3: runs 3/passes 2에서 2회 통과하면 케이스는 통과한다."""
        case = a_case(runs_per_case=3, passes_needed=2)

        assert passes(case, [True, True, False]) is True

    def test_one_pass_out_of_three_runs_does_not_meet_two_needed(self):
        """B3: 1회만 통과하면 passes_needed 2를 채우지 못해 불통과다."""
        case = a_case(runs_per_case=3, passes_needed=2)

        assert passes(case, [True, False, False]) is False
