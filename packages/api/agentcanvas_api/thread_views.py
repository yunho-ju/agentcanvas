"""지난 대화를 보여 주는 모습 — 요약 한 줄과, 실행별로 묶은 이벤트.

여기 있는 것은 전부 파생이다: 첫 마디도 마지막 상태도 이미 쌓인 이벤트에서 읽을 때마다
다시 계산한다 (적어 두는 자리는 없다). 스레드는 실행들을 묶는 끈일 뿐이라 계약(contracts)이
아니라 이 문 앞에서만 쓰는 모습이다.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime

from agentcanvas_contracts.chat import CHAT_SAID_BINDING
from agentcanvas_contracts.run import Run, RunStatus, run_status
from agentcanvas_contracts.run_events import EventType, RunEvent
from pydantic import BaseModel


class ThreadSummary(BaseModel):
    """대화 하나를 한 줄로 — 무엇으로 시작했고, 몇 번 오갔고, 지금 어떤가."""

    thread_id: str
    #: 사람이 처음 건넨 말 — 건넨 것이 없으면 지어내지 않고 없다(None).
    first_said: str | None
    started_at: datetime
    last_at: datetime
    #: 오간 횟수 — 실행 하나가 말 한 번이다.
    turns: int
    last_status: RunStatus
    #: 이 대화가 집은 판 — 첫 마디가 만난 판을 끝까지 쓴다.
    spec_revision: str


class ThreadTurn(BaseModel):
    """말 한 번 — 그 실행과, 그 실행이 남긴 이벤트들(SSE로 받던 것과 같은 것)."""

    run: Run
    events: list[RunEvent]


def what_was_first_said(opening: Sequence[RunEvent]) -> str | None:
    """첫 실행이 열릴 때 함께 실린 사람의 말 — 없으면 없다고 말한다.

    실린 것이 사람의 말이 아니면(일반 실행이 건넨 값) 그것을 말인 척하지 않는다.
    """
    for event in opening:
        if event.event_type is not EventType.RUN_STARTED:
            continue
        said = event.payload.get("input")
        if isinstance(said, dict) and isinstance(said.get(CHAT_SAID_BINDING), str):
            return said[CHAT_SAID_BINDING]
    return None


def summarize_thread(
    turns: Sequence[Run],
    opening: Sequence[RunEvent],
    last: RunEvent | None,
) -> ThreadSummary:
    """오간 말들을 한 줄로 줄인다 — turns는 스레드 묶음이라 비어 올 수 없다."""
    return ThreadSummary(
        thread_id=turns[0].thread_id,
        first_said=what_was_first_said(opening),
        started_at=turns[0].created_at,
        last_at=turns[-1].created_at,
        turns=len(turns),
        last_status=run_status([] if last is None else [last]),
        spec_revision=turns[0].spec_revision,
    )


__all__ = [
    "ThreadSummary",
    "ThreadTurn",
    "summarize_thread",
    "what_was_first_said",
]
