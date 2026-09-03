# 입은 skill이 문서와 맞는가 — 두 언어가 함께 읽는 케이스

`cases.json`은 engine(Python)의 `validate_graph`와 studio(TS)의 `skillIssues`가
**같은 판정을 내는지** 맞춰 보는 자리다. 두 쪽은 같은 케이스로 같은 코드를 내놓아야
한다. 문구(message)는 비교하지 않는다 — 언어가 다르다.

한 케이스의 뜻:

| 칸 | 뜻 |
|---|---|
| `skills` | 문서가 가진 skill의 이름들 (ref는 `skill://<이름>@1`) — 같은 이름이 두 번이면 문서에 두 번 실린 것이다 |
| `wears` | 에이전트 노드가 입겠다고 적은 ref들 |
| `codes` | 나와야 하는 issue 코드들 (차례는 보지 않는다) |

세 가지 판정:

- `skill.missing` (ERROR) — 노드가 문서에 없는 skill을 입었다
- `skill.duplicate` (ERROR) — 같은 ref가 문서에 두 번 실렸다
- `skill.unused` (INFO) — 아무도 입지 않은 skill이 문서에 남아 있다
