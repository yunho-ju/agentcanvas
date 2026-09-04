# 에이전트 패턴 설계 — ReAct와 패턴 카탈로그

상태: 설계 초안 (2026-09-04). 구현 브리프는 이 문서를 근거로 `docs/briefs/`에 쓴다.
관련: `PRODUCT.md` 제품 원칙, `docs/AGENTCANVAS_DESIGN.md` §4 Guided Architect·§5 Runtime, `DESIGN.md` §7 guided-architect-card·optimize-card·architect-patch-contract.

## 0. 한 줄 요약

"패턴은 엔진이 먼저, Architect는 엔진이 할 수 있는 것만 묻는다." ReAct(에이전트가 도구를 쓰며 답을 다듬는 반복)를 **AI 에이전트 노드 안의 루프**로 만들고, 그 위에 **패턴 카탈로그**(registry)를 얹어 만들 때 묻기·직접 놓기·지금 그래프 고치기 세 입구가 같은 표를 읽게 한다.

## 1. 지금 상태 (2026-09-04 실측)

| 사실 | 위치 | 의미 |
|---|---|---|
| AI 에이전트 노드는 모델을 정확히 한 번 부른다 | `routed_runtime.py:248-277` | 도구를 쓰며 답을 다듬는 반복이 없다 |
| inspector에 '쓸 도구'(`toolset_refs`)·'최대 몇 턴'(`max_turns`)이 있지만 엔진이 읽지 않는다 | `node_registry.py:559-620`, 엔진 grep 0건 | **거짓 화면** — 제품 원칙 3 위반. 이 설계의 첫 수정 대상 |
| 모델 호출 계약에 도구가 없다: `ModelAsk`에 tools 없음, `ModelSaid`에 tool_calls 없음, OpenAI 어댑터가 `tools=`를 보내지 않고 `tool_calls`를 읽지 않는다 | `model_call.py:20-67`, `openai_model.py:106,137` | 제공자 층부터 새로 열어야 한다 |
| 도구 노드(`tool.mcp`)는 승인 정책(`ask_first`)·결과 처리(`full/sections/digest/retrieve`)·이벤트(`tool.policy_checked/requested/completed`)·멈춤(`human.approval_requested`+`run.paused`)을 이미 갖는다 | `routed_runtime.py:279-360`, `tool_def.py` | 루프 안의 도구 호출은 **이 경로를 그대로 재사용**한다 |
| `RunEvent`에 턴을 묶는 자리가 없다(`seq, run_id, event_type, timestamp, spec_revision, payload, node_id`) | `run_events.py:38-45` | 한 노드 안에서 반복되는 `llm.*`/`tool.*`를 묶을 키가 필요하다 |
| 화면의 답 규칙 `spokenTexts`는 말하는 노드의 **모든** `llm.completed`를 답으로 센다 | `spokenText.ts:45-56` | 턴이 여러 개가 되면 중간 생각이 답으로 새어 나온다 — 규칙 갱신 필수(Python 미러 포함) |
| `ExecutionLimits{max_total_tokens, max_runtime_ms, max_tool_calls}`는 선언만 있고 읽는 곳이 없다 | `agent_spec.py:75-84` | 문서 단위 한도를 살릴 자리가 이미 있다 |
| Architect는 한 번의 text→patch이고 되묻는 길이 없다. Optimizer는 시험 근거로 patch를 짓고 같은 `preview_of` 게이트를 탄다 | `architect_service.py:217`, `optimizer_service.py` | 되묻기는 새 계약이고, 패턴 적용은 patch로 표현할 수 있다 |
| 그래프 고리는 검증 오류(`graph.cycle`), 실행은 한 노드씩 순차 | `validator.py:300-334`, `routed_runtime.py:165-183` | 반복은 그래프가 아니라 노드 안에 둔다. 병렬은 이 문서 범위 밖 |

## 2. 결정

**D1. 순서 — 엔진이 먼저.** 카탈로그의 한 항목은 엔진이 실제로 돌릴 수 있을 때만 존재한다. 서버가 `GET /patterns`로 "이 서버가 할 수 있는 패턴"만 돌려주고 화면·Architect는 그 목록 밖을 말하지 않는다(증거의 한계, 원칙 6).

**D2. ReAct는 노드 안의 루프다.** 그래프 고리 금지는 유지한다. 반복은 `llm.agent` 한 노드의 실행 안에서 일어나고, 화면에서는 노드 하나가 "여러 번 시도했다"로 읽힌다. 근거: 고리를 허용하면 검증·되돌리기·비교 화면이 전부 흔들리고, 비개발자가 그래프에서 루프를 그릴 이유가 없다.

**D3. 루프 안의 도구 호출은 도구 노드의 경로를 재사용한다.** 승인 정책(`ResourceBinding.approval_policy`), 결과 처리(`ResultHandling`), 이벤트 세 종, 멈춤·재개 모두 같다. 새 이벤트 타입을 만들지 않는다. 다른 점은 `node_id`가 도구 노드가 아니라 **에이전트 노드**라는 것뿐이다.

**D4. 턴은 이벤트의 일급 필드다.** `RunEvent.turn: int | None`을 추가한다(계약 변경, json_schema·TS 재생성). 한 노드 실행 안의 n번째 모델 호출과 그 호출이 시킨 도구 호출들이 같은 `turn`을 갖는다. 루프가 없는 노드는 `turn=null`(기존과 같다). payload에 숨기지 않는 이유: 화면·평가·재개가 모두 이 키로 묶기 때문이며, primitive obsession을 피한다(CLAUDE.md).

**D5. 답은 도구를 부르지 않은 마지막 말이다.** `llm.completed` payload에 `tool_calls: [...]`(비어 있을 수 있음)를 싣고, 화면·엔진의 "말한 것" 규칙을 **"`tool_calls`가 빈 `llm.completed`만 말이다"**로 바꾼다. `spokenTexts`(TS)와 `spoken_llm_texts`(Python)를 같은 케이스 파일(`examples/spoken-answers/cases.json` 확장)로 함께 고친다. 중간 턴의 텍스트(모델의 "생각")는 답이 아니라 실행 보기의 줄이다.

**D6. 한도는 두 겹이고, 한도에 닿아도 답은 있다.** 노드의 `max_turns`(기본 1 = 지금과 같은 한 번)와 문서의 `ExecutionLimits.max_tool_calls`(없으면 서버 기본값)를 둘 다 읽는다. 한도에 닿으면 실패가 아니다: 도구 없이 **마무리 호출**을 한 번 더 해 답을 받는다(`llm.requested` payload `closing: true`). 이 호출은 `max_turns`에 세지 않고, 문서 한도의 최종 호출 1회로 예약한다. 근거: "여기까지 알아본 것으로 답해요"가 빈손보다 낫고, 화면이 "실패"라고 겁주지 않는다(안심, 원칙 2). 토큰·시간 한도는 이 라운드에서 읽지 않는다(선언은 남기되 화면에 약속하지 않는다).

**D7. 제공자 계약을 연다.** `ModelAsk.tools: tuple[ToolBrief, ...]`(이름·쉬운 설명·입력 스키마), `ModelSaid.tool_calls: tuple[ToolCall, ...]`(`call_id, name, arguments`). `ModelAsk.transcript`: 이전 턴들(모델 말·도구 결과)을 제공자 형식과 무관한 중립 구조로 넘긴다. 어댑터: OpenAI(`tools`/`tool_choice:auto`, `message.tool_calls` 읽기, `role:tool` 메시지로 결과 회신), Anthropic(`tools`/`tool_use`/`tool_result`), OpenAI 호환 로컬(같은 경로, 서버가 tools를 거절하면 `ModelBalked(reason="tools_unsupported")` — 새 사유). 도구를 못 쓰는 제공자에서 도구가 붙은 노드를 돌리면 **실행 전에** 거절하고 이유를 말한다(그릴 때 막을 것은 그릴 때 — inspector에서도 같은 판정).

**D8. 루프 상태는 이벤트로만 복원한다.** 승인으로 멈췄다 재개할 때 "지금까지의 대화"는 메모리가 아니라 `turn`으로 묶인 이벤트(`llm.completed.tool_calls`, `tool.completed.result`)에서 다시 만든다. 이미 있는 `_state_from`(이벤트→상태) 원칙을 따르며, 프로세스가 죽어도 재개가 된다. 재개 뒤 도구 호출은 반복될 수 있다(§5 exactly-once 아님 — 문서에 그대로 적는다).

**D9. 도구 결과는 모델에 넣기 전에 결과 처리와 펜싱을 거친다.** `ResultHandling`(digest 등) 적용 후, 제어문자 제거·크기 상한·"도구 결과" 구분자 감싸기를 한 뒤 회신 메시지로 넣는다. 도구 결과가 지시문 행세를 하지 못하게 하는 최소 방어이며, 규칙은 순수 함수(`tool_result_fence`)로 두고 케이스 파일(`examples/tool-result-fence`)로 고정한다 — 펜싱은 엔진만 하므로 TS 미러는 두지 않는다(화면은 펜싱 결과를 읽을 뿐이다). 구분자 흉내(결과 본문에 닫는 구분자가 들어오는 것)까지 막지는 않는다 — 완전한 방어가 아님을 적어 둔다.

**D10. 패턴 카탈로그는 registry다.** `packages/contracts/.../patterns.py`에 `PatternDef`를 두고 `DEFAULT_PATTERNS`로 등록한다. 새 패턴 추가 = 항목 하나 추가(기존 코드 수정 없음, OCP).

```
PatternDef
  id: "react" | "human_gate" | "router" | …      # 화면·프롬프트 어디에도 원명을 쓰지 않는다
  question:  LocalizedText   # "이 에이전트가 회사 시스템에서 무언가 찾아봐야 하나요?"
  applies_when: LocalizedText# 사람이 읽는 적용 근거(모델 프롬프트에도 그대로 실린다)
  cost: LocalizedText        # "실행이 길어지고, 도구를 부를 때 승인이 생길 수 있어요"
  needs: tuple[Capability]   # {"tool_calling"} 같은 서버 능력 — 없으면 목록에서 빠진다
  template: PatchTemplate    # agent.patch/v1 작업 목록. 앵커(예: {agent}) 자리를 실제 노드 id로 채운다
  detects: GraphSignal       # 지금 그래프에서 "이 패턴이 빠져 있다"를 판정하는 순수 규칙(Improve용)
```

첫 등록 3개: **react**(도구가 붙은 에이전트 + max_turns>1), **human_gate**(행동 전 사람 확인 — 엔진에 이미 있음), **router**(갈래 나누기 — 이미 있음). 서브에이전트·병렬은 엔진이 생기면 항목만 추가한다.

**D11. Architect의 되묻기는 한 번, 최대 세 개, 건너뛸 수 있다.** `POST /architect/draft`의 응답에 `asks: [{pattern_id}]`를 허용한다(patch 없이). 모델은 프롬프트에 실린 카탈로그(질문·적용 근거만, 템플릿은 안 보여 준다)에서 **부탁 문장에 근거가 보이는 것만** 고른다. 서버가 카탈로그 밖 id·3개 초과를 잘라 낸다. 화면은 질문을 한 번에 하나씩 예/아니요/건너뛰기로 묻고(guided-architect-card "한 시점에 하나만 묻는다" 유지), 답을 `answers: [{pattern_id, yes}]`로 실어 다시 부른다. 두 번째 호출은 되묻기를 허용하지 않는다(patch 필수) — 설문지가 되지 않게 하는 상한이다. 답이 "예"인 패턴의 템플릿은 **서버가** patch에 합쳐 넣는다(모델이 구조를 지어내지 않고, 검증은 기존 `preview_of` 그대로).

**D12. 직접 놓기.** 팔레트·오른쪽 클릭의 '여기에 노드 놓기'와 나란히 '이 모양으로 놓기'가 카탈로그 항목을 나열한다. 템플릿을 그 자리에 적용하고 한 undo 걸음이다. 카탈로그를 읽는 세 번째 입구일 뿐 새 표면을 만들지 않는다.

**D13. 지금 그래프 고치기.** Optimizer 프롬프트에 카탈로그와 `detects` 판정 결과("이 에이전트는 도구를 한 번만 부르고 끝난다")를 근거 줄로 싣는다. 제안문의 가설이 패턴을 가리키면 `pattern_id`를 함께 돌려주고, optimize-card는 그것을 칩 하나로 보인다. 적용은 기존 후보 미리보기·승인 경로 그대로(승인 전에는 아무것도 바뀌지 않는다).

**D14. 이름은 화면에 없다.** ReAct·supervisor·orchestrator는 코드 id로만 존재한다. 사람이 읽는 것은 질문·근거·대가 세 문장이다.

## 3. 계약 변경 목록

| 계약 | 변경 | 재생성 |
|---|---|---|
| `RunEvent` | `turn: int \| None` 추가. `llm.completed.payload.tool_calls`, `llm.requested.payload.closing` 규약 | json_schema, TS 타입, 문서 |
| `ModelAsk`/`ModelSaid` | `tools`, `transcript` / `tool_calls`. `ModelBalked.reason`에 `tools_unsupported` | Python만(어댑터 계약) |
| `AgentSpec.execution.limits.max_tool_calls` | 읽기 시작. 기본값 서버 설정 | 없음 |
| `llm.agent.config` | 변경 없음(`toolset_refs`·`max_turns`가 드디어 사실이 된다). `max_turns` 기본 1을 스키마 default로 명시 | json_schema |
| `PatternDef`/`DEFAULT_PATTERNS` | 신규 registry + `GET /patterns` | json_schema, TS |
| Architect draft API | 요청 `answers[]`, 응답 `asks[]` | json_schema, TS |
| Optimizer proposal | `pattern_id: str \| None` | json_schema, TS |
| `examples/spoken-answers/cases.json` | 턴 있는 케이스 추가(중간 말은 답이 아니다) | 양쪽 테스트 |
| `examples/tool-result-fence/cases.json` | 신규 미러 케이스 | 양쪽 테스트 |

## 4. 엔진 알고리즘 (llm.agent)

```
turns = 0
transcript = []                               # 이벤트에서 복원 가능해야 한다 (D8)
tools = tools_offered(node.toolset_refs)      # 승인 정책·결과 처리는 binding에서
loop:
  said = ask_model(instruction, state, transcript, tools if turns < max_turns else NONE,
                   closing = turns >= max_turns or tool_budget_left == 0)
  emit llm.requested(turn=turns, closing), llm.completed(turn=turns, text, tool_calls)
  if said.tool_calls is empty or closing: answer = said.text; break
  for call in said.tool_calls:
      if ask_first(binding): emit policy_checked, approval_requested, run.paused; return HOLD
         # 재개 시 이 지점부터: transcript는 이벤트로 복원
      result = call_tool(call)               # 기존 _makes_the_call
      emit tool.requested/completed(turn=turns, call_id)
      transcript += fenced(handled(result))  # D9
      tool_budget_left -= 1
  turns += 1
state[response] = answer; emit node.completed
```

- 마무리 호출(`closing`)에서 모델이 그래도 도구를 요구하면 그 요구는 무시하고 텍스트만 답으로 쓴다. **마무리 호출**에서 텍스트도 도구 요구도 없으면 답이 없는 것이다 → `node.failed{reason:no_final_answer}` 뒤 **`run.failed`**(실행은 반드시 종결 이벤트로 끝난다). 중간 턴의 침묵까지 실패로 넓히지 않는 까닭(2026-09-04 실측): 진짜 제공자는 그 상태를 어댑터(`model_talk` `NOTHING_SAID`)에서 이미 실패로 바꿔 보내고, 그 상태를 실제로 만드는 것은 **열쇠 없는 서버의 대역**뿐이다 — 넓히면 열쇠 없이 예시 그래프를 걸어 보는 길이 막힌다(제품 약속)(실행은 반드시 종결 이벤트로 끝난다 — 화면·durable 워커가 그것을 본다).
- 승인은 **호출(call_id)에 묶인다**: 재개 시 받은 답은 `human.approval_requested`의 그 call_id에만 쓰이고, 같은 턴의 다른 호출이 승인을 물려받지 않는다(부작용 도구의 동의 위반 방지). 예산은 **호출마다** 확인한다 — 한 턴에 N개를 시켜도 남은 예산만큼만 부르고 나머지는 '예산이 다 됐다'는 회신으로 돌려준 뒤 마무리 호출로 간다.
- 모델이 문서에 없는 도구 이름을 지어 부르면 `tool.policy_checked{allowed:false, reason:"no_such_tool", call_id}`를 남기고 그 사실을 회신한다 — 화면과 재개 판정 둘 다 그 호출을 본다.
- 병렬 도구 호출(한 턴에 여럿)은 **순서대로** 부른다(한 노드씩 순차 원칙 유지). 도중에 승인이 필요하면 그 자리에서 멈춘다.
- 실패한 도구는 `tool.completed`의 error payload를 회신 메시지로 넣고 루프를 계속한다(모델이 대안을 찾을 수 있다). 도구 노드의 `error` 포트 결말과 다르다는 점을 문서에 적는다.

## 5. 화면

- **inspector(AI 에이전트)**: '쓸 도구'는 이 문서의 연결(resources) 중 도구가 있는 것만 고르는 다중 선택, 없으면 "이 문서에는 아직 연결이 없어요 — 왼쪽 연결 패널에서 만들 수 있어요"(tool-select와 같은 사전 키). '최대 몇 턴' 캡션: "도구를 부르며 답을 다듬는 횟수예요. 1이면 한 번에 답해요". 도구가 없으면 '최대 몇 턴'은 disabled + title '도구를 고르면 여러 번 시도할 수 있어요'. 도구를 못 쓰는 모델(서버 능력 없음)이면 '쓸 도구' disabled + 이유.
- **실행 보기(event-list)**: 같은 `turn`의 줄은 한 묶음으로 들여쓴다. 묶음 머리말 "2번째 시도 — '재고 조회' 도구를 불렀어요"(쉬운 말, 도구는 화면 이름). 받은 답(GP-1)은 D5 규칙으로 마지막 답만. 승인 카드는 기존 gate-card 그대로(도구 승인 사용례 P3b).
- **노드 카드(실행 중)**: 뱃지 "도구 부르는 중 2/5". 한도로 마무리했으면 노드 캡션 "여기까지 알아본 것으로 답했어요"(warn 3층, 실패 아님).
- **guided-architect-card**: 입력→**묻기**(새 상태, 최대 3문, 한 번에 하나, [예][아니요][건너뛰기])→review→승인. 묻기 상태의 제목은 그 질문 문장이고, 아래 캡션 한 줄이 대가(cost)다. 건너뛰기는 "아니요"와 같지 않다(모델에 `skipped`로 알린다).
- **optimize-card**: 제안문 묶음에 패턴 칩 1개(질문 문장의 짧은 형태, 예: "도구를 쓰며 답 다듬기").
- **팔레트·오른쪽 클릭**: '이 모양으로 놓기' 하위 목록(카탈로그 순서). 이 항목만은 하위 목록을 허용한다(항목 수가 늘어나므로) — DESIGN §7 context-menu의 "하위 메뉴 없음"에 예외를 적는다.

## 6. 테스트와 정합성

- 순수 규칙 4개는 Python↔TS 케이스 파일로 고정: 말한 것(D5), 펜싱(D9), 패턴 감지 `detects`(D10), 되묻기 상한·정리(D11).
- 엔진: 가짜 제공자에 **각본형 응답**을 추가한다(지금 fake_runtime은 고정 응답뿐) — "1턴에 도구 A 호출 → 2턴에 답" 같은 각본으로 루프·한도·마무리·승인 멈춤·재개를 결정론적으로 검사. 골든 이벤트 파일에 `turn`이 실린다.
- 어댑터: OpenAI·Anthropic 요청/응답을 녹음 fixture로 검사(tools 전송, tool_calls 파싱, 결과 회신 형식). 실키 게이트: 커밋 전 실 호출 1회(도구 하나 붙인 에이전트가 2턴 안에 답하는지) — 비용을 브리프에 적는다.
- Architect: 되묻기 응답이 카탈로그 밖 id·4개 이상을 보내도 서버가 자른다는 테스트. 두 번째 호출이 `asks`를 보내면 `invalid_patch`로 거절.
- UI QA 3문답: 만들 수 있는가(Architect 질문·팔레트 '이 모양으로'·inspector 칸) / 바꿀 수 있는가(inspector 두 칸, 잘못되면 이유) / 결과를 볼 수 있는가(실행 보기 턴 묶음·노드 뱃지·받은 답). A등급 probe: 도구 하나 붙인 에이전트로 실 실행 1회, 실행 보기에 2턴 묶음과 마지막 답.

## 7. 단계와 크기

| 단계 | 내용 | 크기 | 게이트 |
|---|---|---|---|
| P1 정직 | `max_turns` default 1 명시, 도구 없는 노드의 '최대 몇 턴' disabled+이유, 서버 능력 없으면 '쓸 도구' disabled+이유. 엔진은 아직 1턴 | S | 화면이 더 이상 거짓을 말하지 않는다 |
| P2 제공자 | `ModelAsk/ModelSaid` 확장, OpenAI·Anthropic·로컬 어댑터, `tools_unsupported`, 녹음 fixture | M | 어댑터 테스트 + 실 호출 1회 |
| P3 엔진 루프 | `turn` 계약, 루프·한도·마무리·승인 멈춤/재개·펜싱, 각본형 fake, 골든 갱신, 말한 것 규칙(양쪽) | L | 엔진 테스트 + 미러 케이스 + 실 실행 probe |
| P4 실행 보기 | 턴 묶음·노드 뱃지·마무리 캡션 | S | jsdom + A등급 |
| P5 카탈로그 | `PatternDef` registry 3항목, `GET /patterns`, `detects` | M | 미러 케이스 |
| P6 세 입구 | Architect 되묻기(계약+카드), Optimizer 칩, 팔레트·메뉴 '이 모양으로' | M | Architect 테스트 + A등급 |

P1은 지금 바로 할 수 있고 다른 단계와 독립이다. P2→P3→P4는 직렬, P5는 P3와 병렬 가능, P6은 P5 뒤.

## 8. 위험과 대응

- **비용 폭주**: `max_turns`와 문서 `max_tool_calls` 두 겹 + 마무리 호출 예약. 화면은 '최대 몇 턴' 옆에 "턴마다 모델 호출 비용이 들어요"를 hover 뒤에 숨기지 않고 보인다.
- **재개 시 도구 중복 실행**: exactly-once가 아니다(§5). 재개 직전 마지막 `tool.requested`에 짝이 되는 `tool.completed`가 없으면 그 호출은 **다시 부르지 않고** 실패로 회신한다(부작용 있는 도구를 두 번 부르지 않는다).
- **도구 결과의 지시문 행세**: D9 펜싱. 완전한 방어가 아니라는 점을 문서에 적는다.
- **도구를 못 쓰는 제공자**: 실행 전에 거절(`tools_unsupported`), inspector에서도 같은 판정.
- **OpenAI 추론 모델과 도구(2026-09-04 실측)**: `gpt-5.6-luna` 계열은 `/v1/chat/completions`에서 reasoning이 켜진 채로는 function tools를 거절한다(400: "use /v1/responses or set reasoning_effort to 'none'"). 결정: 카탈로그의 모델 정의에 **`tools_need_thinking_off`**(도구를 쓰려면 추론을 꺼야 하는 모델 — `gpt-5` 계열은 서버가 기본 True, env로 덮어쓸 수 있다)를 두고, 어댑터는 **그 표식이 있는 모델의 도구 붙은 호출에서만** `reasoning_effort: "none"`을 싣는다(그 외 모델·도구 없는 호출은 바이트 동일 — gpt-4o 같은 모델은 이 파라미터 자체를 거절한다, reviewer 실측). 이는 그 호출의 추론 품질을 낮추는 대가가 있으며, Responses API로 옮기는 것은 범위 밖으로 남긴다. 어댑터의 `tools_unsupported` 판정은 그대로 fallback이다.
- **중간 생각이 답으로 새는 것**: D5 규칙을 양쪽 케이스 파일로 고정. 이 규칙이 깨지면 대화 화면의 답도 함께 틀리므로 정합성 테스트가 게이트다.
- **설문지화**: 되묻기 1회·3문·건너뛰기. 부탁 문장에 근거 없는 질문은 서버가 자른다(`applies_when`을 모델에게 주고, 응답에 근거 문장 인용을 요구 — 인용이 부탁 문장에 없으면 버린다).

## 9. 범위 밖 (이번 설계에서 다루지 않음)

병렬 실행과 합류, 다른 에이전트 부르기 노드(서브에이전트·A2A), 반복(for-each) 노드, LangGraph 어댑터, MCP 서버 노출, 토큰·시간 한도 집행. 각각은 엔진 항목이 생길 때 카탈로그에 항목만 추가한다(D10).
