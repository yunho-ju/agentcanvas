# Persistence and Job Durability

This document defines the current single-node SQLite and durable-work contract. It does not claim distributed or external-provider exactly-once behavior.

## Supported topology

- one API process and in-process durable worker
- one file-backed SQLite database
- one writer topology during startup/migration
- local filesystem semantics that support locks, fsync and atomic rename

Unsupported: in-memory shared DB, multiple API/worker processes coordinating the same SQLite file, horizontal scaling, rolling migration, downgrade and multi-node SQLite.

## Schema ownership and startup

A central database owner runs before the four stores are created. It:

1. acquires a process file lock
2. opens SQLite and inspects application tables
3. validates contiguous `schema_migrations`
4. rejects unknown/future/non-canonical tables, constraints and indexes
5. creates a verified backup when existing application data needs migration
6. applies migrations under `BEGIN IMMEDIATE`
7. validates the complete target schema
8. commits and enables WAL

Fresh/unversioned v0 and v1 databases migrate forward to v2. Errors roll back the transaction and fail startup. A current canonical v2 database is validated but does not create another migration backup.

## Migration backup

A pre-migration backup uses the SQLite backup API rather than copying the DB/WAL files. The implementation writes a private temporary file, runs `PRAGMA quick_check`, fsyncs the file, atomically renames it, fsyncs the directory and verifies the completed backup again.

Default retention is 10 backups per database and accepts values from 1 through 1000. The default directory is `backups/` beside the DB; Compose uses the separate `/backups` volume.

Migration backups are local rollback material, not an off-host disaster-recovery system. Export completed files to separately managed storage.

See [`backup-and-restore.md`](backup-and-restore.md) for operator steps.

## Atomic acceptance

For durable mode, these commands persist the user-visible identity and durable job in the same acceptance boundary before returning:

- run start
- human-gate approval/resume
- evaluation batch start

Evaluation acceptance freezes the dataset/spec snapshot and attempt run identities used by later retries.

## Idempotency

`Idempotency-Key` is supported for run start, approval/resume and evaluation batch start.

- after trimming, length must be 1–200 characters
- matching is case-sensitive
- repeating the same command/key returns the original run or batch identity
- source changes after acceptance do not change the accepted identity
- using one key for a different command, operation or kind returns 409

A client retrying an ambiguous network response should reuse the original key.

## Durable job state

Jobs transition through:

```text
queued → leased → succeeded | failed | cancelled
```

Claim order follows durable `enqueue_seq`. The worker reclaims queued and expired leased work after startup, heartbeats active leases and fences every write to the current unexpired owner. Store failures lower readiness and are retried with bounded backoff.

## Recovery boundary

Recovery avoids blind replay after externally visible work may have happened.

- A run interrupted before any event can be retried.
- A run or continuation with events beyond its safe acceptance boundary is not blindly replayed and converges to a generic terminal failure.
- Evaluation retries use the frozen snapshot and attempt IDs.
- Provider calls may still repeat because external APIs are outside the local transaction.

There is no external-provider exactly-once guarantee. A process may die after a provider side effect but before its result is durably recorded.

## Cancellation

- queued cancellation becomes terminal atomically
- leased work observes cooperative cancellation between node/case/attempt boundaries
- provider and Python calls are not force-killed
- shutdown keeps lease heartbeat during its grace period, then makes a best-effort relinquish to queued state
- lease expiry is the final recovery boundary

Cancellation latency therefore depends on the current call returning.

## Readiness

`GET /health/ready` reads all four stores and checks durable-worker health/initial store access. A store or worker fault returns 503 without exposing paths or SQL details.

Readiness does not:

- call external providers
- prove provider availability
- assert an empty queue
- verify backup restore
- prove production fitness

## Read-only diagnostics

The operations CLI includes read-only checks:

```bash
agentcanvas-ops verify-backup /path/to/backup.sqlite3
agentcanvas-ops doctor --database /path/to/agentcanvas.db
```

These commands do not migrate, repair, restore or create a database. Run them against copies or quiescent files according to the command help and [`backup-and-restore.md`](backup-and-restore.md).

## Non-guarantees and operator responsibilities

AgentCanvas currently has no:

- automatic off-host backup
- retention policy for run/eval/application data growth
- automated restore command
- tested horizontal scaling or rolling migration
- production restore evidence bundled with the source
- forced cancellation of provider calls
- external side-effect exactly-once guarantee

Operators are responsible for filesystem capacity, off-host copies, restore drills, access control and process supervision.
