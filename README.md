# AgentCanvas

**English** | [한국어](README.ko.md)

AgentCanvas is a self-hosted tool for designing AI agents with natural language on a visual canvas, observing their runs, and evaluating them repeatedly. The graph on the canvas is stored as `AgentSpec`, an execution contract.

![AgentCanvas demo — from login through AI drafting, node configuration, and run observation](docs/media/agentcanvas-demo.gif)

> The demo above: admin login → a natural-language request ("Read a customer inquiry email and write a polite reply") → the AI Architect drafts a graph (contract, flow, and dry-run review) → apply to canvas → configure nodes → execute against a real provider and watch the event timeline.

> **Alpha software:** the current source metadata targets `v0.1.0-alpha.1`. This is an evaluation release for a single trusted administrator and one implicit workspace — not production-ready and not a multi-tenant service. See [`CHANGELOG.md`](CHANGELOG.md) for the versioning policy and scope of changes.

## What it does today

- **Build:** node/edge editing, schema and graph validation, inspector, undo/redo, Impact Preview, file and server persistence, revision history
- **Guided:** turns a natural-language request on a blank canvas into a constrained `agent.patch/v1` candidate; applied only after schema, graph, and dry-run review and explicit user approval
- **Run:** routed execution, SSE event stream with reconnection, human approval gate, cancellation, timeline/history, static comparison of two runs
- **Evaluate:** dataset/case management, repeated runs with a required pass count, batch history/detail/comparison, deterministic `expected_phrases` judgment
- **Persistence:** SQLite v2 schema, forward migrations, verified pre-migration backups, durable run/eval queue, leases and restart recovery
- **Deployment:** single-admin session authentication, CSRF, exact-origin CORS, liveness/readiness, same-origin Docker Compose

`ReleaseManifest` exists only as a Python/JSON Schema data contract. There is no release storage, approval, deployment, or rollback UI yet.

## Fastest way to run

Requirements: Docker Engine 24+ and Docker Compose v2+.

```bash
if [ ! -f .env ]; then
  (umask 077; cp .env.example .env)
fi
chmod 600 .env

python -c 'import secrets; print(secrets.token_urlsafe(32))'
python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Put the two different generated values into `AGENTCANVAS_ADMIN_PASSWORD` and `AGENTCANVAS_SESSION_SECRET` in `.env`. When using a provider, keep the provider secret and model ID in `.env` only — never commit them.

```bash
docker compose up --build -d
docker compose ps
```

Open <http://localhost:8080> in a browser. The default Compose profile exposes only Studio on `127.0.0.1:8080` and keeps the API on the internal network.

```bash
curl --fail http://localhost:8080/api/health/live
curl --fail http://localhost:8080/api/health/ready
docker compose down
```

`docker compose down -v` deletes the stored specs, runs, evals, and backup volumes — use it only when you intend to discard data.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AGENTCANVAS_BIND` | `127.0.0.1` | Studio bind address |
| `AGENTCANVAS_PORT` | `8080` | Studio published port |
| `AGENTCANVAS_DB` | `/data/agentcanvas.db` | API SQLite path |
| `AGENTCANVAS_BACKUP_DIR` | `/backups` in Compose | Migration backup path |
| `AGENTCANVAS_BACKUP_RETENTION` | `10` | Migration backups retained per DB (1–1000) |
| `AGENTCANVAS_ALLOWED_ORIGINS` | `http://localhost:8080` | Exact CORS origin list. `*` is rejected. |
| `AGENTCANVAS_ADMIN_PASSWORD` | required | Single admin password (12+ characters) |
| `AGENTCANVAS_SESSION_SECRET` | required | Separate HMAC session secret (32+ UTF-8 bytes) |
| `AGENTCANVAS_SESSION_TTL_SECONDS` | `28800` | Fixed session expiry (60 seconds–7 days) |
| `AGENTCANVAS_COOKIE_SECURE` | `false` | Must be `true` for HTTPS deployments |
| `VITE_API_URL` | `/api` | Studio build-time API URL |
| `AGENTCANVAS_OPENAI_MODEL` | empty | Explicitly chosen OpenAI model ID |
| `AGENTCANVAS_SECRET_OPENAI_API_KEY` | empty | OpenAI secret |
| `AGENTCANVAS_SECRET_ANTHROPIC_API_KEY` | empty | Anthropic catalog and execution secret |
| `AGENTCANVAS_LOCAL_MODEL` | empty | OpenAI-compatible local model ID |
| `AGENTCANVAS_LOCAL_BASE_URL` | `http://host.docker.internal:11434/v1` | Local model endpoint |

The OpenAI path is enabled only when both the key and the model ID are present. Because external providers change pricing and availability, AgentCanvas does not pick an OpenAI model default for you. Guided drafting currently fails closed with a 503 unless OpenAI is explicitly configured. Regular runs and evals can use Anthropic or an OpenAI-compatible provider, and fall back to a deterministic stand-in when no provider is configured.

`VITE_API_URL` is baked in at bundle build time. Rebuild the Studio image after changing it.

## Security boundary

Compose pins authentication to always-required. Every HTTP route except health and login is default-deny, and unsafe methods require both the session cookie and an `X-CSRF-Token` header. The exact session, cookie, CORS, and logout contract — and what is explicitly not guaranteed — is in [`docs/security/authentication.md`](docs/security/authentication.md).

The default profile is loopback HTTP, so the cookie's `Secure` flag is off. Remote deployments must provide TLS or a reverse proxy and set `AGENTCANVAS_COOKIE_SECURE=true`. There is no built-in TLS, OIDC, MFA, or user/role/tenant isolation.

## Data, upgrades, and recovery

Compose keeps the DB and its `-wal`/`-shm` files in the `agentcanvas-data` volume and migration backups in a separate `agentcanvas-backups` volume. The API migrates v0/v1 databases forward to v2; when a database contains application tables, it snapshots and verifies a backup via the SQLite backup API before changing anything. Unknown or non-conforming schemas abort startup instead of being guessed at.

Only one API instance may run a migration at a time. Automatic backups are local rollback material, not off-host disaster recovery.

- Schema, queue, idempotency, and recovery: [`docs/operations/durability.md`](docs/operations/durability.md)
- Backup verification and manual restore: [`docs/operations/backup-and-restore.md`](docs/operations/backup-and-restore.md)
- Compose topology and health: [`docs/operations/deployment.md`](docs/operations/deployment.md)

## Local development

Requirements: Python 3.12+, uv 0.8.15, Node.js 22.20+, pnpm 10.15.1.

```bash
uv sync --frozen
pnpm install --frozen-lockfile

export AGENTCANVAS_ADMIN_PASSWORD='local-development-admin-password'
export AGENTCANVAS_SESSION_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
uv run --frozen uvicorn agentcanvas_api.app:create_app --factory --reload
```

In another terminal:

```bash
pnpm dev
```

The default API database is `agentcanvas.db` at the repository root; point `AGENTCANVAS_DB` elsewhere to change it.

## Verification

```bash
uv run --frozen ruff check packages
uv run --frozen ruff format --check packages
uv run --frozen pytest
pnpm test
VITE_API_URL=/api pnpm build
pnpm gen:types
git diff --exit-code -- apps/studio/src/generated
docker compose --env-file .env.example config --quiet
```

The GitHub Actions workflow verifies Python, Studio, generated-type drift, container builds, auth fail-closed startup, and an isolated Compose smoke test. Check CI status on each commit and pull request under Checks.

## Structure and documentation

- `packages/contracts`: AgentSpec, RunEvent, Eval, Architect, and ReleaseManifest contracts
- `packages/engine`: graph validation, routed runtime, evaluators
- `packages/adapters`: Anthropic/OpenAI-compatible provider boundary
- `packages/api`: FastAPI, auth, SQLite stores, SSE, durable worker
- `apps/studio`: React/TypeScript/Vite visual Studio
- `examples`: versioned contract examples
- `docs/security`, `docs/operations`: supported public operating contracts
- `docs/design`: Studio design language and principles
- `docs/vision`: long-term proposals, not current capabilities

Product scope lives in [`PRODUCT.md`](PRODUCT.md), the current UI contract in [`DESIGN.md`](DESIGN.md), and the implementation architecture in [`docs/AGENTCANVAS_DESIGN.md`](docs/AGENTCANVAS_DESIGN.md).

## Known limitations

- Supports exactly one trusted administrator and one implicit workspace.
- Does not guarantee exactly-once for external provider calls.
- Evaluation judges only normalized phrase inclusion; it does not prove quality, safety, groundedness, or task success.
- No horizontal scaling, rolling SQLite migration, Kubernetes, or PostgreSQL backend.
- No structured application logging, metrics, quota/rate limiting, or automatic off-host backups.
- Release/Investigate, a real MCP executor, a LangGraph adapter, the 3D Runtime World, and workspace collaboration are vision-stage only.
- The current public scope is source and source-built Docker Compose. Prebuilt artifacts would need their own SBOM, digests/signatures, and a complete license/NOTICE bundle.

## Contributing, security, and support

Follow [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contribution process and DCO sign-off, [`SECURITY.md`](SECURITY.md) for vulnerability reports, and [`SUPPORT.md`](SUPPORT.md) for the support scope. All participants must follow [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

AgentCanvas is provided under the [Apache License 2.0](LICENSE). Third-party component notices are maintained in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
