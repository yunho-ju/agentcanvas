"""AgentSpec — 그래프의 실행 계약 (설계 문서 §7)."""

from __future__ import annotations

from datetime import datetime, timedelta
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, AwareDatetime, Field, model_validator

from .base import ContractModel, JsonSchema, NonEmptyText
from .refs import ServerRef
from .revision import REVISION_PATTERN, compute_revision
from .tool_def import ToolDef

SCHEMA_VERSION = "agent.spec/v1"


def _must_be_utc(value: datetime) -> datetime:
    if value.utcoffset() != timedelta(0):
        raise ValueError("timestamp must be in UTC")
    return value


UtcDatetime = Annotated[AwareDatetime, AfterValidator(_must_be_utc)]


class AgentStatus(str, Enum):
    DRAFT = "draft"
    VALIDATED = "validated"
    APPROVED = "approved"
    PUBLISHED = "published"
    DEPRECATED = "deprecated"


class ApprovalPolicy(str, Enum):
    """연결이 도구를 부르기 전에 사람에게 물어보는가.

    값은 둘뿐이다: 바로 부르거나(read_only_auto, 기본), 부를 때마다 사람의 확인을
    기다린다(ask_first). "무엇을 쓸 수 있나"는 allowed_tools가 이미 정하므로,
    "부르지 마라" 같은 세 번째 값은 두지 않는다.
    """

    READ_ONLY_AUTO = "read_only_auto"
    ASK_FIRST = "ask_first"


class EdgeKind(str, Enum):
    DATA = "data"
    CONTROL = "control"
    APPROVAL = "approval"


class Position(ContractModel):
    x: float
    y: float


class Node(ContractModel):
    id: str = Field(min_length=1)
    type: str = Field(min_length=1)
    position: Position
    config: dict[str, Any] = Field(default_factory=dict)


class EdgeEndpoint(ContractModel):
    node: str = Field(min_length=1)
    port: str = Field(min_length=1)


class EdgeCondition(ContractModel):
    language: Literal["cel"]
    expression: str = Field(min_length=1)


class Edge(ContractModel):
    id: str = Field(min_length=1)
    kind: EdgeKind
    source: EdgeEndpoint
    target: EdgeEndpoint
    condition: EdgeCondition | None = None


class ExecutionLimits(ContractModel):
    max_total_tokens: int = Field(gt=0)
    max_runtime_ms: int = Field(gt=0)
    max_tool_calls: int = Field(gt=0)


class ExecutionConfig(ContractModel):
    checkpointer: str = Field(min_length=1)
    replay_policy: str = Field(min_length=1)
    limits: ExecutionLimits


class ResourceBinding(ContractModel):
    id: str = Field(min_length=1)
    kind: str = Field(min_length=1)
    server_ref: ServerRef
    allowed_tools: list[str] = Field(default_factory=list)
    approval_policy: ApprovalPolicy = ApprovalPolicy.READ_ONLY_AUTO
    tools: list[ToolDef] = Field(default_factory=list)

    @model_validator(mode="after")
    def _tool_names_are_unique(self):
        """노드는 이름으로 도구를 고른다 — 한 바인딩 안에 같은 이름이 둘이면 고를 수 없다."""
        names = [tool.name for tool in self.tools]
        repeated = sorted({name for name in names if names.count(name) > 1})
        if repeated:
            raise ValueError(
                "tool names must be unique within a binding, "
                f"but these are used more than once: {', '.join(repeated)}"
            )
        return self


class AgentSpec(ContractModel):
    schema_version: Literal["agent.spec/v1"]
    id: str = Field(min_length=1)
    # 사람이 부르는 이름. 이름도 내용이므로 바꾸면 다른 revision이 된다.
    name: NonEmptyText | None = None
    version: int = Field(ge=1)
    revision: str = Field(pattern=REVISION_PATTERN)
    status: AgentStatus
    input_schema: JsonSchema
    state_schema: JsonSchema
    nodes: list[Node]
    edges: list[Edge]
    resources: list[ResourceBinding] = Field(default_factory=list)
    execution: ExecutionConfig | None = None

    def computed_revision(self) -> str:
        return compute_revision(self.model_dump(mode="json"))


def coerce_known_policies(raw: dict) -> dict:
    """저장된 spec을 관대히 읽는다: 낯선 승인 정책은 기본값으로 되돌린다 (관대한 입력).

    저장 경로는 Enum이 강제하므로 낯선 값은 애초에 저장될 수 없다 — 이건 미래의 낯선
    값에 부서지지 않기 위한 과거 데이터의 안전줄이지, 조용한 무시(§9)가 아니다.
    적지 않은 자리는 건드리지 않는다: 그 자리는 필드 기본값이 채운다.
    """
    known = {policy.value for policy in ApprovalPolicy}
    for resource in raw.get("resources", []):
        if not isinstance(resource, dict):
            continue
        policy = resource.get("approval_policy")
        if policy is not None and policy not in known:
            resource["approval_policy"] = ApprovalPolicy.READ_ONLY_AUTO.value
    return raw


__all__ = [
    "SCHEMA_VERSION",
    "AgentSpec",
    "AgentStatus",
    "ApprovalPolicy",
    "ContractModel",
    "Edge",
    "EdgeCondition",
    "EdgeEndpoint",
    "EdgeKind",
    "ExecutionConfig",
    "ExecutionLimits",
    "JsonSchema",
    "Node",
    "NonEmptyText",
    "Position",
    "ResourceBinding",
    "UtcDatetime",
    "coerce_known_policies",
]
