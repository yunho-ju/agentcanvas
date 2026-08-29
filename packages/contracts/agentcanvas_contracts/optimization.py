"""OptimizationProposal — Optimizer가 내는 타입 있는 제안문 (실행물이 아니다).

vision(optimize.md §관점2)이 요구한 "실행물이 아닌 타입 있는 제안문": patch는 응답의 별도
자리에 있고(preview가 만든 candidate), 이 봉투는 objective·가설·대상 노드·기대 효과·근거를
덧붙인다. proposal 자체는 apply되지 않는다.

정직성: 측정 못 한 축(비용·지연)의 수치를 만들지 않는다 — 지금은 서술(LocalizedText)과
품질(eval) 근거뿐이다. token/latency/cost 근거는 텔레메트리(OPT-3) 전까지 없다.
"""

from __future__ import annotations

from pydantic import Field

from .agent_spec import ContractModel
from .localized import LocalizedText


class ProposalEvidence(ContractModel):
    """무엇을 근거로 골랐는가 — 어느 eval 배치의 어떤 케이스가 근거인가 (읽기 전용 사실).

    시험이 하나도 없으면 batch_id는 없음이고 셈도 0이다: 없는 근거를 지어내지 않는다.
    품질(eval)만 근거로 쓴다 — RunEvent에 token/latency/cost가 없으므로 비용·지연 근거는 없다.
    """

    #: 근거가 된 eval 배치. 시험이 없으면 없음(추측으로 제안한다는 뜻).
    batch_id: str | None = None
    #: 그 배치가 돌린 케이스 수.
    cases: int = 0
    #: 그중 기대한 것을 못 맞춘(통과 못 한) 케이스 수 — 가설의 직접 재료.
    cases_with_gaps: int = 0


class OptimizationProposal(ContractModel):
    """왜 이렇게 바꾸자는가 — objective·가설·대상 노드·기대 효과·근거의 봉투."""

    #: 무엇을 개선하려는가 (사람의 objective를 두 언어로 다듬은 것).
    objective: LocalizedText
    #: 왜 지금 약한가·무엇을 바꾸나.
    hypothesis: LocalizedText
    #: 어디를 건드리나 — 후보 patch가 만지는 노드 id 목록.
    target_nodes: list[str] = Field(default_factory=list)
    #: 무엇을 기대하나 — 서술뿐(측정 못 한 축의 숫자를 만들지 않는다).
    expected_effect: LocalizedText
    #: 무엇을 근거로 골랐나 (읽기 전용 eval 사실).
    evidence: ProposalEvidence


__all__ = ["OptimizationProposal", "ProposalEvidence"]
