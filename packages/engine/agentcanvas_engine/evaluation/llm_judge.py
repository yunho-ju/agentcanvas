"""llm_judge 판정기 — 사다리의 마지막 단: 아래층이 못 건진 말을 심판에게 물어본다.

값이 드는 층이라 사람이 켰을 때만 사다리에 얹힌다(그 선택은 밖에서 한다). 구제 의미론은
뜻 층과 같다: 남은 말이 전부 담겼으면 통과, 아니면 끝내 못 건진 말만 근거로 남는다.
무엇이 답하는지는 밖에서 받는다(AsksEntailment) — 이 모듈은 모델도 프롬프트도 모른다.
"""

from __future__ import annotations

from agentcanvas_contracts.evaluator_catalog import DEFAULT_EVALUATOR_CATALOG

from .entailment import AsksEntailment
from .entailment_rung import entailment_rung
from .evaluator import Evaluator

#: 카탈로그 안에서 이 판정기를 가리키는 이름 — EvalAttempt.judged_by가 이 값을 싣는다.
LLM_JUDGE_EVALUATOR_NAME = "llm_judge"


def llm_judge_evaluator(asks: AsksEntailment) -> Evaluator:
    """심판에게 물어 판정하는 층 하나 — 말마다 묻고, 하나라도 못 건지면 불통과다(AND)."""
    return entailment_rung(DEFAULT_EVALUATOR_CATALOG[LLM_JUDGE_EVALUATOR_NAME], asks)


__all__ = ["LLM_JUDGE_EVALUATOR_NAME", "llm_judge_evaluator"]
