"""심판 층(사다리 마지막 단) — 남은 말마다 "이 진술이 답에 담겼는가"를 묻는다.

뜻 층과 구제 의미론이 같다: 전부 담기면 통과, 아니면 못 건진 말만 근거로 남는다.
여기 시험은 모델을 부르지 않는다 — 묻는 자리에 적어 둔 답을 하는 대역을 꽂는다.
"""

from __future__ import annotations

from agentcanvas_engine.evaluation.entailment import Entailment
from agentcanvas_engine.evaluation.llm_judge import (
    LLM_JUDGE_EVALUATOR_NAME,
    llm_judge_evaluator,
)


class Answering:
    """적어 둔 답을 차례로 하는 대역 — 무엇을 물었는지 기억한다."""

    def __init__(self, *answers: bool) -> None:
        self._answers = list(answers)
        self.asked: list[tuple[str, str]] = []

    def __call__(self, statement: str, body: str) -> Entailment:
        self.asked.append((statement, body))
        assert len(self.asked) <= len(self._answers), (
            "the stand-in was asked more times than it was given answers"
        )
        return Entailment(entailed=self._answers[len(self.asked) - 1])


class TestLlmJudgeEvaluator:
    """C1 — 심판 층은 카탈로그의 이름으로 서고, 뜻 층과 같은 구제 의미론을 따른다."""

    def test_it_introduces_itself_with_the_catalog_name(self):
        assert llm_judge_evaluator(Answering()).definition.name == (
            LLM_JUDGE_EVALUATOR_NAME
        )

    def test_every_phrase_left_over_is_asked_about_against_the_answer(self):
        asks = Answering(True, True)

        judgement = llm_judge_evaluator(asks).judge(
            ["반갑습니다", "감사합니다"], "만나 뵈어 기뻐요"
        )

        assert asks.asked == [
            ("반갑습니다", "만나 뵈어 기뻐요"),
            ("감사합니다", "만나 뵈어 기뻐요"),
        ]
        assert judgement.passed is True
        assert judgement.missing_phrases == []

    def test_only_the_phrases_the_judge_could_not_find_are_left_as_the_reason(self):
        judgement = llm_judge_evaluator(Answering(True, False)).judge(
            ["반갑습니다", "감사합니다"], "만나 뵈어 기뻐요"
        )

        assert judgement.passed is False
        assert judgement.missing_phrases == ["감사합니다"]
