# agentcanvas-api — 그래프를 저장하는 서버 (Control Plane)

AgentSpec을 저장하고 지나온 판을 되돌려주는 최초의 서버다.

## 띄우기

```bash
uv run uvicorn agentcanvas_api.app:create_app --factory --reload   # http://127.0.0.1:8000
AGENTCANVAS_DB=/tmp/agentcanvas.db uv run uvicorn agentcanvas_api.app:create_app --factory
```

저장 파일은 기본값 `./agentcanvas.db`이고 `AGENTCANVAS_DB`로 바꾼다.
문서(OpenAPI)는 띄운 뒤 `/docs`에 있다.

스튜디오는 서버와 다른 자리(포트)에서 뜨므로, 브라우저는 서버가 그 자리를 허락했는지 먼저 묻는다.
기본은 내 컴퓨터에서 띄운 스튜디오(`http://localhost:5xxx`·`http://127.0.0.1:5xxx`)만 받는다.
다른 자리에서 띄웠다면 쉼표로 적어 준다 (아무나 여는 `*`는 쓰지 않는다):

```bash
AGENTCANVAS_ALLOWED_ORIGINS=https://studio.example,http://localhost:4321 \
  uv run uvicorn agentcanvas_api.app:create_app --factory
```

## 문 아홉 개

| 메서드 | 길 | 하는 일 |
|---|---|---|
| POST | `/specs` | 새 그래프를 처음 저장한다 (첫 판). 이미 있으면 409 |
| GET | `/specs` | 저장해 둔 그래프들의 지금 모습 — `{documents, has_more}` (최근에 저장한 것이 앞, 200개까지) |
| PUT | `/specs/{id}` | 있는 그래프를 고친다. 내용이 같으면 새 판을 만들지 않는다 |
| GET | `/specs/{id}` | 가장 나중에 저장된 그래프 |
| GET | `/specs/{id}/revisions` | 지나온 판들 (최근 것이 앞) |
| POST | `/specs/{id}/runs` | 저장된 최신 판을 실행한다 — `{run, status}`. `{"spec_revision": ...}`을 적어 보내면 그 판이 최신일 때만 돈다 (아니면 409) |
| GET | `/runs/{id}` | 그 실행의 지금 모습 — `{run, status}` |
| GET | `/runs/{id}/events` | 실행이 남기는 이벤트를 흘려보낸다 (SSE). `Last-Event-ID`나 `?after=`로 읽던 자리부터 이어 받는다 |
| POST | `/runs/{id}/approval` | 밸브 앞에 멈춰 선 실행에 사람이 답한다 (`{"approved": true, "values": {...}}`). 멈춰 있지 않으면 409 |

## 약속

- **판을 매기는 권위는 서버에 있다.** 클라이언트가 적어 보낸 `version`·`revision`은 읽지 않고,
  계약의 `AgentSpec.computed_revision()` 값으로 덮어쓴다. 해시를 여기서 만들지 않는다.
- **저장은 벌주지 않는다.** 아직 손볼 곳(engine `validate_graph`)이 있어도 저장되고,
  무엇이 걸렸는지 `issues`로 함께 돌려준다. 계약을 어겨 읽을 수 없는 것만 422로 거절한다.
- **이력은 고쳐 쓰지 않는다.** 판은 덧붙이기만 한다.
- **목록은 한 번에 200개까지.** 그보다 오래된 것은 아직 돌려주지 않는다.
  잘렸는지는 서버가 세어 `has_more`로 말해 준다 — 화면이 개수를 보고 짐작하지 않는다
  (딱 200개가 저장돼 있으면 `has_more`는 거짓이다).
- **실행의 상태는 이벤트가 말한다.** 실행에 status 필드는 없다 — `running·paused·completed·failed`는
  마지막 이벤트에서 파생된 값이고, 이벤트는 덧붙이기만 한다.
- **실행은 한 판의 실행이다.** 실행 이름은 서버가 발급하고, 시작한 판이 그 실행에 박힌다.
  그 사이 그래프를 고쳐 저장했어도 실행은 **시작한 판**으로 이어 돈다 (저장소에서 그 판을 꺼내 온다) —
  밸브 앞에서 고민하는 동안 저장 한 번 했다고 실행이 막히지 않는다.
- **답은 한 번만 먹힌다.** 같은 순간에 두 답이 오면 하나만 실행을 재개시키고, 진 쪽은 409로 돌아온다.
- **거절에는 값이 없다.** `{"approved": false, "values": {...}}`는 계약이 거절한다 (422).
- **흘려보내기는 자기가 닫는다.** 실행이 끝난 이벤트(`run.completed`·`run.failed`)를 보내면 스트림을 닫고,
  멈춰 선 실행이면 열어 둔 채 기다린다 (15초마다 `: keepalive` 한 마디).
- 실행은 엔진의 갈림길 실행기(`routed_run`)가 맡는다 — 조건과 포트를 읽어 **고른 갈래만** 실제로 돈다.
  판단(어느 길로 갈 것인가)은 아직 진짜 모델이 아니라 주입된 결정론 판단이다 — 같은 그래프면 언제나 같은 이벤트가 나온다.
- 시계·저장소·허락할 자리는 주입한다(`create_app(store=..., clock=..., allowed_origins=[...])`) —
  시험은 기억만 하는 저장소를 쓰고, 주입한 값이 환경변수보다 앞선다.
