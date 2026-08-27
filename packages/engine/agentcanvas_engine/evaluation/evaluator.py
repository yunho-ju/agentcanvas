"""판정기 한 종의 모양 — 카탈로그가 말하는 소개와, 판정을 내리는 순수 함수.

판정 함수는 예외를 던지지 않는다: 통과 여부와 사람이 읽을 근거를 한 값(Judgement)으로 돌려준다.
새 층(NLI·LLM 심판)도 이 모양만 맞추면 registry에 얹혀 같은 자리로 돌아간다.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from agentcanvas_contracts.evaluator_catalog import EvaluatorDef


@dataclass(frozen=True)
class Judgement:
    """한 회차의 판정 — 통과했는가, 그리고 답에 없던 말은 무엇인가(사람이 적은 그대로)."""

    passed: bool
    missing_phrases: list[str] = field(default_factory=list)


#: 판정 그 자체 — (기대하는 말, 답) → 판정. 부수효과도 예외도 없다.
Judge = Callable[[Sequence[str], str], Judgement]


@dataclass(frozen=True)
class Evaluator:
    """registry 한 칸 — 이름·판은 카탈로그(계약)가 원천이고, 판정은 여기 함수가 안다."""

    definition: EvaluatorDef
    judge: Judge


__all__ = ["Evaluator", "Judge", "Judgement"]
