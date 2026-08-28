"""판정 사다리 — 싼 층이 먼저 서고, 그 층이 놓친 말만 윗층이 다시 본다.

0층 통과면 윗층은 아예 불리지 않는다(값싼 판정이 먼저인 까닭). 0층이 놓친 말을 윗층이
전부 건지면 그 회차는 구제되어 통과하고, 못 건진 말만 근거로 남는다. 윗층이 없으면
사다리는 조용히 짧아진다 — 0층의 판정이 그대로 결론이다.
"""

from __future__ import annotations

from agentcanvas_contracts.evaluator_catalog import EvaluatorDef
from agentcanvas_engine.evaluation.evaluator import Evaluator, Judgement
from agentcanvas_engine.evaluation.expected_phrases import EXPECTED_PHRASES
from agentcanvas_engine.evaluation.ladder import judged_up_the_ladder


class Layer:
    """이 시험 파일에만 있는 층 — 받은 말 중 건질 수 있다고 적어 둔 것만 건진다."""

    def __init__(self, name: str, rescues: set[str] | None = None) -> None:
        self.name = name
        self._rescues = rescues if rescues is not None else set()
        #: 이 층이 받은 (기대하는 말, 답)들 — 불렸는지, 무엇을 받았는지 시험이 읽는다.
        self.asked: list[tuple[list[str], str]] = []

    def evaluator(self) -> Evaluator:
        return Evaluator(
            definition=EvaluatorDef.model_validate(
                {
                    "name": self.name,
                    "version": "v9",
                    "plain_description": {"ko": "시험용 층", "en": "a test rung"},
                    "example": {"ko": "예시", "en": "example"},
                }
            ),
            judge=self._judge,
        )

    def _judge(self, expected_phrases, output_text) -> Judgement:
        self.asked.append((list(expected_phrases), output_text))
        missing = [phrase for phrase in expected_phrases if phrase not in self._rescues]
        return Judgement(passed=not missing, missing_phrases=missing)


class TestJudgedUpTheLadder:
    """C3 — 사다리의 의미론: 언제 윗층을 부르고, 무엇을 근거로 남기는가."""

    def test_the_ground_floor_passing_ends_it_without_asking_anyone_above(self):
        above = Layer("위층")

        verdict = judged_up_the_ladder(
            EXPECTED_PHRASES, [above.evaluator()], ["반갑습니다"], "반갑습니다!"
        )

        assert above.asked == []
        assert verdict.passed is True
        assert verdict.missing_phrases == []
        assert verdict.judged_by == EXPECTED_PHRASES.definition.name

    def test_a_higher_rung_only_hears_the_phrases_the_floor_below_missed(self):
        above = Layer("위층", rescues={"감사합니다"})

        judged_up_the_ladder(
            EXPECTED_PHRASES,
            [above.evaluator()],
            ["반갑습니다", "감사합니다"],
            "반갑습니다, 고마워요",
        )

        assert above.asked == [(["감사합니다"], "반갑습니다, 고마워요")]

    def test_rescuing_every_missed_phrase_turns_the_round_into_a_pass(self):
        above = Layer("위층", rescues={"감사합니다"})

        verdict = judged_up_the_ladder(
            EXPECTED_PHRASES,
            [above.evaluator()],
            ["반갑습니다", "감사합니다"],
            "반갑습니다, 고마워요",
        )

        assert verdict.passed is True
        assert verdict.missing_phrases == []
        assert verdict.judged_by == "위층"

    def test_the_reason_that_is_left_is_only_what_no_rung_could_rescue(self):
        above = Layer("위층", rescues={"감사합니다"})

        verdict = judged_up_the_ladder(
            EXPECTED_PHRASES,
            [above.evaluator()],
            ["반갑습니다", "감사합니다"],
            "고마워요",
        )

        assert verdict.passed is False
        assert verdict.missing_phrases == ["반갑습니다"]
        assert verdict.judged_by == "위층"

    def test_with_no_rung_above_the_ground_floor_verdict_stands_as_it_is(self):
        verdict = judged_up_the_ladder(
            EXPECTED_PHRASES, [], ["반갑습니다", "감사합니다"], "고마워요"
        )

        assert verdict.passed is False
        assert verdict.missing_phrases == ["반갑습니다", "감사합니다"]
        assert verdict.judged_by == EXPECTED_PHRASES.definition.name

    def test_the_rungs_are_climbed_in_the_order_they_were_handed_in(self):
        """C9의 순수 함수 쪽 — 순서는 목록이 정한다: 두 층이 차례로 서고, 뒤층이 나중에 본다."""
        first = Layer("첫째", rescues={"반갑습니다"})
        second = Layer("둘째", rescues={"감사합니다"})

        verdict = judged_up_the_ladder(
            EXPECTED_PHRASES,
            [first.evaluator(), second.evaluator()],
            ["반갑습니다", "감사합니다"],
            "고마워요",
        )

        assert first.asked == [(["반갑습니다", "감사합니다"], "고마워요")]
        assert second.asked == [(["감사합니다"], "고마워요")]
        assert verdict.passed is True
        assert verdict.judged_by == "둘째"
