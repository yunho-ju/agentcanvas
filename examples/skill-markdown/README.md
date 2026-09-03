# 표준 SKILL.md 하나를 읽으면 무엇이 되는가 — 두 언어가 함께 읽는 케이스

`cases.json`은 contracts(Python)의 `parse_skill_markdown`과 studio(TS)의
`parseSkillMarkdown`이 **같은 판정을 내는지** 맞춰 보는 자리다. 두 쪽은 같은
`cases/*.md` 파일을 읽고 같은 issue 코드와 같은 SkillDef를 내놓아야 한다.
문구(message)는 비교하지 않는다 — 언어가 다르다.

한 케이스의 뜻:

| 칸 | 뜻 |
|---|---|
| `file` | `cases/` 아래의 SKILL.md 파일 이름 |
| `issues` | 나와야 하는 issue 코드들 (차례대로) |
| `expect` | 만들어져야 하는 skill의 겉모습. `null`이면 skill을 만들지 않는다 |

`expect`가 있는 케이스는 본문(body)까지 비교하지 않는다 — 본문은 파일이 곧
정답이고, 대신 두 쪽 모두 `render → parse`가 같은 skill로 돌아오는지 본다.
