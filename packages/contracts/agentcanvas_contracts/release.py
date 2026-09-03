"""ReleaseManifest — 배포되는 것은 prompt 하나가 아니라 실행 계약 전체 (PROMPT_EVAL §3.2)."""

from __future__ import annotations

import hashlib

from pydantic import Field

from .agent_spec import AgentSpec, ContractModel, UtcDatetime
from .revision import REVISION_PREFIX


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
    #: 게시된 판이 입고 있던 skill — ref 하나당 그 본문의 지문(sha256). 없으면 skill이 없던 판이다.
    skill_snapshot: dict[str, str] = Field(default_factory=dict)
    approval: Approval


def skill_snapshot_of(spec: AgentSpec) -> dict[str, str]:
    """이 문서가 가진 skill의 지문 — 나중에 그 지시가 바뀌었는지 한눈에 알아본다.

    지문은 본문에서만 나온다: 이름·설명이 다듬어져도 모델이 읽는 말이 같으면 같은 지문이다.
    """
    return {
        skill.ref: REVISION_PREFIX
        + hashlib.sha256(skill.body.encode("utf-8")).hexdigest()
        for skill in spec.skills
    }


__all__ = ["Approval", "ModelSnapshot", "ReleaseManifest", "skill_snapshot_of"]
