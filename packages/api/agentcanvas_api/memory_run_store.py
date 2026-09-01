"""프로세스가 사는 동안만 기억하는 실행 저장소 — 시험과 시연이 쓰는 자리."""

from __future__ import annotations

from collections.abc import Sequence
from threading import Lock

from agentcanvas_contracts.run import Run
from agentcanvas_contracts.run_events import RunEvent

from .run_store import SeqAlreadyStored, ThreadRuns, threads_from


class InMemoryRunStore:
    def __init__(self) -> None:
        self._runs: dict[str, Run] = {}
        self._events: dict[str, list[RunEvent]] = {}
        # 문은 여러 일꾼이 동시에 연다 — 이미 적혔는지 보는 일과 적는 일 사이를 아무도 끼어들지 못한다.
        self._writing = Lock()

    def start(self, run: Run) -> None:
        self._runs[run.id] = run
        self._events.setdefault(run.id, [])

    def get(self, run_id: str) -> Run | None:
        return self._runs.get(run_id)

    def runs_in_thread(self, thread_id: str) -> list[Run]:
        """한 스레드의 실행들 — 시작한 순서(created_at)대로, 말들이 차례로 묶인다."""
        return sorted(
            (run for run in self._runs.values() if run.thread_id == thread_id),
            key=lambda run: (run.created_at, run.id),
        )

    def threads_of_spec(self, spec_id: str) -> list[ThreadRuns]:
        """한 그래프에서 오간 대화들 — 최근에 말이 오간 대화부터."""
        return threads_from(
            [run for run in self._runs.values() if run.spec_id == spec_id]
        )

    def delete_thread(self, thread_id: str) -> None:
        """한 대화에 묶인 실행들과 그 이벤트를 통째로 거둔다."""
        with self._writing:
            for run in self.runs_in_thread(thread_id):
                self._runs.pop(run.id, None)
                self._events.pop(run.id, None)

    def append(self, run_id: str, events: Sequence[RunEvent]) -> None:
        with self._writing:
            written = self._events.setdefault(run_id, [])
            taken = {event.seq for event in written}
            for event in events:
                if event.seq in taken:
                    raise SeqAlreadyStored(
                        f"{run_id!r} already has an event {event.seq}"
                    )
                taken.add(event.seq)
            written.extend(events)

    def events(self, run_id: str, after: int | None = None) -> list[RunEvent]:
        written = sorted(self._events.get(run_id, []), key=lambda event: event.seq)
        if after is None:
            return written
        return [event for event in written if event.seq > after]

    def last_event(self, run_id: str) -> RunEvent | None:
        written = self._events.get(run_id)
        if not written:
            return None
        return max(written, key=lambda event: event.seq)


__all__ = ["InMemoryRunStore"]
