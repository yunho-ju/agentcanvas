# Changelog

AgentCanvas의 사용자에게 영향을 주는 변경은 이 문서에 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)를 따르고, Git tag와 source release는 [Semantic Versioning](https://semver.org/)을 사용합니다.

## 버전·호환성 정책

- Git tag, 문서와 Node package는 SemVer(`0.1.0-alpha.1`)를 사용합니다. 같은 source의 Python metadata는 PEP 440 대응 버전(`0.1.0a1`)을 사용합니다.
- `0.x`와 prerelease 동안 HTTP API, 환경변수, Python API와 UI는 안정 계약이 아닙니다. Alpha 사이에도 breaking change가 있을 수 있습니다.
- Breaking change, 제거, 수동 조치와 data migration은 해당 release의 `Changed`, `Removed` 또는 `Migration`에 기록합니다.
- DB upgrade는 문서화된 순방향 schema 경로만 지원합니다. Downgrade와 알 수 없는 schema의 자동 변환은 지원하지 않습니다.
- Versioned contract의 비호환 변경은 새 schema version 또는 명시적 migration을 요구합니다.
- 가능한 경우 제거 전 alpha 한 번 이상 deprecation을 알립니다. 보안 또는 data 손상 방지 변경은 예고 없이 적용할 수 있으며 이유를 release note에 기록합니다.
- Prerelease 장기 backport와 상업적 SLA는 제공하지 않습니다. [`SUPPORT.md`](SUPPORT.md)를 참고하세요.

## [Unreleased]

다음 항목은 `v0.1.0-alpha.1` 최초 공개 후보입니다. Release commit과 tag가 생성되기 전까지 released version으로 간주하지 않습니다.

### Added

- `AgentSpec`, node registry, RunEvent, evaluation 및 `ReleaseManifest` schema/data contract.
- React/TypeScript Studio의 Build, Run, Evaluate와 Guided Architect preview.
- AgentSpec CRUD, immutable revision history, routed run, SSE, human gate와 run comparison.
- Eval dataset, repeated attempt, batch history/detail/comparison과 deterministic `expected_phrases` evaluator.
- FastAPI control plane과 SQLite spec/run/eval persistence.
- SQLite v0/v1→v2 migration, migration 전 backup과 read-only verification command.
- Durable run/eval queue, lease/heartbeat, restart recovery, cancellation과 idempotency boundary.
- 단일 관리자 session 인증, CSRF, exact-origin CORS와 live/readiness endpoint.
- Source-built multi-stage Dockerfile과 loopback-first Docker Compose profile.
- Apache-2.0, DCO와 기여·보안·지원·거버넌스 정책.
- Evaluation ladder: exact `expected_phrases`, then an optional local meaning check (`agentcanvas-adapters[nli]` extra, source runs only), then an optional judge model (`AGENTCANVAS_JUDGE_MODEL`, default `model://default`).
- Every evaluation result records the rung that decided it (`judged_by`), and the eval screen shows the instructions under test, the missing phrases and the deciding layer.
- AI-suggested evaluation cases the person keeps or drops, aware of which tools the graph can actually call.
- Talk mode: publish a revision, chat with the published version, list past conversations, read the fix spots derived from them, and turn a real conversation turn into a test case.
- Improve mode: state an objective and review a candidate graph change the model proposes, grounded in existing test batches when there are any.
- Tool wrapping: paste an API document and approve it as a connection with tools (`POST /tools/wrap`), drag tool nodes from the palette, re-import or delete connections.
- HTTP tool adapter that runs tool nodes for real, with failures on the error port, an optional hold for approval before a call, and carry/retrieve/digest handling for large responses.
- `GET /models` lists the models this server can actually call, and the model picker offers those first while keeping the rest visible but disabled with the reason.
- Architect drafts fill each step's `model_ref` with a model this server can call and name the graph's input row `message`, so a draft can be talked to once published.

### Changed

- OpenAI provider는 API key뿐 아니라 `AGENTCANVAS_OPENAI_MODEL`도 명시해야 활성화됩니다. AgentCanvas는 외부 model 기본값을 선택하지 않습니다.
- Node cards re-measure their ports when the ports change, so a hand-placed input node can be connected.
- New palette nodes land where the person is looking, and Tidy puts unconnected nodes in one row and fits the view.
- The top bar, mode segment and canvas corners share one responsive grid and no longer overlap at narrow desktop widths; the minimap fits its container and Sign out moved into the document menu.
- Popovers (document menu, revision history, node picker, confirmations) are opaque and always stack above the floating layer.
- The first-steps card counts a finished run from run history and folds to one line while a mode panel is open.
- The run button is idempotent — pressing it again keeps the input card open — and Talk opens on the composer when there is no past conversation to continue.
- Saving a document the server already has issues one PUT instead of a POST that fails with 409 first.
- Docker Compose passes `AGENTCANVAS_JUDGE_MODEL` through to the API.

### Security

- 관리자 비밀번호나 session secret이 유효하지 않으면 API startup이 fail closed합니다.
- Session cookie는 HttpOnly·SameSite=Strict이고 HTTPS 배포에서 Secure 설정을 요구합니다.
- Provider secret은 환경변수로만 주입하며 spec, browser contract와 image에 포함하지 않습니다.

### Known limitations

- 단일 신뢰 관리자와 하나의 암묵적 workspace만 지원합니다.
- TLS/trusted proxy, Kubernetes, horizontal scaling과 rolling SQLite migration을 제공하지 않습니다.
- 외부 provider side effect의 exactly-once를 보장하지 않습니다.
- 평가는 문구·뜻·심판 모델 판정을 사다리로 쌓은 regression이며, 모델 품질·안전·task success 증거가 아닙니다. 뜻 비교는 `agentcanvas-adapters[nli]`를 추가로 설치한 source 실행에서만, 심판 모델은 `AGENTCANVAS_JUDGE_MODEL`이 이 서버가 부를 수 있는 모델일 때만 동작합니다.
- Improve는 후보를 제안할 뿐, 후보를 자동으로 돌려 base와 성적을 비교해 주지는 않습니다.
- ReleaseManifest는 schema contract만 존재하며 release workflow, Investigate와 실제 MCP executor는 구현되지 않았습니다.
- 현재 범위는 source distribution입니다. Prebuilt image/binary에는 artifact별 license bundle, SBOM, digest와 signature가 추가로 필요합니다.
