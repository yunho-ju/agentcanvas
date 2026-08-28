"""nli_entailment 판정기 — 글자가 아니라 뜻으로 본다: 기대하는 말이 답에 함의되는가.

expected_phrases(0층)가 글자로 놓친 답을 이 층이 구제한다. 판정 자체는 여기서도 순수하다:
예외를 던지지 않고, 물어본 결과를 모아 통과 여부와 근거(못 건진 말)로 돌려준다.
무엇이 답하는지는 밖에서 받는다(AsksEntailment) — 이 모듈은 모델도 네트워크도 모른다.
묻고 판정하는 규칙 자체는 entailment_rung 한 벌뿐이다 — 이 모듈은 그 층에 자기 이름을 준다.
"""

from __future__ import annotations

from agentcanvas_contracts.evaluator_catalog import DEFAULT_EVALUATOR_CATALOG

from .entailment import AsksEntailment
from .entailment_rung import entailment_rung
from .evaluator import Evaluator

#: 카탈로그 안에서 이 판정기를 가리키는 이름 — EvalAttempt.judged_by가 이 값을 싣는다.
NLI_EVALUATOR_NAME = "nli_entailment"


def nli_entailment_evaluator(asks: AsksEntailment) -> Evaluator:
    """함의를 물어 판정하는 층 하나 — 말마다 묻고, 하나라도 못 건지면 불통과다(AND)."""
    return entailment_rung(DEFAULT_EVALUATOR_CATALOG[NLI_EVALUATOR_NAME], asks)


__all__ = ["NLI_EVALUATOR_NAME", "nli_entailment_evaluator"]
