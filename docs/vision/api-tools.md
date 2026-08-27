# API Tools Vision

*Proposal — not a current capability. See [`../AGENTCANVAS_DESIGN.md`](../AGENTCANVAS_DESIGN.md) §10.*

이미 운영 중인 HTTP API를 MCP 서버 없이 "도구"로 감싸서 캔버스 파이프라인에 꽂는다.
쉬운 말로: **"우리 회사가 이미 쓰는 웹 주소(API)를 붙여 넣으면, AI가 그것을 도구로
바꿔 주고, 그래프의 노드로 끌어다 쓸 수 있다."**

## Why

- MCP executor(별도 프로세스·프로토콜)보다 훨씬 작은 표면으로 "진짜 도구 실행"에
  먼저 도달한다. 예약만 되어 있는 `tool.requested / tool.policy_checked /
  tool.completed` 이벤트의 첫 실제 소비자가 된다.
- 대부분의 조직에서 내부 도구의 실체는 이미 HTTP API다. MCP 서버를 세우라고
  요구하는 것은 "누구나 만들 수 있게"라는 제품 원칙에 어긋난다.

## Contract

### 관점: MCP도 결국 도구다

계약의 1급 개념은 **Tool(=ToolDef) 하나**다. 노드·validator·정책 집행·`tool.*`
이벤트·팔레트는 전부 ToolDef만 본다. MCP는 도구의 "종류"가 아니라 도구를
**얻어오고(import) 실행하는(adapter) 방법 중 하나**로 내려간다. 갈리는 곳은
가장자리 두 군데뿐이다:

1. **Import** — 어디서 ToolDef를 얻는가: MCP `list_tools` / OpenAPI·curl에서
   AI 추출 / 산문 설명에서 AI 생성. 출력은 셋 다 동일한 ToolDef 목록.
2. **실행** — 어떻게 부르는가: 바인딩 `kind`로 어댑터가 갈린다.

MCP 바인딩도 import 시점에 ToolDef를 **spec에 스냅샷**한다. 서버가 런타임에
알려주는 동적 목록에 기대지 않으므로 (a) spec이 서버 없이 자급자족해 리플레이·
검증이 성립하고, (b) 사람이 승인한 도구 스키마가 고정되어, 서버가 도구를 바꾸면
실행 시점 `tool.policy_checked`에서 드리프트로 검출된다. 서버가 바뀌면 재-import가
필요하다는 비용은, 승인 게이트가 있는 제품에서는 버그가 아니라 기능이다.

### ResourceBinding 확장 (기존 계약 재사용)

`ResourceBinding.kind`에 `"http.api"`를 추가한다. 모든 바인딩이 도구 정의
목록을 갖는다:

```
ResourceBinding
  id: "clinical-reference"          # 노드가 가리키는 이름 (규약: 노드 → 바인딩 id)
  kind: "http.api"                  # 어댑터를 고르는 열쇠 ("mcp" | "http.api")
  server_ref: api://clinical-ref    # scheme은 kind와 짝 (mcp:// | api://)
  allowed_tools: [...]              # 기존 필드 그대로 — 집행 지점은 어댑터
  approval_policy: "..."            # 기존 필드 그대로
  tools: list[ToolDef]              # NEW — kind와 무관하게 모든 바인딩이 채운다
```

### ToolDef (신규 계약)

OpenAPI 문서(또는 MCP 서버의 도구 목록) 전체를 spec에 넣지 않는다 — import가
추출한, 실행에 필요한 subset만 계약으로 남긴다. spec은 외부 문서 없이
자급자족해야 리플레이가 성립한다.

ToolDef는 **인터페이스**(모든 도구가 같음)와 **호출 방법**(kind마다 다름)을
나눈다. 노드·validator·화면은 인터페이스만 읽고, 호출 방법은 어댑터만 읽는다:

```
ToolDef                             # 인터페이스 — 모든 kind 공통
  name: str                         # 바인딩 안에서 유일
  plain_description: LocalizedText  # 용어 원칙 — 쉬운 말 설명 필수
  input_schema: JsonSchema          # 노드 input 포트가 이 schema로 resolve된다
  output_schema: JsonSchema         # 노드 result 포트가 이 schema로 resolve된다
  timeout_ms: int
  call: HttpCall | McpCall          # 호출 방법 — 어댑터만 읽는다 (discriminated union)

HttpCall                            # kind="http.api"의 호출 방법
  method: "GET" | "POST" | ...
  url_template: str                 # 예: https://api.example.com/patients/{id}
  auth: SecretRef | None            # raw 키 금지 — secret:// ref만 (기존 guard 재사용)

McpCall                             # kind="mcp"의 호출 방법
  remote_name: str                  # 서버가 아는 도구 이름 (import 시점에 스냅샷)
```

### 노드는 하나로 통일

`tool.http` 노드 타입을 새로 만들지 않는다. 노드가 transport(MCP냐 HTTP냐)를 알면
실행 방식이 화면 계약으로 새는 것이다. 기존 `tool.mcp` 노드를 `tool.call`(가칭,
"도구 실행")로 일반화하고, `resource_ref`(바인딩 id) + `tool_name`만 갖는다.
바인딩의 `kind`가 어댑터를 고른다 (Adapter 패턴, 분기 대신 registry).

포트 schema는 정적 `{type: object}`가 아니라 참조된 ToolDef의
`input_schema`/`output_schema`로 동적 resolve한다 — `input.source`가
`spec.input_schema`로 포트를 만드는 것과 같은 기법. 이때부터 validator의
`port.schema_mismatch`가 도구 노드에도 실제로 물린다.

### AgentSpecPatch 확장

architect와 도구 생성기가 바인딩을 만들 수 있도록 `add_resource` /
`replace_resource` / `remove_resource` operation을 추가한다.
(현재 resources를 채울 경로가 전무한 gap의 해소이기도 하다.)

## AI 자동 생성 (Tool Wrapper)

architect와 동일한 골격의 별도 서비스: **입력 → 검증된 제안 → 미리보기 → 사람
승인 → spec 반영**. 승인 전에 spec을 건드리지 않는다.

- 입력 3종: OpenAPI/Swagger 문서 붙여넣기, curl 예시, 산문 설명
  ("환자 번호를 주면 진료 기록을 돌려주는 우리 API가 있어").
- 출력: `ResourceBinding(kind="http.api") + ToolDef[]` 패치 제안.
  pydantic 검증 실패는 architect처럼 balk — 조용히 고쳐 쓰지 않는다.
- 미리보기 화면: 도구마다 "이름 / 쉬운 설명 / 무엇을 주면 무엇을 받는가"를
  비개발자가 읽을 수 있는 카드로 보여 준다. 승인 시 바인딩이 생기고,
  팔레트에 그 도구들이 끌어다 놓을 수 있는 항목으로 나타난다.
- 인증 키는 생성기가 절대 받지 않는다 — `secret://` 이름만 제안하고,
  실제 값 등록은 기존 secrets 경로를 따른다.

## Result handling — 응답을 다 싣지 않는다

큰 문서를 돌려주는 도구(예: 의료 문서 API)의 응답을 통째로 모델 컨텍스트에
실으면 컨텍스트가 넘친다. "무엇을 얼마나 실을 것인가"는 도구마다 다르므로,
ToolDef에 **결과 처리 전략**을 둔다 — 분기 대신 registry: 새 전략은 표에 한
줄을 더한다.

```
ToolDef
  ...
  result_handling: Full | Sections | Digest | Retrieve   # discriminated union
                                                          # 기본은 Full

Full                                # 그대로 싣는다 — 작은 응답의 기본값
Sections                            # 부르는 쪽이 섹션 목록을 고른다
  section_param: str                # 도구 입력에 추가되는 배열 파라미터 이름
                                    # (input_schema에 함께 실린다 — 노드가
                                    #  섹션 배열을 넘긴다)
Digest                              # 받은 전체를 모델로 압축 요약해 싣는다
  model_ref: ModelRef               # 요약을 맡을 모델 (본 실행과 분리)
  max_chars: int                    # 실을 최대 길이
Retrieve                            # 질의로 관련 부분만 골라 싣는다 (BM25)
  query_param: str                  # 부르는 쪽이 넘기는 검색 질의 파라미터
  top_k: int                        # 실을 조각 수
  chunk: {by: "section"|"chars", size: int}
Extract                             # (후순위) 샌드박스 코드가 원문을 다루고
  ...                               # 결과만 싣는다 — 코드가 기록되므로 재현 가능
```

모든 전략은 **원문 참조를 보존**한다 — 무엇을 잘랐든, 원문을 재조회할 수 있는
ref가 실행 기록에 남는다 (요약·검색의 정보 손실에 대한 안전줄).

원칙:

- **전략은 어댑터의 후처리다** — 노드·validator·화면은 전략의 존재만 알고
  내용은 모른다. 원 응답은 어댑터가 받고, 컨텍스트에는 처리된 것만 싣는다.
- **정직한 화면**: `tool.completed` 이벤트에 원문 크기와 실은 크기를 함께
  기록한다 ("원문 12,400자 → 780자 실음"). 잘려 나간 것이 있음을 화면이
  침묵하지 않는다 — 화면에서 시스템을 이해할 수 있어야 한다는 원칙.
- **AI 생성기와의 접점**: Tool Wrapper가 OpenAPI 응답 schema를 보고 응답이
  크겠다 싶으면(배열·문서 필드) 전략을 함께 제안한다 — 섹션 개념이 schema에
  보이면 Sections, 자유 텍스트 덩어리면 Retrieve를 기본 제안.
- **전략도 시험 대상이다**: 같은 도구·같은 케이스를 전략만 바꿔 eval로 돌려
  "어떤 전략이 답 품질/비용에 유리한가"를 비교할 수 있게 한다 (eval 시스템의
  variant 실행 — 후속 제안, 이 문서 범위 밖).

### 연구 근거와 상황별 기본값 (2026-08 조사)

- 전부 싣기(Full)는 응답이 길수록 중간부 정보를 모델이 놓친다 — Lost in the
  Middle (Liu et al., TACL 2024, arXiv:2307.03172). 작은 응답 전용.
- Sections는 결정론적이라 리플레이 요구와 궁합이 가장 좋다. 섹션 구조가 고정된
  정형 문서(의료 리포트 등)의 1순위 기본값.
- Digest: 압축 자체는 성능 손실이 적다는 실증(RECOMP ICLR 2024
  arXiv:2310.04408, LLMLingua EMNLP 2023 arXiv:2310.05736)이 있으나 요약
  환각·정보 손실 리스크가 있어 **기본값 금지** — 원문 ref 보존이 조건.
- Retrieve의 BM25 선택 근거: 전문 도메인에서 범용 dense 임베딩은 BM25보다
  약하다(MedCPT, Bioinformatics 2023). dense/hybrid는 재현성 문제도 실증됨
  (ReproRAG, arXiv:2509.18869) — v1 제외. **대상 문서 리비전을 run 기록에
  고정**해야 리플레이가 성립한다. cross-encoder rerank는 후속 검토.
- Extract(코드 실행 후 결과만): 가장 강한 절감 실증 — Anthropic code execution
  with MCP(150k→2k 토큰), CodeAct(ICML 2024, arXiv:2402.01030). 필터 코드가
  기록되므로 재현 가능. 샌드박스 인프라가 필요해 후순위.
- 공통 안전줄: 원문 참조 보존(MemGPT 페이징 패턴, arXiv:2310.08560) +
  크기 정직 보고. top-k/섹션 선택이 틀리면 "틀린 답이 재현되는" 형태이므로,
  무엇을 근거로 골랐는지를 RunEvent에 남긴다.

## Execution

`packages/adapters`에 `HttpToolAdapter`:

- `url_template` + input 값으로 요청을 만들고, `timeout_ms`를 지킨다.
- 실행 전 `allowed_tools` 검사 → `tool.policy_checked` 발행.
- 호출 → `tool.requested` / `tool.completed` 발행. 실패는 `error` 포트로 —
  예외를 던지지 않고 결과로 돌려주는 기존 순수함수 규율 그대로.
- `approval_policy`가 사람 확인을 요구하면 human gate와 같은 hold 메커니즘을 탄다.

엔진 쪽은 `KIND_BY_NODE_TYPE`에 도구 노드 한 줄을 더하는 것으로 끝난다
(표에 한 줄 — 기존 설계 그대로).

## Prerequisites (선행 정리)

이 기능 이전에 닫아야 할 기존 gap — 별도 브리프로 먼저 진행한다:

1. validator에 ref 정합성 규칙 (`resource_ref` → 존재하는 바인딩 id인가)
2. ref 규약 확정: 노드의 `resource_ref`는 바인딩 **id**를 가리킨다 (mcp:// 직접 참조 금지)
3. `McpRef` 등 ref pattern을 JSON Schema에 싣기 (`Field(pattern=...)`)

## Phasing

1. **P0** — 선행 정리 3건 (위)
2. **P1** — 계약: ToolDef(+result_handling), ResourceBinding.tools, patch op 3종, 노드 일반화 + 동적 포트
3. **P2** — Tool Wrapper 생성 서비스(전략 제안 포함) + 미리보기/승인 UI + 팔레트 노출
4. **P3** — HttpToolAdapter 실행 + 결과 처리 전략(Full/Sections/Digest/Retrieve) + tool.* 이벤트 + 정책 집행
5. **P4(후속)** — 전략 비교 eval (같은 케이스를 전략 variant로 돌려 품질·비용 비교)

P3까지 가면 "도구 실행" 노드가 아무 일 없이 초록불이 되는 현재의 거짓 성공도
사라진다. MCP executor는 그 뒤에 같은 어댑터 자리(`kind: "mcp"`)로 들어온다.
