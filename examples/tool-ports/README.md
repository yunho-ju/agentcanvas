# 도구 노드의 포트가 무엇을 받고 무엇을 내놓는가 — 두 언어가 함께 읽는 케이스

`cases.json`은 contracts(Python)의 `resolve_ports`와 studio(TS)의 `resolvePorts`가
**같은 포트를 내놓는지** 맞춰 보는 자리다. 도구 노드의 포트 schema는 정적으로 적혀
있지 않다 — 노드가 가리킨 연결(binding)이 들고 있는 도구(ToolDef)의
`input_schema`/`output_schema`를 입는다. 설정이 아직 덜 채워졌거나 가리킨 것이 없으면
registry의 정적 포트로 돌아간다 — 미완성 설정이 캔버스를 깨지 않는다.

한 케이스의 뜻:

| 칸 | 뜻 |
|---|---|
| `name` | 이 케이스가 무엇을 보는지 |
| `node_type` | registry에서 꺼낼 노드 타입 |
| `config` | 그 노드에 적힌 설정 |
| `resources` | 이 에이전트가 가진 연결 목록 (`AgentSpec.resources`) |
| `expected` | 포트 이름 → 그 포트의 schema. 목록 전체가 그대로 맞아야 한다 |

읽는 쪽:

- `packages/contracts/tests/test_tool_port_cases.py`
- `apps/studio/tests/tool-port-cases.test.ts`
