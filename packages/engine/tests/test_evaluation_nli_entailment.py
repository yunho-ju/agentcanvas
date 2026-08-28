"""뜻으로 보는 판정기(1층) — 빠진 말 하나하나가 답에 함의되는지 묻는다.

여기 시험은 모델을 내려받지 않는다: 함의를 묻는 자리에 적어 둔 답을 하는 대역을 꽂는다.
"""

from __future__ import annotations

from agentcanvas_engine.evaluation.entailment import Entailment
from agentcanvas_engine.evaluation.nli_entailment import (
    NLI_EVALUATOR_NAME,
    nli_entailment_evaluator,
)


class Answering:
    """적어 둔 함의 답을 차례로 하는 대역 — 무엇을 물었는지 기억한다."""

    def __init__(self, *answers: bool) -> None:
        self._answers = list(answers)
        self.asked: list[tuple[str, str]] = []

    def __call__(self, statement: str, body: str) -> Entailment:
        self.asked.append((statement, body))
        assert self.asked and len(self.asked) <= len(self._answers), (
            "the stand-in was asked more times than it was given answers"
        )
        return Entailment(entailed=self._answers[len(self.asked) - 1])


class TestNliEntailmentEvaluator:
    """C4 — 뜻으로 보는 층은 말마다 묻고, 못 건진 말만 근거로 남긴다."""

    def test_it_introduces_itself_with_the_catalog_name(self):
        evaluator = nli_entailment_evaluator(Answering())

        assert evaluator.definition.name == NLI_EVALUATOR_NAME

    def test_every_expected_phrase_is_asked_about_against_the_answer(self):
        asks = Answering(True, True)
        evaluator = nli_entailment_evaluator(asks)

        judgement = evaluator.judge(["반갑습니다", "감사합니다"], "만나 뵈어 기뻐요")

        assert asks.asked == [
            ("반갑습니다", "만나 뵈어 기뻐요"),
            ("감사합니다", "만나 뵈어 기뻐요"),
        ]
        assert judgement.passed is True
        assert judgement.missing_phrases == []

    def test_only_the_phrases_no_one_could_find_are_left_as_the_reason(self):
        evaluator = nli_entailment_evaluator(Answering(True, False))

        judgement = evaluator.judge(["반갑습니다", "감사합니다"], "만나 뵈어 기뻐요")

        assert judgement.passed is False
        assert judgement.missing_phrases == ["감사합니다"]
