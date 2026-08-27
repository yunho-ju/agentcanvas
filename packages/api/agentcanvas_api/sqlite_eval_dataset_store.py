"""파일 하나에 데이터셋을 쌓아 두는 저장소 (SQLite).

SQL은 이 파일에만 있다. 저장은 upsert다 — 이력 없이 있는 것을 그대로 덮어쓴다.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from agentcanvas_contracts.eval_case import EvalDataset

from .eval_dataset_store import EvalDatasetSummary
from .sqlite_database import PreparedDatabase


class SqliteEvalDatasetStore:
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

    def save(self, dataset: EvalDataset) -> EvalDataset:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO eval_datasets (dataset_id, dataset_json)"
                " VALUES (?, ?)"
                " ON CONFLICT(dataset_id) DO UPDATE SET"
                " dataset_json = excluded.dataset_json",
                (
                    dataset.id,
                    json.dumps(dataset.model_dump(mode="json"), ensure_ascii=False),
                ),
            )
        return dataset

    def get(self, dataset_id: str) -> EvalDataset | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT dataset_json FROM eval_datasets WHERE dataset_id = ?",
                (dataset_id,),
            ).fetchone()
        if row is None:
            return None
        return EvalDataset.model_validate(json.loads(row["dataset_json"]))

    def list_summaries(self) -> list[EvalDatasetSummary]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT dataset_json FROM eval_datasets ORDER BY rowid"
            ).fetchall()
        return [
            EvalDatasetSummary.of(
                EvalDataset.model_validate(json.loads(row["dataset_json"]))
            )
            for row in rows
        ]

    def delete(self, dataset_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM eval_datasets WHERE dataset_id = ?", (dataset_id,)
            )
        return cursor.rowcount > 0


__all__ = ["SqliteEvalDatasetStore"]
