# Docker Compose Deployment

This document describes the supported alpha deployment profile, not a production reference architecture.

## Topology

```text
browser → 127.0.0.1:8080 Studio/Nginx → internal api:8000
                                           ├─ /data SQLite volume
                                           └─ /backups migration-backup volume
```

- Studio is loopback-bound by default.
- API is exposed only to the Compose network.
- Nginx serves the static Studio and proxies `/api` with SSE buffering disabled.
- API and Studio run read-only, drop Linux capabilities and set `no-new-privileges`.
- Studio starts after API readiness succeeds.
- Authentication is fixed to required.

## Required configuration

Create `.env` from `.env.example` with mode 0600. At minimum set distinct values for:

- `AGENTCANVAS_ADMIN_PASSWORD` (12+ characters)
- `AGENTCANVAS_SESSION_SECRET` (32+ UTF-8 bytes)

Provider configuration is optional. OpenAI requires both `AGENTCANVAS_SECRET_OPENAI_API_KEY` and an explicit `AGENTCANVAS_OPENAI_MODEL`. No external OpenAI model is selected by default.

## Start and health

```bash
docker compose up --build -d
docker compose ps
curl --fail http://localhost:8080/api/health/live
curl --fail http://localhost:8080/api/health/ready
```

Liveness means the API process answers. Readiness checks stores and durable-worker health; it does not call providers or validate restore readiness.

## Stop without deleting data

```bash
docker compose down
```

Do not add `-v` unless intentionally deleting all live and backup volumes.

## Remote access

The default is intentionally local-only. For remote HTTPS access, the operator must provide and validate:

- TLS termination and certificate lifecycle
- exact external origin in `AGENTCANVAS_ALLOWED_ORIGINS`
- `AGENTCANVAS_COOKIE_SECURE=true`
- network/firewall boundary
- proxy timeout and SSE behavior
- secret delivery and log redaction

AgentCanvas does not ship a trusted-proxy/TLS profile. Do not expose plain HTTP or the API port directly to an untrusted network.

## Persistence

Keep the DB, `-wal` and `-shm` in the same `/data` volume. `/backups` is separate so a migration failure does not overwrite the backup directory, but both are still local Docker volumes. Export backups off-host according to [`backup-and-restore.md`](backup-and-restore.md).

## Scaling boundary

This profile supports one API process/worker. Do not scale the API service horizontally against the SQLite volume. Rolling migration and multi-node coordination are unsupported. See [`durability.md`](durability.md).
