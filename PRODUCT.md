# AgentCanvas Product

## 제품 정의

AgentCanvas는 비개발자도 AI agent graph를 만들고, 실행 흐름을 관찰하고, 반복 평가할 수 있게 하는 open-source visual control plane입니다. 화면의 graph는 장식이 아니라 versioned 실행 계약인 `AgentSpec`의 투영입니다.

## 대상 사용자

- **주 사용자:** code와 agent framework 전문 지식 없이 업무 흐름을 설계·검토하려는 domain expert와 operator
- **부 사용자:** self-host 환경을 설치하고 contract/provider를 확장하는 developer

현재 alpha는 한 명의 신뢰 관리자와 하나의 암묵적 workspace를 전제로 합니다. 공용 multi-user 또는 managed SaaS가 아닙니다.

## 현재 alpha

| 영역 | 제공하는 것 | 경계 |
|---|---|---|
| Build | node/edge 편집, validation, inspector, undo/redo, Impact Preview, save/revision | account·role·공유 workspace 없음 |
| Guided | 자연어→제한된 AgentSpec patch preview→검토→명시적 적용 | OpenAI key와 model ID 필요, 자동 저장·배포 안 함 |
| Run | SSE timeline, human gate, cancel, history와 정적 비교 | 외부 provider exactly-once와 full provenance 없음 |
| Evaluate | dataset, 반복 attempt, batch history/detail/comparison | `expected_phrases` 포함 판정만 지원 |
| Operate | 단일 관리자 auth, SQLite migration/backup, durable jobs, Compose | TLS, horizontal scaling, managed backup 없음 |

Build, Run, Evaluate가 현재 Studio mode입니다. Blank canvas에서 Guided onboarding도 제공됩니다. Existing graph용 Architect patch API는 preview-only이며 해당 patch UI는 아직 없습니다.

## 제품 원칙

1. **쉬운 말:** 기술 용어는 쉬운 설명과 함께 제공합니다.
2. **안심:** 되돌리기와 영향 미리보기를 우선하고 destructive action을 숨기지 않습니다.
3. **정직한 화면:** 보이는 graph, 저장된 contract와 실행이 어긋나지 않아야 합니다.
4. **명시적 승인:** AI 제안은 schema·graph 검증을 통과해도 사용자가 승인하기 전에는 적용·저장·배포하지 않습니다.
5. **접근성:** 상태를 색만으로 표현하지 않고 keyboard와 reduced-motion 경로를 유지합니다.
6. **증거의 한계:** fixture, deterministic eval과 local run 결과를 real-provider 품질 또는 production 보장으로 표현하지 않습니다.

## 디자인 기반

- 한국어와 영어 UI
- Bundled Pretendard; 외부 CDN 없음
- Flow Cyan 기반 light/dark token system
- Node Registry와 schema 기반 inspector
- 실행 상태를 나타내는 경우에만 motion 사용

구현 값의 단일 출처는 `apps/studio/src/tokens.css`, UI interaction contract는 [`DESIGN.md`](DESIGN.md)입니다.

## 장기 비전

다음은 현재 alpha capability가 아닙니다.

- 사용자·role·workspace sharing과 collaboration
- Model Matrix와 통계적/LLM-based evaluation
- Prompt Studio, release approval, deployment와 rollback
- Investigation Mode와 Issue Chat
- MCP gateway/executor, LangGraph adapter와 complete provenance/replay
- 3D Runtime World

제안 문서는 [`docs/vision/`](docs/vision/) 아래에서 current/proposed를 구분해 관리합니다.
