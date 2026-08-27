# Backup and Restore Runbook

This runbook covers migration backups for the supported single-node SQLite profile. Test the procedure with copies before relying on it for important data.

## What AgentCanvas backs up

When an existing database requires a schema migration, startup creates a verified SQLite snapshot before changing the source database. Compose stores:

- live DB, WAL and SHM in `agentcanvas-data:/data`
- migration backups in `agentcanvas-backups:/backups`

A current v2 startup does not create a backup. This is not a scheduled backup system.

## Inspect and export backups

List completed migration backups:

```bash
docker compose exec -T api sh -c 'ls -l /backups'
```

Export a completed file to the host:

```bash
docker compose cp api:/backups/<backup-file>.backup.sqlite3 ./agentcanvas-backup.db
chmod 600 ./agentcanvas-backup.db
```

Then move the exported file to separately managed off-host storage. Do not treat the backup volume alone as disaster recovery.

## Verify without modifying

From a development/source environment:

```bash
uv run --frozen agentcanvas-ops verify-backup ./agentcanvas-backup.db
```

The verifier opens the file read-only, runs SQLite integrity/schema checks and rejects newer or unsupported shapes. It never migrates or repairs the file.

A successful check shows that the snapshot is readable and structurally supported; it does not prove that application-level content is complete or that a production restore has been rehearsed.

## Upgrade procedure

1. Export an independent backup when the current data matters.
2. Stop the stack without deleting volumes.
3. Start exactly one API instance with the new source/image.
4. Wait for readiness.
5. Confirm whether a new completed migration backup exists.
6. Exercise representative reads and only then resume normal operation.

```bash
docker compose down
docker compose up --build -d
curl --fail http://localhost:8080/api/health/ready
docker compose exec -T api sh -c 'ls -l /backups'
```

Do not use `docker compose down -v`; it deletes the persistent volumes.

## Manual restore boundary

AgentCanvas does not provide an automated restore command. Restore only while all processes that can open the DB are stopped.

1. Stop Studio/API and verify no API/worker process is running.
2. Preserve the current DB and its `-wal`/`-shm` siblings as a separate incident copy.
3. Copy the chosen backup to a temporary path, not directly over the live file.
4. Verify the temporary copy with `agentcanvas-ops verify-backup`.
5. Replace the live DB atomically while quiescent and remove stale WAL/SHM only after preserving them.
6. Set restrictive ownership/permissions appropriate to the runtime user.
7. Start one API instance.
8. Check readiness and representative specs/runs/evaluations.
9. Keep both the pre-restore incident copy and selected backup until validation is complete.

Exact host/container copy commands depend on how the Docker volumes or host path are managed. Do not improvise a live-file replacement inside a running container.

## Prohibited operations

- copying only the live `.db` while WAL writes are active
- replacing the DB while API/worker processes are running
- editing `schema_migrations` manually
- using the read-only verifier as if it repaired data
- deleting volumes before export and verification
- assuming a migration backup is an off-host or scheduled backup

## Restore drill

A useful recurring drill records:

- source version and backup filename
- verifier result and schema version
- restore environment
- readiness result
- representative application records checked
- elapsed recovery time and any manual correction

Keep the drill evidence outside the application database. A release should not claim restore readiness without release-specific evidence.
