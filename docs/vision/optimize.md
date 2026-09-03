# Optimize Vision — 그래프를 스스로 고칠 후보를 만들고, 증거로 비교한다

*Partly shipped. See [`../AGENTCANVAS_DESIGN.md`](../AGENTCANVAS_DESIGN.md) §10.*

> **Status.** 첫 조각이 Studio의 **고치기(Improve)** 모드로 현재 alpha에 있습니다:
> 목표를 한 문장으로 적으면 모델이 그래프 변경 후보 하나를 제안하고, 시험 배치가
> 있으면 서버가 그 근거를 채워 붙이며, 사람이 설계 도우미 초안처럼 검토한 뒤에만
> 적용됩니다.
> **아직 제안인 것**: 후보를 자동으로 돌려 base와 성적을 나란히 놓는 증거 표, 여러
> 후보 생성과 Pareto 비교, 실행 텔레메트리 기반 제안. 제안은 지우지 않고 그대로 둡니다.

만든 에이전트 그래프에 대해 "더 싸게·더 빠르게·더 잘"의 **실험 후보를 AI가 제안**하고,
같은 시험을 돌려 **증거 표로 비교**한 뒤, 사람이 고른 후보가 새 판(revision)이 된다.
쉬운 말로: **"AI가 '이렇게 바꿔 보면 어때요?'를 제안하고, 시험 성적표를 나란히 보여
주면, 내가 골라서 바꾼다."**

착안: JIT-Agent (arXiv:2608.25593) — 에이전트의 harness(기억·계획·도구 편성) 자체를
작업에 맞춰 생성·진화시킨다는 아이디어. AgentCanvas에는 이미 1급 실행 계약물인
AgentSpec이 있으므로, **별도 harness 개념을 만들지 않고 AgentSpec을 harness로
해석한다** — harness 진화 = spec revision의 진화.

## Why

- 지금의 개선 루프는 전부 사람 손이다: 시험 결과를 보고, 캔버스를 고치고, 다시
  돌린다. "무엇을 바꿔 볼지"의 가설 생성과 "바꾼 것이 나은지"의 비교 실행이
  자동화될 수 있는 유일한 자리인데 비어 있다.
- 재료가 이미 거의 다 있다: 제약된 patch 생성(Architect), 결정론적 검증
  (validate_graph), preview→사람 승인 기계, 시험 사다리(문구→NLI→LLM judge),
  revision 의미론. 새 실행 엔진이 아니라 **기존 경계의 세 번째 소비자**를 만드는
  일이다 (첫째 Architect, 둘째 Tool Wrapper).

## Available now / proposed

| Area | Available now | Proposed |
|---|---|---|
| 후보 생성 | Architect가 사람 요구문 → 제약된 patch | 시험·실행 증거 → 개선 가설 → patch 후보 |
| 검증 | validate_graph 게이트, preview 승인 기계 | 그대로 재사용 (새 게이트 없음) |
| 비교 | eval 배치 비교(EVAL_4B) — 품질만 | 품질·비용·지연·안정성 증거 표 (Pareto) |
| 텔레메트리 | **없음** — RunEvent에 token/latency/cost 없음 | 실행 증거에 사용량·지연 기록 |
| 실험 기억 | JudgementMemory (같은 출력·같은 요구의 판정 캐시) | OptimizationExperiment (무엇을 바꿔 봤고 결과가 어땠나) — 별개 개념 |

## Contract

### 관점 1: AgentSpec이 곧 harness다 — 두 번째 harness 개념을 만들지 않는다

후보는 언제나 **base revision + AgentSpecPatch → candidate revision**이다. 후보도
보통의 spec과 같은 revision 규칙을 탄다. 실행은 언제나 정확한 revision에 묶인다.

### 관점 2: Optimizer와 Architect는 다른 질문이다

- **Architect**: "요구한 설계를 만족하는 그래프 변경은 무엇인가" (요구문 → patch)
- **Optimizer**: "지금 그래프는 왜 약하고, 무엇을 실험해 볼 것인가" (증거 → 가설)

Optimizer의 출력 **OptimizationProposal**은 실행물이 아니다 — 목표(objective),
가설, 대상 노드, 제안 변경, 기대 효과(품질/비용/지연), 근거 증거의 **타입 있는
제안문**이다. 그것을 patch로 번역하는 층은 여전히 Architect(제약된 생성)뿐이다.
모델이 임의 코드를 만들지 않는다는 기존 철학 그대로.

### 관점 3: 점수 하나로 뭉개지 않는다 — 증거 표

`0.7·품질 − 0.2·비용` 같은 설명 불가능한 합성 점수를 만들지 않는다. 후보마다
품질·비용·지연·안정성을 **따로** 보여 주고(Pareto frontier), 추천은 "품질 동급,
비용 39% 절감, 안정성 회귀 없음"처럼 **읽을 수 있는 문장**으로 말한다 — eval
화면의 원칙("점수가 아니라 고칠 근거") 그대로.

**측정 못 한 것은 말하지 않는다**: token/latency 텔레메트리가 실행 증거에 실리기
전까지 비용·지연 열은 존재하지 않는다. 품질만 있으면 품질만 비교한다.

### 관점 4: 실험 기억은 판정 기억과 다른 개념이다

JudgementMemory는 "이 출력·이 요구를 이미 판정했나"(시험의 캐시)다.
OptimizationExperiment는 "비슷한 목표에서 어떤 변경이 통했나"(개선의 기억)다 —
base_revision, objective, proposal, candidate_revision, eval_batch_id, 증거,
채택/기각과 이유. 한 개념에 두 책임을 싣지 않는다. 과거 실험의 검색(retrieval)은
기억이 쌓인 뒤의 일이다.

## Slices

**언제**: 이 축은 `API_TOOLS P3`(실제 도구 실행) **뒤**다. 도구가 실행되지 않는
그래프의 최적화는 가짜 적합도 위의 실험이다. OPT-2(자동 비교)는 CHAT-4(대화 분석)
뒤가 자연스럽다 — 실제 대화에서 온 시험 케이스가 가장 좋은 적합도 재료다.

1. **OPT-1 후보 미리보기** — objective를 받아 Optimizer 가설 → Architect 후보
   patch → 검증 → preview. 자동 실행·자동 시험 없음. 사람이 후보를 보고 승인하면
   보통의 revision이 된다. (preview 승인 기계·거절 관례 전량 재사용)
2. **OPT-2 자동 후보 시험** — 후보들을 기존 데이터셋으로 자동 시험, 품질 열 비교.
3. **OPT-3 텔레메트리** — 실행 증거에 token 사용량·지연·도구 실패를 기록 (계약
   확장). 이때부터 비용·지연 열이 정직해진다.
4. **OPT-4 비교·추천 화면** — Pareto 표 + 읽을 수 있는 추천 문장.
5. **OPT-5 실험 영속** — OptimizationExperiment 저장.
6. **OPT-6 실험 검색** — 비슷한 목표의 과거 성공 실험을 다음 제안의 맥락으로.

요청 시점 적응(runtime JIT)은 이 문서의 끝에도 없다 — 훨씬 뒤에, **미리 시험·승인
된 revision들 중에서 고르는 선택기**(FAST/STANDARD/DEEP 프로파일)로만 검토한다.
실행 시점에 검토 안 된 그래프를 발명하는 일은 영원히 하지 않는다.

## Out of scope

- 실행 시점에 그래프를 바꾸는 runtime JIT — 위 문단의 선택기 형태 외에는 없다
- 모델이 임의 실행 코드를 생성하는 것 — patch 제약 생성만
- 자동 채택 — 사람 승인 없이 revision이 되는 후보는 없다
- 시험 사다리 자체의 개선 ([`prompt-eval-release.md`](prompt-eval-release.md))

## Non-negotiables

- **보이는 그래프 = 저장된 계약 = 실행된 그래프.** 최적화가 이 셋을 가르는 순간
  제품이 무너진다. 모든 후보는 검사 가능·버전 있는 1급 계약물이다.
- **결정론적 검증이 최종 권위다** — LLM의 어떤 제안도 validate_graph를 우회하지
  않는다.
- **증거 없는 정밀도 금지** — 측정하지 않은 축의 숫자를 만들지 않는다.
- **비밀·정책 경계 불변** — 최적화가 allowed_tools·approval_policy·secret 규율을
  약화시키는 제안을 하면 그 후보는 검증에서 죽는다.
