# 실행이 낸 말이 무엇인가 — 두 언어가 함께 읽는 케이스

`cases.json`은 engine(Python)의 `spoken_llm_texts`와 studio(TS)의 `spokenTexts`가
**같은 말을 골라내는지** 맞춰 보는 자리다. 대화 화면은 이 목록의 마지막 말을 그 turn의
답으로 삼으므로(CHAT-3b 결정 4), 두 쪽의 규칙이 갈라지면 화면이 답이 아닌 것을 답이라고
말하게 된다.

규칙은 engine의 것이 원본이다:

- 말은 `llm.completed`에 적힌 `text`다 (문자열이 아니면 말이 아니다).
- 그 사건에 노드가 적혀 있지 않거나, 그래프에 없는 노드면 세지 않는다.
- **길을 고르는 노드**(`llm.router`)가 낸 것은 봉투이지 말이 아니다 — 다만 그 노드에서
  나가는 길 조건(`route == '…'`)이 실제로 하나라도 있을 때만 그렇다. 조건이 없거나 다른
  이름을 보는 조건뿐이면 그 노드는 길을 고르지 않고 그냥 말한 것이다 (P3-1).
- 일어난 순서를 그대로 지킨다.

한 케이스의 뜻:

| 칸 | 뜻 |
|---|---|
| `name` | 이 케이스가 무엇을 보는지 |
| `spec` | 그 실행이 돈 그래프 (AgentSpec) |
| `events` | 그 실행이 남긴 사건들 (RunEvent) |
| `expected_spoken` | 골라낸 말들 — 순서까지 그대로 맞아야 한다 |

읽는 쪽:

- `packages/engine/tests/test_spoken_answer_cases.py`
- `apps/studio/tests/spoken-answer-cases.test.ts`
