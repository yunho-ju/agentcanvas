"""시험 케이스 제안 서비스 — 모델에게 묻고 계약에 닿은 것만 돌려준다. 저장은 하지 않는다.

ArchitectService와 같은 결이다: 누구에게 묻는지는 주입된 ModelCall이 알고, 여기는 그 답을
사람이 골라 담을 수 있는 모양으로 옮기기만 한다. dataset은 이 자리에서 절대 바뀌지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass

from agentcanvas_adapters.case_suggester import (
    CaseSuggestionRequest,
    CaseSuggestionsBalked,
    CaseSuggestionsSaid,
    CaseSuggestionTrouble,
    SuggestedCase,
    case_suggester_from,
)
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_engine.model_call import ModelCall

type CaseSuggestionRefusal = CaseSuggestionTrouble


@dataclass(frozen=True)
class CaseSuggestions:
    """지어 온 제안들 — 몇 개를 청했는지도 함께 말한다(화면이 '5개 중 3개'를 사실대로 말한다).

    제안은 아직 이름(id)이 없다: dataset에 들어갈 이름은 담는 쪽이 그 순간 발급한다.
    """

    cases: list[SuggestedCase]
    asked_for: int


@dataclass(frozen=True)
class CaseSuggestionsRefused:
    reason: CaseSuggestionRefusal
    message: str


type CaseSuggestionOutcome = CaseSuggestions | CaseSuggestionsRefused


class EvalCaseSuggestionService:
    """그래프를 읽고 시험 케이스를 지어 달라고 묻는 일 — HTTP도 provider도 모른다."""

    def __init__(self, model: ModelCall) -> None:
        self._suggester = case_suggester_from(model)

    def suggest(
        self,
        spec: AgentSpec,
        how_many: int,
        include_edge_cases: bool,
        existing_titles: list[str],
        model_ref: str,
    ) -> CaseSuggestionOutcome:
        result = self._suggester(
            CaseSuggestionRequest(
                spec=spec,
                how_many=how_many,
                include_edge_cases=include_edge_cases,
                existing_titles=tuple(existing_titles),
                model_ref=model_ref,
            )
        )
        if isinstance(result, CaseSuggestionsBalked):
            return CaseSuggestionsRefused(reason=result.reason, message=result.message)
        if not isinstance(result, CaseSuggestionsSaid):
            return CaseSuggestionsRefused(
                reason="provider_error",
                message="the case suggester returned no usable result",
            )
        return CaseSuggestions(cases=list(result.cases), asked_for=result.asked_for)


__all__ = [
    "CaseSuggestionOutcome",
    "CaseSuggestionRefusal",
    "CaseSuggestions",
    "CaseSuggestionsRefused",
    "EvalCaseSuggestionService",
]
