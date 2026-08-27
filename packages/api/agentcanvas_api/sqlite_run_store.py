"""파일 하나에 실행을 쌓아 두는 저장소 (SQLite).

SQL은 이 파일에만 있다. 표는 덧붙이기만 한다 — 일어난 일을 고쳐 쓰는 문장은 여기에 없다.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from agentcanvas_contracts.run import Run
from agentcanvas_contracts.run_events import RunEvent

from .run_store import SeqAlreadyStored
from .sqlite_database import BUSY_WAIT_SECONDS, PreparedDatabase


class SqliteRunStore:
    def __init__(self, path: Path | str, *, database_is_prepared: bool = False) -> None:
        self._database = PreparedDatabase(path, already_prepared=database_is_prepared)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        """한 번 열고 반드시 닫는다 — 스트림은 쉼 없이 되묻는 자리라 연결이 쌓이면 안 된다.

        자리가 차 있으면 잠시 기다린다: 겹치는 순간은 흔하고, 그때 포기하면 사건이 사라진다.
        """
        self._database.ensure()
        connection = sqlite3.connect(self._database.path, timeout=BUSY_WAIT_SECONDS)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def start(self, run: Run) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO runs (run_id, spec_id, spec_revision, created_at)"
                " VALUES (?, ?, ?, ?)",
                (run.id, run.spec_id, run.spec_revision, run.created_at.isoformat()),
            )

    def get(self, run_id: str) -> Run | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT run_id, spec_id, spec_revision, created_at FROM runs"
                " WHERE run_id = ?",
                (run_id,),
            ).fetchone()
        if row is None:
            return None
        return Run(
            id=row["run_id"],
            spec_id=row["spec_id"],
            spec_revision=row["spec_revision"],
            created_at=datetime.fromisoformat(row["created_at"]),
        )

    def append(self, run_id: str, events: Sequence[RunEvent]) -> None:
        try:
            with self._connect() as connection:
                connection.executemany(
                    "INSERT INTO run_events (run_id, seq, event_json) VALUES (?, ?, ?)",
                    [
                        (
                            run_id,
                            event.seq,
                            json.dumps(
                                event.model_dump(mode="json"), ensure_ascii=False
                            ),
                        )
                        for event in events
                    ],
                )
        except sqlite3.IntegrityError as clash:
            # 표가 막아 준 일을 저장소의 말로 옮긴다 — 부르는 쪽은 SQLite를 모른다.
            raise SeqAlreadyStored(
                f"{run_id!r} already has one of those events"
            ) from clash

    def events(self, run_id: str, after: int | None = None) -> list[RunEvent]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT event_json FROM run_events"
                " WHERE run_id = ? AND seq > ? ORDER BY seq",
                (run_id, -1 if after is None else after),
            ).fetchall()
        return [RunEvent.model_validate(json.loads(row["event_json"])) for row in rows]

    def last_event(self, run_id: str) -> RunEvent | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT event_json FROM run_events"
                " WHERE run_id = ? ORDER BY seq DESC LIMIT 1",
                (run_id,),
            ).fetchone()
        if row is None:
            return None
        return RunEvent.model_validate(json.loads(row["event_json"]))


__all__ = ["SqliteRunStore"]
