"""Architect preview service — patch 적용·graph validation만 담당하고 저장하지 않는다."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Literal

from agentcanvas_adapters.architect import (
    ARCHITECT_PROMPT_REF,
    ArchitectBalked,
    ArchitectRequest,
    ArchitectSaid,
    architect_from,
)
from agentcanvas_contracts.agent_spec import AgentSpec, Node, Position
from agentcanvas_contracts.architect_patch import AgentSpecPatch
from agentcanvas_engine.architect_patch import PatchApplyError, apply_patch
from agentcanvas_engine.model_call import ModelCall, ModelEvidence
from agentcanvas_engine.validator import Severity, ValidationIssue, validate_graph

type ArchitectRefusal = Literal[
    "invalid_base_revision",
    "unknown_model",
    "missing_secret",
    "provider_error",
    "invalid_patch",
    "stale_revision",
    "patch_conflict",
    "graph_invalid",
]


@dataclass(frozen=True)
class ArchitectPreview:
    patch: AgentSpecPatch
    candidate: AgentSpec
    issues: list[ValidationIssue]
    input_tokens: int
    output_tokens: int
    evidence: ModelEvidence | None = None


@dataclass(frozen=True)
class ArchitectPreviewRefused:
    reason: ArchitectRefusal
    message: str


type ArchitectPreviewOutcome = ArchitectPreview | ArchitectPreviewRefused


def architect_request_fingerprint(
    *, model_ref: str, request: str, base_revision: str
) -> str:
    """비밀과 raw prompt를 남기지 않고 요청 계약을 다시 대조할 지문을 만든다."""

    contract = {
        "base_revision": base_revision,
        "model_ref": model_ref,
        "prompt_ref": ARCHITECT_PROMPT_REF,
        "request": request,
    }
    encoded = json.dumps(
        contract, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def blank_architect_seed(draft_id: str) -> AgentSpec:
    """새 Guided 초안의 서버 소유 base — 저장하지 않고 patch의 기준으로만 쓴다."""

    seed = AgentSpec(
        schema_version="agent.spec/v1",
        id=draft_id,
        name=None,
        version=1,
        revision="sha256:" + "0" * 64,
        status="draft",
        input_schema={
            "type": "object",
            "required": ["request"],
            "properties": {"request": {"type": "string"}},
        },
        state_schema={"type": "object", "properties": {"answer": {"type": "string"}}},
        nodes=[
            Node(
                id="core-input",
                type="core.input",
                position=Position(x=0, y=0),
                config={"bindings": {"request": "input.request"}},
            ),
            Node(
                id="core-output",
                type="core.output",
                position=Position(x=840, y=0),
                config={"binding": "state.answer"},
            ),
        ],
        edges=[],
        resources=[],
        execution=None,
    )
    return seed.model_copy(update={"revision": seed.computed_revision()})


class ArchitectService:
    """모델에게 patch를 물어보고, 유효한 draft candidate만 미리 보여 준다."""

    def __init__(self, model: ModelCall) -> None:
        self._architect = architect_from(model)

    def preview(
        self, base_spec: AgentSpec, request: str, model_ref: str
    ) -> ArchitectPreviewOutcome:
        asked = ArchitectRequest(
            base_spec=base_spec,
            request=request,
            model_ref=model_ref,
        )
        result = self._architect(asked)
        if isinstance(result, ArchitectBalked):
            return ArchitectPreviewRefused(
                reason=result.reason,
                message=result.message,
            )
        if not isinstance(result, ArchitectSaid):
            return ArchitectPreviewRefused(
                reason="provider_error",
                message="the Architect provider returned no usable result",
            )

        try:
            candidate = apply_patch(base_spec, result.patch)
        except PatchApplyError as error:
            if error.reason == "invalid_base_revision":
                reason: ArchitectRefusal = "invalid_base_revision"
            elif error.reason == "stale_revision":
                reason = "stale_revision"
            else:
                reason = "patch_conflict"
            return ArchitectPreviewRefused(reason=reason, message=str(error))

        issues = validate_graph(candidate)
        if any(issue.severity == Severity.ERROR for issue in issues):
            return ArchitectPreviewRefused(
                reason="graph_invalid",
                message="the proposed patch leaves graph validation errors",
            )
        return ArchitectPreview(
            patch=result.patch,
            candidate=candidate,
            issues=issues,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            evidence=result.evidence,
        )

    def preview_new(
        self, draft_id: str, request: str, model_ref: str
    ) -> ArchitectPreviewOutcome:
        """canonical blank seed에서 시작하는 Guided preview."""

        return self.preview(
            base_spec=blank_architect_seed(draft_id),
            request=request,
            model_ref=model_ref,
        )


__all__ = [
    "ArchitectPreview",
    "ArchitectPreviewOutcome",
    "ArchitectPreviewRefused",
    "ArchitectRefusal",
    "ArchitectService",
    "architect_request_fingerprint",
    "blank_architect_seed",
]
