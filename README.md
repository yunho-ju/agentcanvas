# AgentCanvas

**Draw an AI agent on a canvas, watch it run, test it until it earns your trust — all on your own machine.**

**English** | [한국어](README.ko.md)

[![CI](https://github.com/yunho-ju/agentcanvas/actions/workflows/ci.yml/badge.svg)](https://github.com/yunho-ju/agentcanvas/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](CHANGELOG.md)

![AgentCanvas demo — from login through AI drafting, node configuration, and run observation](docs/media/agentcanvas-demo.gif)

AgentCanvas is a self-hosted visual builder for AI agents, made for people who know their work but do not write code. You describe what the agent should do, the AI Architect drafts the graph, and from then on every step is something you can see: what each node was told, what the model answered, which test cases pass, and what to fix next. The graph on the canvas is not a picture of the agent. It *is* the agent — a versioned contract called `AgentSpec` that the runtime executes exactly as drawn.

> **Before you start.** You need one LLM API key. The AI Architect, Improve and tool wrapping use OpenAI and need both `AGENTCANVAS_SECRET_OPENAI_API_KEY` and `AGENTCANVAS_OPENAI_MODEL`; runs and tests can also use Anthropic or any OpenAI-compatible endpoint. With no key configured the app still starts, but runs answer with a deterministic stand-in and the Architect is unavailable.
>
> **This is alpha software** — the first alpha (`v0.1.0-alpha.1`) is being prepared and not yet tagged. It is built for a single trusted administrator on one workspace, distributed as source only (no prebuilt images or packages yet), and its HTTP API, environment variables and UI may change between alpha releases. What changed and what is known not to work is in [`CHANGELOG.md`](CHANGELOG.md).

## Quick start

Requires Docker with Compose v2.

```bash
git clone https://github.com/yunho-ju/agentcanvas.git && cd agentcanvas
(umask 077; cp .env.example .env)
```

Open `.env` and fill in three things: `AGENTCANVAS_ADMIN_PASSWORD` (12+ characters), `AGENTCANVAS_SESSION_SECRET` (32+ characters — `python -c 'import secrets; print(secrets.token_urlsafe(48))'` makes one), and your OpenAI key plus model ID. Then:

```bash
docker compose up --build -d
```

Open <http://localhost:8080>, sign in with the admin password, and type what you want the agent to do. Stop with `docker compose down`; add `-v` only if you also want to delete everything stored: graphs, runs, tests, conversations and the migration backups.

Prefer running from source? See [Local development](#local-development).

## What you can do

Five modes sit at the top of one canvas. You never leave the graph.

| | |
|---|---|
| **Build** — ask the Architect for a draft, or drag nodes yourself. Every node says what still needs a look. ![Build](docs/media/studio-build.png) | **Run** — start a run, watch the timeline step by step, pause and scrub it, approve or refuse at a human gate. ![Run](docs/media/studio-run.png) |
| **Test** — let the model suggest test cases, keep the ones you like, run them all. A failed case tells you what to fix, not just a score. ![Test](docs/media/studio-test.png) | **Talk** — publish a version and chat with it like a user would. Turn any answer into a test case with one click. ![Talk](docs/media/studio-talk.png) |

- **Build.** Node and edge editing with validation while you draw, an inspector that explains every field in plain words, undo/redo, impact preview before you remove something, revision history, save to server or file.
- **AI Architect.** A sentence in, a reviewed draft out: a contract check, a flow check and a fake run (a simulated pass that calls no model) happen before anything touches your canvas, and the draft's steps already name a model this server can call.
- **Run.** Routed execution with a live event stream (if the stream drops it resumes once from where it left off), human approval gates, cancellation, run history and a side-by-side comparison of two runs.
- **Test.** Datasets of cases, AI-suggested cases (tool-aware — the suggestions know which tools your graph can call), repeated runs with a required pass count, batch history and comparison. Judgement is a ladder: exact phrases first, a local meaning check next, and an optional judge model last — each rung only when the cheaper one could not decide, and every result says which rung decided. The meaning check needs the `agentcanvas-adapters[nli]` extra and is only available when you run from source; the Docker image does not include it.
- **Improve.** Say what should get better; the model proposes a graph change — grounded in your test results when you have some — and you review it like an Architect draft.
- **Talk.** Publish a revision, converse with the published version, browse past conversations, and see the spots worth fixing derived from them.
- **A model picker that tells the truth.** Models this server can actually call come first; the rest stay visible but disabled, with the reason.

## Why it is built this way

- **The contract is the source of truth.** Screen, engine and API are all projections of `AgentSpec` and `RunEvent`. Nothing on screen means something the contract does not say.
- **Plain language, and no term without an explanation.** A domain expert should know what to do within a few seconds of seeing a screen, and a mistake should never be scary: refusals say why at the place your hand is, and undo brings things back.
- **Honest evaluation.** A green pill is not proof of quality. Tests judge phrase inclusion, meaning, or a judge model — the UI always says which layer decided, and what the answer actually was.
- **Yours to run.** Two containers, one SQLite file, forward-only migrations with verified backups. No accounts, no telemetry, no cloud dependency beyond the model provider you choose.

## Status

Works today: everything in *What you can do* above; one administrator signs in with a password and every other request is refused; the run and test queue survives a restart; Docker Compose deployment.

Not yet: multiple users, roles or shared workspaces; a guarantee that a provider is called exactly once per step; running more than one server, PostgreSQL or Kubernetes; structured logs, metrics, rate limits or backups to another machine; a real MCP executor, a release/rollback workflow and the other ideas under [`docs/vision/`](docs/vision/) (some of which have since shipped and are marked there). Prebuilt images and packages will follow once they can ship with a list of what is inside them, checksums and a complete license bundle.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `AGENTCANVAS_ADMIN_PASSWORD` | required | Single admin password (12+ characters) |
| `AGENTCANVAS_SESSION_SECRET` | required | Separate HMAC session secret (32+ UTF-8 bytes) |
| `AGENTCANVAS_SECRET_OPENAI_API_KEY` | empty | OpenAI key. Together with the model ID below it enables the Architect, Improve and tool wrapping |
| `AGENTCANVAS_OPENAI_MODEL` | empty | The OpenAI model ID to use; AgentCanvas never picks one for you. Both this and the key must be set |
| `AGENTCANVAS_SECRET_ANTHROPIC_API_KEY` | empty | Enables the bundled Anthropic models for runs and tests |
| `AGENTCANVAS_LOCAL_MODEL` / `AGENTCANVAS_LOCAL_BASE_URL` | empty / `http://host.docker.internal:11434/v1` | An OpenAI-compatible local endpoint (Ollama, vLLM, …) |
| `AGENTCANVAS_JUDGE_MODEL` | `model://default` (Anthropic) | Which model the optional judge rung in Test mode calls. On a server with only an OpenAI key set it to `model://openai`, otherwise the judge is not offered |
| `AGENTCANVAS_BIND` / `AGENTCANVAS_PORT` | `127.0.0.1` / `8080` | Where Studio is published |
| `AGENTCANVAS_ALLOWED_ORIGINS` | `http://localhost:8080` (Compose) | Exact list of browser origins allowed to call the API; `*` is rejected. Running from source, the default allows only the local Studio dev server |
| `AGENTCANVAS_SESSION_TTL_SECONDS` | `28800` | Fixed session expiry (60 s – 7 days) |
| `AGENTCANVAS_COOKIE_SECURE` | `false` | Must be `true` behind HTTPS |
| `AGENTCANVAS_DB` | `/data/agentcanvas.db` | SQLite path |
| `AGENTCANVAS_BACKUP_RETENTION` | `10` | How many migration backups to keep. In Compose the backups live in the `/backups` volume; from source, in `backups/` next to the database |
| `VITE_API_URL` | `/api` | API URL baked into the Studio bundle at build time — rebuild after changing |

Keep keys in `.env` only; the file is ignored by git and the server never sends a key to the browser.

## Security and data

Every request except health checks and login is refused unless it carries the signed session cookie, and requests that change something must also carry an `X-CSRF-Token` header (this stops another website from acting in your name). The default profile is loopback HTTP, so remote deployments must add TLS or a reverse proxy and set `AGENTCANVAS_COOKIE_SECURE=true`. There is no built-in TLS, OIDC or MFA. Details: [`docs/security/authentication.md`](docs/security/authentication.md).

The database and its migration backups live in two Compose volumes. Migrations only move forward; when a database already holds data, a backup is taken and verified before anything changes, and unknown schemas abort startup rather than being guessed at. Details: [`docs/operations/durability.md`](docs/operations/durability.md), [`docs/operations/backup-and-restore.md`](docs/operations/backup-and-restore.md), [`docs/operations/deployment.md`](docs/operations/deployment.md).

## Local development

Requires Python 3.12+, uv 0.8.15, Node.js 22.20+, pnpm 10.15.1.

```bash
uv sync --frozen && pnpm install --frozen-lockfile
export AGENTCANVAS_ADMIN_PASSWORD='local-development-admin-password'
export AGENTCANVAS_SESSION_SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
uv run --frozen uvicorn agentcanvas_api.app:serves --factory --reload   # API on :8000
pnpm dev                                                                # Studio on :5173, in another terminal
```

Open Studio at `http://localhost:5173` (use `localhost`, not `127.0.0.1` — the session cookie is bound to it). The API database defaults to `agentcanvas.db` in the repository root; set `AGENTCANVAS_DB` to keep experiments apart.

The same checks CI runs:

```bash
uv run --frozen ruff check packages && uv run --frozen ruff format --check packages
uv run --frozen pytest
pnpm test && VITE_API_URL=/api pnpm build
pnpm gen:types && git diff --exit-code -- apps/studio/src/generated
```

## How the repository is laid out

Dependencies point one way: `contracts ← engine ← adapters ← apps`.

- `packages/contracts` — `AgentSpec`, `RunEvent`, eval, architect, chat and release contracts, plus the JSON Schemas generated from them
- `packages/engine` — graph validation, the routed runtime, the evaluation ladder
- `packages/adapters` — provider boundary (Anthropic, OpenAI-compatible), architect and case-suggestion prompts, tool calls
- `packages/api` — FastAPI, authentication, SQLite stores, SSE, the durable worker
- `apps/studio` — the React/TypeScript Studio
- `examples/` — versioned contract examples · `docs/` — [design language](docs/design/design-language.md), the binding [UI spec](DESIGN.md), [product scope](PRODUCT.md), [architecture](docs/AGENTCANVAS_DESIGN.md), [operations](docs/operations/), [security](docs/security/), and [vision](docs/vision/) (proposals, not capabilities)

## Community and contributing

Questions and ideas go to [GitHub Discussions](https://github.com/yunho-ju/agentcanvas/discussions); defects go through the [issue templates](https://github.com/yunho-ju/agentcanvas/issues/new/choose). Pull requests are welcome — read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. Every commit needs a DCO sign-off (`git commit -s`); CI checks it. Security reports follow [`SECURITY.md`](SECURITY.md), and the project's decision rules are in [`GOVERNANCE.md`](GOVERNANCE.md).

## License

Apache License 2.0 — see [`LICENSE`](LICENSE). Third-party notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
