"""Architect가 되묻는 한 판의 계약 — 물음과 답과, 넣지 못한 모양 (설계 문서 D11·D14).

물음의 문장은 카탈로그의 것을 그대로 실어 나른다: 화면은 사전을 거치지 않고 이 두 문장을
읽는다. 패턴의 코드 이름은 답을 다시 서버로 가져오는 이름표일 뿐이라 화면에 나가지 않는다.
"""

from __future__ import annotations

from typing import Literal

from .base import ContractModel, NonEmptyText
from .localized import LocalizedText


class PatternAsk(ContractModel):
    """사람에게 던지는 물음 하나 — 무엇을 묻는가와 그 대가."""

    pattern_id: NonEmptyText
    question: LocalizedText
    cost: LocalizedText


class PatternAnswer(ContractModel):
    """그 물음에 사람이 한 답 — 모른다("skipped")는 아니오와 다른 답이다."""

    pattern_id: NonEmptyText
    answer: Literal["yes", "no", "skipped"]


class SkippedPattern(ContractModel):
    """예라고 했는데 넣지 못한 모양 — 무엇이 모자랐는지 사람이 읽는 말로 말한다."""

    pattern_id: NonEmptyText
    why: LocalizedText


__all__ = ["PatternAnswer", "PatternAsk", "SkippedPattern"]
