"""runs에 스레드(thread_id)와 말한 이(end_user_ref) 두 칸을 더하는 v4 마이그레이션.

게시 전 실행에는 애초에 대화가 없었다 — 과거 run은 저마다 홀로 선 스레드였던 것이
사실이므로, 마이그레이션은 기존 행의 thread_id를 run_id로 채운다. 표를 새로 짓지
않고 두 칸만 더한다(P0c 틀 재사용).
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from agentcanvas_api.sqlite_database import (
    _SCHEMA_V1,
    _SCHEMA_V2_DURABLE_JOBS_SQL,
    _SCHEMA_V2_INDEX_SQL,
    CURRENT_SCHEMA_VERSION,
    prepare_database,
    verify_database_schema,
)

STORED_AT = "2026-08-01T00:00:00+00:00"
REVISION = "sha256:" + "1" * 64


def _build_v3_database(path: Path) -> None:
    """스레드 두 칸이 생기기 전 파일 하나 — v3 그대로의 runs(네 칸)를 가진다."""
    with closing(sqlite3.connect(path)) as connection:
        for statement in _SCHEMA_V1:
            connection.execute(statement)
        connection.execute(
            "CREATE TABLE schema_migrations"
            " (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        connection.execute(_SCHEMA_V2_DURABLE_JOBS_SQL)
        for statement in _SCHEMA_V2_INDEX_SQL.values():
            connection.execute(statement)
        connection.executemany(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            [(version, STORED_AT) for version in (1, 2, 3)],
        )
        connection.executemany(
            "INSERT INTO runs (run_id, spec_id, spec_revision, created_at)"
            " VALUES (?, ?, ?, ?)",
            [
                ("run_old_a", "clinical-assistant", REVISION, STORED_AT),
                ("run_old_b", "clinical-assistant", REVISION, STORED_AT),
            ],
        )
        connection.commit()


def _runs_columns(connection: sqlite3.Connection) -> set[str]:
    return {str(row[1]) for row in connection.execute("PRAGMA table_info(runs)")}


def test_v4_adds_two_columns_and_gives_old_runs_their_own_thread(tmp_path: Path):
    database = tmp_path / "agentcanvas.db"
    _build_v3_database(database)

    result = prepare_database(database, backup_dir=tmp_path / "backups")

    assert result.previous_version == 3
    assert result.current_version == CURRENT_SCHEMA_VERSION
    assert result.migrated is True
    assert result.backup_path is not None
    with sqlite3.connect(database) as connection:
        assert {"thread_id", "end_user_ref"} <= _runs_columns(connection)
        assert connection.execute(
            "SELECT run_id, thread_id, end_user_ref FROM runs ORDER BY run_id"
        ).fetchall() == [
            ("run_old_a", "run_old_a", None),
            ("run_old_b", "run_old_b", None),
        ]


def test_v4_migration_is_applied_exactly_once(tmp_path: Path):
    database = tmp_path / "agentcanvas.db"
    _build_v3_database(database)

    first = prepare_database(database, backup_dir=tmp_path / "backups")
    second = prepare_database(database, backup_dir=tmp_path / "backups")

    assert first.migrated is True
    assert second.migrated is False
    assert second.backup_path is None
    with sqlite3.connect(database) as connection:
        assert verify_database_schema(connection) == CURRENT_SCHEMA_VERSION


def test_a_fresh_database_arrives_at_v4_with_the_thread_columns(tmp_path: Path):
    database = tmp_path / "agentcanvas.db"

    result = prepare_database(database, backup_dir=tmp_path / "backups")

    assert result.current_version == CURRENT_SCHEMA_VERSION
    with sqlite3.connect(database) as connection:
        assert {"thread_id", "end_user_ref"} <= _runs_columns(connection)
        assert verify_database_schema(connection) == CURRENT_SCHEMA_VERSION
