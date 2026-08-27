"""AgentSpec — 그래프의 실행 계약 (설계 문서 §7)."""

from __future__ import annotations

from datetime import datetime, timedelta
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)

from .refs import McpRef, no_raw_secrets
from .revision import REVISION_PATTERN, compute_revision

SCHEMA_VERSION = "agent.spec/v1"

JsonSchema = dict[str, Any]


def _must_be_utc(value: datetime) -> datetime:
    if value.utcoffset() != timedelta(0):
        raise ValueError("timestamp must be in UTC")
    return value


UtcDatetime = Annotated[AwareDatetime, AfterValidator(_must_be_utc)]


def _must_not_be_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


# min_length는 JSON Schema에도 실린다 — 파이썬만 아는 규칙은 다른 언어에서 지켜지지 않는다.
NonEmptyText = Annotated[str, Field(min_length=1), AfterValidator(_must_not_be_blank)]


class AgentStatus(str, Enum):
    DRAFT = "draft"
    VALIDATED = "validated"
    APPROVED = "approved"
    PUBLISHED = "published"
    DEPRECATED = "deprecated"


class EdgeKind(str, Enum):
    DATA = "data"
    CONTROL = "control"
    APPROVAL = "approval"


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _reject_raw_secrets(self):
        """자유 dict/list 필드에는 raw secret이 들어올 수 없다."""
        for name, value in self:
            if isinstance(value, (dict, list, tuple)):
                no_raw_secrets(value, name)
        return self


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
    server_ref: McpRef
    allowed_tools: list[str] = Field(default_factory=list)
    approval_policy: str = Field(min_length=1)


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


__all__ = [
    "SCHEMA_VERSION",
    "AgentSpec",
    "AgentStatus",
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
]
