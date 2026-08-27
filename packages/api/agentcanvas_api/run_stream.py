"""실행이 남기는 이벤트를 브라우저가 읽는 줄글로 흘려보낸다 (Server-Sent Events).

한 줄글은 `id:`(그 이벤트의 순번)와 `data:`(RunEvent 그대로)로 이뤄진다 — 순번을 실어 보내므로
연결이 끊겼다 돌아온 브라우저는 자기가 어디까지 읽었는지 말할 수 있다.
기다림은 밖에서 받는다: 이 모듈에는 진짜 시계가 없다.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass

from agentcanvas_contracts.run import RUN_ENDINGS, run_status
from agentcanvas_contracts.run_events import RunEvent

#: 아무 일도 일어나지 않는 동안 보내는 한 마디 — 사이에 선 중계기가 조용한 연결을 끊는다.
#: 주석 줄(`:`로 시작)이라 브라우저는 이벤트로 세지 않는다.
KEEPALIVE = ": keepalive\n\n"

#: 그 순번 다음의 이벤트를 되찾아 오는 것.
EventsAfter = Callable[[int | None], list[RunEvent]]

#: 그 실행이 이미 끝났는가 — 끝난 실행에는 더 보낼 것도, 기다릴 것도 없다.
Ended = Callable[[], bool]

Sleep = Callable[[float], Awaitable[None]]


@dataclass(frozen=True)
class StreamTiming:
    """얼마나 자주 새 이벤트를 살피고, 얼마나 조용하면 한 마디 보내는가."""

    poll_seconds: float = 0.2
    keepalive_seconds: float = 15.0


#: 아무도 따로 정해 주지 않았을 때의 박자.
DEFAULT_TIMING = StreamTiming()


def sse_frame(event: RunEvent) -> str:
    """이벤트 하나를 줄글 한 토막으로 — 순번은 브라우저가 기억할 이름표다."""
    body = json.dumps(event.model_dump(mode="json"), ensure_ascii=False)
    return f"id: {event.seq}\ndata: {body}\n\n"


def ends_the_run(event: RunEvent) -> bool:
    return run_status([event]) in RUN_ENDINGS


def resume_from(last_event_id: str | None, after: int | None) -> int | None:
    """어디까지 읽었는가 — 브라우저가 기억하는 자리가 먼저고, 없으면 물어본 자리다.

    순번이 아닌 것을 들고 오면 못 들은 것으로 한다 (처음부터 다시 흘려보낸다).
    """
    if last_event_id is not None and last_event_id.isdigit():
        return int(last_event_id)
    return after


async def run_event_stream(
    events_after: EventsAfter,
    has_ended: Ended,
    after: int | None = None,
    timing: StreamTiming = DEFAULT_TIMING,
    sleep: Sleep = asyncio.sleep,
) -> AsyncIterator[str]:
    """저장된 이벤트를 순서대로 흘려보내고, 끝나지 않은 실행이면 새 이벤트를 기다린다.

    이미 끝난 실행에 뒤늦게 오면 보낼 것이 없어도 닫는다 — 끝난 실행은 더 말하지 않는다.
    끝났는지를 먼저 묻고 이벤트를 꺼내야, 그 사이에 도착한 이벤트를 흘리지 않고 보낼 수 있다.
    """
    sent = after
    silent = 0.0
    while True:
        ended = has_ended()
        fresh = events_after(sent)
        for event in fresh:
            yield sse_frame(event)
            sent = event.seq
            if ends_the_run(event):
                return
        if fresh:
            silent = 0.0
            continue
        if ended:
            return
        await sleep(timing.poll_seconds)
        silent += timing.poll_seconds
        if silent >= timing.keepalive_seconds:
            yield KEEPALIVE
            silent = 0.0


__all__ = [
    "DEFAULT_TIMING",
    "KEEPALIVE",
    "Ended",
    "EventsAfter",
    "Sleep",
    "StreamTiming",
    "ends_the_run",
    "resume_from",
    "run_event_stream",
    "sse_frame",
]
