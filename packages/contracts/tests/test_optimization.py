"""OptimizationProposal — 실행물이 아닌 타입 있는 제안문 (봉투).

patch를 *포함/참조*하되(preview가 만든 candidate는 따로) objective·가설·근거를 덧붙인다.
proposal 자체는 apply되지 않는다 — 측정 못 한 축의 숫자를 만들지 않는다(서술뿐).
"""

from __future__ import annotations

import pytest
from agentcanvas_contracts.optimization import OptimizationProposal, ProposalEvidence
from pydantic import ValidationError


def a_proposal(**overrides) -> dict:
    return {
        "objective": {"ko": "비용을 줄인다", "en": "cut the cost"},
        "hypothesis": {
            "ko": "라우터가 과하게 큰 모델을 부른다",
            "en": "the router calls too large a model",
        },
        "target_nodes": ["triage", "clinical-agent"],
        "expected_effect": {
            "ko": "작은 모델로 바꾸면 답 품질은 지키며 비용이 준다",
            "en": "a smaller model keeps quality while cutting cost",
        },
        "evidence": {"batch_id": "batch_7", "cases": 12, "cases_with_gaps": 3},
        **overrides,
    }


def test_a_proposal_carries_the_narrative_and_the_evidence():
    proposal = OptimizationProposal.model_validate(a_proposal())

    assert proposal.objective.en == "cut the cost"
    assert proposal.target_nodes == ["triage", "clinical-agent"]
    assert proposal.evidence.batch_id == "batch_7"
    assert proposal.evidence.cases_with_gaps == 3


def test_a_proposal_is_an_envelope_not_an_executable_patch():
    """제안문은 봉투다 — 실행 op(operations)을 담지 않는다. patch는 응답의 별도 자리다."""
    fields = set(OptimizationProposal.model_fields)

    assert "operations" not in fields
    assert "patch" not in fields


def test_evidence_defaults_to_no_test_results():
    """시험이 없으면 그 사실을 정직하게 — 없는 근거를 지어내지 않는다."""
    evidence = ProposalEvidence()

    assert evidence.batch_id is None
    assert evidence.cases == 0
    assert evidence.cases_with_gaps == 0


def test_a_one_language_narrative_is_not_a_valid_proposal():
    with pytest.raises(ValidationError):
        OptimizationProposal.model_validate(
            a_proposal(objective={"ko": "비용을 줄인다"})
        )
