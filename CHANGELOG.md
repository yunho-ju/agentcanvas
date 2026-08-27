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

### Changed

- OpenAI provider는 API key뿐 아니라 `AGENTCANVAS_OPENAI_MODEL`도 명시해야 활성화됩니다. AgentCanvas는 외부 model 기본값을 선택하지 않습니다.

### Security

- 관리자 비밀번호나 session secret이 유효하지 않으면 API startup이 fail closed합니다.
- Session cookie는 HttpOnly·SameSite=Strict이고 HTTPS 배포에서 Secure 설정을 요구합니다.
- Provider secret은 환경변수로만 주입하며 spec, browser contract와 image에 포함하지 않습니다.

### Known limitations

- 단일 신뢰 관리자와 하나의 암묵적 workspace만 지원합니다.
- TLS/trusted proxy, Kubernetes, horizontal scaling과 rolling SQLite migration을 제공하지 않습니다.
- 외부 provider side effect의 exactly-once를 보장하지 않습니다.
- 평가는 phrase-contract regression이며 모델 품질·안전·task success 증거가 아닙니다.
- ReleaseManifest는 schema contract만 존재하며 release workflow, Investigate와 실제 MCP executor는 구현되지 않았습니다.
- 현재 범위는 source distribution입니다. Prebuilt image/binary에는 artifact별 license bundle, SBOM, digest와 signature가 추가로 필요합니다.
