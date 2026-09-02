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
from agentcanvas_contracts.architect_patch import (
    AddNodeOperation,
    AgentSpecPatch,
    ReplaceNodeConfigOperation,
)
from agentcanvas_contracts.chat import CHAT_SAID_BINDING
from agentcanvas_engine.architect_patch import PatchApplyError, apply_patch
from agentcanvas_engine.model_call import ModelCall, ModelEvidence
from agentcanvas_engine.validator import Severity, ValidationIssue, validate_graph

from .model_ref_backfill import with_model_ref_filled

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
    """새 Guided 초안의 서버 소유 base — 저장하지 않고 patch의 기준으로만 쓴다.

    입력 자리 이름은 계약이 정한 그 이름(`CHAT_SAID_BINDING`)이다 — 게시한 뒤 그 판과
    대화하려면 화면이 그 이름을 찾기 때문이다 (DESIGN §7 chat-panel).
    """

    seed = AgentSpec(
        schema_version="agent.spec/v1",
        id=draft_id,
        name=None,
        version=1,
        revision="sha256:" + "0" * 64,
        status="draft",
        input_schema={
            "type": "object",
            "required": [CHAT_SAID_BINDING],
            # 제목은 두 언어로 — 실행 입력 카드가 라벨로 쓴다(원문 이름이 라벨이 되지
            # 않게, DESIGN §7 run-input-card).
            "properties": {
                CHAT_SAID_BINDING: {
                    "type": "string",
                    "title": "What you say",
                    "x-i18n": {"ko": {"title": "사람이 하는 말"}},
                }
            },
        },
        state_schema={"type": "object", "properties": {"answer": {"type": "string"}}},
        nodes=[
            Node(
                id="core-input",
                type="core.input",
                position=Position(x=0, y=0),
                config={"bindings": {CHAT_SAID_BINDING: f"input.{CHAT_SAID_BINDING}"}},
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


def _nodes_the_patch_made(patch: AgentSpecPatch) -> set[str]:
    """이 제안이 새로 만들거나 설정을 갈아 끼운 노드 id — 서버가 채워도 되는 자리의 전부다."""
    return {
        operation.node.id
        if isinstance(operation, AddNodeOperation)
        else operation.node_id
        for operation in patch.operations
        if isinstance(operation, AddNodeOperation | ReplaceNodeConfigOperation)
    }


def _blocks_a_preview(issue: ValidationIssue) -> bool:
    """미리보기를 막는 것은 그림 자체가 깨진 경우뿐 — 덜 채운 설정은 보여 주고 알려 준다."""
    return issue.severity == Severity.ERROR and issue.code != UNFINISHED_CONFIG_CODE


def preview_of(
    base_spec: AgentSpec,
    result: ArchitectSaid | ArchitectBalked,
    *,
    model_ref: str | None = None,
) -> ArchitectPreviewOutcome:
    """모델이 말한 patch를 미리보기로 옮기는 하나뿐인 문 — 저장하지 않고 게이트만 지킨다.

    patch를 물어본 서비스가 무엇이든(그림을 그리는 Architect든, 연결을 만드는 래퍼든)
    통과 규칙은 여기 하나다: 계약 → base revision → 모델 이름 채우기 → 그림 검사.

    `model_ref`를 건넨 서비스는 방금 그 모델에게 물어본 서비스다 — 모델 이름이 빈 채로 온
    노드는 그 이름으로 채워져 검사와 화면에 함께 간다.
    """

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

    if model_ref is not None:
        candidate = with_model_ref_filled(
            candidate, model_ref, only=_nodes_the_patch_made(result.patch)
        )

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
        return preview_of(base_spec, self._architect(asked), model_ref=model_ref)

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
    "preview_of",
]
