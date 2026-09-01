"""한 문서의 실행들을 최근 순으로 읽는 길을 내는 v6 마이그레이션.

칸도 표도 늘지 않는다 — 지난 대화 목록은 이미 쌓인 실행에서 파생되므로, 새로 필요한 것은
읽는 길(runs_spec_idx) 하나뿐이다. 틀(멱등·백업·검증)은 P0c 그대로 재사용한다.
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


def _build_v5_database(path: Path) -> None:
    """읽는 길이 나기 전 파일 하나 — 마이그레이션을 v5까지 그대로 밟아 지은 진짜 v5."""
    with closing(sqlite3.connect(path)) as connection:
        for version in (1, 2, 3, 4, 5):
            _MIGRATIONS[version](connection, STORED_AT)
        connection.execute(
            "INSERT INTO runs"
            " (run_id, spec_id, spec_revision, created_at, thread_id, end_user_ref)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            ("run_old", "clinical-assistant", REVISION, STORED_AT, "chat_7", None),
        )
        connection.commit()


def _indexes(connection: sqlite3.Connection) -> set[str]:
    return {
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index'"
        )
    }


def _indexed_columns(connection: sqlite3.Connection, index: str) -> list[str]:
    return [str(row[2]) for row in connection.execute(f"PRAGMA index_info({index})")]


def test_v6_adds_the_way_into_a_specs_runs_and_leaves_the_runs_as_they_were(
    tmp_path: Path,
):
    database = tmp_path / "agentcanvas.db"
    _build_v5_database(database)

    result = prepare_database(database, backup_dir=tmp_path / "backups")

    assert result.previous_version == 5
    assert result.current_version == 6
    assert result.migrated is True
    assert result.backup_path is not None
    with sqlite3.connect(database) as connection:
        assert "runs_spec_idx" in _indexes(connection)
        assert _indexed_columns(connection, "runs_spec_idx") == [
            "spec_id",
            "created_at",
        ]
        # 읽는 길만 났다 — 쌓여 있던 실행은 한 글자도 달라지지 않는다.
        assert connection.execute(
            "SELECT run_id, spec_id, thread_id, created_at FROM runs"
        ).fetchall() == [("run_old", "clinical-assistant", "chat_7", STORED_AT)]


def test_v6_migration_is_applied_exactly_once(tmp_path: Path):
    database = tmp_path / "agentcanvas.db"
    _build_v5_database(database)

    first = prepare_database(database, backup_dir=tmp_path / "backups")
    second = prepare_database(database, backup_dir=tmp_path / "backups")

    assert first.migrated is True
    assert second.migrated is False
    assert second.backup_path is None
    with sqlite3.connect(database) as connection:
        assert verify_database_schema(connection) == CURRENT_SCHEMA_VERSION


def test_a_fresh_database_arrives_at_v6_with_the_way_into_a_specs_runs(tmp_path: Path):
    database = tmp_path / "agentcanvas.db"

    result = prepare_database(database, backup_dir=tmp_path / "backups")

    assert result.current_version == 6
    with sqlite3.connect(database) as connection:
        assert "runs_spec_idx" in _indexes(connection)
        assert verify_database_schema(connection) == 6


def test_v6_adds_no_table_and_no_column(tmp_path: Path):
    """파생 요약은 저장되지 않는다 — v6가 더하는 것은 읽는 길 하나뿐이다."""
    before = tmp_path / "before.db"
    _build_v5_database(before)
    with closing(sqlite3.connect(before)) as connection:
        was = {
            str(row[0]): [
                str(info[1])
                for info in connection.execute(f"PRAGMA table_info({row[0]})")
            ]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
                " AND name NOT LIKE 'sqlite_%'"
            )
        }

    prepare_database(before, backup_dir=tmp_path / "backups")

    with closing(sqlite3.connect(before)) as connection:
        now = {
            str(row[0]): [
                str(info[1])
                for info in connection.execute(f"PRAGMA table_info({row[0]})")
            ]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
                " AND name NOT LIKE 'sqlite_%'"
            )
        }
    assert now == was
