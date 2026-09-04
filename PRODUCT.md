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
| Build(만들기) | node/edge 편집, validation, inspector, undo/redo, Impact Preview, save/revision | account·role·공유 workspace 없음 |
| Run(실행) | SSE timeline, human gate, cancel, history와 정적 비교, AI 단계가 도구를 부르며 답을 다듬는 여러 번의 시도(시도마다 묶여 보이고, 문서가 정한 횟수·도구 호출 수에서 멈춘 뒤 마지막으로 한 번 정리해 답한다) | 외부 provider exactly-once와 full provenance 없음, 단계 사이 병렬 실행·다른 문서 부르기 없음 |
| Test(시험) | dataset, AI 케이스 제안(그래프가 부를 수 있는 도구를 앎), 반복 attempt, batch history/detail/comparison, 판정 사다리(정확한 문구 → 뜻 비교 → 심판 모델)와 결과마다 `judged_by` 표시 | 뜻 비교는 `agentcanvas-adapters[nli]` 추가 설치 + source 실행에서만, 심판 모델은 `AGENTCANVAS_JUDGE_MODEL`이 이 서버가 부를 수 있는 모델일 때만 |
| Improve(고치기) | 목표 문장 → 모델이 graph 변경 후보를 제안(시험 batch가 있으면 그것을 근거로) → 사람이 검토 후 적용 | 후보를 자동으로 돌려 base와 성적을 비교해 주지는 않음 |
| Talk(대화) | revision publish, 내놓은 판과 대화, 지난 대화 목록, 대화에서 뽑은 고칠 지점, 대화 한 줄→시험 케이스 | 여러 사용자에게 여는 공개 창구·release/rollback 절차 없음 |
| AI Architect | 자연어→(필요하면 '이런 게 필요한가요' 되묻기 최대 3개)→검토 마친 draft(contract·flow·fake run 통과, step의 `model_ref`까지 채움)→명시적 적용 | OpenAI key와 model ID 필요, 자동 저장·배포 안 함, 되묻기는 한 번뿐 |
| Tools(도구) | API 문서를 붙여 connection·tool로 승인, palette의 도구 노드, HTTP 실행, 실행 전 승인, 큰 응답 다루기, **AI 단계가 직접 도구를 골라 부르기**(같은 승인 정책·같은 이벤트) | 실제 MCP executor 없음 |
| Shapes(모양) | 이 서버가 실제로 돌릴 수 있는 모양 목록(도구를 쓰며 답 다듬기 · 사람이 확인하고 넘어가기 · 갈래 나누기)을 Architect 되묻기·팔레트·고치기 제안이 함께 읽음 | 서브에이전트·병렬·반복 모양 없음, 모양을 사람이 새로 정의할 길 없음 |
| Skills(skill) | 표준 `SKILL.md`를 문서 안에 보관, AI 단계가 입음(모델 지시에 실리고 실행 이벤트에 기록), 붙여넣기·주소·검색(문서→시작 skill→skills.sh)으로 가져오기, 지시문을 skill로 만들기(모델 초안, 없으면 틀), Architect 초안이 skill을 고름 | 지시 전용(`scripts/` 실행 안 함), Improve 제안에는 아직 없음, 원격 검색은 `npx` 필요 |
| Operate | 단일 관리자 auth, SQLite migration/backup, durable jobs, Compose, `GET /models` 기반 모델 목록 | TLS, horizontal scaling, managed backup 없음 |

Build, Run, Test, Improve, Talk 다섯 가지가 현재 Studio mode입니다. Blank canvas에서 AI Architect onboarding도 제공됩니다. Existing graph용 Architect patch API는 preview-only이며 해당 patch UI는 아직 없습니다.

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
- Model Matrix와 통계적 evaluation (LLM judge 자체는 현재 alpha의 시험 사다리 마지막 칸으로 있습니다)
- Prompt Studio, release approval, deployment와 rollback
- Improve 후보를 자동으로 돌려 base와 나란히 놓는 evidence table
- Investigation Mode와 Issue Chat
- MCP gateway/executor, LangGraph adapter와 complete provenance/replay
- 3D Runtime World

제안 문서는 [`docs/vision/`](docs/vision/) 아래에서 current/proposed를 구분해 관리합니다.
