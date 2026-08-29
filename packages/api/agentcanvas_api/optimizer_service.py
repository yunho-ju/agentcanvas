"""Optimizer preview 서비스 — objective + eval 증거를 후보 patch로 옮겨 preview에 태운다.

미리보기 게이트는 architect의 것을 그대로 쓴다(`preview_of`) — 계약→base revision→
validate_graph는 여기서 다시 쓰지 않는다. 이 서비스가 하는 일은 둘뿐이다: eval 증거를
읽어(읽기 전용) 모델에게 물어보고, 통과한 candidate에 제안문을 붙인다.
"""

from __future__ import annotations

from agentcanvas_adapters.optimizer import (
    OptimizerRequest,
    OptimizerSaid,
    optimizer_from,
)
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.eval_result import EvalBatch
from agentcanvas_contracts.optimization import OptimizationProposal, ProposalEvidence
from agentcanvas_engine.model_call import ModelCall

from .architect_service import (
    ArchitectPreview,
    ArchitectPreviewOutcome,
    preview_of,
)
from .eval_batch_store import EvalBatchStore


def _evidence_facts(batch: EvalBatch | None) -> ProposalEvidence:
    """근거의 셈만 — 시험이 없으면 그 사실을 정직하게(없는 근거를 지어내지 않는다)."""
    if batch is None:
        return ProposalEvidence()
    return ProposalEvidence(
        batch_id=batch.id,
        cases=len(batch.results),
        cases_with_gaps=sum(1 for result in batch.results if not result.passed),
    )


def _evidence_prompt(batch: EvalBatch | None) -> str:
    """모델이 가설을 딛을 근거 요약 — 어느 케이스가 무엇을 못 맞췄나(읽기 전용)."""
    if batch is None:
        return (
            "There are no eval results for this spec yet, so any hypothesis is a guess "
            "from the objective alone, not grounded in test evidence."
        )
    failed = [result for result in batch.results if not result.passed]
    lines = []
    for result in failed:
        missed = sorted(
            {
                phrase
                for attempt in result.attempts
                for phrase in attempt.missing_phrases
            }
        )
        wanted = ", ".join(missed) if missed else "(no specific phrase recorded)"
        lines.append(f"case {result.case_id} missed: {wanted}")
    head = (
        f"Recent eval batch {batch.id}: {len(batch.results)} cases, "
        f"{len(failed)} did not pass."
    )
    return head + ("\n" + "\n".join(lines) if lines else "")


class OptimizerService:
    """모델에게 objective+증거로 후보 patch를 물어보고, 성립하는 candidate+제안문만 보여 준다."""

    def __init__(self, model: ModelCall, batches: EvalBatchStore) -> None:
        self._optimize = optimizer_from(model)
        self._batches = batches

    def preview(
        self, base_spec: AgentSpec, objective: str, model_ref: str
    ) -> tuple[ArchitectPreviewOutcome, OptimizationProposal | None]:
        # 화면이 보낸 문서는 아직 저장되지 않은 지금의 캔버스다 — 이 preview 안에서만 통하는
        # base revision을 여기서 셈한다 (Tool Wrapper와 같은 자리).
        base = base_spec.model_copy(update={"revision": base_spec.computed_revision()})
        batch = self._batches.latest_for_spec(base.id)
        result = self._optimize(
            OptimizerRequest(
                base_spec=base,
                objective=objective,
                evidence=_evidence_prompt(batch),
                model_ref=model_ref,
            )
        )
        if not isinstance(result, OptimizerSaid):
            return preview_of(base, result), None
        outcome = preview_of(base, result.said)
        if not isinstance(outcome, ArchitectPreview):
            return outcome, None
        proposal = OptimizationProposal(
            objective=result.narrative.objective,
            hypothesis=result.narrative.hypothesis,
            target_nodes=result.narrative.target_nodes,
            expected_effect=result.narrative.expected_effect,
            evidence=_evidence_facts(batch),
        )
        return outcome, proposal


__all__ = ["OptimizerService"]
