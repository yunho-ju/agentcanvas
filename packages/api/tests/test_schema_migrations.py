from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from agentcanvas_api import sqlite_database
from agentcanvas_api.sqlite_database import (
    CURRENT_SCHEMA_VERSION,
    DatabasePreparationError,
    prepare_database,
    verify_database_backup,
    verify_database_schema,
)

_LEGACY_SPEC_SCHEMA = """
CREATE TABLE spec_revisions (
    spec_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    revision TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (spec_id, version)
)
"""


def _legacy_database(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.execute(_LEGACY_SPEC_SCHEMA)
        connection.execute(
            "INSERT INTO spec_revisions"
            " (spec_id, version, revision, spec_json, created_at)"
            " VALUES ('legacy', 1, 'revision-1', '{}', '2026-08-26T00:00:00+00:00')"
        )


def _tables(path: Path) -> set[str]:
    with sqlite3.connect(path) as connection:
        return {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
                " AND name NOT LIKE 'sqlite_%'"
            )
        }


def test_an_open_database_reports_its_verified_schema_version(tmp_path: Path):
    database = tmp_path / "current.db"
    prepare_database(database)

    with sqlite3.connect(database) as connection:
        assert verify_database_schema(connection) == CURRENT_SCHEMA_VERSION


def test_an_open_legacy_database_reports_version_zero(tmp_path: Path):
    database = tmp_path / "legacy.db"
    _legacy_database(database)

    with sqlite3.connect(database) as connection:
        assert verify_database_schema(connection) == 0


def test_an_open_database_from_a_newer_version_is_not_guessed_at(tmp_path: Path):
    database = tmp_path / "future-open.db"
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TABLE schema_migrations ("
            "version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        connection.executemany(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            [
                (1, "2026-08-26T00:00:00+00:00"),
                (2, "2026-08-26T00:01:00+00:00"),
                (3, "2026-08-26T00:02:00+00:00"),
            ],
        )

    with (
        sqlite3.connect(database) as connection,
        pytest.raises(DatabasePreparationError, match="newer AgentCanvas"),
    ):
        verify_database_schema(connection)


def test_an_open_database_with_a_malformed_table_is_rejected(tmp_path: Path):
    database = tmp_path / "malformed-open.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE spec_revisions (wrong TEXT)")

    with (
        sqlite3.connect(database) as connection,
        pytest.raises(DatabasePreparationError, match="unsupported shape"),
    ):
        verify_database_schema(connection)


def test_a_legacy_database_is_backed_up_and_migrated_exactly_once(
    tmp_path: Path,
):
    database = tmp_path / "agentcanvas.db"
    backups = tmp_path / "safe-backups"
    _legacy_database(database)

    first = prepare_database(database, backup_dir=backups)
    second = prepare_database(database, backup_dir=backups)

    assert first.previous_version == 0
    assert first.current_version == CURRENT_SCHEMA_VERSION
    assert first.migrated is True
    assert first.backup_path is not None
    assert verify_database_backup(first.backup_path).schema_version == 0
    assert second.migrated is False
    assert second.backup_path is None
    assert len(list(backups.glob("*.backup.sqlite3"))) == 1
    assert first.backup_path.stat().st_mode & 0o777 == 0o600
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA journal_mode").fetchone() == ("wal",)
    assert _tables(database) == {
        "schema_migrations",
        "spec_revisions",
        "runs",
        "run_events",
        "eval_datasets",
        "eval_batches",
        "durable_jobs",
    }
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT version FROM schema_migrations"
        ).fetchall() == [(version,) for version in range(1, CURRENT_SCHEMA_VERSION + 1)]
        assert connection.execute("SELECT spec_id FROM spec_revisions").fetchall() == [
            ("legacy",)
        ]


def test_a_new_empty_database_does_not_create_a_pointless_backup(tmp_path: Path):
    database = tmp_path / "new.db"
    backups = tmp_path / "backups"

    result = prepare_database(database, backup_dir=backups)

    assert result.migrated is True
    assert result.backup_path is None
    assert not backups.exists()


def test_a_failed_migration_rolls_back_schema_and_preserves_the_backup(
    tmp_path: Path,
):
    database = tmp_path / "agentcanvas.db"
    backups = tmp_path / "backups"
    _legacy_database(database)

    def fail_after_a_change(connection: sqlite3.Connection, applied_at: str) -> None:
        del applied_at
        connection.execute("CREATE TABLE should_be_rolled_back (id INTEGER)")
        raise RuntimeError("injected migration failure")

    with pytest.raises(RuntimeError, match="injected migration failure"):
        prepare_database(
            database,
            backup_dir=backups,
            migrations={1: fail_after_a_change},
        )

    assert _tables(database) == {"spec_revisions"}
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT spec_id FROM spec_revisions").fetchall() == [
            ("legacy",)
        ]
    backup = next(backups.glob("*.backup.sqlite3"))
    assert verify_database_backup(backup).schema_version == 0


def test_a_database_from_a_newer_version_is_not_guessed_at(tmp_path: Path):
    database = tmp_path / "future.db"
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TABLE schema_migrations ("
            "version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
        )
        connection.executemany(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
            [
                (1, "2026-08-26T00:00:00+00:00"),
                (2, "2026-08-26T00:01:00+00:00"),
                (3, "2026-08-26T00:02:00+00:00"),
            ],
        )

    with pytest.raises(DatabasePreparationError, match="newer AgentCanvas"):
        prepare_database(database, backup_dir=tmp_path / "backups")


def test_a_malformed_legacy_table_is_not_approved_as_a_backup(tmp_path: Path):
    database = tmp_path / "malformed-v0.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE spec_revisions (wrong TEXT)")

    with pytest.raises(DatabasePreparationError, match="unsupported shape"):
        verify_database_backup(database)
    with pytest.raises(DatabasePreparationError, match="unsupported shape"):
        prepare_database(database, backup_dir=tmp_path / "backups")


def test_version_one_requires_the_real_primary_keys_and_not_null_constraints(
    tmp_path: Path,
):
    database = tmp_path / "malformed-v1.db"
    with sqlite3.connect(database) as connection:
        connection.executescript(
            """
            CREATE TABLE schema_migrations (version INTEGER, applied_at TEXT);
            INSERT INTO schema_migrations VALUES (1, 'now');
            CREATE TABLE spec_revisions (
                spec_id TEXT, version INTEGER, revision TEXT,
                spec_json TEXT, created_at TEXT
            );
            CREATE TABLE runs (
                run_id TEXT, spec_id TEXT, spec_revision TEXT, created_at TEXT
            );
            CREATE TABLE run_events (run_id TEXT, seq INTEGER, event_json TEXT);
            CREATE TABLE eval_datasets (dataset_id TEXT, dataset_json TEXT);
            CREATE TABLE eval_batches (
                batch_id TEXT, dataset_id TEXT, batch_json TEXT
            );
            """
        )

    with pytest.raises(DatabasePreparationError, match="unsupported shape"):
        prepare_database(database, backup_dir=tmp_path / "backups")


def test_concurrent_prepare_calls_apply_the_migration_once(tmp_path: Path):
    database = tmp_path / "concurrent.db"

    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(lambda _: prepare_database(database), range(4)))

    assert sum(result.migrated for result in results) == 1
    assert _tables(database) == {
        "schema_migrations",
        "spec_revisions",
        "runs",
        "run_events",
        "eval_datasets",
        "eval_batches",
        "durable_jobs",
    }


def test_a_write_after_backup_is_detected_before_migration(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    database = tmp_path / "changing.db"
    backups = tmp_path / "backups"
    _legacy_database(database)
    create_backup = sqlite_database._create_backup

    def backup_then_write(*args, **kwargs):
        backup = create_backup(*args, **kwargs)
        with sqlite3.connect(database) as writer:
            writer.execute(
                "UPDATE spec_revisions SET revision = 'changed' WHERE spec_id = 'legacy'"
            )
        return backup

    monkeypatch.setattr(sqlite_database, "_create_backup", backup_then_write)

    with pytest.raises(DatabasePreparationError, match="changed while"):
        prepare_database(database, backup_dir=backups)

    assert _tables(database) == {"spec_revisions"}
    assert (
        verify_database_backup(next(backups.glob("*.backup.sqlite3"))).schema_version
        == 0
    )


def test_stale_partial_backups_are_removed_before_the_next_snapshot(tmp_path: Path):
    database = tmp_path / "agentcanvas.db"
    backups = tmp_path / "backups"
    backups.mkdir()
    stale = backups / "agentcanvas.db.v0-to-v1.old.backup.sqlite3.partial"
    stale.write_bytes(b"incomplete")
    _legacy_database(database)

    result = prepare_database(database, backup_dir=backups)

    assert result.backup_path is not None
    assert not stale.exists()


def test_version_two_requires_autoincrement_job_ordering(tmp_path: Path):
    database = tmp_path / "malformed-v2-ordering.db"
    prepare_database(database)
    malformed = sqlite_database._SCHEMA_V2_DURABLE_JOBS_SQL.replace(
        " AUTOINCREMENT",
        "",
    )
    with sqlite3.connect(database) as connection:
        connection.executescript(
            """
            DROP INDEX durable_jobs_idempotency_idx;
            DROP INDEX durable_jobs_claim_idx;
            DROP INDEX durable_jobs_reference_idx;
            ALTER TABLE durable_jobs RENAME TO durable_jobs_old;
            """
        )
        connection.execute(malformed)
        connection.execute("DROP TABLE durable_jobs_old")
        connection.execute(
            "CREATE UNIQUE INDEX durable_jobs_idempotency_idx"
            " ON durable_jobs (idempotency_key)"
        )
        connection.execute(
            "CREATE INDEX durable_jobs_claim_idx"
            " ON durable_jobs (status, lease_expires_at, created_at)"
        )
        connection.execute(
            "CREATE INDEX durable_jobs_reference_idx"
            " ON durable_jobs (kind, reference_id, enqueue_seq)"
        )

    with pytest.raises(DatabasePreparationError, match="constraints are unsupported"):
        prepare_database(database)


def test_version_two_rejects_a_partial_idempotency_index(tmp_path: Path):
    database = tmp_path / "malformed-v2-index.db"
    prepare_database(database)
    with sqlite3.connect(database) as connection:
        connection.execute("DROP INDEX durable_jobs_idempotency_idx")
        connection.execute(
            "CREATE UNIQUE INDEX durable_jobs_idempotency_idx"
            " ON durable_jobs (idempotency_key) WHERE kind = 'run'"
        )

    with pytest.raises(
        DatabasePreparationError, match="index has an unsupported shape"
    ):
        prepare_database(database)


def test_version_two_rejects_case_insensitive_idempotency_index(tmp_path: Path):
    database = tmp_path / "malformed-v2-collation.db"
    prepare_database(database)
    with sqlite3.connect(database) as connection:
        connection.execute("DROP INDEX durable_jobs_idempotency_idx")
        connection.execute(
            "CREATE UNIQUE INDEX durable_jobs_idempotency_idx"
            " ON durable_jobs (idempotency_key COLLATE NOCASE)"
        )

    with pytest.raises(
        DatabasePreparationError, match="index has an unsupported shape"
    ):
        prepare_database(database)
