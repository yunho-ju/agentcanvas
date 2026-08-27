"""RunEvent — 실행 이벤트 모델 (설계 문서 §8)."""

from __future__ import annotations

from collections.abc import Sequence
from enum import Enum
from itertools import pairwise
from typing import Any

from pydantic import Field

from .agent_spec import ContractModel, UtcDatetime
from .revision import REVISION_PATTERN


class EventType(str, Enum):
    RUN_STARTED = "run.started"
    NODE_QUEUED = "node.queued"
    NODE_STARTED = "node.started"
    PROMPT_COMPILED = "prompt.compiled"
    LLM_REQUESTED = "llm.requested"
    LLM_COMPLETED = "llm.completed"
    DECISION_RECORDED = "decision.recorded"
    TOOL_POLICY_CHECKED = "tool.policy_checked"
    TOOL_REQUESTED = "tool.requested"
    TOOL_COMPLETED = "tool.completed"
    STATE_PATCH = "state.patch"
    CHECKPOINT_CREATED = "checkpoint.created"
    HUMAN_APPROVAL_REQUESTED = "human.approval_requested"
    RUN_PAUSED = "run.paused"
    RUN_RESUMED = "run.resumed"
    NODE_COMPLETED = "node.completed"
    NODE_FAILED = "node.failed"
    RUN_COMPLETED = "run.completed"
    RUN_FAILED = "run.failed"


class RunEvent(ContractModel):
    seq: int = Field(ge=0)
    run_id: str = Field(min_length=1)
    event_type: EventType
    timestamp: UtcDatetime
    spec_revision: str = Field(pattern=REVISION_PATTERN)
    payload: dict[str, Any]
    node_id: str | None = None


def assert_monotonic_seq(events: Sequence[RunEvent]) -> None:
    """이벤트의 seq가 단조 증가하는지 확인한다."""
    for previous, current in pairwise(events):
        if current.seq <= previous.seq:
            raise ValueError(
                f"seq must strictly increase, got {previous.seq} then {current.seq}"
            )


__all__ = ["EventType", "RunEvent", "assert_monotonic_seq"]
