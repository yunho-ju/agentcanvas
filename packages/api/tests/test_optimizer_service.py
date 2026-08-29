"""OptimizerService — preview 기계의 세 번째 소비자 (첫째 Architect, 둘째 Tool Wrapper).

별도 preview 게이트를 새로 쓰지 않는다: preview_of가 계약→base revision→validate_graph를
지키는 단 하나의 문이다. 여기 있는 것은 objective+증거를 물어보고, 통과한 candidate에 제안문을
붙이는 일뿐이다. 증거 조립은 읽기 전용이다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from agentcanvas_api.architect_service import ArchitectPreview, ArchitectPreviewRefused
from agentcanvas_api.memory_eval_batch_store import InMemoryEvalBatchStore
from agentcanvas_api.optimizer_service import OptimizerService
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.eval_result import (
    EvalAttempt,
    EvalBatch,
    EvalCaseResult,
)
from agentcanvas_contracts.optimization import OptimizationProposal
from agentcanvas_engine.model_call import ModelSaid

EXAMPLE_PATH = (
    Path(__file__).resolve().parents[3] / "examples/basic-agent/agent_spec.json"
)


def base_spec() -> AgentSpec:
    return AgentSpec.model_validate(
        json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
    )


def envelope(base_revision: str, op: dict | None = None) -> str:
    return json.dumps(
        {
            "patch": {
                "schema_version": "agent.patch/v1",
                "base_revision": base_revision,
                "operations": [op or {"op": "remove_edge", "edge_id": "human-output"}],
            },
            "proposal": {
                "objective": {"ko": "비용", "en": "cut cost"},
                "hypothesis": {"ko": "가설", "en": "hypothesis"},
                "target_nodes": ["triage"],
                "expected_effect": {"ko": "효과", "en": "effect"},
            },
        }
    )


def a_service(
    text: str, batches: InMemoryEvalBatchStore | None = None
) -> OptimizerService:
    return OptimizerService(
        lambda _ask: ModelSaid(input_tokens=1, output_tokens=1, text=text),
        batches if batches is not None else InMemoryEvalBatchStore(),
    )


def a_batch(spec: AgentSpec, missing: list[str]) -> EvalBatch:
    return EvalBatch(
        id="batch_7",
        dataset_id="greetings",
        spec_id=spec.id,
        spec_revision=spec.revision,
        started_at=datetime(2026, 8, 1, tzinfo=UTC),
        results=[
            EvalCaseResult(
                case_id="c1",
                attempts=[
                    EvalAttempt(
                        run_id="r1",
                        passed=False,
                        output_text="x",
                        missing_phrases=missing,
                    )
                ],
                passed=False,
                evaluator="contains",
                evaluator_version="1",
            )
        ],
    )


def test_a_candidate_passes_the_preview_and_comes_back_with_a_proposal():
    base = base_spec()
    outcome, proposal = a_service(envelope(base.revision)).preview(
        base_spec=base, objective="cut cost", model_ref="model://x"
    )

    assert isinstance(outcome, ArchitectPreview)
    assert isinstance(proposal, OptimizationProposal)
    assert proposal.objective.en == "cut cost"
    assert proposal.target_nodes == ["triage"]


def test_a_candidate_that_breaks_the_graph_is_refused_the_usual_way():
    base = base_spec()
    breaks = envelope(
        base.revision,
        op={
            "op": "add_edge",
            "edge": {
                "id": "orphan",
                "kind": "data",
                "source": {"node": "missing", "port": "out"},
                "target": {"node": "output", "port": "input"},
            },
        },
    )

    outcome, proposal = a_service(breaks).preview(
        base_spec=base, objective="cut cost", model_ref="model://x"
    )

    assert isinstance(outcome, ArchitectPreviewRefused)
    assert outcome.reason == "graph_invalid"
    assert proposal is None


def test_a_provider_that_balks_is_refused_and_has_no_proposal():
    outcome, proposal = a_service("not json at all").preview(
        base_spec=base_spec(), objective="cut cost", model_ref="model://x"
    )

    assert isinstance(outcome, ArchitectPreviewRefused)
    assert outcome.reason == "invalid_patch"
    assert proposal is None


def test_an_op_outside_the_table_is_refused():
    base = base_spec()
    reaches = envelope(
        base.revision,
        op={
            "op": "add_resource",
            "resource": {
                "id": "x",
                "kind": "http.api",
                "server_ref": "api://x",
                "approval_policy": "read_only_auto",
                "tools": [],
            },
        },
    )

    outcome, _proposal = a_service(reaches).preview(
        base_spec=base, objective="cut cost", model_ref="model://x"
    )

    assert isinstance(outcome, ArchitectPreviewRefused)
    assert outcome.reason == "invalid_patch"


def test_a_batch_grounds_the_evidence():
    base = base_spec()
    store = InMemoryEvalBatchStore()
    store.save(a_batch(base, missing=["refund"]))

    _outcome, proposal = a_service(envelope(base.revision), store).preview(
        base_spec=base, objective="cut cost", model_ref="model://x"
    )

    assert proposal is not None
    assert proposal.evidence.batch_id == "batch_7"
    assert proposal.evidence.cases == 1
    assert proposal.evidence.cases_with_gaps == 1


def test_no_batch_says_it_is_a_guess():
    base = base_spec()
    _outcome, proposal = a_service(envelope(base.revision)).preview(
        base_spec=base, objective="cut cost", model_ref="model://x"
    )

    assert proposal is not None
    assert proposal.evidence.batch_id is None
    assert proposal.evidence.cases == 0


def test_the_evidence_the_model_sees_carries_the_missing_phrases():
    base = base_spec()
    store = InMemoryEvalBatchStore()
    store.save(a_batch(base, missing=["refund", "policy"]))
    seen: list[str] = []

    def model(ask) -> ModelSaid:
        seen.append(ask.instruction)
        return ModelSaid(input_tokens=1, output_tokens=1, text=envelope(base.revision))

    OptimizerService(model, store).preview(
        base_spec=base, objective="cut cost", model_ref="model://x"
    )

    assert "refund" in seen[0]
    assert "policy" in seen[0]


def test_assembling_evidence_does_not_change_the_eval_store():
    base = base_spec()
    store = InMemoryEvalBatchStore()
    store.save(a_batch(base, missing=["refund"]))
    before = store.get("batch_7")

    a_service(envelope(base.revision), store).preview(
        base_spec=base, objective="cut cost", model_ref="model://x"
    )

    assert store.get("batch_7") == before
    assert store.list_for_dataset("greetings") == [before]
