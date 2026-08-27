"""파일 하나에 판을 쌓아 두는 저장소 (SQLite).

SQL은 이 파일에만 있다. 표는 덧붙이기만 한다 — 지나간 판을 고쳐 쓰는 문장은 여기에 없다.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from agentcanvas_contracts.agent_spec import AgentSpec

from .sqlite_database import PreparedDatabase
from .store import (
    RevisionChanged,
    SpecRevision,
    SpecSummary,
    StoredSpec,
    VersionAlreadyStored,
)


class SqliteSpecStore:
    def __init__(self, path: Path | str, *, database_is_prepared: bool = False) -> None:
        self._database = PreparedDatabase(path, already_prepared=database_is_prepared)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        """한 번 열고 반드시 닫는다 — 열어 둔 채로 두면 연결이 쌓인다."""
        self._database.ensure()
        connection = sqlite3.connect(self._database.path)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def append(self, spec: AgentSpec, created_at: datetime) -> StoredSpec:
        try:
            self._insert(spec, created_at)
        except sqlite3.IntegrityError as clash:
            # 표가 막아 준 일을 저장소의 말로 옮긴다 — 부르는 쪽은 SQLite를 모른다.
            raise VersionAlreadyStored(
                f"{spec.id!r} already has a version {spec.version}"
            ) from clash
        return StoredSpec(spec=spec, created_at=created_at)

    def append_if_revision(
        self, spec: AgentSpec, expected_revision: str, created_at: datetime
    ) -> StoredSpec:
        """최신 판 확인과 insert를 같은 SQLite write transaction으로 묶는다."""
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT revision FROM spec_revisions"
                    " WHERE spec_id = ? ORDER BY version DESC LIMIT 1",
                    (spec.id,),
                ).fetchone()
                if row is None or row["revision"] != expected_revision:
                    raise RevisionChanged(
                        f"{spec.id!r} is no longer at revision {expected_revision!r}"
                    )
                connection.execute(
                    "INSERT INTO spec_revisions"
                    " (spec_id, version, revision, spec_json, created_at)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (
                        spec.id,
                        spec.version,
                        spec.revision,
                        json.dumps(spec.model_dump(mode="json"), ensure_ascii=False),
                        created_at.isoformat(),
                    ),
                )
        except sqlite3.IntegrityError as clash:
            raise VersionAlreadyStored(
                f"{spec.id!r} already has a version {spec.version}"
            ) from clash
        return StoredSpec(spec=spec, created_at=created_at)

    def _insert(self, spec: AgentSpec, created_at: datetime) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO spec_revisions"
                " (spec_id, version, revision, spec_json, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (
                    spec.id,
                    spec.version,
                    spec.revision,
                    json.dumps(spec.model_dump(mode="json"), ensure_ascii=False),
                    created_at.isoformat(),
                ),
            )

    def latest(self, spec_id: str) -> StoredSpec | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT spec_json, created_at FROM spec_revisions"
                " WHERE spec_id = ? ORDER BY version DESC LIMIT 1",
                (spec_id,),
            ).fetchone()
        if row is None:
            return None
        return self._stored(row)

    def by_revision(self, spec_id: str, revision: str) -> StoredSpec | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT spec_json, created_at FROM spec_revisions"
                " WHERE spec_id = ? AND revision = ?",
                (spec_id, revision),
            ).fetchone()
        if row is None:
            return None
        return self._stored(row)

    def summaries(self, limit: int) -> list[SpecSummary]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT spec_json, created_at FROM spec_revisions"
                " WHERE (spec_id, version) IN"
                " (SELECT spec_id, MAX(version) FROM spec_revisions GROUP BY spec_id)"
                " ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [SpecSummary.of(self._stored(row)) for row in rows]

    def _stored(self, row: sqlite3.Row) -> StoredSpec:
        return StoredSpec(
            spec=AgentSpec.model_validate(json.loads(row["spec_json"])),
            created_at=datetime.fromisoformat(row["created_at"]),
        )

    def revisions(self, spec_id: str) -> list[SpecRevision]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT version, revision, created_at FROM spec_revisions"
                " WHERE spec_id = ? ORDER BY version DESC",
                (spec_id,),
            ).fetchall()
        return [
            SpecRevision(
                version=row["version"],
                revision=row["revision"],
                created_at=datetime.fromisoformat(row["created_at"]),
            )
            for row in rows
        ]


__all__ = ["SqliteSpecStore"]
