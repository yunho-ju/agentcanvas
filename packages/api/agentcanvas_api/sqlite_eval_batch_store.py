"""파일 하나에 배치를 쌓아 두는 저장소 (SQLite).

SQL은 이 파일에만 있다. 표는 덧붙이기만 한다 — 완결된 배치를 고쳐 쓰는 문장은 여기에 없다.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from agentcanvas_contracts.eval_result import EvalBatch

from .sqlite_database import PreparedDatabase


class SqliteEvalBatchStore:
    def __init__(self, path: Path | str, *, database_is_prepared: bool = False) -> None:
        self._database = PreparedDatabase(path, already_prepared=database_is_prepared)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self._database.ensure()
        connection = sqlite3.connect(self._database.path)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def save(self, batch: EvalBatch) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO eval_batches (batch_id, dataset_id, batch_json)"
                " VALUES (?, ?, ?)",
                (
                    batch.id,
                    batch.dataset_id,
                    json.dumps(batch.model_dump(mode="json"), ensure_ascii=False),
                ),
            )

    def get(self, batch_id: str) -> EvalBatch | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT batch_json FROM eval_batches WHERE batch_id = ?",
                (batch_id,),
            ).fetchone()
        if row is None:
            return None
        return EvalBatch.model_validate(json.loads(row["batch_json"]))

    def list_for_dataset(
        self, dataset_id: str, limit: int | None = None
    ) -> list[EvalBatch]:
        query = (
            "SELECT batch_json FROM eval_batches WHERE dataset_id = ? ORDER BY rowid"
        )
        params: tuple[object, ...] = (dataset_id,)
        if limit is not None:
            query += " LIMIT ?"
            params = (dataset_id, limit)
        with self._connect() as connection:
            rows = connection.execute(query, params).fetchall()
        return [EvalBatch.model_validate(json.loads(row["batch_json"])) for row in rows]

    def latest_for_spec(self, spec_id: str) -> EvalBatch | None:
        # spec_id는 batch_json 안에 있다 — 최근부터 훑어 이 spec의 첫 배치를 돌려준다(읽기 전용).
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT batch_json FROM eval_batches ORDER BY rowid DESC"
            ).fetchall()
        for row in rows:
            batch = EvalBatch.model_validate(json.loads(row["batch_json"]))
            if batch.spec_id == spec_id:
                return batch
        return None


__all__ = ["SqliteEvalBatchStore"]
