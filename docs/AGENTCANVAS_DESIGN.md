# AgentCanvas Architecture

이 문서는 `v0.1.0-alpha.1` source가 구현한 아키텍처와 명시적 비보장 범위를 설명합니다. 장기 제안은 [`vision/`](vision/)에 있으며 현재 capability로 간주하지 않습니다.

## 1. 시스템 경계

```text
Browser
  └─ Studio (React/TypeScript/Vite)
       └─ same-origin /api proxy
            └─ FastAPI control plane
                 ├─ auth/CSRF/CORS
                 ├─ AgentSpec service
                 ├─ routed run service + SSE
                 ├─ evaluation service
                 ├─ durable job worker
                 └─ SQLite v2 stores
                      ├─ specs + revisions
                      ├─ runs + events
                      ├─ eval datasets + batches
                      └─ durable jobs

Provider boundary
  ├─ Anthropic
  ├─ explicit OpenAI model
  ├─ OpenAI-compatible local endpoint
  └─ deterministic fallback
```

지원 배포 profile은 하나의 API process/worker가 하나의 file-backed SQLite DB를 소유하는 single-node self-host입니다. Studio는 Compose에서 loopback에만 bind되고 API는 internal network에 있으며 Nginx가 `/api`를 proxy합니다.

## 2. Versioned contracts

`packages/contracts`가 Python model과 generated JSON Schema의 source입니다.

- `AgentSpec`: graph, ports, schemas, resources, execution settings와 canonical revision
- `RunEvent`: append-only run observation and status projection
- Evaluation contracts: datasets, cases, repeated attempts와 batch results
- Architect patch: 제한된 `agent.patch/v1` operation과 preview response
- `ReleaseManifest`: release composition을 표현하는 data contract만 제공

Server는 저장 시 spec version/revision을 소유하고 update에 `If-Match` optimistic concurrency를 사용합니다. Release 저장, promotion, deployment와 rollback runtime은 없습니다.

## 3. Studio

Studio는 같은 contract의 세 가지 projection을 제공합니다.

### Build

- Node Registry 기반 palette/inspector
- node/edge 편집, port compatibility와 graph validation
- undo/redo, Impact Preview
- file import/export와 server save/open
- immutable revision history 조회
- Korean/English, light/dark token system

### Run

- 입력 binding form과 routed execution
- SSE `RunEvent` stream, resume cursor와 timeline
- human approval/reject/resume
- cancellation, history, replay projection과 static two-run comparison

### Evaluate

- dataset/case create/update/delete
- repeated attempts와 required pass count
- batch start/cancel/history/detail/comparison
- deterministic normalized `expected_phrases` evaluator

이 evaluator는 output에 모든 기대 phrase가 포함됐는지만 판정합니다. Quality, safety, groundedness와 task success를 측정하지 않습니다.

## 4. Guided Architect

Blank canvas Guided flow는 다음 순서를 지킵니다.

```text
natural-language request
  → POST /architect/draft
  → canonical blank AgentSpec seed
  → provider returns restricted agent.patch/v1
  → pure patch apply
  → contract/raw-secret/graph validation
  → Studio schema/graph/dry-run review
  → user approval
  → draft applied to canvas
```

Candidate는 preview-only입니다. 생성만으로 DB에 저장되거나 publish되지 않습니다. 실패 시 local 성공으로 대체하지 않습니다. Guided는 명시적인 OpenAI key와 model ID가 필요합니다. `POST /architect/patch`는 existing spec preview API이지만 Studio에 existing-graph patch UI는 없습니다.

## 5. Runtime and providers

`packages/engine`의 routed runtime은 graph validation 결과와 model-call abstraction을 사용합니다. `packages/adapters`가 provider-specific request를 격리합니다.

- Anthropic key가 있으면 built-in Anthropic catalog가 활성화됩니다.
- OpenAI는 key와 `AGENTCANVAS_OPENAI_MODEL`을 모두 명시해야 catalog에 추가됩니다.
- Local provider는 model ID와 OpenAI-compatible base URL을 사용합니다.
- Usable provider가 없으면 ordinary run/eval은 deterministic fallback을 사용할 수 있습니다.

외부 provider call은 exactly-once가 아닙니다. Process가 provider side effect 이후 local persistence 전에 종료되면 재시도에서 call이 반복될 수 있습니다.

## 6. Run and durable jobs

Run start, approval resume와 eval batch acceptance는 durable job identity와 함께 transaction으로 저장된 뒤 응답합니다. `Idempotency-Key`는 같은 command에 원래 identity를 재사용하고 다른 command/kind 충돌은 409로 거부합니다.

Worker는 `queued → leased → succeeded|failed|cancelled` 상태를 사용합니다. Lease heartbeat와 owner fencing으로 stale worker write를 막고, startup 뒤 queued 또는 expired lease를 reclaim합니다.

Recovery는 provider를 blind replay하지 않습니다.

- Event가 시작되기 전 중단된 run은 retry할 수 있습니다.
- Safe acceptance boundary를 지난 event가 있는 run continuation은 generic terminal failure로 수렴합니다.
- Eval은 acceptance 시 고정한 dataset/spec snapshot과 attempt ID를 재사용하지만 provider call은 반복될 수 있습니다.
- Cancellation은 cooperative하며 provider/Python call을 force-kill하지 않습니다.

정확한 계약은 [`operations/durability.md`](operations/durability.md)에 있습니다.

## 7. Persistence and migration

하나의 SQLite v2 DB가 spec, revision, run/event, eval과 durable job table을 소유합니다. Central schema owner가 store 생성 전에 실행됩니다.

- fresh/v0와 v1에서 v2로 순방향 migration
- process file lock + `BEGIN IMMEDIATE`
- contiguous `schema_migrations`
- canonical table/index validation
- application data가 있으면 migration 전 SQLite backup API snapshot
- `quick_check`, file/directory fsync와 atomic rename
- current v2 startup에서는 migration backup 반복 없음
- WAL은 current schema validation 뒤 활성화

Unknown/future/non-canonical schema, downgrade, in-memory shared DB, rolling migration과 multi-node SQLite는 지원하지 않습니다.

## 8. Authentication and network

Compose는 `AGENTCANVAS_AUTH_MODE=required`를 고정합니다. Health, login과 CORS preflight만 public이며 다른 현재·미래 HTTP route는 default-deny입니다. Stateless HMAC session cookie, in-memory CSRF nonce와 exact-origin credentialed CORS를 사용합니다.

이 profile은 single trusted administrator용입니다. User database, role, tenant isolation, OIDC, MFA, per-session server revocation, login rate limiting과 built-in TLS는 없습니다. 자세한 계약은 [`security/authentication.md`](security/authentication.md)에 있습니다.

## 9. Readiness

- `/health/live`: process가 HTTP 요청에 응답 가능한지 확인
- `/health/ready`: 네 store read와 durable worker health 확인

Readiness는 provider를 호출하지 않으며 provider availability, queue emptiness, backup restore 가능성 또는 production fitness를 증명하지 않습니다.

## 10. Explicit non-capabilities

현재 source에는 다음이 없습니다.

- account, role, tenant 또는 shared workspace
- release storage/UI, deployment와 rollback
- 게시된 에이전트와 이야기하는 자리, 대화(thread) 개념, 대화 분석 — `AgentStatus.published`는 계약 enum 값일 뿐 아무도 읽지 않고, `runs`에는 대화나 말한 이가 없습니다
- Prompt Studio, safety suite 또는 Model Matrix (시험 사다리의 LLM judge rung은 **있습니다** — 문구·NLI 다음의 선택적 단)
- Investigation Agent와 Issue Chat
- Optimizer — 시험·실행 증거에서 개선 후보 revision을 제안·비교하는 자리, run 증거의 token/latency/cost 텔레메트리
- real MCP client/executor 또는 LangGraph adapter
- PostgreSQL, multi-process coordination guarantee 또는 horizontal scaling
- full prompt/tool/context provenance와 checkpoint fork replay
- 3D Runtime World

이 영역의 제안은 [`vision/product-architecture.md`](vision/product-architecture.md), [`vision/workspace-canvas.md`](vision/workspace-canvas.md), [`vision/prompt-eval-release.md`](vision/prompt-eval-release.md), [`vision/investigation-mode.md`](vision/investigation-mode.md), [`vision/live-chat-and-analytics.md`](vision/live-chat-and-analytics.md), [`vision/optimize.md`](vision/optimize.md)를 참고하세요.

## 11. Source layout

```text
packages/contracts   versioned domain contracts and schemas
packages/engine      graph validation, runtime, evaluator
packages/adapters    provider and secret boundaries
packages/api         HTTP API, auth, services, SQLite, durable worker
apps/studio          browser Studio
examples             contract examples
docs/security        supported security contract
docs/operations      supported operator contract
docs/vision          non-current proposals
```
