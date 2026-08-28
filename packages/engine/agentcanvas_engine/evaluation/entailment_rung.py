"""함의를 물어 판정하는 층 하나 — 어느 층이든 묻는 방식은 같고, 다른 것은 이름뿐이다.

뜻 층(nli_entailment)도 심판 층(llm_judge)도 하는 일은 하나다: 남은 말마다 "이 진술이 이
답에 담겨 있는가"를 묻고, 하나라도 못 건지면 불통과다(AND). 누가 답하는지(작은 모델·심판
모델·시험의 대역)는 밖에서 받는다 — 이 모듈은 모델도 네트워크도 모른다.

층을 하나 더 세우는 일이 이 규칙을 다시 적는 일이 되지 않게, 규칙은 여기 한 벌만 산다.
"""

from __future__ import annotations

from collections.abc import Sequence

from agentcanvas_contracts.evaluator_catalog import EvaluatorDef

from .entailment import AsksEntailment
from .evaluator import Evaluator, Judgement


def entailment_rung(definition: EvaluatorDef, asks: AsksEntailment) -> Evaluator:
    """이 소개(계약)로 서서 함의를 물어 판정하는 층 — 못 건진 말이 그 층의 근거다."""

    def judge(expected_phrases: Sequence[str], output_text: str) -> Judgement:
        missing = [
            phrase
            for phrase in expected_phrases
            if not asks(phrase, output_text).entailed
        ]
        return Judgement(passed=not missing, missing_phrases=missing)

    return Evaluator(definition=definition, judge=judge)


__all__ = ["entailment_rung"]
