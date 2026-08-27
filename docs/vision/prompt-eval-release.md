# Prompt, Evaluation and Release Vision

> **Vision document; not a capability statement for `v0.1.0-alpha.1`.** Prompt Studio, LLM judges, safety gates, online evaluation, release promotion/deployment and rollback are not implemented.

## Available now / proposed

| Area | Available now | Proposed |
|---|---|---|
| prompt | `prompt_ref` in graph contracts | versioned block editor, diff and labels |
| evaluation | deterministic normalized `expected_phrases` | trace, schema, quality, groundedness and safety evaluators |
| repetition | `runs_per_case` and `passes_needed` | confidence intervals, flaky-case analysis and statistical gates |
| comparison | batch history/detail and two-batch comparison | baseline deltas and Model Matrix |
| release | `ReleaseManifest` data/schema contract | storage, review, promotion, deployment and rollback |
| provider evidence | run events and limited Architect evidence | complete redacted model/tool/context snapshots |

Current evaluation proves only that every configured phrase appears in normalized output for enough attempts. It does not prove task success, quality, safety, groundedness or production fitness.

## Low-cost evaluation ladder (2026-08 조사 기반 제안)

LLM 심판은 케이스×회차마다 비용이 든다. 판정을 사다리로 쌓아 싼 층이 먼저
거르고, 위층은 아래층이 못 가린 것만 본다 — evaluator는 registry이므로 각 층은
항목 추가일 뿐이다.

| 층 | evaluator | 비용 | 근거 |
|---|---|---|---|
| 0 | 결정적 단언 — expected_phrases(현행), JSON schema, 정규식 | 0원 | 업계 표준 preflight (Promptfoo/OpenAI Evals) |
| 1 | **NLI 함의 검사(소형 모델)** — 기대 "진술"이 답변에 함의되는가 | API 비용 ≈0 (355M~770M 로컬/서버 추론) | MiniCheck(EMNLP 2024, arXiv:2404.10774): GPT-4급 정확도를 400배 낮은 비용으로. AlignScore(ACL 2023, arXiv:2305.16739) |
| 2 | 안정성 게이트 — runs_per_case 표본 간 일치도 | 추가 판정비 0 (기존 다회 실행 재활용) | SelfCheckGPT(arXiv:2303.08896). 정답성 아님 — 안정성 신호로만 |
| 3 | LLM 심판 — 아래층이 애매하다고 표시한 케이스만 | LLM급 (경계 케이스 한정) | 캐스케이드 실증: 74.5%를 저비용층에서 처리, 비용 ~50% 절감 (arXiv:2606.25871) |

원칙:
- 동일 (입력, 출력) 쌍은 재판정하지 않는다 — 판정 캐시.
- ROUGE/BLEU류 전통 지표는 넣지 않는다 (전문 도메인에서 인간 판단과 상관이
  사실상 없음이 반복 실증).
- 의료처럼 누락이 치명적인 도메인에서 layer 1이 특히 유효하다 — GPT-4 의료
  요약의 47%가 임상적 중요 정보를 누락한다는 실증(npj Digital Medicine 2025)
  이 있고, NLI 함의 검사는 "필수 사실이 빠졌는가"를 정확히 그 축에서 잡는다.
- 화면 원칙은 동일하게 적용된다: 각 층의 판정은 점수가 아니라 "무엇이
  빠졌는가/왜 실패인가"로 보여야 프롬프트를 바꿀 근거가 된다.

## Versioned composition goal

A future release should bind immutable references to:

- AgentSpec revision
- prompt revisions
- model/provider snapshot
- tool/MCP policy snapshot
- evaluation suite and evaluator versions
- approval identity, reason and time

The runtime should execute that composition rather than a moving `latest` value. The existing ReleaseManifest schema is only a starting contract.

## Prompt Studio proposal

Prompt content may be modeled as versioned blocks such as system policy, task instruction, context slots, tool instructions and output schema. Proposed UI capabilities include:

- revision history and side-by-side diff
- variable/input preview
- model/tool/context configuration visibility
- smoke dataset execution
- candidate/baseline comparison
- explicit environment labels and rollback

Prompt lifecycle and AgentSpec lifecycle are separate axes that a release composition joins.

## Evaluation layers

A mature evaluation system should combine, where appropriate:

1. deterministic contract checks
2. execution/trace assertions
3. reference-based checks
4. model-based quality judgments with recorded judge version/rationale
5. safety classifiers and adversarial datasets
6. human review for high-impact decisions

Safety and side-effect policy should prefer deterministic enforcement. A model judge score alone must not authorize deployment.

## Repetition and uncertainty

Repeated runs are necessary for stochastic systems. Future reports should distinguish “at least one success” from “consistent success,” show sample size/uncertainty and classify inconclusive changes rather than manufacturing precision. Statistical methods and thresholds must be versioned and documented before they become release gates.

## Guardrail versus evaluation

A guardrail allows or blocks a live action under a latency budget. Evaluation scores stored executions offline. The same detection logic may support both, but enforcement mode, evidence and failure behavior must remain explicit.

## Release review proposal

A review surface may combine:

- graph and prompt diffs
- model/tool/policy changes
- deterministic and statistical evaluation evidence
- critical safety failures
- cost/latency changes
- reviewer identity and rationale

Approval should create an immutable release record. Deployment and rollback require separate adapters and operational acceptance; they are not implied by storing approval.

## Safety boundary

Evaluation fixtures must avoid live secrets and unintended side effects. Tool calls should use read-only fixtures, mocks or isolated sandboxes with network/budget limits. A safety suite detects known regressions; it is not a certification of safety.

## Incremental delivery

1. versioned prompt data and diff
2. deterministic/trace evaluator registry
3. baseline comparison and explicit gate results
4. human review records and ReleaseManifest storage
5. deployment adapters and rollback
6. sampled online evaluation and failure-to-dataset workflow

Every stage must preserve the current alpha's honest evidence boundary.
