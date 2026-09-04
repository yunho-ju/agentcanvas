"""HTTP 문 — 들어온 것을 계약으로 옮기고, 나갈 것을 JSON으로 옮기는 일만 한다.

판을 매기는 규칙은 service가, 저장은 store가 안다. 여기에는 SQL도 해시도 없다.
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path
from time import monotonic
from typing import Annotated, Any, Literal

from agentcanvas_adapters.case_suggester import SuggestedCase
from agentcanvas_adapters.entailment import EntailmentCall, local_entailment
from agentcanvas_adapters.http_tool import sends_with_httpx
from agentcanvas_adapters.llm_judge import JUDGE_MODEL_REF, llm_judge_entailment
from agentcanvas_adapters.openai_model import OPENAI_API_KEY_REF
from agentcanvas_adapters.providers import (
    asks_whoever_serves,
    can_be_asked,
    nobody_to_ask,
)
from agentcanvas_adapters.secrets import env_vault
from agentcanvas_adapters.skill_fetch import (
    Gets,
    SkillFetched,
    fetch_skill_markdown,
    gets_with_httpx,
)
from agentcanvas_adapters.skill_search import (
    RemoteSearch,
    npx_skills_find,
    remembering,
    search_skills,
)
from agentcanvas_adapters.tool_adapters import tools_from
from agentcanvas_adapters.tool_wrapper import ToolSource
from agentcanvas_contracts.agent_spec import AgentSpec, NonEmptyText
from agentcanvas_contracts.architect_asks import (
    PatternAnswer,
    PatternAsk,
    SkippedPattern,
)
from agentcanvas_contracts.architect_patch import AgentSpecPatch
from agentcanvas_contracts.eval_case import EvalDataset
from agentcanvas_contracts.eval_result import EvalBatch
from agentcanvas_contracts.model_catalog import DEFAULT_MODEL_CATALOG, ModelDef
from agentcanvas_contracts.optimization import OptimizationProposal
from agentcanvas_contracts.publication import SpecPublication
from agentcanvas_contracts.refs import EndUserRef, ModelRef
from agentcanvas_contracts.run import ApprovalAnswer, Run
from agentcanvas_contracts.skill_def import (
    SKILL_DESCRIPTION_MAX_LENGTH,
    SKILL_NAME_MAX_LENGTH,
    SKILL_NAME_PATTERN,
    SkillDef,
)
from agentcanvas_contracts.starter_skills import starter_skills
from agentcanvas_engine.model_call import ModelCall, says_the_first_way
from agentcanvas_engine.routed_runtime import (
    resume_routed_run_stream,
    routed_run_stream,
)
from agentcanvas_engine.tool_call import CallsATool
from agentcanvas_engine.validator import ValidationIssue
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .architect_service import (
    ArchitectAsking,
    ArchitectDraftOutcome,
    ArchitectPreview,
    ArchitectPreviewRefused,
    ArchitectRefusal,
    ArchitectService,
    architect_request_fingerprint,
    blank_architect_seed,
)
from .auth import (
    AdminSessionMiddleware,
    AuthSettings,
    BuiltinAuth,
    boolean_setting,
    clear_session_cookie,
    set_session_cookie,
)
from .eval_batch_store import EvalBatchStore
from .eval_dataset_service import (
    EvalDatasetRefusal,
    EvalDatasetRefused,
    EvalDatasetSaveOutcome,
    EvalDatasetService,
)
from .eval_dataset_store import EvalDatasetStore, EvalDatasetSummary
from .eval_ladder import judging_ladder, layers_standing
from .eval_service import (
    EvalBatchFailed,
    EvalBatchListing,
    EvalBatchRefusal,
    EvalBatchRefused,
    EvalBatchRunning,
    EvalBatchService,
    EvalBatchView,
)
from .eval_suggestion_service import (
    CaseSuggestionRefusal,
    CaseSuggestionsRefused,
    EvalCaseSuggestionService,
)
from .job_store import DurableJobStore, IdempotencyConflict
from .job_worker import DurableJobWorker
from .model_catalog_service import RunMode, ServerModels, models_standing
from .optimizer_service import OptimizerService
from .pattern_catalog_service import ServerPatterns, patterns_this_server_can_do
from .run_service import (
    RevisionSource,
    RunIdMaker,
    RunOutcome,
    RunRefusal,
    RunRefused,
    RunService,
    RunView,
    Worker,
    in_the_background,
    new_run_id,
)
from .run_store import RunStore
from .run_stream import (
    DEFAULT_TIMING,
    StreamTiming,
    resume_from,
    run_event_stream,
)
from .service import (
    Clock,
    PublishOutcome,
    PublishRefusal,
    PublishRefused,
    Refusal,
    SaveOutcome,
    SaveRefused,
    SpecListing,
    SpecService,
    utc_now,
)
from .skill_draft_service import DraftedBy, SkillDraftService
from .sqlite_database import prepare_database
from .sqlite_eval_batch_store import SqliteEvalBatchStore
from .sqlite_eval_dataset_store import SqliteEvalDatasetStore
from .sqlite_job_store import SqliteJobStore
from .sqlite_run_store import SqliteRunStore
from .sqlite_store import SqliteSpecStore
from .store import SpecRevision, SpecStore, StoredSpec
from .thread_views import ThreadSummary, ThreadTurn
from .tool_wrapper_service import ToolWrapperService

_logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = Path("agentcanvas.db")
DB_PATH_ENV = "AGENTCANVAS_DB"
ALLOWED_ORIGINS_ENV = "AGENTCANVAS_ALLOWED_ORIGINS"

#: 내 컴퓨터에서 띄운 모델을 이 서버에 알려 주는 자리 — 이름(예: gemma4:26b)과 그 문의 주소.
LOCAL_MODEL_ENV = "AGENTCANVAS_LOCAL_MODEL"
LOCAL_BASE_URL_ENV = "AGENTCANVAS_LOCAL_BASE_URL"

#: 내 컴퓨터에서 띄운 그 모델이 도구를 받는가 — 서버를 띄운 사람만 아는 일이라 묻고, 답이
#: 없으면 못 받는 것으로 본다 (된다고 지어내면 실행이 저쪽 문 앞에서 되돌아온다).
LOCAL_TOOL_CALLING_ENV = "AGENTCANVAS_LOCAL_TOOL_CALLING"

#: 본사의 그 모델이 도구를 쓰려면 생각을 꺼야 하는가 — 적지 않으면 이름으로 짐작한다.
OPENAI_TOOLS_THINKING_OFF_ENV = "AGENTCANVAS_OPENAI_TOOLS_THINKING_OFF"

#: 생각을 켠 채로는 도구를 거절하는 이름들 (2026-09-04 실측: gpt-5.6-luna). 새 계열이 생기면
#: 여기 한 줄이다 — 이름을 갈래로 나누는 if는 두지 않는다.
THINKING_MODEL_PREFIXES = ("gpt-5",)

#: 대개 로컬 서빙이 서 있는 자리 (Ollama의 OpenAI 말투 문).
DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1"

#: 그 모델이 그래프에서 갖는 이름 — 프리셋 목록에는 없고, 직접 적어 넣으면 된다.
LOCAL_MODEL_REF = "model://local"

#: OpenAI provider를 쓸 때 명시적으로 선택할 모델 ID. API key와 모델 ID가
#: 모두 있어야 catalog에 추가하며, 비용·가용성이 변하는 외부 기본값은 두지 않는다.
OPENAI_MODEL_ENV = "AGENTCANVAS_OPENAI_MODEL"

#: 심판이 부를 모델 이름을 서버를 띄운 자리가 고르는 자리 — 적지 않으면 기본 이름 그대로다.
#: 여기 적은 이름이 이 서버에서 열리지 않으면 심판은 서지 않는다(가용성 판정이 그대로 본다).
JUDGE_MODEL_ENV = "AGENTCANVAS_JUDGE_MODEL"

#: 그 모델이 그래프에서 갖는 이름 — 열쇠가 있는 서버에서만 생긴다.
OPENAI_MODEL_REF = "model://openai"
# Guided는 현재 provider 실증 대상이므로 기존 `model://default`와 분리한다.
GUIDED_MODEL_REF = OPENAI_MODEL_REF

#: 스튜디오는 서버와 다른 자리에서 뜬다(개발에서는 언제나 포트가 다르다). 브라우저는 다른 자리에서
#: 온 요청을 서버가 허락했는지 먼저 묻는데, 그 허락을 여기서 정한다.
#: 기본은 내 컴퓨터에서 띄운 스튜디오뿐이다 — 아무나(*)는 열지 않는다. 나중에 로그인이 붙으면
#: 그 구멍이 그대로 남기 때문이다. 배포에서는 AGENTCANVAS_ALLOWED_ORIGINS로 정확히 적어 준다.
LOCAL_STUDIO_ORIGINS = r"^http://(localhost|127\.0\.0\.1):5173$"

#: 저장을 물린 까닭을 HTTP의 말로 옮기는 표 — 새 까닭은 여기 한 줄을 더한다.
REFUSAL_STATUS: dict[Refusal, int] = {
    "already_saved": 409,
    "id_mismatch": 409,
    "unknown": 404,
    "missing_revision": 428,
    "stale_revision": 409,
}

#: 게시를 물린 까닭을 HTTP의 말로 옮기는 표 — 둘 다 '가리킬 판이 없다'라 404다.
PUBLISH_REFUSAL_STATUS: dict[PublishRefusal, int] = {
    "unknown": 404,
    "unknown_revision": 404,
}

#: 실행을 물린 까닭을 HTTP의 말로 옮기는 표.
RUN_REFUSAL_STATUS: dict[RunRefusal, int] = {
    "unknown_spec": 404,
    "unknown_run": 404,
    "stale_revision": 409,
    "not_published": 409,
    # 판을 집는 쪽은 서버다 — 함께 적어 보낸 판은 뜻이 부딪히므로 청 자체를 물린다.
    "revision_not_yours_to_pick": 400,
    "revision_gone": 409,
    "not_paused": 409,
    "already_answered": 409,
    "nowhere_to_answer": 409,
    "another_revision": 409,
}

#: 데이터셋 저장을 물린 까닭을 HTTP의 말로 옮기는 표 — /specs와 같은 결이다.
EVAL_DATASET_REFUSAL_STATUS: dict[EvalDatasetRefusal, int] = {
    "already_saved": 409,
    "id_mismatch": 409,
    "unknown": 404,
}

#: 배치를 물린 까닭을 HTTP의 말로 옮기는 표.
EVAL_BATCH_REFUSAL_STATUS: dict[EvalBatchRefusal, int] = {
    "unknown_dataset": 404,
    "unknown_spec": 404,
    "stale_revision": 409,
}

# 케이스 제안도 저장하지 않는 preview다 — 물을 곳이 없었는가, 쓸 만한 답이 아니었는가로 갈린다.
CASE_SUGGESTION_REFUSAL_STATUS: dict[CaseSuggestionRefusal, int] = {
    "unknown_model": 503,
    "missing_secret": 503,
    "provider_error": 503,
    "invalid_cases": 502,
}

# Architect는 저장하지 않는 preview다 — provider/계약/graph 중 어느 경계에서 멈췄는지 HTTP로 옮긴다.
ARCHITECT_REFUSAL_STATUS: dict[ArchitectRefusal, int] = {
    "invalid_base_revision": 422,
    "unknown_model": 503,
    "missing_secret": 503,
    "provider_error": 503,
    "invalid_patch": 422,
    "graph_invalid": 422,
    "patch_conflict": 422,
    "stale_revision": 409,
}


class AdminLoginRequest(BaseModel):
    """단일 self-host 관리자가 로그인 문에 건네는 비밀번호."""

    password: str


class AdminSessionResponse(BaseModel):
    """Studio가 메모리에만 두는 현재 세션 상태와 CSRF nonce."""

    authenticated: bool
    csrf_token: str | None


class SavedSpec(BaseModel):
    """저장된 그래프와, 저장하면서 눈에 걸린 것들."""

    spec: AgentSpec
    issues: list[ValidationIssue]


class ArchitectPatchRequest(BaseModel):
    """기존 AgentSpec에 대한 Architect preview 요청 — 저장은 별도 명시적 행동이다."""

    model_config = ConfigDict(extra="forbid")

    model_ref: ModelRef
    request: NonEmptyText
    base_spec: AgentSpec


class ArchitectDraftRequest(BaseModel):
    """빈 캔버스 Guided preview 요청 — seed와 id는 서버 경계에서 고정한다.

    답을 함께 보내는 부름은 되묻기의 두 번째 판이다: 그때는 초안이 와야 한다 (D11).
    """

    model_config = ConfigDict(extra="forbid")

    model_ref: ModelRef
    request: NonEmptyText
    draft_id: NonEmptyText
    answers: list[PatternAnswer] = Field(default_factory=list)


class SkillMarkdown(BaseModel):
    """주소 하나에서 가져온 표준 SKILL.md 원문.

    어디서 왔는가는 **사람이 적은 그 주소**다: 저장소 안 어느 파일을 읽었는지는 우리가
    찾아본 길일 뿐이라 문서의 출처로 적지 않는다 (SK-3 리뷰 지적 4).
    """

    model_config = ConfigDict(extra="forbid")

    text: str


class SkillSearchHit(BaseModel):
    """찾아낸 skill 한 줄 — 본문은 아직 읽지 않았다(누르면 그때 읽어 온다)."""

    model_config = ConfigDict(extra="forbid")

    name: str
    description: str | None = None
    origin: Literal["starter", "remote"]
    url: str | None = None
    installs: int | None = None
    owner_repo: str | None = None
    ref: str | None = None


class SkillSearchAnswer(BaseModel):
    """찾은 것들과, 바깥까지 닿았는가 — 닿지 못한 것은 결과 없음과 다른 일이다."""

    model_config = ConfigDict(extra="forbid")

    hits: list[SkillSearchHit]
    remote_reached: bool


class SkillDraftBody(BaseModel):
    """이 지시문을 skill 한 장으로 지어 달라는 청 — 승인 전에는 문서를 건드리지 않는다.

    이름·쓰임새는 사람이 적은 것이 이긴다. 참고 skill은 **예시로만** 실린다: 이 문서가
    가진 skill을 서버는 알지 못하므로 화면이 고른 후보를 함께 보내고, 그중 무엇을 실을지는
    두 언어가 함께 쓰는 규칙(skill_similarity)이 정한다.
    """

    model_config = ConfigDict(extra="forbid")

    model_ref: ModelRef
    instruction: NonEmptyText
    # 이름 규칙은 계약의 것 그대로다 — 어긋난 이름은 아무에게도 묻기 전에 물린다.
    name: str = Field(
        min_length=1, max_length=SKILL_NAME_MAX_LENGTH, pattern=SKILL_NAME_PATTERN
    )
    description: str = Field(min_length=1, max_length=SKILL_DESCRIPTION_MAX_LENGTH)
    references: list[SkillDef] = Field(default_factory=list)


class SkillDraftResponse(BaseModel):
    """지어 온 초안 한 장 — 무엇이 지었는지와, 그 사이에 있었던 일을 함께 말한다."""

    text: str
    drafted_by: DraftedBy
    issues: list[str]


class ToolWrapBody(BaseModel):
    """붙여 넣은 것을 연결로 바꿔 달라는 청 — 승인 전에는 문서를 건드리지 않는다."""

    model_config = ConfigDict(extra="forbid")

    model_ref: ModelRef
    source_kind: ToolSource
    source: NonEmptyText
    base_spec: AgentSpec
    #: 이미 있는 연결을 다시 가져오는 중이면 그 id — 없으면 새 연결을 만드는 것이다.
    replacing: NonEmptyText | None = None


class OptimizePreviewBody(BaseModel):
    """지금 그래프를 objective로 고쳐 달라는 청 — 승인 전에는 문서를 건드리지 않는다."""

    model_config = ConfigDict(extra="forbid")

    model_ref: ModelRef
    objective: NonEmptyText
    base_spec: AgentSpec


class ArchitectCostEvidence(BaseModel):
    status: Literal["estimate_requires_price_snapshot"]
    estimated_usd: float | None = None


class ArchitectEvidence(BaseModel):
    """preview 응답에만 붙는 비밀 없는 provider 관찰값."""

    provider: str
    model_ref: ModelRef
    model_id: str
    request_id: str | None = None
    #: 그림을 그린 그 한 번의 부름이 쓴 토큰이다. 빈 캔버스 초안은 그 앞에 "무엇을 되물을까"를
    #: 따로 한 번 더 묻는데(P6a), 그 부름은 이 수에 들어 있지 않다.
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int | None = None
    provider_processing_ms: int | None = None
    request_fingerprint: str
    external_state: Literal["preview_only"] = "preview_only"
    persisted: Literal[False] = False
    watermark: Literal["not_applicable_json_candidate"] = (
        "not_applicable_json_candidate"
    )
    cost: ArchitectCostEvidence


class ArchitectPatchResponse(BaseModel):
    patch: AgentSpecPatch
    candidate: AgentSpec
    issues: list[ValidationIssue]
    evidence: ArchitectEvidence | None = None
    #: 아무도 모르는 이름표라 단계에서 빼낸 skill들 — 검토 카드가 그 사실을 말한다.
    dropped_skill_refs: list[str] = Field(default_factory=list)


class ArchitectDraftResponse(BaseModel):
    """빈 캔버스 초안의 답 — 되묻기와 초안 중 하나만 실려 온다 (DESIGN §7 pattern-asks).

    `asks`가 비어 있지 않으면 아직 그림이 없다: 화면은 두 상태를 동시에 만나지 않는다.
    """

    asks: list[PatternAsk] = Field(default_factory=list)
    patch: AgentSpecPatch | None = None
    candidate: AgentSpec | None = None
    issues: list[ValidationIssue] = Field(default_factory=list)
    evidence: ArchitectEvidence | None = None
    dropped_skill_refs: list[str] = Field(default_factory=list)
    #: 예라고 했는데 넣지 못한 모양들 — 검토 카드가 그 한 줄을 보인다.
    skipped_patterns: list[SkippedPattern] = Field(default_factory=list)


class OptimizePreviewResponse(ArchitectPatchResponse):
    """architect preview 응답에 제안문 봉투를 더한 것 — patch는 여전히 별도 자리다."""

    proposal: OptimizationProposal


class SpecHistory(BaseModel):
    revisions: list[SpecRevision]


class PublishRequest(BaseModel):
    """게시를 청하며 적어 보낼 수 있는 것 — 어느 판을 게시할 셈인가 (없으면 최신 저장 판).

    모르는 필드는 버리지 않고 물린다 — 오타를 조용히 삼키면 뜻하지 않은 판이 게시된다.
    """

    model_config = ConfigDict(extra="forbid")

    revision: str | None = None


class RunRequest(BaseModel):
    """실행을 청하며 함께 적어 보낼 수 있는 것 — 어느 판을 돌릴 셈이었는가, 무엇을 건네는가.

    건넨 것은 실행이 여는 상태다: 첫 노드부터 그것을 보고 일한다.
    모르는 필드는 버리지 않고 물린다 — `specRevision` 같은 오타를 조용히 삼키면,
    판을 고정한 줄 아는 사람 밑에서 최신 판이 돈다.
    """

    model_config = ConfigDict(extra="forbid")

    spec_revision: str | None = None
    input: dict[str, Any] | None = None
    #: 이 말이 이어 붙는 대화 — 안 주면 이 실행 하나가 자기만의 대화다.
    thread_id: str | None = None
    #: 말한 이를 가리키는 이름 — 신원이 아니라 참조다 (없으면 만든 사람이 시험한 것이다).
    end_user_ref: EndUserRef | None = None
    #: 어느 판을 돌릴지 정하는 법 — 게시된 판을 고르면 판은 서버가 집는다.
    revision_source: RevisionSource = "latest"


class EvalBatchRequest(BaseModel):
    """배치를 청하며 적어 보내는 것 — 어느 그래프의 어느 판을, 어느 층까지 딛어 돌리는가.

    v1 배치는 spec을 그대로 돈다: 모델은 spec_revision이 가리키는 그래프 안에 있다.
    심판까지 쓸지는 이 실행의 속성이라 여기 실린다 — 시험(dataset)에는 저장하지 않는다.
    """

    model_config = ConfigDict(extra="forbid")

    spec_id: str
    spec_revision: str
    #: 값이 드는 층까지 딛을지 — 켜지 않으면 심판은 한 번도 불리지 않는다.
    use_judge: bool = False


class EvalCaseSuggestionRequest(BaseModel):
    """시험 케이스를 지어 달라는 청 — 지금 보고 있는 그래프와, 몇 개를 어떻게 지을지.

    저장하지 않는 preview다: 이 청은 어떤 dataset도 만들거나 고치지 않는다.
    """

    model_config = ConfigDict(extra="forbid")

    model_ref: ModelRef
    spec: AgentSpec
    how_many: int = Field(default=5, ge=1, le=20)
    #: 까다로운 경우도 섞을지 — 끄면 그 요구가 모델이 읽는 말에서 빠진다.
    include_edge_cases: bool = True
    #: 이미 지어 둔 케이스 제목들 — 같은 것을 또 짓지 않게 함께 보낸다.
    existing_titles: list[str] = Field(default_factory=list)


class EvalCaseSuggestionResponse(BaseModel):
    """지어 온 제안들 — 몇 개를 청했는지도 함께 말한다(화면이 '5개 중 3개'를 사실대로 말한다).

    케이스에 이름(id)이 없는 것은 모양의 뜻이다: 담는 쪽이 그 순간 발급한다.
    """

    asked_for: int
    cases: list[SuggestedCase]


class EvalBatchStartResponse(BaseModel):
    """배치가 열렸다는 답 — 이 이름으로 지금의 모습을 물을 수 있다."""

    batch_id: str


class EvalBatchReadResponse(BaseModel):
    """배치의 지금 모습 — 계약(EvalBatch)에는 상태 필드가 없으므로 이 응답 래퍼로만 있다."""

    status: Literal["running", "completed", "failed"]
    batch: EvalBatch | None = None
    #: 배경에서 어그러졌을 때만 있다 — 속엣말은 담지 않는다.
    message: str | None = None


class EvaluatorStanding(BaseModel):
    """판정 층 하나가 이 서버에 섰는가 — 이름은 판정기 카탈로그의 것 그대로다.

    계약(AgentSpec·RunEvent)의 모양이 아니라 이 서버의 지금 사정이라 API 모델로만 있다:
    같은 시험이 서버마다 다르게 판정되는 까닭을 화면이 읽는 자리다.
    """

    name: str
    standing: bool


def _default_store(path: Path) -> SpecStore:
    return SqliteSpecStore(path, database_is_prepared=True)


def _default_run_store(path: Path) -> RunStore:
    return SqliteRunStore(path, database_is_prepared=True)


def _default_eval_dataset_store(path: Path) -> EvalDatasetStore:
    return SqliteEvalDatasetStore(path, database_is_prepared=True)


def _default_eval_batch_store(path: Path) -> EvalBatchStore:
    return SqliteEvalBatchStore(path, database_is_prepared=True)


def _on_my_computer(env: Mapping[str, str]) -> dict[str, ModelDef]:
    """내 컴퓨터에서 띄운 모델 — 이름을 일러 주지 않았으면 그런 것은 없다."""
    named = env.get(LOCAL_MODEL_ENV, "").strip()
    if not named:
        return {}
    return {
        LOCAL_MODEL_REF: ModelDef(
            ref=LOCAL_MODEL_REF,
            title={
                "ko": f"내 컴퓨터의 모델 — {named}",
                "en": f"On my computer — {named}",
            },
            provider="openai_compatible",
            model_id=named,
            base_url=env.get(LOCAL_BASE_URL_ENV, "").strip() or DEFAULT_LOCAL_BASE_URL,
            tool_calling=_asked_for(env, LOCAL_TOOL_CALLING_ENV, unless_told=False),
        )
    }


def _asked_for(env: Mapping[str, str], name: str, unless_told: bool) -> bool:
    """서버를 띄운 자리가 예/아니요로 적어 둔 것 — 적지 않았으면 우리가 짐작한 값 그대로다.

    알아들을 수 없는 말은 조용히 아니라고 읽지 않는다: 크게 말하고 짐작한 값으로 돌아간다
    (이 자리는 뜰 때 한 번이 아니라 목록을 물을 때마다 지나가므로, 터뜨리면 화면이 통째로 닫힌다).
    """
    written = env.get(name, "").strip()
    if not written:
        return unless_told
    try:
        return boolean_setting(name, written)
    except RuntimeError as unclear:
        _logger.warning("%s — taking it as %s", unclear, unless_told)
        return unless_told


def _thinks_before_it_answers(model_id: str) -> bool:
    """이 이름이 생각하는 계열인가 — 표에 적힌 앞머리 하나로만 정한다."""
    return model_id.startswith(THINKING_MODEL_PREFIXES)


def _at_the_company(env: Mapping[str, str]) -> dict[str, ModelDef]:
    """OpenAI provider — key와 model ID를 모두 명시한 서버에서만 생긴다."""
    named = env.get(OPENAI_MODEL_ENV, "").strip()
    if env_vault(env)(OPENAI_API_KEY_REF) is None or not named:
        return {}
    return {
        OPENAI_MODEL_REF: ModelDef(
            ref=OPENAI_MODEL_REF,
            title={"ko": f"OpenAI의 모델 — {named}", "en": f"OpenAI — {named}"},
            provider="openai_compatible",
            model_id=named,
            tools_need_thinking_off=_asked_for(
                env,
                OPENAI_TOOLS_THINKING_OFF_ENV,
                unless_told=_thinks_before_it_answers(named),
            ),
        )
    }


def catalog_in(env: Mapping[str, str]) -> dict[str, ModelDef]:
    """이 서버가 아는 모델들 — 내 컴퓨터에서 띄운 것과, 열쇠가 여는 본사의 문까지.

    제품이 싣고 다니는 목록(공개 JSON)은 건드리지 않는다: 사본에만 더한다.
    """
    return {
        **DEFAULT_MODEL_CATALOG,
        **_on_my_computer(env),
        **_at_the_company(env),
    }


def asks_the_model_in(env: Mapping[str, str]) -> ModelCall:
    """서버를 띄운 자리를 보고 누구에게 물을지 정한다 — 물을 곳이 있으면 진짜, 없으면 결정론 대역.

    이 갈림은 여기 한 곳뿐이다: 실행기도 서비스도 어느 provider인지 알지 못한다. 어느 곳에
    물을지는 모델 정의가 정하고(provider 표), 열쇠도 로컬 모델도 없으면 서버는 예전처럼
    지어낸 판단으로 돈다 (아무것도 설정하지 않아도 뜨고 돌아간다).
    """
    vault = env_vault(env)
    catalog = catalog_in(env)
    if nobody_to_ask(vault, catalog):
        return says_the_first_way
    return asks_whoever_serves(vault, catalog)


def _default_model_call() -> ModelCall:
    return asks_the_model_in(os.environ)


def tools_in(env: Mapping[str, str]) -> CallsATool:
    """서버를 띄운 자리의 금고를 들고 도구를 부르는 자리를 연다 (모델 배선과 같은 문법).

    모델과 다른 점 하나: 도구는 "부를 곳이 있는가"를 미리 물을 수 없다 — 어느 열쇠가 필요한지는
    문서의 그 도구가 정한다. 그래서 자리는 언제나 서고, 열쇠가 없는 도구만 부를 때 그 까닭을
    답한다(부를 때마다 같은 까닭 — anthropic_from 선례와 같은 정직함이다).

    digest 전략의 요약 모델은 **live provider일 때만** 주입한다 — 아니면 None이라 digest 도구는
    조용한 Full이 아니라 정직한 미지원 balk가 된다(모델 배선의 nobody_to_ask와 같은 갈림).
    """
    summarize = (
        None
        if nobody_to_ask(env_vault(env), catalog_in(env))
        else tools_summariser_in(env)
    )
    return tools_from(env_vault(env), sends_with_httpx, summarize)


def tools_summariser_in(env: Mapping[str, str]) -> ModelCall:
    """도구 응답을 줄일 요약 모델 — LLM 노드가 쓰는 그 ModelCall을 그대로 재사용한다."""
    return asks_whoever_serves(env_vault(env), catalog_in(env))


def _default_tool_call() -> CallsATool:
    return tools_in(os.environ)


def _a_judge_for(
    asks_a_model: ModelCall,
    judge_model_ref: str,
    env: Mapping[str, str] | None,
) -> EntailmentCall | None:
    """심판을 세울 수 있는가 — 심판이 부를 **바로 그 이름**이 이 서버에서 열려야 심판이다.

    지어낸 판단으로 뜻을 보아 통과를 내주면, 화면은 '심판이 보고 통과시켰다'고 말하게 된다.
    다른 문이 열렸다고 세워 두는 것도 같은 거짓이다: 내 컴퓨터의 모델만 있는 서버에서
    본사의 이름으로 물으면 매 질의가 열쇠 없는 문 앞에서 되돌아오고, 화면에는 '심판이 보고
    못 건졌다'가 남는다. 그래서 열리지 않는 이름이면 심판 자리는 아예 비워 둔다 — 청한
    배치는 싼 층까지만 돌고, 그 사실을 로그가 말한다.

    env는 서버가 스스로 모델을 고른 경우에만 건네받는다: 모델을 주입했다면 무엇이 답하는지는
    주입한 쪽이 안다(카탈로그도 열쇠도 그 자리의 사정이 아니다).
    """
    if asks_a_model is says_the_first_way:
        return None
    if env is not None and not can_be_asked(
        judge_model_ref, env_vault(env), catalog_in(env)
    ):
        return None
    return llm_judge_entailment(asks_a_model, judge_model_ref)


def _models_on_offer(
    asks_a_model: ModelCall, env: Mapping[str, str] | None
) -> ServerModels:
    """화면에 말할 모델 사정 — 조립 때 한 번 정하고 그대로 닫아 둔다.

    모델을 건네받았다면 무엇이 답하는지는 건넨 쪽의 것이라 아무 판정도 말하지 않는다
    (심판 자리와 같은 규칙 — 카탈로그도 열쇠도 그 자리의 사정이 아니다).

    도는 자리(live/stand_in)는 실행이 고른 그 갈림을 그대로 읽는다: 열쇠도 내 컴퓨터의
    모델도 없는 서버는 연습용 답으로 **모든 이름에** 답하므로, 열쇠 없음만 보고 화면을
    전부 잠그면 화면이 실행과 다른 말을 하게 된다.
    """
    if env is None:
        return ServerModels(mode="live", models=[])
    mode: RunMode = "stand_in" if asks_a_model is says_the_first_way else "live"
    return ServerModels(
        mode=mode, models=models_standing(catalog_in(env), env_vault(env))
    )


def _judge_model_ref_in(env: Mapping[str, str]) -> str:
    """심판이 부를 이름 — 서버를 띄운 자리가 고르고, 고르지 않았으면 기본 이름이다."""
    return env.get(JUDGE_MODEL_ENV, "").strip() or JUDGE_MODEL_REF


def _origins_from_env() -> list[str]:
    """서버를 띄운 자리가 일러 주는 허용 목록 — 쉼표로 나눠 적는다."""
    written = os.environ.get(ALLOWED_ORIGINS_ENV, "")
    return [origin.strip() for origin in written.split(",") if origin.strip()]


def _allow_the_studio(app: FastAPI, allowed_origins: Sequence[str] | None) -> None:
    """어느 자리에서 온 credential 요청까지 받아 줄지 정확한 origin으로 정한다."""
    origins = (
        list(allowed_origins) if allowed_origins is not None else _origins_from_env()
    )
    if "*" in origins:
        raise RuntimeError("AGENTCANVAS_ALLOWED_ORIGINS must not contain '*'")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=None if origins else LOCAL_STUDIO_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["content-type", "if-match", "x-csrf-token"],
    )


def _durability_blockers(
    *, injected_stores: Mapping[str, object | None], worker: Worker
) -> list[str]:
    """기본 배선이 아니라 durable job을 켤 수 없는 까닭을 사람이 읽을 말로 모은다."""
    blockers = [
        f"an injected {name} does not share the durable database"
        for name, candidate in injected_stores.items()
        if candidate is not None
    ]
    if worker is not in_the_background:
        blockers.append("an injected worker does not carry jobs in the background")
    return blockers


#: 가져오지 못한 까닭 -> 문이 답하는 자리 (새 까닭이 생기면 여기 한 줄이다).
SKILL_FETCH_STATUS = {
    "skill.fetch.host": 400,
    "skill.fetch.notfound": 404,
    "skill.fetch.toolarge": 413,
    "skill.fetch.timeout": 504,
    "skill.fetch.ratelimited": 429,
}


def create_app(
    store: SpecStore | None = None,
    clock: Clock = utc_now,
    allowed_origins: Sequence[str] | None = None,
    run_store: RunStore | None = None,
    new_run_id: RunIdMaker = new_run_id,
    stream_timing: StreamTiming = DEFAULT_TIMING,
    worker: Worker = in_the_background,
    model: ModelCall | None = None,
    tool: CallsATool | None = None,
    eval_dataset_store: EvalDatasetStore | None = None,
    eval_batch_store: EvalBatchStore | None = None,
    auth_settings: AuthSettings | None = None,
    job_store: DurableJobStore | None = None,
    durability: bool | None = None,
    asks_entailment: EntailmentCall | None = None,
    gets_a_page: Gets | None = None,
    searches_skills: RemoteSearch | None = None,
) -> FastAPI:
    """저장소·시계·일꾼·모델·허용할 자리·인증을 주입해 서버를 만든다.

    실행은 일꾼이 배경에서 옮긴다: 문은 실행이 끝나기를 기다리지 않고 곧바로 답한다.
    누구에게 물을지 적어 주지 않으면 서버를 띄운 자리가 정한다 (열쇠가 있으면 진짜 모델).
    인증을 명시하지 않으면 환경에서 읽으며, 운영 기본은 자격증명 누락 시 시작하지 않는다.

    durability를 적지 않으면 기본 배선일 때만 durable job을 켠다 — 켜지 못하면 까닭을 남긴다.
    True는 켜지 못하는 배선에서 조용히 넘어가지 않고 멈춘다. False는 켜지 않는다.

    skill 원문을 가져오는 그물도 주입이다: 적어 주지 않으면 진짜 httpx가 나간다.

    뜻 검사(함의) 백엔드도 주입이다: 적어 주지 않으면 판정 사다리는 0층까지만 선다.
    서버를 만드는 것만으로 모델을 싣지 않는다 — 실제로 싣는 자리는 아래 `serves`뿐이다.
    """
    auth = BuiltinAuth(
        auth_settings if auth_settings is not None else AuthSettings.from_env()
    )
    injected_stores: Mapping[str, object | None] = {
        "spec store": store,
        "run store": run_store,
        "eval dataset store": eval_dataset_store,
        "eval batch store": eval_batch_store,
    }
    if durability is False and job_store is not None:
        raise RuntimeError(
            "durable jobs cannot be off while a durable job store is injected"
        )
    needs_default_database = any(
        candidate is None for candidate in injected_stores.values()
    )
    database_path = Path(os.environ.get(DB_PATH_ENV, DEFAULT_DB_PATH))
    if needs_default_database:
        # 한 파일을 공유하는 네 store보다 먼저 schema migration과 backup을 한 번 끝낸다.
        prepare_database(database_path)

    specs = store if store is not None else _default_store(database_path)
    service = SpecService(specs, clock)
    guided_provider_is_live = model is None
    asks_a_model = model if model is not None else _default_model_call()
    calls_a_tool = tool if tool is not None else _default_tool_call()
    # 화면에 말할 모델 사정은 **실행이 실제로 들고 있는 그것**이다: 실행기는 조립 때의 카탈로그를
    # 닫아 들고 돌기 때문에, 뒤에 바뀐 환경을 여기서 다시 읽으면 화면과 실행이 어긋난다.
    # 서버가 스스로 고른 배선에서만 env가 판단의 근거다(주입된 모델은 주입한 쪽의 것 — 심판 선례).
    models_on_offer = _models_on_offer(
        asks_a_model, os.environ if model is None else None
    )
    # 모양의 목록도 조립 때 닫아 둔다 — 뒤에 바뀐 환경을 다시 읽으면 화면이 실행과 다른
    # 말을 하게 된다(모델 사정과 같은 갈림).
    patterns_on_offer = ServerPatterns(
        patterns=patterns_this_server_can_do(catalog_in(os.environ))
    )
    architect = ArchitectService(asks_a_model, patterns=patterns_on_offer.patterns)
    tool_wrapper = ToolWrapperService(asks_a_model)
    # 초안은 부를 모델이 없어도 답한다 — 물을 곳이 있는가만 조립 때 한 번 정해 둔다
    # (심판 자리와 같은 갈림: 지어낸 판단은 모델이 지은 초안이 아니다).
    # 바깥 목록을 부르는 일도 주입이다: 적어 주지 않으면 진짜 `npx skills find`가 나가고,
    # 같은 물음은 10분 동안 다시 나가지 않는다.
    finds_skills_outside = (
        searches_skills
        if searches_skills is not None
        else remembering(npx_skills_find, clock=monotonic)
    )
    skill_drafts = SkillDraftService(
        asks_a_model, someone_to_ask=asks_a_model is not says_the_first_way
    )
    case_suggestions = EvalCaseSuggestionService(asks_a_model)
    durable_jobs = job_store
    if durable_jobs is None and durability is not False:
        blockers = _durability_blockers(injected_stores=injected_stores, worker=worker)
        if not blockers:
            durable_jobs = SqliteJobStore(database_path, database_is_prepared=True)
        elif durability:
            raise RuntimeError(
                "durable jobs cannot be turned on: " + "; ".join(blockers)
            )
        else:
            _logger.warning("durable jobs are off: %s", "; ".join(blockers))
    durable_runtime: DurableJobWorker | None = None

    def wake_durable_worker() -> None:
        if durable_runtime is not None:
            durable_runtime.wake()

    runs = RunService(
        specs=specs,
        runs=(
            run_store if run_store is not None else _default_run_store(database_path)
        ),
        clock=clock,
        new_run_id=new_run_id,
        worker=worker,
        start_run=partial(routed_run_stream, model=asks_a_model, tool=calls_a_tool),
        resume_run=partial(
            resume_routed_run_stream, model=asks_a_model, tool=calls_a_tool
        ),
        jobs=durable_jobs,
        wake_worker=wake_durable_worker,
    )
    eval_dataset_store_used = (
        eval_dataset_store
        if eval_dataset_store is not None
        else _default_eval_dataset_store(database_path)
    )
    eval_datasets = EvalDatasetService(eval_dataset_store_used)
    # 판정 사다리는 건네받은 층으로 세운다 — 뜻 검사를 건네주지 않았으면 0층까지만 서고,
    # 그 사실은 서버 로그가 말한다(조용히 짧아지되 침묵하지는 않는다).
    # 심판이 부를 이름은 서버를 띄운 자리가 고른다(AGENTCANVAS_JUDGE_MODEL). 고르지 않았으면
    # 기본 이름이고, 고른 이름이 이 서버에서 열리지 않으면 심판은 서지 않는다(싼 층까지만 돈다).
    ladder = judging_ladder(
        asks_entailment,
        judge=_a_judge_for(
            asks_a_model,
            _judge_model_ref_in(os.environ),
            # 서버가 스스로 고른 배선에서만 env가 판단의 근거다(주입된 모델은 주입한 쪽의 것).
            os.environ if model is None else None,
        ),
    )
    eval_batch_store_used = (
        eval_batch_store
        if eval_batch_store is not None
        else _default_eval_batch_store(database_path)
    )
    optimizer = OptimizerService(
        asks_a_model, eval_batch_store_used, patterns=patterns_on_offer.patterns
    )
    eval_batches = EvalBatchService(
        datasets=eval_dataset_store_used,
        specs=specs,
        batches=eval_batch_store_used,
        model=asks_a_model,
        clock=clock,
        worker=worker,
        jobs=durable_jobs,
        wake_worker=wake_durable_worker,
        evaluators=ladder.evaluators,
        ladder=ladder.order,
        judged_ladder=ladder.order_with_judge,
    )
    if durable_jobs is not None:
        durable_runtime = DurableJobWorker(durable_jobs, runs, eval_batches)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if durable_runtime is not None:
            durable_runtime.start()
        try:
            yield
        finally:
            if durable_runtime is not None:
                durable_runtime.stop()

    app = FastAPI(
        title="AgentCanvas control plane",
        version="0.1.0-alpha.1",
        lifespan=lifespan,
    )
    # 인증이 안쪽, CORS가 바깥쪽에 있어 401/403에도 브라우저가 읽을 CORS 헤더가 붙는다.
    app.add_middleware(AdminSessionMiddleware, auth=auth)
    _allow_the_studio(app, allowed_origins)

    @app.get("/health/live", tags=["operations"])
    def health_live() -> dict[str, str]:
        """프로세스가 요청에 답할 수 있는지만 말한다 — 외부 provider는 부르지 않는다."""
        return {"status": "ok"}

    @app.get("/health/ready", tags=["operations"])
    def health_ready() -> dict[str, str]:
        """네 영속 저장소를 짧게 읽어 요청을 받을 준비가 됐는지 확인한다."""
        readiness_id = "__agentcanvas_readiness__"
        try:
            if durable_runtime is not None and not durable_runtime.healthy:
                raise RuntimeError("durable worker is not healthy")
            service.latest(readiness_id)
            runs.view(readiness_id)
            eval_datasets.read(readiness_id)
            eval_batches.view(readiness_id)
        except Exception as unavailable:
            # 저장소 예외·경로·SQL을 probe 응답으로 내보내지 않는다.
            raise HTTPException(
                status_code=503, detail="service not ready"
            ) from unavailable
        return {"status": "ok"}

    @app.post(
        "/auth/login", response_model=AdminSessionResponse, tags=["authentication"]
    )
    def login(asked: AdminLoginRequest) -> JSONResponse:
        """환경에 둔 단일 관리자 비밀번호를 확인하고 짧은 서명 세션을 발급한다."""
        if auth.enabled and not auth.password_matches(asked.password):
            raise HTTPException(status_code=401, detail="invalid credentials")
        token, session = auth.issue()
        response = JSONResponse(
            {"authenticated": True, "csrf_token": session.csrf_token},
            headers={"Cache-Control": "no-store"},
        )
        if auth.enabled:
            set_session_cookie(response, token, auth.settings)
        return response

    @app.get(
        "/auth/session", response_model=AdminSessionResponse, tags=["authentication"]
    )
    def read_session(request: Request) -> JSONResponse:
        """유효한 cookie를 이미 확인한 middleware가 Studio에 CSRF nonce를 돌려준다."""
        session = request.state.admin_session if auth.enabled else auth.verify(None)
        return JSONResponse(
            {
                "authenticated": True,
                "csrf_token": session.csrf_token if session is not None else None,
            },
            headers={"Cache-Control": "no-store"},
        )

    @app.post(
        "/auth/logout", response_model=AdminSessionResponse, tags=["authentication"]
    )
    def logout() -> JSONResponse:
        """현재 브라우저의 세션 cookie를 지운다."""
        response = JSONResponse(
            {"authenticated": False, "csrf_token": None},
            headers={"Cache-Control": "no-store"},
        )
        if auth.enabled:
            clear_session_cookie(response, auth.settings)
        return response

    def _answered(outcome: SaveOutcome) -> SavedSpec:
        """서비스가 내린 답을 HTTP의 말로 옮긴다 — 규칙은 서비스가 정했다."""
        if isinstance(outcome, SaveRefused):
            raise HTTPException(
                status_code=REFUSAL_STATUS[outcome.reason], detail=outcome.message
            )
        return SavedSpec(spec=outcome.stored.spec, issues=outcome.issues)

    def _found(spec_id: str) -> StoredSpec:
        """저장된 적 없는 그래프는 열어 볼 수 없다."""
        stored = service.latest(spec_id)
        if stored is None:
            raise HTTPException(status_code=404, detail=f"no graph called {spec_id!r}")
        return stored

    def _architected(
        outcome: ArchitectPreview | ArchitectPreviewRefused,
        *,
        model_ref: str | None = None,
        request: str | None = None,
        guided: bool = False,
    ):
        if isinstance(outcome, ArchitectPreviewRefused):
            status = ARCHITECT_REFUSAL_STATUS[outcome.reason]
            detail = outcome.message
            if guided:
                if outcome.reason in {"unknown_model", "missing_secret"}:
                    status = 503
                    detail = "architect provider is not configured"
                elif outcome.reason == "provider_error":
                    status = 503
                    detail = "architect provider is unavailable"
                elif outcome.reason == "invalid_patch":
                    status = 502
                    detail = "architect provider returned invalid output"
            raise HTTPException(
                status_code=status,
                detail=detail,
            )
        evidence = None
        if (
            model_ref is not None
            and request is not None
            and outcome.evidence is not None
        ):
            evidence = ArchitectEvidence(
                provider=outcome.evidence.provider,
                model_ref=model_ref,
                model_id=outcome.evidence.model_id,
                request_id=outcome.evidence.request_id,
                input_tokens=outcome.input_tokens,
                output_tokens=outcome.output_tokens,
                latency_ms=outcome.evidence.latency_ms,
                provider_processing_ms=outcome.evidence.provider_processing_ms,
                request_fingerprint=architect_request_fingerprint(
                    model_ref=model_ref,
                    request=request,
                    base_revision=outcome.patch.base_revision,
                ),
                cost=ArchitectCostEvidence(
                    status="estimate_requires_price_snapshot",
                ),
            )
        return ArchitectPatchResponse(
            patch=outcome.patch,
            candidate=outcome.candidate,
            issues=outcome.issues,
            evidence=evidence,
            dropped_skill_refs=list(outcome.dropped_skill_refs),
        )

    @app.post("/architect/patch", response_model=ArchitectPatchResponse)
    def architect_patch(asked: ArchitectPatchRequest) -> ArchitectPatchResponse:
        return _architected(
            architect.preview(
                base_spec=asked.base_spec,
                request=asked.request,
                model_ref=asked.model_ref,
            ),
            model_ref=asked.model_ref,
            request=asked.request,
        )

    def _live_provider_or_503(model_ref: str) -> None:
        """provider가 실제로 서 있을 때만 물어본다 — 서버 fallback을 답으로 둔갑시키지 않는다."""
        if model_ref != GUIDED_MODEL_REF or (
            guided_provider_is_live and GUIDED_MODEL_REF not in catalog_in(os.environ)
        ):
            raise HTTPException(
                status_code=503,
                detail="architect provider is not configured",
            )

    def _drafted(
        outcome: ArchitectDraftOutcome, *, model_ref: str, request: str
    ) -> ArchitectDraftResponse:
        if isinstance(outcome, ArchitectAsking):
            return ArchitectDraftResponse(asks=list(outcome.asks))
        drafted = _architected(
            outcome, model_ref=model_ref, request=request, guided=True
        )
        return ArchitectDraftResponse(
            patch=drafted.patch,
            candidate=drafted.candidate,
            issues=drafted.issues,
            evidence=drafted.evidence,
            dropped_skill_refs=drafted.dropped_skill_refs,
            skipped_patterns=list(outcome.skipped_patterns),
        )

    @app.post("/architect/draft", response_model=ArchitectDraftResponse)
    def architect_draft(asked: ArchitectDraftRequest) -> ArchitectDraftResponse:
        _live_provider_or_503(asked.model_ref)
        return _drafted(
            architect.preview_new(
                draft_id=asked.draft_id,
                request=asked.request,
                model_ref=asked.model_ref,
                answers=asked.answers,
            ),
            model_ref=asked.model_ref,
            request=asked.request,
        )

    @app.post("/tools/wrap", response_model=ArchitectPatchResponse)
    def wrap_tools(asked: ToolWrapBody) -> ArchitectPatchResponse:
        """붙여 넣은 API 설명 하나 = 연결 제안 하나. 승인은 화면의 몫이고 여기서 저장하지 않는다."""
        _live_provider_or_503(asked.model_ref)
        return _architected(
            tool_wrapper.preview(
                base_spec=asked.base_spec,
                source=asked.source,
                source_kind=asked.source_kind,
                model_ref=asked.model_ref,
                replacing=asked.replacing,
            ),
            guided=True,
        )

    @app.post("/skills/draft", response_model=SkillDraftResponse)
    def draft_skill(asked: SkillDraftBody) -> SkillDraftResponse:
        """지시문 하나 = 초안 한 장. 승인은 화면의 몫이고 여기서 저장하지 않는다.

        부를 모델이 없어도 503이 아니다 — 틀 초안과 함께 그 사정을 사실대로 말한다
        (guided 카드와 다른 자리: 여기에는 모델 없이도 정직하게 줄 수 있는 답이 있다).
        """
        drafted = skill_drafts.draft(
            instruction=asked.instruction,
            name=asked.name,
            description=asked.description,
            references=asked.references,
            model_ref=asked.model_ref,
        )
        return SkillDraftResponse(
            text=drafted.text,
            drafted_by=drafted.drafted_by,
            issues=drafted.issues,
        )

    @app.get("/skills/search", response_model=SkillSearchAnswer)
    def search_for_skills(
        q: Annotated[NonEmptyText, Query()],
    ) -> SkillSearchAnswer:
        """물음 하나 = 시작 skill과 바깥 목록에서 찾은 줄들.

        이 문서가 이미 가진 skill은 여기 오지 않는다 — 화면이 알고 있으므로 앞에 합치는
        일은 화면의 몫이다(문서를 서버에 보내지 않는다). 바깥에 닿지 못해도 실패가 아니다:
        있는 것만 돌려주고 닿지 못했다고 말한다.
        """
        found = search_skills(
            q.strip(), starters=starter_skills().values(), remote=finds_skills_outside
        )
        return SkillSearchAnswer(
            hits=[SkillSearchHit(**vars(hit)) for hit in found.hits],
            remote_reached=found.remote_reached,
        )

    @app.get("/skills/fetch", response_model=SkillMarkdown)
    def fetch_skill(url: str) -> SkillMarkdown:
        """주소 하나 = SKILL.md 원문 하나. 읽어 skill로 만드는 일은 화면의 파서가 한다."""
        got = fetch_skill_markdown(url, gets=gets_a_page or gets_with_httpx)
        if not isinstance(got, SkillFetched):
            # 저쪽이 보낸 말은 그대로 내보내지 않는다 — 화면이 아는 코드 하나만 건넨다.
            raise HTTPException(
                status_code=SKILL_FETCH_STATUS.get(got.code, 502), detail=got.code
            )
        return SkillMarkdown(text=got.text)

    @app.post("/optimize/preview", response_model=OptimizePreviewResponse)
    def optimize_preview(asked: OptimizePreviewBody) -> OptimizePreviewResponse:
        """지금 그래프 + objective + eval 증거 → 후보 patch + 제안문. 승인 전 저장하지 않는다."""
        _live_provider_or_503(asked.model_ref)
        outcome, proposal = optimizer.preview(
            base_spec=asked.base_spec,
            objective=asked.objective,
            model_ref=asked.model_ref,
        )
        # 거절이면 _architected가 여기서 끝맺는다(Architect/Wrapper와 같은 거절 관례).
        base = _architected(outcome, guided=True)
        assert proposal is not None  # 통과한 outcome에는 언제나 제안문이 붙는다
        return OptimizePreviewResponse(
            patch=base.patch,
            candidate=base.candidate,
            issues=base.issues,
            evidence=base.evidence,
            proposal=proposal,
        )

    @app.post("/specs", response_model=SavedSpec, status_code=201)
    def create_spec(spec: AgentSpec) -> SavedSpec:
        return _answered(service.create(spec))

    @app.put("/specs/{spec_id}", response_model=SavedSpec)
    def update_spec(
        spec_id: str,
        spec: AgentSpec,
        if_match: str | None = Header(default=None, alias="If-Match"),
    ) -> SavedSpec:
        return _answered(service.update(spec_id, spec, if_match))

    @app.get("/specs", response_model=SpecListing)
    def list_specs() -> SpecListing:
        return service.summaries()

    @app.get("/specs/{spec_id}", response_model=SavedSpec)
    def read_spec(spec_id: str) -> SavedSpec:
        view = service.read(spec_id)
        if view is None:
            raise HTTPException(status_code=404, detail=f"no graph called {spec_id!r}")
        return SavedSpec(spec=view.stored.spec, issues=view.issues)

    @app.get("/specs/{spec_id}/revisions/{revision}", response_model=SavedSpec)
    def read_revision(spec_id: str, revision: str) -> SavedSpec:
        """지나간 판 하나 — 지금 저장된 판을 읽는 것과 같은 모습으로 온다."""
        view = service.read_revision(spec_id, revision)
        if view is None:
            raise HTTPException(
                status_code=404, detail=f"no revision {revision!r} of {spec_id!r}"
            )
        return SavedSpec(spec=view.stored.spec, issues=view.issues)

    @app.get("/specs/{spec_id}/revisions", response_model=SpecHistory)
    def read_revisions(spec_id: str) -> SpecHistory:
        _found(spec_id)
        return SpecHistory(revisions=service.revisions(spec_id))

    def _published(outcome: PublishOutcome) -> SpecPublication:
        """게시 서비스가 내린 답을 HTTP의 말로 옮긴다 — 규칙은 서비스가 정했다."""
        if isinstance(outcome, PublishRefused):
            raise HTTPException(
                status_code=PUBLISH_REFUSAL_STATUS[outcome.reason],
                detail=outcome.message,
            )
        return outcome

    @app.post("/specs/{spec_id}/publish", response_model=SpecPublication)
    def publish_spec(
        spec_id: str, asked: PublishRequest | None = None
    ) -> SpecPublication:
        wanted = asked if asked is not None else PublishRequest()
        return _published(service.publish(spec_id, wanted.revision))

    @app.delete("/specs/{spec_id}/publish", status_code=204)
    def unpublish_spec(spec_id: str) -> None:
        service.unpublish(spec_id)

    @app.get("/specs/{spec_id}/publication", response_model=SpecPublication | None)
    def read_publication(spec_id: str) -> SpecPublication | None:
        return service.publication(spec_id)

    def _idempotency_key(written: str | None) -> str | None:
        if written is None:
            return None
        key = written.strip()
        if not key or len(key) > 200:
            raise HTTPException(
                status_code=400,
                detail="Idempotency-Key must contain 1 to 200 characters",
            )
        return key

    def _ran(outcome: RunOutcome) -> RunView:
        """실행 서비스가 내린 답을 HTTP의 말로 옮긴다 — 규칙은 서비스가 정했다."""
        if isinstance(outcome, RunRefused):
            raise HTTPException(
                status_code=RUN_REFUSAL_STATUS[outcome.reason], detail=outcome.message
            )
        return outcome

    def _running(run_id: str) -> RunView:
        """시작된 적 없는 실행은 들여다볼 수 없다."""
        view = runs.view(run_id)
        if view is None:
            raise HTTPException(status_code=404, detail=f"no run called {run_id!r}")
        return view

    @app.post("/specs/{spec_id}/runs", response_model=RunView, status_code=201)
    def start_run(
        spec_id: str,
        asked: RunRequest | None = None,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> RunView:
        wanted = asked if asked is not None else RunRequest()
        try:
            return _ran(
                runs.start(
                    spec_id,
                    wanted.spec_revision,
                    wanted.input,
                    _idempotency_key(idempotency_key),
                    thread_id=wanted.thread_id,
                    end_user_ref=wanted.end_user_ref,
                    revision_source=wanted.revision_source,
                )
            )
        except IdempotencyConflict as conflict:
            raise HTTPException(
                status_code=409, detail="idempotency key conflicts with another request"
            ) from conflict

    @app.get("/specs/{spec_id}/threads", response_model=list[ThreadSummary])
    def read_spec_threads(spec_id: str) -> list[ThreadSummary]:
        """한 그래프에서 오간 지난 대화들 — 최근에 말이 오간 것부터, 요약을 곁들여.

        아무도 말을 건 적 없는 그래프는 없다고 하지 않고 비어 있다(대화는 파생 개념이다).
        """
        return runs.threads_of_spec(spec_id)

    @app.get("/threads/{thread_id}/events", response_model=list[ThreadTurn])
    def read_thread_events(thread_id: str) -> list[ThreadTurn]:
        """한 대화에 쌓인 이벤트 — 실행별로 묶어 한 번에 준다.

        흐르는 동안 듣는 길은 SSE(`/runs/{run_id}/events`)이고, 되돌아보는 길은 여기다.
        """
        return runs.thread_turns(thread_id)

    @app.get("/threads/{thread_id}/runs", response_model=list[Run])
    def read_thread(thread_id: str) -> list[Run]:
        """한 대화에 오간 말들 — 말한 순서대로.

        스레드는 실행들을 묶는 끈일 뿐 따로 만들어 두는 것이 아니다: 아무도 말하지 않은
        대화는 없다고 하지 않고 비어 있다.
        """
        return runs.runs_in_thread(thread_id)

    @app.delete("/threads/{thread_id}", status_code=204)
    def delete_thread(thread_id: str) -> None:
        """대화 하나를 통째로 거둔다 — 아직 흐르는 말이 있으면 하나도 지우지 않는다."""
        kept = runs.delete_thread(thread_id)
        if kept is not None:
            raise HTTPException(status_code=409, detail=kept.message)

    @app.get("/runs/{run_id}", response_model=RunView)
    def read_run(run_id: str) -> RunView:
        return _running(run_id)

    @app.get("/runs/{run_id}/events")
    def stream_run_events(
        run_id: str,
        after: int | None = None,
        last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    ) -> StreamingResponse:
        _running(run_id)
        return StreamingResponse(
            run_event_stream(
                lambda seq: runs.events(run_id, seq),
                lambda: runs.has_ended(run_id),
                after=resume_from(last_event_id, after),
                timing=stream_timing,
            ),
            media_type="text/event-stream",
            # 사이에 선 중계기가 줄글을 모아 두지 않게 한다 — 이벤트는 일어나는 대로 닿아야 한다.
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/runs/{run_id}/approval", response_model=RunView)
    def answer_gate(
        run_id: str,
        approval: ApprovalAnswer,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> RunView:
        try:
            return _ran(
                runs.answer(run_id, approval, _idempotency_key(idempotency_key))
            )
        except IdempotencyConflict as conflict:
            raise HTTPException(
                status_code=409, detail="idempotency key conflicts with another request"
            ) from conflict

    @app.post("/runs/{run_id}/cancel", response_model=RunView)
    def cancel_run(run_id: str) -> RunView:
        view = runs.cancel(run_id)
        if view is None:
            raise HTTPException(status_code=404, detail=f"no run called {run_id!r}")
        return view

    def _dataset_answered(outcome: EvalDatasetSaveOutcome) -> EvalDataset:
        """데이터셋 서비스가 내린 답을 HTTP의 말로 옮긴다 — 규칙은 서비스가 정했다."""
        if isinstance(outcome, EvalDatasetRefused):
            raise HTTPException(
                status_code=EVAL_DATASET_REFUSAL_STATUS[outcome.reason],
                detail=outcome.message,
            )
        return outcome

    @app.post("/eval/case-suggestions", response_model=EvalCaseSuggestionResponse)
    def suggest_eval_cases(
        asked: EvalCaseSuggestionRequest,
    ) -> EvalCaseSuggestionResponse:
        """시험 케이스를 지어 준다 — 사람이 골라 담기 전까지 어떤 dataset도 바뀌지 않는다."""
        outcome = case_suggestions.suggest(
            spec=asked.spec,
            how_many=asked.how_many,
            include_edge_cases=asked.include_edge_cases,
            existing_titles=asked.existing_titles,
            model_ref=asked.model_ref,
        )
        if isinstance(outcome, CaseSuggestionsRefused):
            raise HTTPException(
                status_code=CASE_SUGGESTION_REFUSAL_STATUS[outcome.reason],
                detail=outcome.message,
            )
        return EvalCaseSuggestionResponse(
            asked_for=outcome.asked_for, cases=outcome.cases
        )

    # 화면이 이 서버가 부를 수 있는 모델을 아는 유일한 길 — 답은 조립 때 닫아 둔 그 사정
    # 하나에서 나온다(실행이 든 카탈로그와 같은 것). 열쇠는 그 투영에 자리가 없다.
    @app.get("/models", response_model=ServerModels)
    def list_models() -> ServerModels:
        return models_on_offer

    # 화면과 Architect가 이 서버가 놓아 줄 수 있는 모양을 아는 유일한 길.
    @app.get("/patterns", response_model=ServerPatterns)
    def list_patterns() -> ServerPatterns:
        return patterns_on_offer

    # 화면이 이 서버의 판정 층을 아는 유일한 길 — 답은 조립 때 세운 사다리 하나에서 나온다.
    @app.get("/eval/evaluators", response_model=list[EvaluatorStanding])
    def list_evaluator_standings() -> list[EvaluatorStanding]:
        return [
            EvaluatorStanding(name=name, standing=stands)
            for name, stands in layers_standing(ladder).items()
        ]

    @app.post("/eval/datasets", response_model=EvalDataset, status_code=201)
    def create_eval_dataset(dataset: EvalDataset) -> EvalDataset:
        return _dataset_answered(eval_datasets.create(dataset))

    @app.put("/eval/datasets/{dataset_id}", response_model=EvalDataset)
    def update_eval_dataset(dataset_id: str, dataset: EvalDataset) -> EvalDataset:
        return _dataset_answered(eval_datasets.update(dataset_id, dataset))

    @app.get("/eval/datasets", response_model=list[EvalDatasetSummary])
    def list_eval_datasets() -> list[EvalDatasetSummary]:
        return eval_datasets.list_summaries()

    @app.get("/eval/datasets/{dataset_id}", response_model=EvalDataset)
    def read_eval_dataset(dataset_id: str) -> EvalDataset:
        found = eval_datasets.read(dataset_id)
        if found is None:
            raise HTTPException(
                status_code=404, detail=f"no dataset called {dataset_id!r}"
            )
        return found

    @app.delete("/eval/datasets/{dataset_id}", status_code=204)
    def delete_eval_dataset(dataset_id: str) -> None:
        if not eval_datasets.delete(dataset_id):
            raise HTTPException(
                status_code=404, detail=f"no dataset called {dataset_id!r}"
            )

    @app.post(
        "/eval/datasets/{dataset_id}/batches",
        response_model=EvalBatchStartResponse,
        status_code=202,
    )
    def start_eval_batch(
        dataset_id: str,
        asked: EvalBatchRequest,
        idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ) -> EvalBatchStartResponse:
        try:
            outcome = eval_batches.start(
                dataset_id,
                asked.spec_id,
                asked.spec_revision,
                _idempotency_key(idempotency_key),
                use_judge=asked.use_judge,
            )
        except IdempotencyConflict as conflict:
            raise HTTPException(
                status_code=409, detail="idempotency key conflicts with another request"
            ) from conflict
        if isinstance(outcome, EvalBatchRefused):
            raise HTTPException(
                status_code=EVAL_BATCH_REFUSAL_STATUS[outcome.reason],
                detail=outcome.message,
            )
        return EvalBatchStartResponse(batch_id=outcome.batch_id)

    def _eval_batch_response(
        batch_id: str, view: EvalBatchView
    ) -> EvalBatchReadResponse:
        if view is None:
            raise HTTPException(status_code=404, detail=f"no batch called {batch_id!r}")
        if isinstance(view, EvalBatchRunning):
            return EvalBatchReadResponse(status="running")
        if isinstance(view, EvalBatchFailed):
            return EvalBatchReadResponse(status="failed", message=view.message)
        return EvalBatchReadResponse(status="completed", batch=view)

    @app.get("/eval/batches/{batch_id}", response_model=EvalBatchReadResponse)
    def read_eval_batch(batch_id: str) -> EvalBatchReadResponse:
        return _eval_batch_response(batch_id, eval_batches.view(batch_id))

    @app.post("/eval/batches/{batch_id}/cancel", response_model=EvalBatchReadResponse)
    def cancel_eval_batch(batch_id: str) -> EvalBatchReadResponse:
        return _eval_batch_response(batch_id, eval_batches.cancel(batch_id))

    @app.get("/eval/datasets/{dataset_id}/batches", response_model=EvalBatchListing)
    def list_eval_batches(dataset_id: str) -> EvalBatchListing:
        listing = eval_batches.list_for_dataset(dataset_id)
        if listing is None:
            raise HTTPException(
                status_code=404, detail=f"no dataset called {dataset_id!r}"
            )
        return listing

    return app


def serves() -> FastAPI:
    """실제로 띄우는 서버 — 여기서만 뜻 검사 백엔드를 싣는다.

    싣지 못하면(`agentcanvas-adapters[nli]` 미설치, 가중치를 못 읽음) local_entailment가
    없음을 돌려주고 서버는 그대로 뜬다 — 고른 층 하나가 본체를 막지 않는다.
    """
    return create_app(asks_entailment=local_entailment())


# 서버는 띄울 때 만들어진다 (`uvicorn agentcanvas_api.app:serves --factory`) —
# 이 파일을 읽는 것만으로 저장 파일이 생기거나 모델이 실리지 않는다.

__all__ = [
    "ALLOWED_ORIGINS_ENV",
    "ARCHITECT_REFUSAL_STATUS",
    "DB_PATH_ENV",
    "DEFAULT_DB_PATH",
    "DEFAULT_LOCAL_BASE_URL",
    "EVAL_BATCH_REFUSAL_STATUS",
    "EVAL_DATASET_REFUSAL_STATUS",
    "GUIDED_MODEL_REF",
    "LOCAL_BASE_URL_ENV",
    "LOCAL_MODEL_ENV",
    "LOCAL_MODEL_REF",
    "LOCAL_STUDIO_ORIGINS",
    "LOCAL_TOOL_CALLING_ENV",
    "OPENAI_MODEL_ENV",
    "OPENAI_MODEL_REF",
    "OPENAI_TOOLS_THINKING_OFF_ENV",
    "REFUSAL_STATUS",
    "THINKING_MODEL_PREFIXES",
    "ArchitectCostEvidence",
    "ArchitectDraftRequest",
    "ArchitectEvidence",
    "ArchitectPatchRequest",
    "ArchitectPatchResponse",
    "EvalBatchReadResponse",
    "EvalBatchRequest",
    "EvalBatchStartResponse",
    "SavedSpec",
    "SpecHistory",
    "ToolWrapBody",
    "asks_the_model_in",
    "blank_architect_seed",
    "catalog_in",
    "create_app",
    "serves",
    "tools_in",
]
