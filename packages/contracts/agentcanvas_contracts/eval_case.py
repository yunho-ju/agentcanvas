"""EvalCase / EvalDataset — 답이 맞았는지 확인할 케이스 하나와 그 모음 (Evaluate 슬라이스).

EvalDataset은 AgentSpec과 달리 revision을 갖지 않는다 — v1은 케이스 목록 자체를 갈아 끼운다.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field, model_validator

from .agent_spec import ContractModel, NonEmptyText


class EvalCase(ContractModel):
    """돌려보고 답을 확인할 입력 하나 — 무엇을 넣고, 무슨 말이 들어있어야 통과인가.

    passes_needed는 runs_per_case를 넘을 수 없다 — 돌리기로 한 횟수보다 더 많은 통과를 요구할 수 없다.
    """

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    #: RunRequest.input과 같은 모양 — 그래프가 열 때 보는 시작 상태다.
    input: dict[str, Any]
    expected_phrases: list[NonEmptyText] = Field(min_length=1)
    runs_per_case: int = Field(default=1, ge=1)
    passes_needed: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def _passes_needed_within_runs(self):
        """돌리기로 한 횟수보다 더 많은 통과를 요구할 수 없다."""
        if self.passes_needed > self.runs_per_case:
            raise ValueError("passes_needed must not exceed runs_per_case")
        return self


class EvalDataset(ContractModel):
    """케이스의 모음 — 독립 엔티티다 (v1은 revision 없음)."""

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    cases: list[EvalCase] = Field(default_factory=list)


__all__ = ["EvalCase", "EvalDataset"]
