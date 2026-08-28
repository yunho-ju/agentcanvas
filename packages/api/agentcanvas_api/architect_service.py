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


# 설정이 덜 찬 것은 초안의 정상 상태다 — 모델은 config 칸을 모른 채 그림만 그려 주고,
# 빈 칸은 사람이 inspector에서 채운다. 완성 강제는 승인·실행 게이트의 몫이다.
UNFINISHED_CONFIG_CODE = "node.invalid_config"


def _blocks_a_preview(issue: ValidationIssue) -> bool:
    """미리보기를 막는 것은 그림 자체가 깨진 경우뿐 — 덜 채운 설정은 보여 주고 알려 준다."""
    return issue.severity == Severity.ERROR and issue.code != UNFINISHED_CONFIG_CODE


class ArchitectService:
    """모델에게 patch를 물어보고, 그림이 성립하는 draft candidate만 미리 보여 준다."""

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
        if any(_blocks_a_preview(issue) for issue in issues):
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
