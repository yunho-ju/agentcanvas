"""실행을 어떻게 되찾는가 — 실행 저장소가 지키는 약속(프로토콜).

저장소는 저장만 안다. 어떤 이벤트가 나오는지는 엔진이, 언제 이어 붙일지는 서비스가 정한다.
실행이 남긴 이벤트는 덧붙이기만 한다 — 일어난 일은 고쳐 쓰지 않는다.
"""

from __future__ import annotations

from collections.abc import Sequence
from itertools import groupby
from typing import Protocol

from agentcanvas_contracts.run import Run
from agentcanvas_contracts.run_events import RunEvent

#: 한 대화에 묶인 실행들 — 말한 순서대로 선다. 스레드는 이 끈일 뿐 따로 저장하지 않는다.
ThreadRuns = list[Run]


class SeqAlreadyStored(Exception):
    """이미 적힌 순번을 다시 적으려 했다 — 일어난 일은 고쳐 쓰지 않는다."""


def threads_from(runs: Sequence[Run]) -> list[ThreadRuns]:
    """실행들을 대화별로 묶는다 — 최근에 말이 오간 대화가 앞에 선다.

    두 저장소가 같은 답을 내도록 묶는 규칙은 여기 한 곳에만 둔다. 대화는 파생 개념이라
    묶는 일도 읽을 때마다 다시 한다 (묶어 둔 것을 적어 두지 않는다).
    """
    in_order = sorted(runs, key=lambda run: (run.thread_id, run.created_at, run.id))
    threads = [
        list(turns) for _, turns in groupby(in_order, key=lambda run: run.thread_id)
    ]
    threads.sort(
        key=lambda thread: (thread[-1].created_at, thread[-1].id), reverse=True
    )
    return threads


class RunStore(Protocol):
    """실행과 그 이벤트를 쌓아 두는 자리."""

    def start(self, run: Run) -> None:
        """실행 하나를 연다 — 이 실행이 어느 그래프의 어느 판인지 적어 둔다."""
        ...

    def get(self, run_id: str) -> Run | None:
        """그 이름의 실행. 시작된 적이 없으면 없다."""
        ...

    def runs_in_thread(self, thread_id: str) -> list[Run]:
        """한 스레드에 묶인 실행들 — 시작한 순서(created_at)대로. 빈 스레드는 빈 목록."""
        ...

    def threads_of_spec(self, spec_id: str) -> list[ThreadRuns]:
        """한 그래프에서 오간 대화들 — 최근에 말이 오간 대화부터, 안에서는 말한 순서대로.

        아무도 돌린 적 없는 그래프는 빈 목록이다 (대화는 만들어 두는 것이 아니다).
        """
        ...

    def delete_thread(self, thread_id: str) -> None:
        """한 대화에 묶인 실행들과 그 이벤트를 통째로 거둔다. 빈 스레드를 지워도 탈은 없다.

        지우는 자리는 여기 하나다 — 남는 실행은 고쳐 쓰이지 않고, 지운 실행은 남지 않는다.
        """
        ...

    def append(self, run_id: str, events: Sequence[RunEvent]) -> None:
        """실행이 남긴 이벤트를 끝에 잇는다.

        한 실행의 순번은 하나뿐이다 — 이미 적힌 순번을 다시 적으면 `SeqAlreadyStored`를 낸다.
        """
        ...

    def events(self, run_id: str, after: int | None = None) -> list[RunEvent]:
        """그 실행이 남긴 이벤트 — 순번 순서대로. `after`를 주면 그 다음 것부터."""
        ...

    def last_event(self, run_id: str) -> RunEvent | None:
        """가장 나중에 적힌 이벤트 하나 — 상태는 이것만 보고도 안다 (전체를 꺼내지 않는다)."""
        ...


__all__ = ["RunStore", "SeqAlreadyStored", "ThreadRuns", "threads_from"]
