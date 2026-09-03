# 어떤 skill이 이 지시문과 비슷한가 — 두 언어가 함께 읽는 케이스

`cases.json`은 contracts(Python)의 `similar_skills`와 studio(TS)의 `similarSkills`가
**같은 참고를 같은 차례로 고르는지** 맞춰 보는 자리다. 새 skill의 초안을 지을 때
화면이 보여 주는 참고 목록과 서버가 프롬프트에 싣는 예시가 갈리면, 사람이 본 것과
모델이 읽은 것이 달라진다.

한 케이스의 뜻:

| 칸 | 뜻 |
|---|---|
| `name` | 케이스 이름 (사람이 읽는다) |
| `query` | 지금 만들고 있는 skill — `name`·`description`·`body` |
| `candidates` | 고를 수 있는 skill들 — `name`·`description`·`body` (ref는 이름에서 짓는다) |
| `howMany` | 몇 개까지 고르는가 |
| `expect` | 골라야 하는 skill 이름들 (차례대로). 겹치는 말이 없는 skill은 목록에 들지 않는다 |
