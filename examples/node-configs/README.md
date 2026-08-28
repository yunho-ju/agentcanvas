# 노드 설정이 쓸 만한가 — 두 언어가 함께 읽는 케이스

`cases.json`은 studio(TS)의 `validateConfig`와 contracts(Python)의 `config_issues`가
**같은 판정을 내는지** 맞춰 보는 자리다. 두 쪽 모두 registry의 `config_schema`를
그대로 읽어 판정한다 — 화면을 거치지 않고 API로 바로 저장한 그래프도 같은 문지기를 지난다.

**맞춰 보는 것은 "문제가 있다/없다"뿐이다.** 오류 문구는 비교하지 않는다 —
studio는 사람이 읽을 쉬운 말로 옮기고(언어마다 다르다), 서버는 영어 기술 문장을 남긴다.

한 케이스의 뜻:

| 칸 | 뜻 |
|---|---|
| `name` | 이 케이스가 무엇을 보는지 |
| `node_type` | registry에서 꺼낼 노드 타입 (`config_schema`의 출처) |
| `config` | 그 노드에 적힌 설정 |
| `valid` | 이 설정에 아무 문제가 없는가 |

케이스는 registry의 `config_schema`만으로 판정이 갈리는 것만 넣는다. `core.input`의
빈 포트 이름처럼 **서버에만 있는 추가 규칙**(`config_issues`의 bindings 검사)은
studio ajv가 같은 답을 낼 이유가 없으므로 여기 넣지 않는다 —
그 규칙은 `packages/contracts/tests/test_node_registry.py`가 따로 지킨다.
