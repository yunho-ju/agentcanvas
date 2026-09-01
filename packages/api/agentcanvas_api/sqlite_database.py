"""AgentCanvas SQLite 파일의 schema, migration, backup을 한곳에서 소유한다."""

from __future__ import annotations

import fcntl
import json
import os
import sqlite3
import threading
from collections.abc import Callable, Iterator, Mapping
from contextlib import closing, contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from agentcanvas_contracts.agent_spec import AgentSpec

CURRENT_SCHEMA_VERSION = 6
BACKUP_DIR_ENV = "AGENTCANVAS_BACKUP_DIR"
BACKUP_RETENTION_ENV = "AGENTCANVAS_BACKUP_RETENTION"
DEFAULT_BACKUP_RETENTION = 10
BUSY_WAIT_SECONDS = 5.0

_METADATA_TABLE = "schema_migrations"
_APPLICATION_TABLES = {
    "spec_revisions",
    "runs",
    "run_events",
    "eval_datasets",
    "eval_batches",
    "durable_jobs",
    "spec_publications",
}
_KNOWN_TABLES = _APPLICATION_TABLES | {_METADATA_TABLE}
_SCHEMA_V1_CONTRACT: Mapping[str, tuple[tuple[str, str, int, int], ...]] = {
    "schema_migrations": (
        ("version", "INTEGER", 0, 1),
        ("applied_at", "TEXT", 1, 0),
    ),
    "spec_revisions": (
        ("spec_id", "TEXT", 1, 1),
        ("version", "INTEGER", 1, 2),
        ("revision", "TEXT", 1, 0),
        ("spec_json", "TEXT", 1, 0),
        ("created_at", "TEXT", 1, 0),
    ),
    "runs": (
        ("run_id", "TEXT", 0, 1),
        ("spec_id", "TEXT", 1, 0),
        ("spec_revision", "TEXT", 1, 0),
        ("created_at", "TEXT", 1, 0),
    ),
    "run_events": (
        ("run_id", "TEXT", 1, 1),
        ("seq", "INTEGER", 1, 2),
        ("event_json", "TEXT", 1, 0),
    ),
    "eval_datasets": (
        ("dataset_id", "TEXT", 0, 1),
        ("dataset_json", "TEXT", 1, 0),
    ),
    "eval_batches": (
        ("batch_id", "TEXT", 0, 1),
        ("dataset_id", "TEXT", 1, 0),
        ("batch_json", "TEXT", 1, 0),
    ),
}
_SCHEMA_V2_CONTRACT = {
    **_SCHEMA_V1_CONTRACT,
    "durable_jobs": (
        ("id", "TEXT", 1, 0),
        ("enqueue_seq", "INTEGER", 0, 1),
        ("kind", "TEXT", 1, 0),
        ("operation", "TEXT", 1, 0),
        ("status", "TEXT", 1, 0),
        ("attempt", "INTEGER", 1, 0),
        ("max_attempts", "INTEGER", 1, 0),
        ("idempotency_key", "TEXT", 1, 0),
        ("request_fingerprint", "TEXT", 1, 0),
        ("reference_id", "TEXT", 1, 0),
        ("payload_json", "TEXT", 1, 0),
        ("lease_owner", "TEXT", 0, 0),
        ("lease_expires_at", "TEXT", 0, 0),
        ("cancel_requested_at", "TEXT", 0, 0),
        ("terminal_reason", "TEXT", 0, 0),
        ("created_at", "TEXT", 1, 0),
        ("updated_at", "TEXT", 1, 0),
        ("terminal_at", "TEXT", 0, 0),
    ),
}
# v3은 표의 모양을 바꾸지 않는다 — 바뀐 것은 저장된 그래프의 canonical revision뿐이다.
# v4는 runs에 스레드(thread_id)와 말한 이(end_user_ref) 두 칸을 더한다 (ALTER로 붙이므로
# 둘 다 nullable — 기존 행은 마이그레이션이 thread_id=run_id로 채운다).
_SCHEMA_V4_CONTRACT = {
    **_SCHEMA_V2_CONTRACT,
    "runs": (
        ("run_id", "TEXT", 0, 1),
        ("spec_id", "TEXT", 1, 0),
        ("spec_revision", "TEXT", 1, 0),
        ("created_at", "TEXT", 1, 0),
        ("thread_id", "TEXT", 0, 0),
        ("end_user_ref", "TEXT", 0, 0),
    ),
}
# v5는 문서가 게시한 판을 가리키는 자리(spec_publications)를 새로 짓는다 — 문서당 한 줄
# (게시=upsert, 내리기=delete). 저장 이력(spec_revisions)은 그대로 append-only로 둔다.
_SCHEMA_V5_CONTRACT = {
    **_SCHEMA_V4_CONTRACT,
    "spec_publications": (
        ("spec_id", "TEXT", 0, 1),
        ("revision", "TEXT", 1, 0),
        ("published_at", "TEXT", 1, 0),
    ),
}
# v6은 표의 모양을 바꾸지 않는다 — 늘어난 것은 한 문서의 실행들을 읽는 길뿐이다.
_SCHEMA_CONTRACTS = {
    1: _SCHEMA_V1_CONTRACT,
    2: _SCHEMA_V2_CONTRACT,
    3: _SCHEMA_V2_CONTRACT,
    4: _SCHEMA_V4_CONTRACT,
    5: _SCHEMA_V5_CONTRACT,
    6: _SCHEMA_V5_CONTRACT,
}
_INDEX_CONTRACTS: Mapping[int, Mapping[str, tuple[int, tuple[str, ...]]]] = {
    1: {},
    2: {
        "durable_jobs_idempotency_idx": (1, ("idempotency_key",)),
        "durable_jobs_claim_idx": (0, ("status", "lease_expires_at", "created_at")),
        "durable_jobs_reference_idx": (
            0,
            ("kind", "reference_id", "enqueue_seq"),
        ),
    },
}
_INDEX_CONTRACTS = {**_INDEX_CONTRACTS, 3: _INDEX_CONTRACTS[2]}
# v4는 한 스레드의 실행들을 시작 순서대로 읽는 길을 낸다 (thread_id, created_at).
_INDEX_CONTRACTS = {
    **_INDEX_CONTRACTS,
    4: {**_INDEX_CONTRACTS[3], "runs_thread_idx": (0, ("thread_id", "created_at"))},
}
# v5는 새 인덱스를 더하지 않는다 — 게시 조회는 문서당 한 줄이라 PRIMARY KEY로 충분하다.
_INDEX_CONTRACTS = {**_INDEX_CONTRACTS, 5: _INDEX_CONTRACTS[4]}
# v6은 한 문서에서 오간 대화들을 최근 것부터 읽는 길을 낸다 (spec_id, created_at).
_INDEX_CONTRACTS = {
    **_INDEX_CONTRACTS,
    6: {**_INDEX_CONTRACTS[5], "runs_spec_idx": (0, ("spec_id", "created_at"))},
}

_SCHEMA_V1 = (
    """
CREATE TABLE IF NOT EXISTS spec_revisions (
    spec_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    revision TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (spec_id, version)
)
""",
    """
CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    spec_id TEXT NOT NULL,
    spec_revision TEXT NOT NULL,
    created_at TEXT NOT NULL
)
""",
    """
CREATE TABLE IF NOT EXISTS run_events (
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_json TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
)
""",
    """
CREATE TABLE IF NOT EXISTS eval_datasets (
    dataset_id TEXT PRIMARY KEY,
    dataset_json TEXT NOT NULL
)
""",
    """
CREATE TABLE IF NOT EXISTS eval_batches (
    batch_id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    batch_json TEXT NOT NULL
)
""",
)

Migration = Callable[[sqlite3.Connection, str], None]


class DatabasePreparationError(RuntimeError):
    """DB를 안전하게 이해하거나 준비할 수 없을 때 startup을 멈춘다."""


@dataclass(frozen=True)
class MigrationResult:
    previous_version: int
    current_version: int
    migrated: bool
    backup_path: Path | None


@dataclass(frozen=True)
class BackupVerification:
    path: Path
    schema_version: int
    size_bytes: int


def _migration_to_v1(connection: sqlite3.Connection, applied_at: str) -> None:
    for statement in _SCHEMA_V1:
        connection.execute(statement)
    connection.execute(
        "CREATE TABLE schema_migrations ("
        "version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
    )
    connection.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        (1, applied_at),
    )


_SCHEMA_V2_DURABLE_JOBS_SQL = """
CREATE TABLE durable_jobs (
    id TEXT NOT NULL UNIQUE,
    enqueue_seq INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('run', 'eval')),
    operation TEXT NOT NULL CHECK (operation IN ('start', 'resume', 'batch')),
    status TEXT NOT NULL CHECK (
        status IN ('queued', 'leased', 'succeeded', 'failed', 'cancelled')
    ),
    attempt INTEGER NOT NULL,
    max_attempts INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    lease_owner TEXT,
    lease_expires_at TEXT,
    cancel_requested_at TEXT,
    terminal_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    terminal_at TEXT
)
"""


_SCHEMA_V2_INDEX_SQL = {
    "durable_jobs_idempotency_idx": (
        "CREATE UNIQUE INDEX durable_jobs_idempotency_idx"
        " ON durable_jobs (idempotency_key)"
    ),
    "durable_jobs_claim_idx": (
        "CREATE INDEX durable_jobs_claim_idx"
        " ON durable_jobs (status, lease_expires_at, created_at)"
    ),
    "durable_jobs_reference_idx": (
        "CREATE INDEX durable_jobs_reference_idx"
        " ON durable_jobs (kind, reference_id, enqueue_seq)"
    ),
}


def _migration_to_v2(connection: sqlite3.Connection, applied_at: str) -> None:
    connection.execute(_SCHEMA_V2_DURABLE_JOBS_SQL)
    for statement in _SCHEMA_V2_INDEX_SQL.values():
        connection.execute(statement)
    connection.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        (2, applied_at),
    )


def _restamped_specs(connection: sqlite3.Connection) -> dict[str, str]:
    """저장된 그래프를 지금의 계약으로 다시 적는다 — 돌려주는 것은 옛 revision → 새 revision.

    계약에 자리가 하나 늘면 같은 그래프도 다른 revision을 낸다. 읽을 수 없는 줄은
    이 마이그레이션이 손대지 않는다 (저장소가 읽지 못하는 줄은 옮길 곳도 없다).
    """
    moved: dict[str, str] = {}
    rows = connection.execute(
        "SELECT spec_id, version, revision, spec_json FROM spec_revisions"
    ).fetchall()
    for spec_id, version, revision, spec_json in rows:
        try:
            spec = AgentSpec.model_validate(json.loads(spec_json))
        except (ValueError, TypeError):
            continue
        recomputed = spec.computed_revision()
        if recomputed == revision:
            continue
        moved[str(revision)] = recomputed
        restamped = spec.model_copy(update={"revision": recomputed})
        connection.execute(
            "UPDATE spec_revisions SET revision = ?, spec_json = ?"
            " WHERE spec_id = ? AND version = ?",
            (
                recomputed,
                json.dumps(restamped.model_dump(mode="json"), ensure_ascii=False),
                spec_id,
                version,
            ),
        )
    return moved


def _repoint_runs(connection: sqlite3.Connection, moved: Mapping[str, str]) -> None:
    """실행이 시작한 판을 같이 옮긴다 — 저장된 문자열끼리의 대조가 계속 맞아야 한다."""
    for old, new in moved.items():
        connection.execute(
            "UPDATE runs SET spec_revision = ? WHERE spec_revision = ?", (new, old)
        )


def _repoint_eval_batches(
    connection: sqlite3.Connection, moved: Mapping[str, str]
) -> None:
    """배치가 판정한 판도 같이 옮긴다 — 판정 결과 자체는 그대로 둔다."""
    rows = connection.execute(
        "SELECT batch_id, batch_json FROM eval_batches"
    ).fetchall()
    for batch_id, batch_json in rows:
        batch = json.loads(batch_json)
        new = moved.get(str(batch.get("spec_revision")))
        if new is None:
            continue
        connection.execute(
            "UPDATE eval_batches SET batch_json = ? WHERE batch_id = ?",
            (json.dumps({**batch, "spec_revision": new}, ensure_ascii=False), batch_id),
        )


def _migration_to_v3(connection: sqlite3.Connection, applied_at: str) -> None:
    moved = _restamped_specs(connection)
    _repoint_runs(connection, moved)
    _repoint_eval_batches(connection, moved)
    connection.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        (3, applied_at),
    )


_RUNS_THREAD_INDEX_SQL = "CREATE INDEX runs_thread_idx ON runs (thread_id, created_at)"
_RUNS_SPEC_INDEX_SQL = "CREATE INDEX runs_spec_idx ON runs (spec_id, created_at)"

#: 인덱스마다 정확한 SQL — 이름만 같고 모양이 다른 인덱스를 걸러낸다.
_CANONICAL_INDEX_SQL = {
    **_SCHEMA_V2_INDEX_SQL,
    "runs_thread_idx": _RUNS_THREAD_INDEX_SQL,
    "runs_spec_idx": _RUNS_SPEC_INDEX_SQL,
}


def _migration_to_v4(connection: sqlite3.Connection, applied_at: str) -> None:
    """runs에 스레드·말한 이 두 칸을 더한다 — 표를 새로 짓지 않고 칸만 붙인다.

    과거 run은 저마다 홀로 선 스레드였던 것이 사실이므로 thread_id를 run_id로 채운다.
    """
    connection.execute("ALTER TABLE runs ADD COLUMN thread_id TEXT")
    connection.execute("ALTER TABLE runs ADD COLUMN end_user_ref TEXT")
    connection.execute("UPDATE runs SET thread_id = run_id WHERE thread_id IS NULL")
    connection.execute(_RUNS_THREAD_INDEX_SQL)
    connection.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        (4, applied_at),
    )


_SCHEMA_V5_PUBLICATIONS_SQL = """
CREATE TABLE spec_publications (
    spec_id TEXT PRIMARY KEY,
    revision TEXT NOT NULL,
    published_at TEXT NOT NULL
)
"""


def _migration_to_v5(connection: sqlite3.Connection, applied_at: str) -> None:
    """문서가 게시한 판을 가리키는 자리를 새로 짓는다 — 문서당 한 줄.

    게시 개념 이전 문서엔 게시된 판이 없는 게 사실이므로 backfill하지 않는다(빈 표).
    """
    connection.execute(_SCHEMA_V5_PUBLICATIONS_SQL)
    connection.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        (5, applied_at),
    )


def _migration_to_v6(connection: sqlite3.Connection, applied_at: str) -> None:
    """한 문서에서 오간 대화들을 읽는 길을 낸다 — 칸도 표도 늘지 않는다.

    지난 대화 목록은 이미 쌓인 실행에서 파생된다: 요약을 적어 둘 자리는 짓지 않는다.
    """
    connection.execute(_RUNS_SPEC_INDEX_SQL)
    connection.execute(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        (6, applied_at),
    )


_MIGRATIONS: Mapping[int, Migration] = {
    1: _migration_to_v1,
    2: _migration_to_v2,
    3: _migration_to_v3,
    4: _migration_to_v4,
    5: _migration_to_v5,
    6: _migration_to_v6,
}


def _user_tables(connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
        " AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return {str(row[0]) for row in rows}


def _schema_version(connection: sqlite3.Connection, tables: set[str]) -> int:
    unknown = tables - _KNOWN_TABLES
    if unknown:
        raise DatabasePreparationError("database contains unknown application tables")
    if _METADATA_TABLE not in tables:
        if "durable_jobs" in tables:
            raise DatabasePreparationError(
                "unversioned database contains a versioned job table"
            )
        return 0
    rows = connection.execute(
        "SELECT version FROM schema_migrations ORDER BY version"
    ).fetchall()
    if not rows:
        raise DatabasePreparationError("database schema metadata is empty")
    versions = [int(row[0]) for row in rows]
    if versions != list(range(1, versions[-1] + 1)):
        raise DatabasePreparationError("database schema metadata is not contiguous")
    return versions[-1]


def _normalized_schema_sql(written: str) -> str:
    return " ".join(written.split()).casefold()


def _validate_schema(
    connection: sqlite3.Connection,
    tables: set[str],
    *,
    version: int,
    require_all_tables: bool,
) -> None:
    if version == 0:
        raise DatabasePreparationError("schema contract version must be positive")
    contract = _SCHEMA_CONTRACTS[version]
    if require_all_tables:
        missing = set(contract) - tables
        if missing:
            raise DatabasePreparationError(
                "database is missing required application tables"
            )
    unexpected_for_version = tables - set(contract)
    if unexpected_for_version:
        raise DatabasePreparationError(
            "database contains tables from another schema version"
        )
    for table in tables & set(contract):
        actual = tuple(
            (str(row[1]), str(row[2]).upper(), int(row[3]), int(row[5]))
            for row in connection.execute(f"PRAGMA table_info({table})")
        )
        if actual != contract[table]:
            raise DatabasePreparationError(
                f"database table {table!r} has an unsupported shape"
            )
    if require_all_tables and version >= 2:
        durable_table = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
            ("durable_jobs",),
        ).fetchone()
        if (
            durable_table is None
            or durable_table[0] is None
            or _normalized_schema_sql(str(durable_table[0]))
            != _normalized_schema_sql(_SCHEMA_V2_DURABLE_JOBS_SQL)
        ):
            raise DatabasePreparationError(
                "database durable job constraints are unsupported"
            )
    if require_all_tables:
        for index_name, expected in _INDEX_CONTRACTS[version].items():
            row = connection.execute(
                "SELECT sql, tbl_name FROM sqlite_master"
                " WHERE type = 'index' AND name = ?",
                (index_name,),
            ).fetchone()
            if row is None or row[0] is None:
                raise DatabasePreparationError("database is missing a required index")
            canonical_sql = _CANONICAL_INDEX_SQL.get(index_name)
            if canonical_sql is not None and _normalized_schema_sql(
                str(row[0])
            ) != _normalized_schema_sql(canonical_sql):
                raise DatabasePreparationError(
                    "database index has an unsupported shape"
                )
            owner = str(row[1])
            indexed = tuple(
                str(info[2])
                for info in connection.execute(f"PRAGMA index_info({index_name})")
            )
            index_metadata = next(
                (
                    info
                    for info in connection.execute(f"PRAGMA index_list({owner})")
                    if info[1] == index_name
                ),
                None,
            )
            if index_metadata is None:
                raise DatabasePreparationError("database is missing a required index")
            unique = int(index_metadata[2])
            origin = str(index_metadata[3])
            partial = int(index_metadata[4])
            if (unique, indexed) != expected or origin != "c" or partial != 0:
                raise DatabasePreparationError(
                    "database index has an unsupported shape"
                )


def _retention_from_env() -> int:
    written = os.environ.get(BACKUP_RETENTION_ENV, str(DEFAULT_BACKUP_RETENTION))
    try:
        retention = int(written)
    except ValueError as error:
        raise DatabasePreparationError(
            f"{BACKUP_RETENTION_ENV} must be an integer"
        ) from error
    if not 1 <= retention <= 1000:
        raise DatabasePreparationError(
            f"{BACKUP_RETENTION_ENV} must be between 1 and 1000"
        )
    return retention


def backup_directory(database_path: Path) -> Path:
    configured = os.environ.get(BACKUP_DIR_ENV, "").strip()
    return Path(configured) if configured else database_path.parent / "backups"


@contextmanager
def _migration_lock(database_path: Path) -> Iterator[None]:
    lock_path = database_path.with_name(f".{database_path.name}.migration.lock")
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    lock = os.fdopen(descriptor, "r+")
    try:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
    finally:
        lock.close()


def _backup_name(database_path: Path, from_version: int, to_version: int) -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    return (
        f"{database_path.name}.v{from_version}-to-v{to_version}."
        f"{stamp}.{uuid4().hex[:8]}.backup.sqlite3"
    )


def _quick_check(connection: sqlite3.Connection) -> None:
    result = connection.execute("PRAGMA quick_check").fetchone()
    if result is None or result[0] != "ok":
        raise DatabasePreparationError("SQLite backup integrity check failed")


def verify_database_schema(connection: sqlite3.Connection) -> int:
    """열린 DB의 무결성과 schema를 검사하고 그 schema version을 돌려준다."""
    _quick_check(connection)
    tables = _user_tables(connection)
    version = _schema_version(connection, tables)
    if version > CURRENT_SCHEMA_VERSION:
        raise DatabasePreparationError(
            "database was created by a newer AgentCanvas version"
        )
    _validate_schema(
        connection,
        tables,
        version=version or 1,
        require_all_tables=version > 0,
    )
    return version


def verify_database_backup(path: Path | str) -> BackupVerification:
    backup_path = Path(path)
    if not backup_path.is_file():
        raise DatabasePreparationError("database backup does not exist")
    uri = backup_path.resolve().as_uri() + "?mode=ro"
    try:
        with closing(sqlite3.connect(uri, uri=True)) as connection:
            _quick_check(connection)
            tables = _user_tables(connection)
            version = _schema_version(connection, tables)
            if version > CURRENT_SCHEMA_VERSION:
                raise DatabasePreparationError(
                    "database backup was created by a newer AgentCanvas version"
                )
            _validate_schema(
                connection,
                tables,
                version=version or 1,
                require_all_tables=version > 0,
            )
    except sqlite3.DatabaseError as error:
        raise DatabasePreparationError("database backup cannot be verified") from error
    return BackupVerification(
        path=backup_path,
        schema_version=version,
        size_bytes=backup_path.stat().st_size,
    )


def _fsync_file(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _prune_backups(directory: Path, database_path: Path, retention: int) -> None:
    partial_pattern = f"{database_path.name}.v*-to-v*.backup.sqlite3.partial"
    for partial in directory.glob(partial_pattern):
        partial.unlink()
    pattern = f"{database_path.name}.v*-to-v*.backup.sqlite3"
    backups = sorted(
        directory.glob(pattern), key=lambda candidate: candidate.name, reverse=True
    )
    for stale in backups[retention:]:
        stale.unlink()


def _create_backup(
    source: sqlite3.Connection,
    database_path: Path,
    from_version: int,
    to_version: int,
    directory: Path,
    retention: int,
) -> Path:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    try:
        os.chmod(directory, 0o700)
    except PermissionError:
        # 일부 volume mount는 mode 변경을 허용하지 않는다. 파일 자체는 계속 0600으로 제한한다.
        pass
    _prune_backups(directory, database_path, retention)
    final_path = directory / _backup_name(database_path, from_version, to_version)
    temporary_path = final_path.with_suffix(final_path.suffix + ".partial")
    descriptor = os.open(
        temporary_path,
        os.O_CREAT | os.O_EXCL | os.O_WRONLY,
        0o600,
    )
    os.close(descriptor)
    try:
        with closing(sqlite3.connect(temporary_path)) as destination:
            source.backup(destination)
            _quick_check(destination)
        _fsync_file(temporary_path)
        temporary_path.replace(final_path)
        _fsync_directory(directory)
        verify_database_backup(final_path)
        _prune_backups(directory, database_path, retention)
        _fsync_directory(directory)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        final_path.unlink(missing_ok=True)
        _fsync_directory(directory)
        raise
    return final_path


def _enable_wal(connection: sqlite3.Connection) -> None:
    result = connection.execute("PRAGMA journal_mode=WAL").fetchone()
    if result is None or str(result[0]).lower() != "wal":
        raise DatabasePreparationError("SQLite WAL mode is unavailable")


def _apply_migrations(
    connection: sqlite3.Connection,
    previous_version: int,
    migrations: Mapping[int, Migration],
    *,
    backup_data_version: int | None,
) -> None:
    connection.execute("BEGIN IMMEDIATE")
    try:
        if backup_data_version is not None:
            current_data_version = connection.execute("PRAGMA data_version").fetchone()
            if (
                current_data_version is None
                or int(current_data_version[0]) != backup_data_version
            ):
                raise DatabasePreparationError(
                    "database changed while its migration backup was created"
                )
        applied_at = datetime.now(UTC).isoformat()
        for version in range(previous_version + 1, CURRENT_SCHEMA_VERSION + 1):
            migration = migrations.get(version)
            if migration is None:
                raise DatabasePreparationError(
                    f"database migration to version {version} is unavailable"
                )
            migration(connection, applied_at)
        tables = _user_tables(connection)
        if _schema_version(connection, tables) != CURRENT_SCHEMA_VERSION:
            raise DatabasePreparationError(
                "database migration did not reach its target"
            )
        _validate_schema(
            connection,
            tables,
            version=CURRENT_SCHEMA_VERSION,
            require_all_tables=True,
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def prepare_database(
    path: Path | str,
    *,
    backup_dir: Path | str | None = None,
    retention: int | None = None,
    migrations: Mapping[int, Migration] | None = None,
) -> MigrationResult:
    """DB를 현재 version으로 준비한다. legacy data가 있으면 먼저 검증된 backup을 만든다."""
    database_path = Path(path)
    if str(path) == ":memory:":
        raise DatabasePreparationError(
            "shared stores require a file-backed SQLite database"
        )
    if not database_path.parent.is_dir():
        raise DatabasePreparationError("database parent directory does not exist")
    keep = _retention_from_env() if retention is None else retention
    if not 1 <= keep <= 1000:
        raise DatabasePreparationError("backup retention must be between 1 and 1000")
    target_backup_dir = (
        Path(backup_dir) if backup_dir is not None else backup_directory(database_path)
    )

    with _migration_lock(database_path):
        try:
            with closing(
                sqlite3.connect(database_path, timeout=BUSY_WAIT_SECONDS)
            ) as connection:
                connection.row_factory = sqlite3.Row
                tables = _user_tables(connection)
                previous_version = _schema_version(connection, tables)
                if previous_version > CURRENT_SCHEMA_VERSION:
                    raise DatabasePreparationError(
                        "database was created by a newer AgentCanvas version"
                    )
                if previous_version == CURRENT_SCHEMA_VERSION:
                    _validate_schema(
                        connection,
                        tables,
                        version=CURRENT_SCHEMA_VERSION,
                        require_all_tables=True,
                    )
                    _enable_wal(connection)
                    return MigrationResult(
                        previous_version=previous_version,
                        current_version=previous_version,
                        migrated=False,
                        backup_path=None,
                    )

                _validate_schema(
                    connection,
                    tables,
                    version=previous_version or 1,
                    require_all_tables=False,
                )
                backup_path = None
                backup_data_version = None
                if tables & _APPLICATION_TABLES:
                    data_version = connection.execute("PRAGMA data_version").fetchone()
                    if data_version is None:
                        raise DatabasePreparationError(
                            "database change counter is unavailable"
                        )
                    backup_data_version = int(data_version[0])
                    backup_path = _create_backup(
                        connection,
                        database_path,
                        previous_version,
                        CURRENT_SCHEMA_VERSION,
                        target_backup_dir,
                        keep,
                    )
                _apply_migrations(
                    connection,
                    previous_version,
                    _MIGRATIONS if migrations is None else migrations,
                    backup_data_version=backup_data_version,
                )
                _enable_wal(connection)
                return MigrationResult(
                    previous_version=previous_version,
                    current_version=CURRENT_SCHEMA_VERSION,
                    migrated=True,
                    backup_path=backup_path,
                )
        except (sqlite3.DatabaseError, OSError) as error:
            raise DatabasePreparationError("database could not be prepared") from error


class PreparedDatabase:
    """저장소가 공유하는 준비 관문 — 파일 하나를 처음 쓸 때 딱 한 번 준비한다."""

    def __init__(self, path: Path | str, *, already_prepared: bool = False) -> None:
        # 구성만으로 파일이 생기면 안 된다 — 실제로 쓰거나 읽을 때 처음 준비한다(lazy).
        self._path = str(path)
        self._prepared = already_prepared
        self._lock = threading.Lock()

    @property
    def path(self) -> str:
        return self._path

    def ensure(self) -> None:
        if self._prepared:
            return
        with self._lock:
            if not self._prepared:
                prepare_database(self._path)
                self._prepared = True


__all__ = [
    "BACKUP_DIR_ENV",
    "BACKUP_RETENTION_ENV",
    "CURRENT_SCHEMA_VERSION",
    "BackupVerification",
    "DatabasePreparationError",
    "MigrationResult",
    "PreparedDatabase",
    "backup_directory",
    "prepare_database",
    "verify_database_backup",
    "verify_database_schema",
]
