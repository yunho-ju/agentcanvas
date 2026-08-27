# AgentCanvas Operations Roadmap

이 문서는 현재 공개 alpha의 운영 capability와 production-ready까지 남은 gate를 구분합니다. 날짜별 local test evidence나 private implementation note를 release 보장으로 사용하지 않습니다.

## 상태 정의

- **Available:** 현재 source와 공개 문서에 구현된 capability
- **Limited:** 구현됐지만 지원 profile 또는 증거가 제한된 capability
- **Planned:** 아직 구현되지 않은 capability

## 현재 공개 alpha

| 영역 | 상태 | 범위 |
|---|---|---|
| Source build | Available | pinned Python/Node toolchain, API/Studio container target, Compose |
| Health | Available | liveness와 store/worker readiness |
| Authentication | Limited | single administrator, stateless session, CSRF, exact-origin CORS |
| Persistence | Limited | single-node SQLite v2, forward migration와 local migration backup |
| Run/eval jobs | Limited | durable queue, lease, restart recovery, cancellation, idempotency |
| CI | Available | Python, Studio, generated types, containers와 isolated Compose smoke workflow |
| Governance | Available | Apache-2.0, DCO, security/support/contribution policy |
| Observability | Planned | structured logs, metrics, correlation와 operational alerts |
| Multi-user/tenant | Planned | accounts, roles, workspace isolation, OIDC/MFA |
| Production release | Planned | artifact SBOM/signing, release workflow, production acceptance |

## P0-A — Reproducible runtime

**상태: Available, deployment profile 제한**

- [x] API liveness/readiness
- [x] pinned Python·Node·pnpm·uv container build
- [x] same-origin `/api` proxy와 SSE buffering 해제
- [x] SQLite DB/WAL과 migration backup의 분리 volume
- [x] loopback-first Compose와 environment example
- [x] Python·Studio·container CI definition
- [x] public setup/deployment documentation

남은 gate:

- [ ] hosted CI가 public release commit에서 통과
- [ ] supported Linux host matrix 정의
- [ ] TLS/reverse proxy reference profile과 long-running SSE acceptance

Deployment contract: [`operations/deployment.md`](operations/deployment.md).

## P0-B — Authentication and isolation

**상태: Limited — single trusted administrator**

- [x] bootstrap administrator password와 signed session cookie
- [x] health/login 외 HTTP route default-deny
- [x] unsafe-method CSRF, Studio session gate와 logout
- [x] exact-origin credentialed CORS와 wildcard startup rejection
- [x] Compose auth-required/fail-closed
- [ ] persistent login rate limit
- [ ] request size/timeout policy
- [ ] accounts, owner/editor/viewer와 cross-workspace isolation
- [ ] OIDC/MFA와 provider secret vault/rotation/audit
- [ ] TLS/trusted-proxy acceptance

Authentication contract: [`security/authentication.md`](security/authentication.md).

## P0-C — Data and job durability

**상태: Limited — single process, single SQLite node**

- [x] central schema owner and v0/v1→v2 forward migration
- [x] migration pre-backup, verification와 read-only diagnostics
- [x] durable run/eval queue, lease, heartbeat와 fencing
- [x] atomic acceptance, idempotency, local crash recovery와 cancellation
- [ ] retention, pagination와 DB growth policy
- [ ] automated off-host backup and recurring restore drill
- [ ] PostgreSQL transition criteria
- [ ] production DB/provider fault acceptance

Contracts and runbooks:

- [`operations/durability.md`](operations/durability.md)
- [`operations/backup-and-restore.md`](operations/backup-and-restore.md)

## P0-D — Observability and safeguards

**상태: Planned**

- JSON structured logging and redaction rules
- request/spec/run/batch correlation IDs
- latency, error, queue depth, SSE client와 provider cost/token metrics
- quota/rate limit and overload behavior
- graceful shutdown acceptance and incident runbook

완료 기준은 대표 장애를 log와 metric만으로 탐지하고 범위를 좁힐 수 있는 것입니다.

## P0-E — Open-source release

**상태: In progress**

- [x] Apache-2.0 `LICENSE`
- [x] `SECURITY.md`, `CONTRIBUTING.md`, Code of Conduct와 support policy
- [x] source runtime dependency inventory와 `THIRD_PARTY_NOTICES.md`
- [x] SemVer/PEP 440 mapping, changelog와 pre-1.0 compatibility policy
- [ ] clean public source snapshot and hosted CI
- [ ] source release tag
- [ ] artifact-specific license bundle, SBOM, digest, signature와 vulnerability scan

## P1 — Production acceptance

**상태: Planned**

- Real-provider quality/cost/latency/error budgets
- Browser Build→Run→Gate→Evaluate acceptance
- Long-running SSE, concurrent client와 DB contention tests
- Backup export and off-host restore evidence
- Bundle splitting, list pagination와 run/eval retention
- Narrow-screen/mobile support boundary

## Product vision, not operations support

Release/deployment UI, Investigation/Issue Chat, MCP execution, Model Matrix, workspace sharing/collaboration와 3D Runtime World는 현재 운영 capability가 아닙니다. 제안은 [`vision/`](vision/) 문서에 분리합니다.

## Production-ready definition

다음 조건을 모두 충족하기 전에는 production-ready로 표현하지 않습니다.

1. Supported environment에서 install/upgrade/restore가 release artifact로 재현됩니다.
2. Authentication과 data isolation threat model이 intended deployment와 일치합니다.
3. Restart와 dependency failure 뒤 accepted work가 documented terminal state로 수렴합니다.
4. Logging, metrics, correlation, quota와 incident runbook이 있습니다.
5. Real provider, browser, backup/restore와 long-running acceptance가 release-specific evidence로 남습니다.
6. CI, vulnerability scan, SBOM, digest/signature와 complete third-party notices가 release gate입니다.
