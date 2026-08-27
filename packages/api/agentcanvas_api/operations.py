"""Read-only operational checks for AgentCanvas durable SQLite state."""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections.abc import Sequence
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from agentcanvas_api.sqlite_database import (
    CURRENT_SCHEMA_VERSION,
    DatabasePreparationError,
    backup_directory,
    verify_database_backup,
    verify_database_schema,
)

_JOB_STATUSES = ("queued", "leased", "succeeded", "failed", "cancelled")
_FileSignature = tuple[int, int, int, int] | None


def _file_signature(path: Path) -> _FileSignature:
    try:
        stat = path.stat()
    except FileNotFoundError:
        return None
    return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)


def _read_only_connection(
    path: Path,
) -> tuple[sqlite3.Connection, bool, tuple[_FileSignature, ...]]:
    wal_path = Path(f"{path}-wal")
    shm_path = Path(f"{path}-shm")
    if wal_path.exists() and not shm_path.is_file():
        raise DatabasePreparationError(
            "database WAL exists without its shared-memory sidecar"
        )
    immutable = not wal_path.exists()
    before = tuple(
        _file_signature(candidate) for candidate in (path, wal_path, shm_path)
    )
    query = "?mode=ro&immutable=1" if immutable else "?mode=ro"
    connection = sqlite3.connect(path.resolve().as_uri() + query, uri=True)
    connection.row_factory = sqlite3.Row
    return connection, immutable, before


def _journal_mode_for_inspection(
    path: Path, connection: sqlite3.Connection, *, immutable: bool
) -> str:
    if not immutable:
        row = connection.execute("PRAGMA journal_mode").fetchone()
        if row is None:
            raise DatabasePreparationError("database journal mode is unavailable")
        return str(row[0]).lower()

    with path.open("rb") as database_file:
        header = database_file.read(20)
    if len(header) < 20 or header[:16] != b"SQLite format 3\x00":
        raise DatabasePreparationError("database header is unsupported")
    read_version, write_version = header[18], header[19]
    if (read_version, write_version) == (2, 2):
        return "wal"
    if (read_version, write_version) == (1, 1):
        return "delete"
    raise DatabasePreparationError("database journal format is unsupported")


def _backup_inventory(database_path: Path, directory: Path) -> dict[str, Any]:
    if directory.exists() and not directory.is_dir():
        raise DatabasePreparationError("configured backup path is not a directory")

    pattern = f"{database_path.name}.v*-to-v*.backup.sqlite3"
    partial_pattern = f"{pattern}.partial"
    backups = (
        sorted(directory.glob(pattern), key=lambda item: item.name, reverse=True)
        if directory.is_dir()
        else []
    )
    partials = list(directory.glob(partial_pattern)) if directory.is_dir() else []
    latest: dict[str, Any] | None = None
    if backups:
        verification = verify_database_backup(backups[0])
        mode = backups[0].stat().st_mode & 0o777
        latest = {
            "path": str(verification.path.resolve()),
            "schema_version": verification.schema_version,
            "size_bytes": verification.size_bytes,
            "mode": f"0o{mode:03o}",
            "permissions_restricted": mode & 0o077 == 0,
        }
    return {
        "directory": str(directory.resolve()),
        "count": len(backups),
        "partial_count": len(partials),
        "latest_verified": latest,
    }


def inspect_database(
    database: Path | str,
    *,
    backup_dir: Path | str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Inspect a database and its latest backup without migrating or repairing either."""
    database_path = Path(database)
    if not database_path.is_file():
        raise DatabasePreparationError("database does not exist or is not a file")

    checked_at = now or datetime.now(UTC)
    counts = {status: 0 for status in _JOB_STATUSES}
    expired_leases = 0
    connection, immutable, before = _read_only_connection(database_path)
    with closing(connection):
        connection.execute("BEGIN")
        schema_version = verify_database_schema(connection)
        journal_mode = _journal_mode_for_inspection(
            database_path, connection, immutable=immutable
        )
        if schema_version >= 2:
            for row in connection.execute(
                "SELECT status, COUNT(*) AS count FROM durable_jobs GROUP BY status"
            ):
                status = str(row["status"])
                if status not in counts:
                    raise DatabasePreparationError(
                        "database contains an unknown durable job status"
                    )
                counts[status] = int(row["count"])
            expired_row = connection.execute(
                "SELECT COUNT(*) FROM durable_jobs"
                " WHERE status = 'leased' AND lease_expires_at <= ?",
                (checked_at.isoformat(),),
            ).fetchone()
            if expired_row is None:
                raise DatabasePreparationError("expired lease count is unavailable")
            expired_leases = int(expired_row[0])
    if immutable:
        wal_path = Path(f"{database_path}-wal")
        shm_path = Path(f"{database_path}-shm")
        after = tuple(
            _file_signature(candidate)
            for candidate in (database_path, wal_path, shm_path)
        )
        if after != before:
            raise DatabasePreparationError(
                "database changed during read-only inspection; retry when quiescent"
            )

    selected_backup_dir = (
        Path(backup_dir) if backup_dir is not None else backup_directory(database_path)
    )
    backups = _backup_inventory(database_path, selected_backup_dir)
    findings: list[dict[str, str]] = []
    if schema_version != CURRENT_SCHEMA_VERSION:
        findings.append(
            {
                "severity": "warning",
                "code": "schema_not_current",
                "detail": (
                    f"database schema is v{schema_version}; "
                    f"runtime target is v{CURRENT_SCHEMA_VERSION}"
                ),
            }
        )
    if journal_mode != "wal":
        findings.append(
            {
                "severity": "warning",
                "code": "journal_mode_not_wal",
                "detail": f"database journal mode is {journal_mode!r}, not 'wal'",
            }
        )
    if expired_leases:
        findings.append(
            {
                "severity": "warning",
                "code": "expired_leases_pending_reclaim",
                "detail": f"{expired_leases} expired lease(s) await worker reclaim",
            }
        )
    if backups["partial_count"]:
        findings.append(
            {
                "severity": "warning",
                "code": "partial_backups_present",
                "detail": f"{backups['partial_count']} partial backup(s) remain",
            }
        )
    latest = backups["latest_verified"]
    if latest is not None and not latest["permissions_restricted"]:
        findings.append(
            {
                "severity": "warning",
                "code": "latest_backup_permissions_open",
                "detail": "latest backup is accessible to group or other users",
            }
        )
    if backups["count"] == 0:
        findings.append(
            {
                "severity": "info",
                "code": "no_migration_backups",
                "detail": "no migration backup exists for this database name",
            }
        )

    needs_attention = any(item["severity"] == "warning" for item in findings)
    return {
        "operation": "doctor",
        "status": "attention" if needs_attention else "verified",
        "checked_at": checked_at.isoformat(),
        "database": {
            "path": str(database_path.resolve()),
            "size_bytes": database_path.stat().st_size,
            "schema_version": schema_version,
            "target_schema_version": CURRENT_SCHEMA_VERSION,
            "journal_mode": journal_mode,
        },
        "jobs": {"by_status": counts, "expired_leases": expired_leases},
        "backups": backups,
        "findings": findings,
    }


def inspect_backup(path: Path | str) -> dict[str, Any]:
    """Verify one backup and report integrity/schema facts without changing it."""
    verification = verify_database_backup(path)
    mode = verification.path.stat().st_mode & 0o777
    return {
        "operation": "verify-backup",
        "status": "verified",
        "backup": {
            "path": str(verification.path.resolve()),
            "schema_version": verification.schema_version,
            "size_bytes": verification.size_bytes,
            "mode": f"0o{mode:03o}",
            "permissions_restricted": mode & 0o077 == 0,
        },
    }


def _print_doctor(report: dict[str, Any]) -> None:
    database = report["database"]
    jobs = report["jobs"]
    backups = report["backups"]
    print(f"AgentCanvas durability doctor: {report['status'].upper()}")
    print(f"database: {database['path']}")
    print(
        "schema: "
        f"v{database['schema_version']} / target v{database['target_schema_version']}"
    )
    print(f"journal mode: {database['journal_mode']}")
    counts = ", ".join(
        f"{status}={count}" for status, count in jobs["by_status"].items()
    )
    print(f"jobs: {counts}")
    print(f"expired leases: {jobs['expired_leases']}")
    print(f"backup directory: {backups['directory']}")
    print(f"backups: {backups['count']} (partial={backups['partial_count']})")
    latest = backups["latest_verified"]
    if latest is not None:
        print(
            "latest verified backup: "
            f"{latest['path']} (schema=v{latest['schema_version']}, "
            f"mode={latest['mode']})"
        )
    if report["findings"]:
        print("findings:")
        for finding in report["findings"]:
            print(f"- [{finding['severity']}] {finding['code']}: {finding['detail']}")


def _print_backup(report: dict[str, Any]) -> None:
    backup = report["backup"]
    print("AgentCanvas backup verification: VERIFIED")
    print(f"backup: {backup['path']}")
    print(f"schema: v{backup['schema_version']}")
    print(f"size: {backup['size_bytes']} bytes")
    print(f"mode: {backup['mode']}")
    if not backup["permissions_restricted"]:
        print("warning: backup is accessible to group or other users")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="agentcanvas-ops",
        description=(
            "Read-only durability checks. This command never migrates, repairs, "
            "restores, or creates a database."
        ),
    )
    commands = parser.add_subparsers(dest="command", required=True)

    doctor = commands.add_parser(
        "doctor", help="inspect a live SQLite database and its latest backup"
    )
    doctor.add_argument(
        "--database",
        required=True,
        type=Path,
        help="explicit path to the SQLite database",
    )
    doctor.add_argument(
        "--backup-dir",
        type=Path,
        help="backup directory (defaults to AGENTCANVAS_BACKUP_DIR or DB-adjacent backups/)",
    )
    doctor.add_argument("--json", action="store_true", help="emit JSON")

    verify = commands.add_parser(
        "verify-backup", help="verify one SQLite migration backup"
    )
    verify.add_argument("path", type=Path, help="path to the backup file")
    verify.add_argument("--json", action="store_true", help="emit JSON")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "doctor":
            report = inspect_database(
                args.database,
                backup_dir=args.backup_dir,
            )
        else:
            report = inspect_backup(args.path)
    except (DatabasePreparationError, OSError, sqlite3.DatabaseError) as error:
        blocked = {
            "operation": args.command,
            "status": "blocked",
            "reason": str(error),
        }
        if args.json:
            print(json.dumps(blocked, indent=2, sort_keys=True))
        else:
            print(f"BLOCKED: {error}")
        return 1

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    elif args.command == "doctor":
        _print_doctor(report)
    else:
        _print_backup(report)
    return 0 if report["status"] == "verified" else 1


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["inspect_backup", "inspect_database", "main"]
