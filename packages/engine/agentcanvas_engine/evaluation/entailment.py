"""함의를 묻는 자리의 모양 — "이 진술이 이 본문에 담겨 있는가"를 묻고 답으로 받는다.

engine은 무엇이 답하는지 모른다: 작은 모델이든, 원격 심판이든, 시험의 대역이든
이 모양(AsksEntailment)만 맞으면 판정기에 꽂힌다. 답하는 쪽(adapters)이 어그러져도
예외가 아니라 "담기지 않았다"는 답으로 돌아온다 — 판정은 예외를 던지지 않는다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Entailment:
    """함의 질의 하나의 답 — 본문이 그 진술을 담고 있는가."""

    entailed: bool


#: 함의를 묻는 것 — (진술, 본문) → 답. 예외 대신 답을 돌려준다.
AsksEntailment = Callable[[str, str], Entailment]


__all__ = ["AsksEntailment", "Entailment"]
