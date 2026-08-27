# Third-Party Notices

AgentCanvas 자체 코드는 Apache License 2.0으로 제공됩니다. 이 문서는 AgentCanvas의 lockfile로 해석되는 런타임 제3자 구성요소를 기록하며, 각 구성요소의 원 라이선스를 변경하거나 대체하지 않습니다.

이 목록은 공개 source snapshot의 `uv.lock`과 `pnpm-lock.yaml`에 고정된 runtime dependency를 기록합니다. Release를 만들 때 다음 명령으로 lockfile과 설치 metadata의 일치 여부를 다시 검증해야 합니다.

```bash
uv tree --no-dev
pnpm licenses list --prod --json
```

의존성을 갱신할 때 이 문서도 함께 갱신합니다. 이 inventory는 source distribution의 안내이며 artifact별 완전한 license bundle을 대신하지 않습니다. 미리 빌드한 wheel, JavaScript bundle 또는 container image를 배포하기 전에는 해당 artifact에 포함된 원문 license/copyright/NOTICE, exact image digest, SBOM과 필요한 attribution을 별도로 생성하고 보존해야 합니다.

## Python API runtime

| Component | Resolved version | License |
|---|---:|---|
| annotated-doc | 0.0.5 | MIT |
| annotated-types | 0.8.0 | MIT |
| anthropic | 0.122.0 | MIT |
| anyio | 4.14.2 | MIT |
| certifi | 2026.7.22 | MPL-2.0 |
| click | 8.4.2 | BSD-3-Clause |
| distro | 1.9.0 | Apache-2.0 |
| docstring-parser | 0.18.0 | MIT |
| fastapi | 0.141.1 | MIT |
| h11 | 0.16.0 | MIT |
| httpcore | 1.0.9 | BSD-3-Clause |
| httpcore2 | 2.10.0 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| httpx2 | 2.10.0 | BSD-3-Clause |
| idna | 3.18 | BSD-3-Clause |
| jiter | 0.16.0 | MIT |
| openai | 3.2.0 | Apache-2.0 |
| pydantic | 2.13.4 | MIT |
| pydantic-core | 2.46.4 | MIT |
| sniffio | 1.3.1 | MIT OR Apache-2.0 |
| starlette | 1.6.0 | BSD-3-Clause |
| tqdm | 4.70.0 | MPL-2.0 AND MIT |
| truststore | 0.10.4 | MIT |
| typing-extensions | 4.16.0 | PSF-2.0 |
| typing-inspection | 0.4.4 | MIT |
| uvicorn | 0.52.3 | BSD-3-Clause |

Python package의 정확한 license text와 copyright notice는 설치된 distribution의 `.dist-info` metadata와 해당 upstream source distribution에 포함됩니다. 주요 upstream은 다음과 같습니다.

- Anthropic SDK: <https://github.com/anthropics/anthropic-sdk-python>
- OpenAI Python SDK: <https://github.com/openai/openai-python>
- FastAPI: <https://github.com/fastapi/fastapi>
- Pydantic: <https://github.com/pydantic/pydantic>
- Uvicorn: <https://github.com/Kludex/uvicorn>

## Studio runtime

### MIT

- `@types/d3-color` 3.1.3
- `@types/d3-drag` 3.0.7
- `@types/d3-interpolate` 3.0.4
- `@types/d3-selection` 3.0.11
- `@types/d3-transition` 3.0.9
- `@types/d3-zoom` 3.0.8
- `@types/prop-types` 15.7.15
- `@types/react` 18.3.31
- `@types/react-dom` 18.3.7
- `@xyflow/react` 12.11.3
- `@xyflow/system` 0.0.80
- `ajv` 8.20.0
- `ajv-formats` 3.0.1
- `classcat` 5.0.5
- `csstype` 3.2.3
- `fast-deep-equal` 3.1.3
- `js-tokens` 4.0.0
- `json-schema-traverse` 1.0.0
- `loose-envify` 1.4.0
- `react` 18.3.1
- `react-dom` 18.3.1
- `require-from-string` 2.0.2
- `scheduler` 0.23.2
- `use-sync-external-store` 1.6.0
- `zustand` 4.5.7 and 5.0.15

### ISC

- `d3-color` 3.1.0
- `d3-dispatch` 3.0.1
- `d3-drag` 3.0.0
- `d3-interpolate` 3.0.1
- `d3-selection` 3.0.0
- `d3-timer` 3.0.1
- `d3-transition` 3.0.1
- `d3-zoom` 3.0.0

### BSD-3-Clause

- `d3-ease` 3.0.1
- `fast-uri` 3.1.5

### SIL Open Font License 1.1

- `pretendard` 1.3.9, Copyright Kil Hyung-jin and the Pretendard contributors
- Upstream: <https://github.com/orioncactus/pretendard>
- License identifier: `OFL-1.1`

Pretendard font files are bundled into the Studio output. Font 수정·재배포 시 SIL Open Font License 1.1의 reserved font name과 기타 조건을 확인해야 합니다.

Studio package의 정확한 license text와 copyright notice는 설치된 package의 license file과 upstream source distribution에 포함됩니다. 주요 upstream은 다음과 같습니다.

- React: <https://github.com/facebook/react>
- React Flow / xyflow: <https://github.com/xyflow/xyflow>
- Ajv: <https://github.com/ajv-validator/ajv>
- Zustand: <https://github.com/pmndrs/zustand>
- D3 modules: <https://github.com/d3>

## Container base images

로컬 Compose build는 다음 base image를 사용합니다.

- `python:3.12.11-slim-bookworm`
- `node:22.20.0-bookworm-slim` (build stage only)
- `nginxinc/nginx-unprivileged:1.28.0-alpine`

각 base image는 언어 runtime, Debian 또는 Alpine package와 자체 license/notice를 포함합니다. AgentCanvas는 그 license를 변경하지 않습니다. 미리 빌드한 image를 공개 배포하기 전에는 exact image digest를 고정하고 해당 image에 포함된 OS package license, SBOM과 upstream notice를 artifact와 함께 보존해야 합니다.

## No endorsement

제3자 프로젝트 이름과 상표는 attribution과 호환성 설명을 위해서만 사용합니다. 각 upstream 저작권자나 contributor가 AgentCanvas를 보증한다는 의미가 아닙니다.
