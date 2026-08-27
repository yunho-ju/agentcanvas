# Contributing to AgentCanvas

AgentCanvas에 관심을 가져 주셔서 감사합니다. 현재 프로젝트는 단일 관리자 self-hosted 환경을 대상으로 하는 공개 알파 준비 단계입니다. 호환성보다 계약의 명확성, 재현 가능한 검증, 데이터·보안 경계를 우선합니다.

## Before you start

- 버그와 작은 문서 수정은 바로 pull request를 열 수 있습니다.
- 새로운 기능, schema/API 변경, dependency 추가, 대규모 refactor는 먼저 issue에서 범위와 migration 영향을 합의해 주세요.
- 보안 취약점은 공개 issue가 아니라 [`SECURITY.md`](SECURITY.md)의 비공개 절차를 사용해 주세요.
- 실제 API key, 사용자 데이터, `.env`, SQLite DB, provider 원문 응답을 issue·PR·fixture에 포함하지 마세요.

## Development setup

필요 조건:

- Python 3.12+
- uv 0.8.15
- Node.js 22.20+
- pnpm 10.15.1

```bash
uv sync --frozen
pnpm install --frozen-lockfile
```

로컬 API와 Studio 실행 방법은 [`README.md`](README.md)의 로컬 개발 절차를 따릅니다.

## Validation

변경한 영역의 targeted test를 먼저 실행한 뒤 관련 전체 gate를 실행해 주세요.

```bash
uv run --frozen ruff check packages
uv run --frozen ruff format --check packages
uv run --frozen pytest
pnpm test
VITE_API_URL=/api pnpm build
pnpm gen:types
git diff --exit-code -- apps/studio/src/generated
```

Docker 또는 운영 설정을 변경했다면 다음도 확인합니다.

```bash
docker compose --env-file .env.example config --quiet
docker build --target api-runtime --tag agentcanvas-api:contributor-check .
docker build --target studio-runtime --build-arg VITE_API_URL=/api --tag agentcanvas-studio:contributor-check .
```

실제 provider credential이 필요한 acceptance는 maintainer와 범위·비용·데이터 노출을 먼저 합의하지 않는 한 PR gate로 요구하지 않습니다.

## Pull requests

- 하나의 PR에는 하나의 목적을 담아 주세요.
- 사용자에게 보이는 동작, schema, API, migration 또는 운영 절차가 바뀌면 관련 문서를 함께 수정해 주세요.
- generated file은 generator를 실행해 갱신하고 직접 편집하지 마세요.
- 기존 migration을 변경하지 말고 필요한 경우 새 순방향 migration을 추가해 주세요.
- 내부 예외, secret, prompt 원문을 API 오류나 영속 terminal reason에 추가하지 마세요.
- 검증한 명령과 아직 검증하지 못한 경계를 PR 설명에 적어 주세요.

AI 도구를 사용한 기여도 같은 기준을 적용합니다. 중요한 설계·보안·라이선스 결정과 생성된 코드의 검증 책임은 기여자에게 있으며, PR 설명에 실질적인 AI 보조 사용을 간단히 밝혀 주세요.

## Developer Certificate of Origin

AgentCanvas는 CLA 대신 [Developer Certificate of Origin 1.1](DCO)을 사용합니다. 모든 commit에 다음 형식의 sign-off가 있어야 합니다.

```text
Signed-off-by: Your Name <your.email@example.com>
```

Git에서 `-s` 옵션으로 추가할 수 있습니다.

```bash
git commit -s -m "Describe the change"
```

sign-off는 commit의 저작권을 프로젝트에 양도한다는 뜻이 아니라, 해당 기여를 제출할 권리가 있고 프로젝트 라이선스에 따라 제공할 수 있음을 확인하는 것입니다.

## License of contributions

별도 서면 합의가 없는 한 AgentCanvas에 의도적으로 제출된 기여는 프로젝트와 동일한 [Apache License 2.0](LICENSE) 조건으로 제공됩니다. 기여자는 포함한 제3자 코드·자산의 라이선스와 attribution 의무를 밝히고 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)를 필요한 경우 갱신해야 합니다.

## Community expectations

모든 참여자는 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)를 따라야 합니다. 사용 방법과 지원 범위는 [`SUPPORT.md`](SUPPORT.md)를 참고하세요.
