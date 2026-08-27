"""흘려보내기 — 저장된 이벤트를 브라우저가 읽는 줄글(SSE)로 옮기고, 새 이벤트를 기다린다.

시계는 밖에서 받는다: 여기 시험에는 진짜 기다림이 없다.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from agentcanvas_api.run_stream import (
    KEEPALIVE,
    StreamTiming,
    ends_the_run,
    resume_from,
    run_event_stream,
    sse_frame,
)
from agentcanvas_contracts.run_events import EventType, RunEvent

REVISION = "sha256:" + "1" * 64


def an_event(seq: int, event_type: EventType = EventType.NODE_STARTED) -> RunEvent:
    return RunEvent(
        seq=seq,
        run_id="run_1",
        event_type=event_type,
        timestamp=datetime(2026, 8, 1, 12, 30, tzinfo=UTC),
        spec_revision=REVISION,
        payload={"node_type": "core.input"},
        node_id="input",
    )


class _Recorded:
    """이벤트가 뒤늦게 도착하는 저장소 — 기다림 한 번에 한 묶음씩 열린다."""

    def __init__(self, batches: list[list[RunEvent]]) -> None:
        self.arrivals = batches
        self.opened: list[RunEvent] = []
        self.slept: list[float] = []

    def after(self, seq: int | None) -> list[RunEvent]:
        return [event for event in self.opened if seq is None or event.seq > seq]

    def ended(self) -> bool:
        return bool(self.opened) and ends_the_run(self.opened[-1])

    async def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        if self.arrivals:
            self.opened.extend(self.arrivals.pop(0))


async def collect(recorded: _Recorded, after: int | None = None, **timing) -> list[str]:
    return [
        frame
        async for frame in run_event_stream(
            recorded.after,
            recorded.ended,
            after=after,
            timing=StreamTiming(**timing),
            sleep=recorded.sleep,
        )
    ]


def test_an_event_carries_its_seq_as_the_id_the_browser_remembers():
    frame = sse_frame(an_event(7))

    assert frame.startswith("id: 7\ndata: ")
    assert frame.endswith("\n\n")


def test_the_data_of_a_frame_is_the_run_event_itself():
    body = sse_frame(an_event(7)).split("data: ", 1)[1].strip()

    assert json.loads(body) == an_event(7).model_dump(mode="json")


def test_a_browser_that_comes_back_says_where_it_left_off():
    assert resume_from(last_event_id="12", after=None) == 12


def test_the_query_can_say_it_too_when_nobody_sent_a_header():
    assert resume_from(last_event_id=None, after=3) == 3


def test_what_the_browser_remembers_wins_over_the_query():
    assert resume_from(last_event_id="12", after=3) == 12


def test_a_header_that_is_not_a_seq_is_ignored():
    assert resume_from(last_event_id="hello", after=None) is None
    assert resume_from(last_event_id="hello", after=3) == 3


def test_a_header_that_only_looks_like_a_seq_is_ignored_too():
    """`--5`는 순번이 아니다 — 못 들은 것으로 하지, 터지지 않는다."""
    assert resume_from(last_event_id="--5", after=None) is None
    assert resume_from(last_event_id="-5", after=3) == 3


def test_nothing_is_asked_for_when_nobody_says_anything():
    assert resume_from(last_event_id=None, after=None) is None


@pytest.mark.anyio
async def test_the_stream_sends_what_is_already_there_and_closes_at_the_end():
    recorded = _Recorded([])
    recorded.opened = [an_event(0), an_event(1, EventType.RUN_COMPLETED)]

    frames = await collect(recorded)

    assert [frame.splitlines()[0] for frame in frames] == ["id: 0", "id: 1"]
    assert recorded.slept == []


@pytest.mark.anyio
async def test_a_run_that_broke_closes_the_stream_too():
    recorded = _Recorded([])
    recorded.opened = [an_event(0, EventType.RUN_FAILED)]

    assert len(await collect(recorded)) == 1


@pytest.mark.anyio
async def test_a_run_held_at_a_valve_keeps_the_stream_open_until_it_ends():
    recorded = _Recorded([[an_event(1, EventType.RUN_COMPLETED)]])
    recorded.opened = [an_event(0, EventType.RUN_PAUSED)]

    frames = await collect(recorded, keepalive_seconds=60.0)

    assert [frame.splitlines()[0] for frame in frames] == ["id: 0", "id: 1"]


@pytest.mark.anyio
async def test_a_stream_that_comes_back_starts_after_what_was_already_read():
    recorded = _Recorded([])
    recorded.opened = [an_event(0), an_event(1), an_event(2, EventType.RUN_COMPLETED)]

    frames = await collect(recorded, after=0)

    assert [frame.splitlines()[0] for frame in frames] == ["id: 1", "id: 2"]


@pytest.mark.anyio
async def test_a_stream_that_comes_back_after_the_end_closes_at_once():
    """끝난 실행에 마지막 순번을 들고 다시 오면 보낼 것이 없다 — 붙잡아 두지 않고 닫는다.

    브라우저는 서버가 스트림을 닫으면 마지막 `id:`를 들고 곧바로 다시 온다: 여기서 안 닫으면
    영원히 되묻는 연결이 하나 남는다.
    """
    recorded = _Recorded([])
    recorded.opened = [an_event(0), an_event(1, EventType.RUN_COMPLETED)]

    assert await collect(recorded, after=1) == []
    assert recorded.slept == []


@pytest.mark.anyio
async def test_a_waiting_stream_says_it_is_still_there():
    """오래 조용하면 한 마디 보낸다 — 사이에 선 중계기가 조용한 연결을 끊기 때문이다."""
    recorded = _Recorded([[], [an_event(0, EventType.RUN_COMPLETED)]])

    frames = await collect(recorded, poll_seconds=0.2, keepalive_seconds=0.2)

    assert frames[0] == KEEPALIVE
    assert recorded.slept == [0.2, 0.2]
