"""문서가 게시한 판을 가리키는 자리(spec_publications)를 더하는 v5 마이그레이션.

게시 개념 이전 문서엔 게시된 판이 없는 게 사실이므로 backfill하지 않는다 — 빈 표만
새로 생긴다. 표를 새로 짓되 틀(멱등·백업·검증)은 P0c 그대로 재사용한다.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from agentcanvas_api.sqlite_database import (
    _MIGRATIONS,
    CURRENT_SCHEMA_VERSION,
    prepare_database,
    verify_database_schema,
)

STORED_AT = "2026-08-01T00:00:00+00:00"
REVISION = "sha256:" + "1" * 64


def _build_v4_database(path: Path) -> None:
    """게시 자리가 생기기 전 파일 하나 — 마이그레이션을 v4까지 그대로 밟아 지은 진짜 v4."""
    with closing(sqlite3.connect(path)) as connection:
        for version in (1, 2, 3, 4):
            _MIGRATIONS[version](connection, STORED_AT)
        connection.execute(
            "INSERT INTO runs"
            " (run_id, spec_id, spec_revision, created_at, thread_id, end_user_ref)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            ("run_old", "clinical-assistant", REVISION, STORED_AT, "run_old", None),
        )
        connection.commit()


def _tables(connection: sqlite3.Connection) -> set[str]:
    return {
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
            " AND name NOT LIKE 'sqlite_%'"
        )
    }


def test_v5_adds_the_publications_table_and_backfills_nothing(tmp_path: Path):
    database = tmp_path / "agentcanvas.db"
    _build_v4_database(database)

    result = prepare_database(database, backup_dir=tmp_path / "backups")

    assert result.previous_version == 4
    assert result.current_version == 5
    assert result.migrated is True
    assert result.backup_path is not None
    with sqlite3.connect(database) as connection:
        assert "spec_publications" in _tables(connection)
        # 게시 이전 문서엔 게시된 판이 없다 — backfill하지 않는다.
        assert (
            connection.execute("SELECT COUNT(*) FROM spec_publications").fetchone()[0]
            == 0
        )


def test_v5_migration_is_applied_exactly_once(tmp_path: Path):
    database = tmp_path / "agentcanvas.db"
    _build_v4_database(database)

    first = prepare_database(database, backup_dir=tmp_path / "backups")
    second = prepare_database(database, backup_dir=tmp_path / "backups")

    assert first.migrated is True
    assert second.migrated is False
    assert second.backup_path is None
    with sqlite3.connect(database) as connection:
        assert verify_database_schema(connection) == CURRENT_SCHEMA_VERSION


def test_a_fresh_database_arrives_at_v5_with_the_publications_table(tmp_path: Path):
    database = tmp_path / "agentcanvas.db"

    result = prepare_database(database, backup_dir=tmp_path / "backups")

    assert result.current_version == 5
    with sqlite3.connect(database) as connection:
        assert "spec_publications" in _tables(connection)
        assert verify_database_schema(connection) == 5
