# 연결 하나가 순환을 만드는가 — 두 언어가 함께 읽는 케이스

`cases.json`은 studio(TS)의 `checkConnection`과 engine(Python)의 `validate_graph`가
**같은 판정을 내는지** 맞춰 보는 자리다. 두 쪽이 묻는 질문은 서로 다르다:

- Python: 그은 뒤의 그래프 **전체**에 순환이 있는가 (`graph.cycle`)
- TS: **이 연결이** 순환을 만드는가 (`connection.cycle`)

**두 질문은 밑그림(`edges`)이 비순환일 때만 같은 답을 낸다.** 이미 순환이 있는 그래프를
케이스로 넣으면 Python은 그 옛 순환 때문에 `true`, TS는 새 연결만 보고 `false`를 낼 수 있다 —
한쪽만 빨개진다. 그래서 케이스의 `edges`는 언제나 비순환이어야 하고,
이 전제는 `packages/engine/tests/test_connection_cycles.py`가 지킨다.

한 케이스의 뜻:

| 칸 | 뜻 |
|---|---|
| `nodes` | 캔버스에 놓인 노드 이름들 — 전부 `llm.router`다 (input·passthrough 포트의 schema가 비어 있어 종류로는 걸리지 않는다) |
| `edges` | 이미 그어져 있는 연결들 (`[보내는 노드, 받는 노드]`, 언제나 `passthrough → input`) |
| `draw` | 지금 사람이 긋는 연결 |
| `cycle` | 그으면 흐름이 제자리를 도는가 |
