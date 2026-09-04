"""Architect preview service — patch 적용·graph validation만 담당하고 저장하지 않는다."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Literal

from agentcanvas_adapters.architect import (
    ARCHITECT_PROMPT_REF,
    INVALID_PATCH_MESSAGE,
    ArchitectBalked,
    ArchitectRequest,
    ArchitectSaid,
    architect_from,
    with_skills_made_real,
)
from agentcanvas_adapters.pattern_asker import PatternAskRequest, pattern_asker_from
from agentcanvas_contracts.agent_spec import AgentSpec, Node, Position
from agentcanvas_contracts.architect_asks import (
    PatternAnswer,
    PatternAsk,
    SkippedPattern,
)
from agentcanvas_contracts.architect_patch import (
    AddNodeOperation,
    AgentSpecPatch,
    PatchOperation,
    ReplaceNodeConfigOperation,
)
from agentcanvas_contracts.chat import CHAT_SAID_BINDING
from agentcanvas_contracts.localized import LocalizedText
from agentcanvas_contracts.patterns import AddNodeTemplateOp, PatternDef
from agentcanvas_contracts.starter_skills import starter_skills
from agentcanvas_engine.architect_patch import PatchApplyError, apply_patch
from agentcanvas_engine.model_call import ModelCall, ModelEvidence
from agentcanvas_engine.patterns.apply import TemplateCannotFill, fill_template
from agentcanvas_engine.patterns.detect import detect_all
from agentcanvas_engine.validator import Severity, ValidationIssue, validate_graph
from pydantic import ValidationError

from .model_ref_backfill import with_model_ref_filled
from .pattern_asks import asks_worth_making

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
    #: 아무도 모르는 이름표라 단계에서 빼낸 skill들 — 검토 카드가 그 사실을 말한다.
    dropped_skill_refs: tuple[str, ...] = ()
    #: 예라고 했는데 이 초안에 놓지 못한 모양들 — 검토 카드가 그 까닭을 말한다.
    skipped_patterns: tuple[SkippedPattern, ...] = ()


@dataclass(frozen=True)
class ArchitectPreviewRefused:
    reason: ArchitectRefusal
    message: str


@dataclass(frozen=True)
class ArchitectAsking:
    """되묻는 판 — 이때는 초안이 없다(사람이 답해야 그림을 그린다)."""

    asks: tuple[PatternAsk, ...]


type ArchitectPreviewOutcome = ArchitectPreview | ArchitectPreviewRefused

type ArchitectDraftOutcome = ArchitectPreviewOutcome | ArchitectAsking


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


# 아래 세 문장은 화면의 "이 모양은 넣지 못했어요 — {why}" 뒤에 이어 붙는 **까닭 절**이다:
# 온전한 문장으로 적으면 사람이 같은 말을 두 번 읽는다.

#: 템플릿은 채웠는데 그 그림이 검사를 통과하지 못했을 때 — 초안은 살리고 사실만 말한다.
SHAPE_DOES_NOT_FIT = LocalizedText(
    ko="이 초안에 더 넣을 자리가 없어요 — 적용한 뒤 직접 놓을 수 있어요.",
    en="there was no room left in this draft — you can place it yourself after applying.",
)

#: 답은 왔는데 이 서버가 그 모양을 더 이상 내놓지 않을 때(카탈로그가 바뀐 사이의 답).
SHAPE_NOT_ON_OFFER = LocalizedText(
    ko="이 서버는 지금 이 모양을 놓지 못해요.",
    en="this server cannot place this shape right now.",
)

#: 채우고 보니 문서에 더할 것이 없었을 때 — 아무 일도 일어나지 않은 것을 그대로 말한다.
NOTHING_TO_ADD = LocalizedText(
    ko="이 초안에 더할 것이 없었어요.",
    en="there was nothing to add to this draft.",
)

#: 그 모양이 이미 서 있을 때 — 답을 버리는 것이 아니라 "이미 있어요"라고 답한다.
ALREADY_IN_THE_DRAFT = LocalizedText(
    ko="이 초안에는 이미 그 모양이 들어 있어요",
    en="The draft already has this shape",
)


def _already_standing(pattern: PatternDef, spec: AgentSpec) -> bool:
    """예라고 한 그 모양이 이 초안에 이미 서 있는가 — 판단의 근거는 엔진의 규칙이다.

    규칙이 그 모양에 대해 아무 말도 하지 않으면 넣을 까닭이 없다는 뜻이다(`detect_all`).
    다만 규칙이 조용한 데는 '이미 있다' 말고 '아직 이 문서가 그 이야기를 할 처지가
    아니다'도 있어서(도구가 하나도 없는 초안에서 '사람 없이 움직인다'는 규칙은 조용하다),
    템플릿이 새로 놓는 종류의 노드가 정말 서 있는지도 함께 본다 — 사람이 청한 모양을
    "이미 있어요"라는 거짓말로 흘리지 않는다.
    """
    if any(signal.pattern_id == pattern.id for signal in detect_all(spec)):
        return False
    placing = {op.type for op in pattern.template if isinstance(op, AddNodeTemplateOp)}
    return not placing or bool(placing & {node.type for node in spec.nodes})


def _also(
    standing: ArchitectPreview,
    base_spec: AgentSpec,
    operations: list[PatchOperation],
    *,
    model_ref: str,
) -> ArchitectPreview | None:
    """지금 초안에 이 작업들을 더해 다시 게이트를 지난다 — 지나지 못하면 없던 일이다."""
    try:
        patch = AgentSpecPatch(
            schema_version=standing.patch.schema_version,
            base_revision=standing.patch.base_revision,
            operations=[*standing.patch.operations, *operations],
        )
    except ValidationError:
        return None
    outcome = preview_of(
        base_spec,
        ArchitectSaid(
            patch=patch,
            input_tokens=standing.input_tokens,
            output_tokens=standing.output_tokens,
            evidence=standing.evidence,
        ),
        model_ref=model_ref,
    )
    return outcome if isinstance(outcome, ArchitectPreview) else None


def with_shapes_said_yes(
    outcome: ArchitectPreviewOutcome,
    *,
    base_spec: AgentSpec,
    answers: Sequence[PatternAnswer],
    on_offer: Sequence[PatternDef],
    model_ref: str,
) -> ArchitectPreviewOutcome:
    """예라고 한 모양들을 서버가 초안에 얹는다 — 모델이 구조를 지어내지 않는다 (D11).

    한 모양씩 얹고 그때마다 기존 게이트를 다시 지난다: 놓지 못한 모양은 초안을 무르지 않고
    건너뛰되, 무엇을 넣지 못했는지 사람이 읽는 말로 함께 돌아간다.
    """
    if not isinstance(outcome, ArchitectPreview):
        return outcome
    catalog = {pattern.id: pattern for pattern in on_offer}
    standing = outcome
    skipped: list[SkippedPattern] = []
    for answer in answers:
        if answer.answer != "yes":
            continue
        pattern = catalog.get(answer.pattern_id)
        if pattern is None:
            skipped.append(
                SkippedPattern(pattern_id=answer.pattern_id, why=SHAPE_NOT_ON_OFFER)
            )
            continue
        filled = fill_template(pattern.template, standing.candidate)
        if isinstance(filled, TemplateCannotFill):
            skipped.append(SkippedPattern(pattern_id=pattern.id, why=filled.message))
            continue
        if not filled:
            skipped.append(SkippedPattern(pattern_id=pattern.id, why=NOTHING_TO_ADD))
            continue
        # 채울 수 있는지 먼저 보고 나서 묻는다 — 못 채우는 까닭(도구가 없다 같은)은
        # "이미 있어요"보다 먼저 사람이 들어야 할 말이다.
        if _already_standing(pattern, standing.candidate):
            skipped.append(
                SkippedPattern(pattern_id=pattern.id, why=ALREADY_IN_THE_DRAFT)
            )
            continue
        with_shape = _also(standing, base_spec, filled, model_ref=model_ref)
        if with_shape is None:
            skipped.append(
                SkippedPattern(pattern_id=pattern.id, why=SHAPE_DOES_NOT_FIT)
            )
            continue
        standing = with_shape
    return replace(
        standing,
        dropped_skill_refs=outcome.dropped_skill_refs,
        skipped_patterns=tuple(skipped),
    )


class ArchitectService:
    """모델에게 patch를 물어보고, 그림이 성립하는 draft candidate만 미리 보여 준다."""

    def __init__(
        self, model: ModelCall, *, patterns: Sequence[PatternDef] = ()
    ) -> None:
        self._architect = architect_from(model)
        self._asks_about = pattern_asker_from(model)
        self._patterns = tuple(patterns)

    def preview(
        self, base_spec: AgentSpec, request: str, model_ref: str
    ) -> ArchitectPreviewOutcome:
        asked = ArchitectRequest(
            base_spec=base_spec,
            request=request,
            model_ref=model_ref,
        )
        said = self._architect(asked)
        if isinstance(said, ArchitectBalked):
            return preview_of(base_spec, said, model_ref=model_ref)
        # 모델은 skill을 **고르기만** 한다 — 본문은 카탈로그에서 서버가 넣고, 아무도
        # 모르는 이름표는 여기서 빠진다(없는 것을 입은 단계가 검증까지 가지 않게).
        made = with_skills_made_real(
            said.patch, held=base_spec.skills, starters=starter_skills()
        )
        if made.patch is None:
            # 걷어 내고 나니 할 일이 없는 답은 쓸 수 없는 답이다 — 깨진 답과 같은 자리로 돌린다.
            return preview_of(
                base_spec,
                ArchitectBalked(reason="invalid_patch", message=INVALID_PATCH_MESSAGE),
                model_ref=model_ref,
            )
        outcome = preview_of(
            base_spec, replace(said, patch=made.patch), model_ref=model_ref
        )
        if isinstance(outcome, ArchitectPreviewRefused):
            return outcome
        return replace(outcome, dropped_skill_refs=made.dropped)

    def preview_new(
        self,
        draft_id: str,
        request: str,
        model_ref: str,
        *,
        answers: Sequence[PatternAnswer] = (),
    ) -> ArchitectDraftOutcome:
        """canonical blank seed에서 시작하는 Guided preview — 먼저 한 번 되물을 수 있다.

        답을 아직 듣지 못했을 때만 묻는다: 답을 들고 온 부름은 초안을 내놓아야 하고 또
        묻지 못한다(설문지가 되지 않는 상한, D11).
        """

        if not answers:
            asks = self._what_to_ask(request, model_ref)
            if asks:
                return ArchitectAsking(asks=tuple(asks))
        base_spec = blank_architect_seed(draft_id)
        return with_shapes_said_yes(
            self.preview(base_spec=base_spec, request=request, model_ref=model_ref),
            base_spec=base_spec,
            answers=answers,
            on_offer=self._patterns,
            model_ref=model_ref,
        )

    def _what_to_ask(self, request: str, model_ref: str) -> list[PatternAsk]:
        """이 부탁에 정말 물을 것이 있는가 — 고르는 것은 모델, 자르는 것은 서버다."""
        if not self._patterns:
            return []
        proposed = self._asks_about(
            PatternAskRequest(
                request=request, model_ref=model_ref, patterns=self._patterns
            )
        )
        return asks_worth_making(proposed, on_offer=self._patterns, request=request)


__all__ = [
    "ALREADY_IN_THE_DRAFT",
    "NOTHING_TO_ADD",
    "SHAPE_DOES_NOT_FIT",
    "SHAPE_NOT_ON_OFFER",
    "ArchitectAsking",
    "ArchitectDraftOutcome",
    "ArchitectPreview",
    "ArchitectPreviewOutcome",
    "ArchitectPreviewRefused",
    "ArchitectRefusal",
    "ArchitectService",
    "architect_request_fingerprint",
    "blank_architect_seed",
    "preview_of",
    "with_shapes_said_yes",
]
