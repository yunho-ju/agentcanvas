"""Run — 그래프를 한 번 돌린 일 (설계 문서 §6).

Run에는 상태 필드가 없다: 실행의 원본은 이벤트이고, 지금 어떤 상태인가는 거기서 파생된다.
"""

from __future__ import annotations

from collections.abc import Sequence
from enum import Enum
from typing import Any

from pydantic import Field, model_validator

from .agent_spec import ContractModel, UtcDatetime
from .refs import EndUserRef
from .revision import REVISION_PATTERN
from .run_events import EventType, RunEvent


class RunStatus(str, Enum):
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"


class Run(ContractModel):
    """한 번의 실행 — 어느 그래프의 어느 판을, 언제, 어느 스레드에서, 누구의 말로 돌렸는가."""

    #: 실행의 이름은 서버가 발급한다 (클라이언트가 지어 오지 않는다).
    id: str = Field(min_length=1)
    spec_id: str = Field(min_length=1)
    spec_revision: str = Field(pattern=REVISION_PATTERN)
    created_at: UtcDatetime
    #: 이 실행이 속한 스레드 — 모든 run은 스레드에 속한다. 안 주면 자기 이름이 곧 스레드다
    #: (단독 실행 = 홀로 선 스레드). 스레드는 실행들을 차례로 묶는 끈일 뿐 별도 모델이 아니다.
    thread_id: str = Field(min_length=1)
    #: 이 말을 한 사람을 가리키는 이름 — 없으면 만든 사람이 자기 그래프를 시험한 것이다.
    end_user_ref: EndUserRef | None = None

    @model_validator(mode="before")
    @classmethod
    def _solo_run_is_its_own_thread(cls, data: Any) -> Any:
        """스레드를 안 주면 그 실행 하나가 자기만의 스레드다 — run_id가 곧 thread_id."""
        if isinstance(data, dict) and not data.get("thread_id"):
            return {**data, "thread_id": data.get("id")}
        return data


#: 마지막 이벤트가 말해 주는 상태 — 표에 없는 이벤트는 실행이 아직 흐르고 있다는 뜻이다.
_STATUS_BY_LAST_EVENT: dict[EventType, RunStatus] = {
    EventType.RUN_PAUSED: RunStatus.PAUSED,
    EventType.RUN_COMPLETED: RunStatus.COMPLETED,
    EventType.RUN_FAILED: RunStatus.FAILED,
}


def run_status(events: Sequence[RunEvent]) -> RunStatus:
    """이벤트가 말하는 지금의 상태 — 아무 말도 없으면 이제 막 흐르기 시작한 것이다."""
    if not events:
        return RunStatus.RUNNING
    return _STATUS_BY_LAST_EVENT.get(events[-1].event_type, RunStatus.RUNNING)


#: 실행이 여기서 끝났다고 말하는 상태들 — 여기 닿은 실행은 더 이어지지 않는다.
RUN_ENDINGS = frozenset({RunStatus.COMPLETED, RunStatus.FAILED})


class ApprovalAnswer(ContractModel):
    """밸브 앞에서 사람이 내린 답 — 허락인가, 그리고 함께 적어 넣은 값이 있는가.

    거절(approved=false)에는 values를 실을 수 없다 — 허락하지 않은 값이 실행에 남지 않는다.
    """

    approved: bool
    values: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _refusal_carries_no_values(self):
        """거절에는 적어 넣은 값이 없다 — 허락하지 않은 값이 실행에 남지 않는다."""
        if not self.approved and self.values is not None:
            raise ValueError("a refused approval cannot carry values")
        return self


__all__ = ["RUN_ENDINGS", "ApprovalAnswer", "Run", "RunStatus", "run_status"]
