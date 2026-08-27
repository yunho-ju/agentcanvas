"""ReleaseManifest — 배포되는 것은 prompt 하나가 아니라 실행 계약 전체 (PROMPT_EVAL §3.2)."""

from __future__ import annotations

from pydantic import Field

from .agent_spec import ContractModel, UtcDatetime


class ModelSnapshot(ContractModel):
    provider: str = Field(min_length=1)
    model: str = Field(min_length=1)
    quantization: str | None = None
    digest: str | None = None


class Approval(ContractModel):
    status: str = Field(min_length=1)
    approved_by: list[str] = Field(default_factory=list)
    approved_at: UtcDatetime


class ReleaseManifest(ContractModel):
    release_id: str = Field(min_length=1)
    graph_revision: str = Field(min_length=1)
    prompt_revisions: dict[str, str] = Field(default_factory=dict)
    model_snapshot: ModelSnapshot
    tool_registry_snapshot: str = Field(min_length=1)
    mcp_policy_snapshot: str = Field(min_length=1)
    eval_suite_snapshot: str = Field(min_length=1)
    approval: Approval


__all__ = ["Approval", "ModelSnapshot", "ReleaseManifest"]
