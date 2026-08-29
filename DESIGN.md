# DESIGN.md — AgentCanvas

> **지위**: 현재 Studio UI 구현·리뷰의 계약. 여기 없는 시각 결정을 새로 내릴 때는 이 문서에 먼저 추가한 뒤 구현한다. 원칙과 근거는 [docs/design/design-language.md](docs/design/design-language.md), 값의 단일 출처는 `apps/studio/src/tokens.css`입니다. **이 문서의 값과 `tokens.css`가 어긋나면 구현 값인 `tokens.css`를 기준으로 이 문서를 고칩니다.**

## 0. Overview

- 한 줄 무드: **"정밀한 작업대 위, 신호가 흐르는 회로"** — 밝고 정제된 중립 캔버스, Flow Cyan(청록)은 크롬의 좁은 자리에만, 캔버스 위 색의 주인은 실행 상태.
- 벤치마크 craft: 토스(마찰 제거·안심·쉬운 말), Figma/Linear(캔버스 중립·hairline 정밀함).
- 커버 범위: studio 앱 전체. 커버하지 않음(Known Gaps): 마케팅/랜딩 표면, 모바일 전용 레이아웃(§10 참조), 3D Runtime World.

## 1. Canvas & Viewport

```
canvas
- Background: var(--bg-canvas)  /* 단색. 그리드·점·텍스처 금지 */
- 깊이: 카드 표면 대비(--surface vs --bg-canvas) + hairline + shadow로만
- 정렬 신호: 드래그 중에만 --accent 1px 가이드 라인(스냅 6px) — 평시엔 어떤 선도 없다
- 줌: 커서 중심. Shift+1 전체 보기, Shift+2 선택 보기
```

**플로팅 레이어 문법** (고정 패널 금지 — 모든 UI는 캔버스 위에 뜬다):

| 레이어 | 위치 | 구성 |
|---|---|---|
| `.layer-top-left` | 좌상 | DocCard(로고·문서명·메뉴) + HistoryControls(되돌리기 — 항상 보임) |
| `.layer-top-center` | 상중앙 | ModeSegment (만들기/실행/평가/고치기) |
| `.layer-top-right` | 우상 | 검증 pill + 실행 주 버튼 |
| 좌측 독 | 좌 | 아이콘 독(36px) — 패널은 클릭 시 옆으로 펼침, **한 번에 하나** |
| `.layer-right` | 우 | 세로 스택: inspector 카드(선택 시에만) → 이벤트 목록(실행 시) — **겹침 금지, 스택** |
| `.layer-bottom` | 하중앙 | 세로 스택: 토스트 → 타임라인(실행 시) → 실행 히스토리 스트립 |
| 우하 | | 미니맵(소형 148×96) + 줌 컨트롤 |

- 모든 플로팅 요소: `--surface-glass` + backdrop blur + `--hairline` 1px + `--shadow-float`, radius `--radius-card`.
- **Esc 우선순위 체인** (한 번의 Esc는 한 가지 일만 한다 — 여러 단계를 한꺼번에 닫지 않는다. 초점 위치가 순서를 바꾸지 않는다):
  ⓪ Impact(빼기 확인) 물리기 ① **되묻는 물음**(gate 거절 확인, 문서 열기 확인 등 — 되묻기는 언제나 그 물음을 띄운 표면보다 먼저 물러난다) ①′ 열린 실행 입력 카드 닫기(§7 run-input-card — 넣던 값은 버리지 않는다) ② 열린 gate 카드 → 멈춘 채 두기(닫기 — 응답을 강요하지 않는다) ③ 문서 열기 목록 닫기 ④ 열린 독 패널 닫기 ⑤ 비교 화면 닫기(선택 해제) ⑥ 실행 보기 닫기 ⑦ 선택 해제. 항상 이 순서.
  예외 셋: 텍스트 입력 중(inspector 필드 등)의 Esc는 입력의 것이다 — 체인을 타지 않는다. 노드 피커가 열려 있으면 Esc는 피커를 닫는다(§7 node-picker — 체인보다 먼저). gate 승인 폼 필드의 Esc는 체인이 받아 그 필드의 초점만 거둔다(§7 gate-card — ②보다 먼저, 카드는 닫지 않는다).

## 2. Colors (역할 붙은 토큰만 사용 — 컴포넌트에 hex 직접 사용 금지·lint로 강제)

**브랜드 Flow Cyan** (hue 192°): 50 `#F3FAFC` · 100 `#E2F4F8` · 200 `#C4E9F3` · 300 `#97DCED` · 400 `#5ECDE8` · 500 `#23BFE7` · 600 `#10A2C6` · 700 `#0D83A0` · 800 `#0E667C` · 900 `#0D4A59`

| 역할 토큰 | light / dark | 쓰는 곳 (이곳에만) |
|---|---|---|
| `--accent` | 700 `#0D83A0` / 500 `#23BFE7` | 주 행동 버튼, 선택 ring, 포커스, 링크, 모드 활성 |
| `--accent-soft` | 100 / 900 | 선택·hover 배경 |
| `--running` | `#3B82F6` (hue 220 — 브랜드와 분리) | 실행 중 상태·관·물방울 |
| `--success` | `#12B76A` | 완료 |
| `--warn` | `#F59E0B` | 미설정·확인 대기·도달 불가 |
| `--danger` | `#EF4444` | 끊어짐·실패·삭제 |
| 상태 3층 규칙 | 색=바/마크, `-soft`=바탕, `-ink`=글자(AA) | 상태색 원색을 글자로 쓰지 않는다 |
| 표면 | `--bg-canvas`→`--surface`→`--surface-raised`→glass | 캔버스→카드→떠 있는 것 |
| `--type-*` 6종 | 저채도 구분색 | 노드 타입 칩 전용 |

## 3. Typography (Pretendard 번들, CDN 금지)

| 토큰 | size | weight | 쓰는 곳 |
|---|---|---|---|
| `--text-title` | 14px | 600 | 카드·패널 제목 |
| `--text-body` | 13.5px / lh 1.55 | 400 | 본문·설명 |
| `--text-label` | 12.5px | 500 | 버튼·필드 라벨·뱃지 |
| `--text-caption` | 11.5px | 400 | 보조·event_type 원문 |
| 숫자 | `tabular-nums` | | 시간·카운트 전부 |

- 기술 명칭(mono)은 `--font-mono` + caption 크기. 사용자 노출 문구는 반드시 i18n 사전(ko/en) 경유 — 컴포넌트 내 한글 리터럴 금지(lint).

## 4. Spacing & Placement 규칙

- 스케일: 4/8/12/16/24/32 (`--space-1..6`)만. 임의 px 금지.
- **노드 부속물 배치 규칙**: 노드에 붙는 카드(승인 카드, 향후 응답 폼 등)는 **노드 바로 아래**, 노드와 같은 폭(min `--node-width`), 간격 `--space-2`, 세로 스택. 노드 옆(좌우) 배치 금지 — 포트 라벨과 겹친다.
- 노드 부속 카드가 떠 있는 동안: 그 노드의 **출력 포트 라벨과 툴팁은 숨긴다** (시각 충돌 금지, aria 관계는 유지).
- 포트 라벨: 기본 숨김 → 포트 hover 시 해당 라벨 → 연결 드래그 중 호환 전부 → 노드 선택 시 그 노드 전부.

## 5. Elevation

| 토큰 | 쓰는 곳 |
|---|---|
| `--shadow-card` | 노드 카드(기본) |
| `--shadow-float` | 플로팅 패널·독·타임라인·피커 |
| `--shadow-lift` | 선택된 노드·드래그 중 |
| `--ring-accent`/`--ring-focus` | 선택/포커스 — 그림자와 병행 |

그림자는 항상 hairline과 함께 — 그림자만으로 경계를 만들지 않는다.

## 6. Shapes

- radius: 카드 14 / 컨트롤 10 / 칩 8 / pill 999 (`--radius-*`). 같은 화면에서 임의 radius 혼용 금지.
- 관(edge): 대기 1px `--edge` 베지어 → carrying 4px `--running`+글로우 → carried 2.5px 저채도 잔상. 물방울 `--pipe-drop` 3px, 4개, 간격 편차(등간격 금지).

## 7. Components (variant별 key:value — 새 컴포넌트는 이 형식으로 여기에 추가)

```
node-card (기본)
- Surface: var(--surface) | Border: 1px var(--hairline) | Radius: var(--radius-card)
- Shadow: var(--shadow-card) | Width: var(--node-width)
- 구조(상시): [타입 칩 22px] [이름 --text-title] [상태/설정필요 뱃지] — 한 줄. 설명·포트명 상시 노출 금지
- 미설정: '⚠ 설정 필요' warn 뱃지 (hover 불필요, 항상)
- hover: 툴팁(plain_description 1줄, 키보드 포커스 동일)
- selected: ring var(--ring-accent) + shadow-lift + 그 노드 포트 라벨 노출
- running: 좌측 rail 3px var(--running) + pulse + 상태 뱃지(기호+쉬운 말)
- waiting(확인 대기): rail·뱃지 var(--warn) '✋ 확인을 기다려요' + 출력 포트 라벨·툴팁 숨김
- completed: rail var(--success) + '✓ 마쳤다 {시간}' (핵심 숫자 1개만)
- failed: rail var(--danger) + 오류 요약 1줄 (실패 시에만 2번째 정보 허용)

button-primary
- Bg: var(--accent) | Text: var(--on-accent) | Radius: var(--radius-control)
- Padding: var(--space-2) var(--space-4) | Text: --text-label 500
- hover: var(--accent-hover) | active: var(--accent-active) | focus-visible: var(--ring-focus) | disabled: 40% + title로 이유

button-ghost (보조)
- Bg: transparent | Border: 1px var(--hairline) | Text: var(--ink)
- 상태 4종 동일 규칙 (hover: --surface-hover)

gate-card (승인 카드 — 노드 부속물 배치 규칙 §4 적용)
- 위치: 노드 아래 top: calc(100% + var(--space-2)), width 100%, min-width var(--node-width)
- Surface: var(--surface) | Border: 1px var(--warn) | Radius: var(--radius-card)
- 구조: 제목 1줄('✋ 여기서 멈춰 있어요') + 본문 1줄 + 버튼 행 [primary(승인하고 계속)][ghost-danger(거절하기)][ghost(멈춘 채 두기)] 나란히 같은 높이
- ghost-danger 버튼: transparent bg + 1px var(--danger) border + var(--danger-ink) 글자, hover: var(--danger-soft) 바탕 (4상태 동일 규칙)
- 거절 확인 모드(거절하기 클릭 시 카드 내용 교체, 새 레이어 금지): 본문 '거절하면 흐름이 여기서 끝나요' + 버튼 행 [정말 거절하기: var(--danger-soft) 바탕 + var(--danger-ink) 글자 + 1px var(--danger) border][돌아가기 ghost]. Esc = 돌아가기
- 거절 후: 카드 닫힘, gate 노드 rail·뱃지 var(--warn) '✋ 거절했어요' (거절은 실패가 아니다 — danger 금지), 이벤트 목록 쉬운 말 '사람이 거절해서 흐름을 여기서 마쳤다'
- **도구 승인 사용례(P3b)**: `ask_first` 정책의 도구 노드가 실행 전에 멈추면 같은 gate-card를 그대로 쓴다 — 본문이 '이 도구를 불러도 될까요'를 도구 이름·쉬운 설명(plain_description)과 함께 말하고, 무엇을 줄지(입력 요약)를 한 줄로. 새 카드 발명 금지. 허락=도구를 부른다, 거절=부르지 않고 흐름을 error 포트로(부르지 않은 것을 적지 않는다). control.human_gate의 승인과 같은 문법·같은 이벤트(human.approval_requested)
- 카드 존재 중 노드 툴팁·출력 포트 라벨 숨김
- **승인 폼**(gate의 입력 양식이 해석됐을 때, 본문과 버튼 행 사이): 필드 세로 스택, 필드 간격 var(--space-2). 필드 = 라벨(--text-label, ink) + 컨트롤(inspector 폼 컨트롤과 같은 스펙 재사용 — 새 시각 발명 금지). 필수 필드는 라벨 뒤 '(필수)' 글자 표기(기호만으로 나누지 않는다)
- 필수 미입력이면 '승인하고 계속' disabled(40% + title '필수 입력을 채우면 승인할 수 있어요' — button-primary disabled 규칙). 거절·멈춘 채 두기는 입력과 무관하게 항상 살아 있다(응답을 강요하지 않는다)
- 폼 필드에 초점이 있을 때 Esc는 그 필드의 초점만 거둔다(카드는 닫지 않는다 — §1 체인 ②보다 먼저). 거절 확인 모드로 바뀌어도 입력한 값은 버리지 않는다(돌아가기로 복귀 시 그대로)
- **양식 못 찾음**(ref가 카탈로그에 없음): 폼 자리 대신 안내 1줄(--text-caption, ink-soft) '이 단계가 요구한 입력 양식을 찾지 못했어요 — 입력 없이 승인만 할 수 있어요'. 내부 ref 원문은 화면에 쓰지 않는다. 승인·거절은 그대로 동작(막지 않는다)

doc-card (좌상 플로팅 — 로고·문서명·메뉴·저장 상태)
- 문서명: --text-title. 아직 문서가 없으면 '새 초안', 문서는 있는데 이름만 없으면 '이름 없는 문서' — 뒤엣말은 **열기 목록과 같은 말**을 쓴다(한 문서를 두 화면이 다르게 부르지 않는다). id 같은 내부 이름표는 제목·이름 입력칸·스크린리더 어디에도 쓰지 않는다
- 문서명: 클릭 시 인라인 편집(같은 자리 input) — Enter 확정(undo 가능한 편집), Esc·바깥 클릭(blur) 취소, 빈 값이면 원복(빈 이름 불가 — 계약 min_length와 동일). 확정은 명시적 행동(Enter)만
- 저장 상태 캡션(--text-caption, ink-soft, 항상 보임) 4상태: '저장하는 중이에요'(왕복 중) / '저장했어요 · N번째 판' / '저장 안 된 변경이 있어요' / '아직 저장 안 했어요'
- 저장: 메뉴 항목 + Cmd+S(글자 입력 중에도 듣는다 — 문서명 편집 중이면 그 이름을 먼저 확정하고 저장). 왕복 중에는 저장·실행 둘 다 잠근다(중복 실행 금지)
- **Cmd+S는 언제나 앱의 것이다** — 저장할 수 없는 상태(문서 없음·왕복 중·실행 중·빼기 확인 중)에서도 브라우저의 '페이지 저장' 대화상자가 뜨게 두지 않는다. 대신 왜 지금 저장할 수 없는지 토스트로 한 번 말한다(조용한 무시 금지)
- 토스트 3종은 색+기호+쉬운 말 3중 표기, 기호가 서로 달라야 한다: 성공 `✓`(accent) / 이슈 있는 저장 `!`(warn, '저장했어요 — 손볼 곳 N곳') / 실패 `✕`(danger, 이유는 쉬운 말 한 줄 — 서버 원문·JSON 노출 금지, 데이터는 그대로)
- 하단 toast가 받는 공용 상태 이름은 `feedbackNotice`다. 저장·실행·문서 복귀가 같은 surface를 써도 저장 전용 상태 이름을 재사용하지 않는다. eval의 `caseSaveNotice`, 편집 history의 `notice`, 연결 안내는 각자 surface 계약을 유지한다
- 메뉴: 저장 / **열기**(서버에 저장해 둔 문서 목록) / 파일 열기(내 컴퓨터의 파일) / 판 기록 / **게시**(CHAT-2) / 내보내기 / 정리하기. 문서가 없으면(빈 캔버스) 저장은 메뉴·단축키 **양쪽 다** 막고 이유를 말한다(title). 서버가 켜졌는지는 미리 알 수 없으므로 그것만은 시도 후 토스트로 알린다
- **게시 항목(CHAT-2)**: 아직 게시 안 됐으면 '이 판 게시하기'(지금 저장된 판을 대화 상대로 내놓는다), 이미 게시됐으면 두 항목 — '다른 판으로 바꿔 게시하기'(지금 판으로 갱신)와 '게시 내리기'. 저장 안 된 변경이 있으면 게시 항목 disabled + title '먼저 저장해야 게시할 수 있어요'(게시는 저장된 판을 가리키는 일). 문서 없으면 disabled + 이유. 서버 없이는 시도 후 토스트(열기와 같은 규율)
- **게시 표식(CHAT-2)**: 저장 캡션과 **다른 축**이라 한 줄로 뭉치지 않는다(저장된 최신 판 ≠ 게시된 판일 수 있다). 게시됐을 때만 저장 캡션 아래 별도 표식 한 줄(--text-caption, accent 글자 — 저장 캡션의 ink-soft와 다른 축임을 색으로도 가른다): 게시된 판이 지금 보는 판과 같으면 '지금 판을 게시했어요', 다르면 'N번째 판을 게시했어요 — 지금 보는 판과 달라요'(만드는 쪽이 캔버스를 고쳐도 게시된 판은 그대로라는 vision 원칙을 그 자리에서 말한다). 게시 전에는 이 표식이 없다(없는 상태를 빈 배지로 세우지 않는다)
- 두 '열기'는 이름으로 구분한다 — 서버는 '열기', 내 컴퓨터는 '파일 열기'. 어느 쪽인지 설명 없이 아이콘만으로 나누지 않는다
- 파일 열기에서 JSON/schema 검증이 끝난 뒤에도 저장하지 않은 작업이 있으면 캔버스를 바꾸지 않고 중앙 confirmation(`alertdialog`)을 보여 준다. 선택지는 서버 문서 열기와 같은 `[저장하고 열기][그냥 열기][돌아가기]`이며, 저장 실패·돌아가기·Esc는 현재 작업을 보존한다. `그냥 열기`는 파일을 새 unsaved document로 연다(`savedSpec=null`).

open-dialog (문서 열기 — doc-card 메뉴 '열기')
- 위치: 화면 중앙 플로팅(공용 .layer + .open-dialog) | glass + 1px hairline + shadow-float + radius-card
- 구조: 제목 '어떤 문서를 열까요' + 목록 + 닫기 ghost. 목록 한 줄 = [이름(없으면 '이름 없는 문서') --text-title] [마지막 저장 시각 · N번째 판 --text-caption ink-soft]
- 정렬: 마지막 저장이 최근인 것부터. 지금 열려 있는 문서는 '지금 보는 문서' 뱃지(accent-soft + accent), 다시 눌러도 아무 일 없음
- 키보드: 열리면 목록 첫 줄에 초점, ↑↓ 이동, Enter 열기, Esc 닫기(§1 체인 ③). 닫히면 초점은 문서 메뉴 버튼으로 복귀
- 빈 목록: '아직 저장한 문서가 없어요 — 지금 만드는 것을 저장하면 여기 쌓여요' 1줄 (조용한 빈 화면 금지)
- 목록이 **잘렸으면**(서버가 보여주지 못한 문서가 더 있다고 알린 경우) 마지막 줄 뒤에 '오래된 문서는 아직 보여줄 수 없어요' 1줄(--text-caption, ink-soft) — 조용한 절단 금지. 잘림 여부는 서버가 말한다(개수로 짐작 금지)
- 목록을 불러오는 중: `DocListState.loading`이 true이면 카드에 '문서 목록을 불러오는 중이에요'를 `role=status`로 말하고 dialog에 `aria-busy=true`를 붙인다. 최초 요청은 빈 body가 아니라 이 안내만 보이며, reload 중에는 기존 rows를 유지한 채 안내를 추가한다. status는 초점을 훔치지 않고 닫기·Esc는 계속 동작한다. 성공·실패 응답이 현재 요청이면 loading을 끄고 기존 목록/오류 계약으로 돌아간다. 닫힌 뒤나 오래된 요청의 응답은 화면을 되살리지 않는다
- 목록 새로 고침: 성공 목록 header의 제목 옆에 기존 `icon-button` 문법의 `↻` 버튼을 둔다. 접근 이름과 title은 `open.reload`(ko: '문서 목록 새로 불러오기' / en: 'Reload documents')로 고정하고 내부 API 이름은 화면에 쓰지 않는다. 버튼은 현재 목록을 다시 묻는 명시적 입구이며 `reloadDocList()`를 재사용한다. loading 중에는 disabled로 중복 요청을 막고, 기존 rows·`role=status`·`aria-busy`를 유지한다. 새로고침 버튼은 목록 첫 줄의 자동 초점을 훔치지 않으며, 닫기·Esc·rows 선택은 기존 계약을 따른다. 실패 시 header 버튼 대신 기존 `다시 해보기`를 오류 줄에 둔다
- 새로 고침 초점 전이: pointer나 keyboard로 새로 고침을 시작하면 native disabled가 되는 버튼에 초점을 남기지 않는다. 기존 row가 있으면 첫 row로, empty 목록이면 닫기로 옮기며 pending 중에도 row의 ↑↓/Enter와 Esc를 쓸 수 있어야 한다. 성공 뒤 pending 중 초점이 있던 문서가 새 목록에도 있으면 그 row를 유지하고, 사라졌으면 새 첫 row, empty가 됐으면 닫기로 보낸다. 실패로 rows가 교체되면 `다시 해보기`로, `다시 해보기` pending에는 닫기로 옮기고 성공 뒤 첫 row·재실패 뒤 `다시 해보기`로 돌아간다. `role=status`는 어느 전이에서도 초점을 받지 않으며 Esc로 닫으면 문서 메뉴 버튼으로 복귀한다
- '지금 보는 문서'를 다시 고르면 문서를 다시 읽지 않고 대화상자만 닫는다 (빈 걸음도, 조용한 무시도 아니다)
- 파일 열기 confirmation도 같은 `.open-dialog__ask` 표면을 재사용한다. 제목은 파일용 쉬운 말 토큰을 쓰고 내부 id·파일 원문은 노출하지 않는다. confirmation이 닫히면 초점을 파일 열기를 시작한 문서 메뉴 버튼으로 되돌리며, Esc는 한 단계만 물러난다.

revision-history (문서 판 기록 — doc-card 메뉴 '판 기록')
- 위치: 문서 카드 메뉴 바로 아래에 붙는 비차단 anchored layer. 화면 중앙 modal 표면인 open-dialog를 재사용하지 않는다
- 구조: 제목·닫기 + 서버가 준 순서를 보존한 판 목록. 각 줄은 판 번호·저장 시각·짧은 revision 식별자만 읽기 전용으로 보여준다
- 상태: 불러오는 중 / 판 없음 / 서버 오류 / 응답 해석 불가를 서로 구분한다. 서버 오류 원문이나 JSON은 화면에 쓰지 않는다
- 식별자: `sha256:` 접두사와 digest 앞 8자리 뒤 `…`까지만 표시한다. 전체 digest는 DOM·title·aria-label·클립보드에 넣지 않는다
- **게시된 판 배지(CHAT-2)**: 게시된 판의 줄에 작은 배지 '게시됨'(accent-soft 바탕+accent 글자, pill 문법). 판마다 붙지 않고 게시된 그 한 판에만. 이 표면에서 게시/내리기를 하지는 않는다(그건 doc-card 메뉴의 일 — 같은 행동을 두 입구에서 다른 길로 만들지 않는다), 배지는 읽기 표시일 뿐
- 문서가 없는 상태의 메뉴 항목은 disabled이며 이유를 title로 알린다. 복원·diff·merge·재로드·권한 변경은 이 표면의 범위가 아니다
- 문서를 열면 주소에 `?doc=<id>`가 남는다 — 새로고침하면 그 문서가 다시 열리고, 주소를 복사하면 같은 문서가 열린다. 주소의 id를 찾지 못하면 빈 초안으로 시작하고 '그 문서를 찾지 못했어요' 토스트 1회 + 주소는 정리한다
- 주소 복귀의 같은 id `fetchDoc`가 아직 끝나지 않았으면 in-flight 요청 하나만 공유한다(개발 StrictMode replay의 중복 GET 방지). 각 호출의 최신성 generation은 따로 유지해 가장 최신 호출만 adopt/feedback을 적용하며, settle 뒤 재복귀·retry와 다른 id는 새 요청이다
- 목록을 못 불러오면: 목록 자리에 이유 1줄(쉬운 말) + '다시 해보기' ghost. 대화상자는 닫지 않는다
- 저장 안 된 변경이 있는데 다른 문서를 열려 하면: **같은 카드 안에서 되묻는다**(새 레이어 금지) — '아직 저장하지 않은 작업이 있어요' + [저장하고 열기 primary][그냥 열기 ghost-danger][돌아가기 ghost]. Esc = 돌아가기(§1 체인 ①)

pill (집계·히스토리 카드)
- Radius: var(--radius-pill) | Border: 1px hairline | Text: --text-label
- 검증 pill: warn-soft 바탕 + warn-ink 글자. 실행 히스토리 카드: 활성 시 accent-soft+accent

dock / dock-panel
- 독 버튼 36px, 아이콘+tooltip(제목+설명), aria-expanded
- 패널: glass, 독 옆 슬라이드, 한 번에 하나, Esc/재클릭 닫힘

inspector-card
- 폭 var(--panel-inspector) (좁으면 -narrow) | 선택 시에만 존재 | 닫기=선택 해제
- 필드: 라벨(--text-label) + 설명(--text-caption, ink-soft) + 오류(danger-ink, 쉬운 말)
- **지우기**: 필드 스택 맨 아래 '이 노드 지우기' 버튼(button-ghost 4상태 + 글자만 var(--danger-ink) — danger 배경은 상시 노출로 쓰지 않는다 §9). **확인 대화를 더하지 않는다** — 연결이 없는 노드는 즉시 빠지고, 연결이 끊기는 노드는 기존 빼기 확인(무엇이 끊어지는지 보여 주고 묻는 카드)을 그대로 탄다(같은 행동은 입구가 달라도 같은 길 — Delete 키와 동일). 캡션 한 줄(--text-caption, ink-soft) "되돌리기로 언제든 살릴 수 있어요"가 무섭지 않음을 말한다. title에 단축키(Delete)를 함께 적는다. 실행을 보는 동안(잠금)은 비활성 + 이유 title

port-handle (이어 붙이는 점 — 보이는 크기와 잡히는 크기는 다르다)
- 보이는 점: var(--handle-size) 그대로(8px, hover 시 -hover 확대·자석 규칙 기존 유지). **연결선의 끝은 언제나 보이는 점에 닿는다** — 히트 영역 확장이 선의 끝점을 옮겨서는 안 된다
- **잡히는 영역**: 가로 var(--handle-hit)(24px), 세로는 이웃 포트와 겹치지 않는 만큼(포트 간격 한도) — 점 둘레의 투명 히트. 작은 점을 정밀 조준하게 하지 않는다(판정 기준: 실수해도 무섭지 않은가 이전에, 애초에 실수가 나기 어려운가). 카드 가장자리 바깥쪽에 치우쳐 카드 본문 드래그를 가리지 않는다

node-picker
- 포트 드래그 릴리즈/더블클릭 좌표에 표시 | glass + shadow-float
- 검색 입력 자동 포커스, ↑↓ 순환+Enter+Esc, 호환 노드만 + 이유 한 줄('~에 이을 수 있는 노드만')

connection-hint (연결이 안 될 때 그 자리에서 말한다 — 손이 있는 곳에서)
- **말하는 자리는 손이 있는 곳**: 거절은 연결을 놓은 지점, 못 잇는 드래그 안내는 잡고 있는 포트 옆. 아래 var(--space-2), 화면 가장자리에서는 안쪽으로 뒤집는다. 화면 반대편(StatusBar)에서 말하지 않는다
- Surface: var(--surface-glass) + blur | Radius: var(--radius-control) | Shadow: var(--shadow-float) | 최대 폭 var(--node-width)
- 톤 2종(색+기호+쉬운 말 3중 표기 §9): 거절 `✕` 1px var(--danger) + var(--danger-ink) / 안내 `!` 1px var(--warn) + var(--warn-ink)
- 구조: 한 줄 [기호] [이유 --text-label]. 이유로 끝내지 않고 **다음 걸음**을 말한다(예: 무엇과 무엇이 다른지 / 무엇을 먼저 놓으면 되는지)
- **스스로 사라진다**: 등장 --dur-tap 안에, var(--dur-hint) 뒤 소멸. 실패는 사용자가 치워야 할 쓰레기가 아니다 — 닫기 버튼 없음
- **쌓이지 않는다**: 새 안내가 오면 갈아탄다(항상 하나). 연결에 성공하거나 **안내가 예고한 일이 일어나면**(빈 곳에 놓아 노드 피커가 열림) 즉시 사라진다 — 할 일을 다 한 말은 남지 않는다
- pointer-events: none — 안내가 다음 행동을 가로막지 않는다
- 접근성: role="alert". reduced-motion에서는 페이드 없이 즉시 표시/제거하되 **수명은 줄이지 않는다**(읽을 시간은 모션이 아니다)
- 상호작용 없음 — hover/active/focus/disabled 4상태가 성립하지 않는다(누를 것이 없다). 빠뜨린 것이 아니다
- **말은 화면에 보이는 것으로 한다**: 내부 id 문법(`node.port`)·자료형 원문(string·array)을 그대로 쓰지 않는다. 포트는 화면의 그 라벨로, 종류가 다르다는 말은 쉬운 말로. 이 카드에 뜨는 문구는 **서로 같은 말투**를 쓴다(한 카드가 두 목소리로 말하지 않는다)
- 채널 분리: 연결이 안 되는 이유는 **이것만** 말한다. StatusBar는 저장·일반 안내 전용
- **첫 연결 초대(안내 톤의 사용례)**: 그래프에 연결이 하나도 없는 상태에서 노드를 놓으면, 그 노드의 첫 출력 포트 옆에서 안내 톤(`!`)으로 한 번 말한다 — "가장자리 점을 끌어 다음 단계를 이어요"(끌면 이을 수 있는 것만 보여 준다는 다음 걸음 포함). 연결 드래그가 시작되거나(예고한 일이 시작됨) 첫 연결이 생기면 즉시 사라진다. 이미 연결을 만들어 본 그래프에서는 말하지 않는다(파생 상태 — 튜토리얼 상태 머신 아님, first-steps-card 문법)

first-steps-card (처음 온 사람의 네 걸음 — 빈 캔버스에서 첫 실행까지)
- 정체: 직접 조립(Advanced) 경로의 첫 걸음 안내. 걸음의 완료는 **그래프의 실제 상태에서 파생**된다(따로 켜고 끄는 튜토리얼 상태 머신이 아니다) — 이미 다 만들어진 문서를 열면 만든 걸음들(①~③)은 완료로 접혀 있고, **실행을 한 번 끝까지 보기 전까지는 '실행해 봐요'가 남는다**(실행을 보는 것이 이 제품의 첫 가치다). 실행까지 마치거나 숨기면 그 뒤로는 없다
- 자리: `.layer-right` 세로 스택의 마지막(inspector 카드 → 이벤트 목록 → 이 카드). 캔버스 중앙 금지 — 중앙은 모달급(열기 대화상자·비교 화면) 자리이고, 안내는 작업을 가로막지 않는다
- 구조: 제목 1줄(--text-label) + 걸음 4줄 + 숨기기(ghost, --text-caption, 상시). 걸음 = [상태 기호] [할 일 한 줄] — 지금 걸음만 [방법 한 줄(--text-caption, ink-soft)]을 함께 보여준다
- 걸음 4개(파생 술어): ① 노드 놓기(노드 ≥ 1 — 방법: 빈 곳 두 번 누르기) ② 잇기(연결 ≥ 1) ③ 채우기(빈 필수 설정 0 — 기존 '설정이 필요해요' 판정 그대로) ④ 실행해 보기(이번 실행이 끝까지 감)
- 걸음 상태 3종(3중 표기 §9): 완료 = ✓ success-ink + 취소선 없음(ink-soft로 가라앉힘) / 지금 걸음 = 번호 기호 + ink + 방법 줄 / 아직 = 번호 기호 + ink-soft. 색만으로 구분 금지
- 표면: glass + 1px hairline + radius-card + shadow-float (기존 카드 문법). 폭은 inspector와 같은 var(--panel-inspector)
- **스스로 사라진다**: 네 걸음이 모두 완료로 전이하면 축하 한 줄('첫 실행까지 해냈어요')로 바뀌고 var(--dur-hint) 뒤 소멸 + 다시 나타나지 않음(기억). 숨기기를 눌러도 같은 기억 — 기억은 이 브라우저에 남는다(locale 저장과 같은 방식)
- 축하는 카드가 걸음을 보여 주던 중 완주로 **전이**했을 때의 것이다. 축하가 머무는 동안 다른 문서로 옮겨 가면 축하는 그 자리에서 끝난다(새 문서 위에 남지 않는다) — 완주 기억은 그대로다
- Esc 체인에 끼지 않는다 — 초점을 잡지 않는 상시 안내라 '닫을 것'이 아니다. 숨기기 버튼이 유일한 상호작용(4상태는 button-ghost 그대로)
- 문구: `guide.*` 사전 접두사, 쉬운 말·해요체(ko)/명령형(en), 내부 id·자료형 원문·은유 금지 — connection-hint 문구 규칙과 같은 가드를 자동 수집으로 건다
- reduced-motion: 소멸 페이드 없이 즉시 제거하되 축하 줄이 머무는 시간은 줄이지 않는다

guided-architect-card (빈 캔버스의 Guided 첫 화면 — Phase 2.5 ARCH-1)
- 정체: Advanced 직접 조립 전에 서는 **선택 가능한** 첫 진입. 빈 캔버스에서만 보이며, `직접 조립할게요`를 누르면 기존 `first-steps-card`가 그 자리를 잇는다. 기존 문서를 열었거나 초안을 승인하면 끼어들지 않는다
- 질문: 한 시점에 하나만 묻는다. 입력 상태는 "무엇을 만들고 싶으세요?" 하나에 집중하고, review 상태는 "이 초안을 캔버스에 넣을까요?" 하나에 집중한다. 중앙 modal·코치마크·별도 tutorial mode 금지
- 위치: `.layer-right` 스택에서 inspector/event/eval 뒤, `first-steps-card` 앞. Architect가 열려 있는 동안 first-steps는 숨겨 두 카드가 동시에 첫 행동을 지시하지 않게 한다
- 입력 구조: 제목(--text-title) + 쉬운 설명(--text-body) + textarea(기존 `.control` 문법, 예시 placeholder는 값이 아님) + [초안 만들기 primary] [직접 조립할게요 ghost]. 빈 입력은 버튼 disabled + title로 다음 행동을 말한다
- 정직성: ARCH-1의 결정론적 local preview는 순수 fixture/test 경계로 남긴다. 기본 Guided 첫 실행은 ARCH-3 provider-backed preview이며, 서버 candidate와 기존 local review가 모두 통과한 뒤에만 적용한다. provider 실패를 local 성공으로 둔갑시키지 않고, 실제 provider 품질·자연어 의미 분석은 별도 실증 전까지 주장하지 않는다
- review 구조: 같은 카드 안에서 [요구 문장] → [✓ 계약 확인 / ✓ 흐름 확인 / ✓ 가짜 실행] check row → [후보 노드 N개 · 연결 M개] summary → [캔버스에 적용 primary] [다시 적기 ghost]. 통과 여부는 기호+쉬운 말+색 3층으로 말한다
- 검증 순서: committed AgentSpec schema → 도달성·고아 edge·cycle 정적 검사 → 기존 fake runtime의 고정 dry-run. 하나라도 실패하면 적용을 막고, 일반 화면에는 내부 AJV/raw JSON을 노출하지 않는다
- 적용: `spec === null && nodes.length === 0`인 빈 캔버스에서 승인할 때만 기존 `loadSpec`으로 draft를 올린다. 승인 전에는 그래프를 바꾸지 않는다. 승인 결과는 `status: draft`이며 저장·publish가 아니다. 현재 그래프를 덮는 증분 patch는 별도 범위
- 안전: 실행·저장 왕복 중인 현재 그래프를 Architect가 덮어쓰는 경로 없음. 문서 열기·승인 후 표면은 닫히고, 기존 canvas/inspector/run/first-steps를 그대로 사용한다
- 표면: 기존 glass + hairline + radius-card + shadow-float + `var(--panel-inspector)` 재사용. 새 색·radius·font·motion token 금지. 내부 목록은 패널 안에서만 스크롤

architect-patch-contract (기존 AgentSpec에 실제 Architect를 물어보는 안전한 증분 preview — Phase 2.5 ARCH-2)
- 정체: ARCH-1의 local preview와 분리된 서버 경계. 기존 AgentSpec과 `base_revision`을 받아 provider-backed `agent.patch/v1` 후보만 돌려주며 저장·publish하지 않는다. 빈 캔버스와 Guided UI 연결은 후속
- 출력: `base_revision` + 1~32개의 제한된 discriminator 작업만 허용한다 — `add_node`, `remove_node`, `replace_node_config`, `add_edge`, `remove_edge`. 임의 JSON path·id/version/status/schema/resources/execution 수정 금지
- 적용: 순수 apply가 exact base revision을 확인하고 작업을 순서대로 적용한다. 연결된 노드 삭제는 edge 선삭제 없이는 거부한다. 결과는 `status=draft`, `version+1`, canonical revision이며 저장소는 건드리지 않는다
- 검증: 기존 AgentSpec contract/raw-secret guard → patch conflict → `validate_graph` error 검사를 순서대로 통과해야 candidate를 말한다. malformed/provider 실패는 raw 모델 응답을 노출하지 않는다
- provider: 기존 `ModelCall` 주입과 model catalog/secret 경계를 재사용하고, `ModelAsk`의 선택적 response schema를 Anthropic `output_config`·OpenAI-compatible `response_format`으로 매핑한다. 실제 provider 품질은 별도 실증 게이트

architect-blank-provider-contract (빈 캔버스 provider-backed onboarding — Phase 2.5 ARCH-3)
- 정체: ARCH-1 Guided 카드의 기본 생성 경로. `POST /architect/draft`는 client `draft_id`와 request를 받고, 서버가 canonical blank seed를 만든 뒤 provider에 `agent.patch/v1`만 요청한다. 전체 `AgentSpec` 모델 출력은 허용하지 않는다
- seed: `agent.spec/v1`, `status=draft`, input required string `request`, state string `answer`, `core.input`/`core.output` 두 노드, 빈 edges/resources/execution. seed는 저장하지 않으며 revision을 서버에서 계산한다
- candidate: exact seed revision patch 적용 → 기존 schema/raw-secret/graph error 검증. 결과는 preview 전용이고 저장·publish하지 않는다. seed v1에서 patch 적용 후 version v2가 되어도 첫 저장의 server-owned version 규칙을 따른다
- UI: Guided card는 비동기 loading/error를 보여주고 server candidate를 기존 schema/graph/fake dry-run review에 넣는다. 실패 시 blank canvas/request를 보존하며 자동 local fallback을 하지 않는다. 승인 조건과 빈 캔버스 guard는 ARCH-1 규칙을 유지한다
- 경계: streaming, model picker, auth/workspace, 기존 graph 증분 UI, provider/browser 품질·비용·latency 실증은 포함하지 않는다
- 표면: API `POST /architect/patch` preview only. 빈 캔버스 Guided의 provider 호출 연결과 canonical seed는 ARCH-3 계약을 따른다

preset-select (많이 쓰는 값은 고르고, 특수한 값만 적는다 — model_ref 등 카탈로그 있는 ref 필드)
- 구조: 셀렉트(기존 .control 스펙 그대로) 옵션 = 카탈로그 프리셋(제목, 카탈로그의 LocalizedText 두 언어) + 마지막 '직접 적기…' 옵션. 프리셋을 고르면 그 값이 곧 저장값 — 추가 입력 없음
- '직접 적기…' 선택 시: 셀렉트 아래 var(--space-1) 간격으로 텍스트 입력(.control) 등장 + 자동 포커스, 등장 --dur-tap 내. 이 전환 자체는 값 변경이 아니다. 적는 대로 곧 값이다 — 이어진 글자들은 undo 한 걸음으로 합쳐진다
- 현재 값이 카탈로그에 없으면: 셀렉트는 '직접 적기…' 상태, 텍스트 입력이 열린 채 그 값을 보여준다 — 오래된 문서의 값을 잃지 않는다 (§9 조용한 무시 금지). 모드는 노드마다 제 것이다 — 다른 노드로 옮겨 가서 새 나오지 않는다
- 저장되는 것은 단일 필드 값 하나 — 고름/적음 모드는 화면의 상태일 뿐 저장·undo에 남지 않는다. **고름은 글자 병합과 다르다**: 프리셋 선택 1회 = undo 1단계, 연속으로 다른 프리셋을 골라도 선택마다 한 걸음이다
- 옵션에 빈 값을 두지 않는다(이 컨트롤은 required ref 필드용) — 현재 값이 비어 있을 때만 '(고르지 않음)'이 고를 수 없는 자리 표시로 보인다
- 직접 입력 상자도 필드의 것이다: 접근 이름은 필드 라벨('사용할 모델'), 설명(aria-describedby)도 셀렉트와 같은 것을 받는다 — '직접 적기…'는 전환 옵션의 이름이지 상자의 이름이 아니다
- 4상태: 셀렉트·텍스트 입력 모두 기존 .control 4상태 재사용 — 새 시각 발명 금지 (gate-card 승인 폼도 같은 컨트롤을 그대로 물려받는다 §7 gate-card)
- 문구: '직접 적기…'는 사전 경유(ko/en, 쉬운 말). 텍스트 입력 중 Esc는 입력의 것(§1 예외 그대로)

preset-fill (긴 글 필드를 프리셋으로 시작한다 — instruction 등 "골라 채우고 고쳐 쓰는" 필드)
- preset-select와 다르다: 셀렉트가 값이 아니라 **채우는 행동**이다. 저장되는 값은 언제나 textarea의 글 하나뿐이고, 셀렉트는 어떤 값도 들고 있지 않다
- 구조: textarea 위 var(--space-1) 간격에 셀렉트(.control 스펙 그대로, 새 시각 발명 금지). 쉬는 상태 표시 문구는 '이런 일을 시켜 보세요…'(사전 경유, 고를 수 없는 자리 표시 — preset-select의 '(고르지 않음)' 문법과 동일) + 옵션 = 카탈로그 프리셋 제목(LocalizedText 두 언어)
- 고르면: 프리셋 본문(현재 언어)이 textarea 값이 된다 — **고름 1회 = undo 1단계**(글자 병합과 다르다, preset-select 규칙과 동일). 셀렉트는 다시 쉬는 상태로 돌아간다(행동이지 값이 아니므로 선택이 남지 않는다)
- 초점 이동은 고름이 **결정**됐을 때의 것이다: 포인터로 고르면 즉시 textarea로 간다(고쳐 쓰라고 주는 글이다 — 한 번 더 클릭하게 두지 않는다). 키보드로 화살표를 훑는 동안에는 초점이 셀렉트에 남는다(훑는 것만으로 값이 바뀌는 환경에서 옵션 비교를 막지 않는다 — 채움 자체는 훑는 중에도 일어나고 undo가 지킨다). Enter로 결정하면 그때 textarea로 간다
- 이미 글이 있어도 고르면 바꿔 채운다 — 되묻지 않는다. undo 한 걸음이 이전 글을 그대로 되살리므로 실수가 무섭지 않다(§9 확인 대화상자보다 싼 되돌리기 우선). 같은 프리셋을 다시 골라 값이 그대로면 undo 걸음을 쌓지 않는다
- 셀렉트도 필드의 것이다: 접근 이름은 '<필드 라벨> 프리셋'(사전 경유 조합), 설명(aria-describedby)은 textarea와 같은 것을 받는다
- 4상태: 셀렉트·textarea 모두 기존 .control 4상태 재사용. 텍스트 입력 중 Esc는 입력의 것(§1 예외 그대로)
- 문구·프리셋 본문: 전부 사전·카탈로그 경유(ko/en 쉬운 말) — 화면에 본문을 하드코딩하지 않는다
- 빈 상자는 초대말(placeholder)을 보여 준다: 값의 예가 아니라 **무엇을 하면 되는지의 초대**("이 단계가 무엇을 하면 되는지 적어요 — 위에서 골라 시작해도 돼요"). 브라우저 기본 placeholder 표현(연한 잉크)을 쓰고, 글을 적기 시작하면 사라진다. 저장·검증 어디에도 실리지 않는다. 거짓말 금지 — 비웠을 때 일어나는 일을 단정하는 문구를 placeholder에 적지 않는다

binding-select (문서가 가진 연결 중에서 고른다 — config_schema가 `x-binding-ref`로 표시한 필드)
- preset-select 문법을 그대로 물려받는다(셀렉트 .control 스펙·'직접 적기…'·값 보존·고름 1회 = undo 1걸음·4상태). 새 시각 발명 금지 — 아래는 **다른 점만** 적는다
- 옵션 출처가 전역 카탈로그가 아니라 **지금 이 문서의 연결 목록**(spec.resources)이다. 옵션 이름 = 연결 id(사람이 문서에서 부르는 그 이름), 저장값 = 같은 id
- 문서에 연결이 하나도 없으면: 셀렉트 아래 var(--space-1) 간격에 --text-caption/var(--ink-soft) 한 줄 '이 문서에는 아직 연결이 없어요 — 왼쪽 연결 패널에서 만들 수 있어요'(사전 경유). 빈 목록을 말없이 던지지 않고, 만드는 길(§7 resources-panel)을 가리킨다
- 목록에 없는 값이 이미 저장돼 있으면 preset-select 규칙 그대로 '직접 적기…' 상태로 그 값을 보여준다. 값이 틀렸다는 판정은 이 컨트롤이 하지 않는다 — 필드 오류(§7 inspector)와 노드 뱃지가 이미 말한다(같은 말을 두 번 하지 않는다)

tool-select (고른 연결이 든 도구 중에서 고른다 — config_schema의 `x-tool-ports.tool_name_field`가 가리키는 필드)
- binding-select와 같은 문법. 다른 점: 옵션 출처가 **지금 이 노드가 고른 연결의 tools**다 — 연결을 바꾸면 도구 목록이 그 자리에서 따라 바뀐다
- 옵션 이름 = 도구 이름(저장값 그대로), 옵션의 title = 그 도구의 쉬운 설명(plain_description, 두 언어) — 용어를 설명 없이 두지 않는다
- 아직 연결을 **하나도 고르지 않았을 때만** 잠근다: 셀렉트와 '직접 적기…' 입력 상자 모두 disabled(.control의 기존 disabled 상태 그대로) + 이유 한 줄 '먼저 연결을 고르세요'. 비활성은 언제나 이유를 말한다
- 연결 이름이 적혀 있는데 문서에서 찾지 못하는 경우는 **잠그지 않는다** — 아직 안 고른 것과 다른 일이고, 그 이름이 틀렸다는 말은 필드 오류와 노드 뱃지가 이미 한다(같은 말을 세 번 하지 않는다). 도구 이름은 그대로 보이고 고칠 수 있다
- 연결을 바꿔 적혀 있던 도구 이름이 새 목록에 없어지면 preset-select 규칙 그대로 '직접 적기…' 상태로 그 값을 남긴다(조용히 지우지 않는다). 이때 **초점은 옮기지 않는다** — 사람이 고른 것은 옆 칸(연결)이지 이 칸이 아니다. 자동 초점은 '직접 적기…'를 사람이 직접 골랐을 때의 것이다
- 이유 한 줄의 자리: 그 칸의 마지막 요소 아래 var(--space-1)('직접 적기…'가 열려 있으면 입력 상자 아래). 이유는 aria-describedby로 칸에 매여 schema 설명과 함께 읽힌다
- 고른 연결에 도구가 하나도 없으면 같은 자리에 이유 한 줄 '이 연결에는 아직 도구가 없어요'
- 고른 결과는 그 자리에서 보인다: 노드 카드의 포트가 그 도구의 모양으로 다시 그려진다(§7 node-card). 그 때문에 값의 모양이 어긋나 끊기는 기존 연결은 편집 영향 알림(§9 — 설정 변경 notice) 그대로 사람에게 말한다. 조용히 지우지 않는다

palette (노드 팔레트 — 독의 노드 패널)
- 기존 동작의 성문화: registry의 노드 타입 목록(NodeTypeChip), 클릭 = 캔버스에 추가, 실행 중 잠금 + 이유
- 문서 도구 섹션(P2c): 노드 타입 목록 아래 구분 제목 '이 문서의 도구'(--text-label) + spec.resources의 도구마다 칩 하나 — [도구 이름] + title에 쉬운 설명(plain_description 두 언어). 클릭 = 도구 노드가 **그 연결·도구로 채워진 채** 추가된다(연결 고르기·도구 고르기 두 걸음을 건너뛴다). 추가 1회 = undo 1걸음(기존 addNode와 동일). 잠금 규칙 동일
- 연결이나 도구가 하나도 없으면 섹션 자체가 없다 — 빈 제목을 세우지 않는다(만드는 길은 resources-panel이 말한다)

resources-panel (문서의 연결과 도구를 보는 독 패널 — API_TOOLS P2b)
- dock / dock-panel 문법 그대로(glass, 독 옆 슬라이드, 한 번에 하나, Esc/재클릭 닫힘, 독 버튼 36px+tooltip). `DOCK_TOOLS` 표에 한 줄 — 새 표면 발명 금지
- 내용: 이 문서의 연결(spec.resources) 목록. 연결 한 줄 = 이름(id, --text-label) + 종류의 쉬운 말 캡션(--text-caption, ink-soft — 'http.api' 원문이 아니라 '웹 API 연결' 같은 쉬운 말, 원문은 title로) + 그 연결이 든 도구들(이름 + 쉬운 설명 plain_description 두 언어). 도구가 없는 연결은 '이 연결에는 아직 도구가 없어요'(tool-select와 같은 사전 키 재사용)
- 빈 상태: '이 문서에는 아직 연결이 없어요' 한 줄 + [새 연결 primary]. 빈 목록을 말없이 던지지 않는다(§9)
- [새 연결]은 tool-wrap-card(중앙 모달)를 연다. 실행을 보는 동안(잠금)은 비활성 + 이유 title(기존 잠금 규칙 그대로, 새 잠금 로직 금지)
- 연결 줄의 승인 정책 셀렉트(P3b): 연결 이름 아래 작은 셀렉트(.control select 문법 그대로, 값 둘) — '부를 때마다 물어본다'(ask_first) / '바로 부른다'(read_only_auto). 고름 1회 = undo 1걸음(P2c 연결 편집 Command 경로 재사용, 두 벌 상태 금지). 이 정책은 그 연결의 **모든 도구**에 걸린다는 뜻을 캡션 한 줄로(--text-caption, ink-soft). 실행 중 잠금은 다른 행동과 같은 규칙
- 연결 줄의 행동 2개(P2c): [다시 가져오기](button-ghost — tool-wrap-card를 그 연결의 재-import 모드로 연다) · [지우기](inspector-card 지우기 문법 그대로 — button-ghost 4상태 + 글자만 var(--danger-ink), 확인 대화 없음, title에 이유). 지우기 1회 = undo 1걸음, 캡션 '되돌리기로 언제든 살릴 수 있어요' 재사용. 어떤 노드가 그 연결을 쓰고 있어도 즉시 지운다 — 구조(노드·연결선)는 아무것도 빠지지 않고 노드 뱃지·필드 오류가 후속 상태를 말하므로, 빼기 확인 카드 대신 기존 편집 영향 알림(§9 설정 변경 notice)으로 어느 노드가 연결을 잃었는지 그 자리에서 말한다(조용히 끊지 않는다). 실행 중 잠금은 [새 연결]과 같은 규칙

tool-wrap-card (붙여 넣으면 도구가 된다 — API 문서/curl/산문 → 연결+도구 제안·승인, API_TOOLS P2b)
- 표면: open-dialog 문법 재사용(중앙 `.layer` 모달급, Esc 체인·초점 복귀 규칙 그대로) — 긴 붙여넣기와 도구 카드 미리보기에 공간이 필요한 집중 작업이다. glass + hairline + radius-card + shadow-float, 새 색·radius·motion token 금지
- 원칙은 guided-architect-card를 물려받는다: 한 시점에 하나만 묻는다(입력 상태 ↔ review 상태), **승인 전 spec 불변**, provider 실패를 성공으로 둔갑시키지 않는다
- 입력 상태: 제목('무엇을 연결할까요' --text-title) + 쉬운 설명 한 줄(--text-body — "쓰는 API 문서나 예시를 붙여 넣으면 도구로 바꿔 드려요") + 입력 종류 세그먼트 3종(API 문서 붙여넣기 / 요청 예시(curl) / 말로 설명) + textarea(.control 문법, placeholder는 초대말이지 값이 아님) + [도구로 바꾸기 primary][그만두기 ghost]. 빈 입력은 primary disabled + title로 이유
- 기다림·실패: 비동기 loading/error는 guided 카드 문법. 실패는 쉬운 말 + 다음 걸음으로 말하고, raw 모델 응답·서버 message 원문을 화면에 쓰지 않는다(§9). 실패해도 적은 입력은 보존된다
- review 상태: 연결 이름 한 줄 + 도구마다 카드 한 장 — [도구 이름 --text-label] [쉬운 설명 plain_description 두 언어 --text-body] ['무엇을 주면 → 무엇을 받는가' 한 줄 --text-caption: input/output schema의 필드 제목을 쉬운 말로 늘어놓는다, raw JSON 기본 노출 금지]. 비밀 이름(secret://)이 제안되면 이름만 보여 주고 캡션 한 줄로 '열쇠 값은 서버에 따로 둬요 — 여기엔 이름만 적혀요'
- 버튼 행: [문서에 넣기 primary][다시 적기 ghost]. 승인 1회 = undo 1걸음(architect 승인 규칙). 승인 즉시 모달이 닫히고 resources-panel 목록과 binding-select에 그 연결이 나타난다 — 결과가 그 자리에서 보인다
- 문구 전부 사전 경유(ko/en 쉬운 말), 4상태는 기존 .control·button 문법 재사용
- 재-import 모드(P2c): resources-panel의 [다시 가져오기]로 열리면 **대상 연결 하나가 고정**된 채 같은 입력 3종을 받는다(제목이 그 연결 이름을 말한다). review는 diff로 말한다 — [새 도구 / 바뀐 도구 / 빠지는 도구] 세 묶음, **빠지는 것을 침묵하지 않는다**(§9 — P2b에서 조용한 삭제가 blocker였던 바로 그 지점). 승인은 그 연결 하나만 갈아 끼우고(다른 연결·그래프 불변) 1 undo 걸음

run-input-card (실행에 넣을 값 — '실행해 보기'가 물을 것이 있을 때)
- 언제: 실행 버튼을 눌렀고 그래프의 입력 노드가 받는 값 이름(bindings)이 하나라도 있을 때. 물을 것이 없으면 카드 없이 바로 실행(지금과 동일 — 빈 카드를 띄우지 않는다)
- 위치: `.layer-top-right` 실행 버튼 아래 var(--space-2) 세로 스택. glass + 1px hairline + shadow-float + radius-card, 폭 var(--panel-inspector)
- 구조: 제목 1줄('무엇으로 실행해 볼까요' --text-title) + 필드 세로 스택(간격 var(--space-2)) + 버튼 행 [이 값으로 실행 primary][그만두기 ghost] — gate-card 승인 폼과 같은 필드 문법·같은 컨트롤 세트 재사용(새 시각 발명 금지)
- 필드 원천: 입력 노드(core.input)들의 bindings 값 이름 합집합. input_schema에 그 이름의 스키마가 있으면 그 제목(두 언어)·타입 컨트롤, 없으면 값 이름을 라벨로 한 글 입력. 필수(input_schema.required)는 gate-card 규칙 그대로(미입력이면 실행 버튼 disabled + title로 이유; 스키마가 없으면 모두 선택 입력)
- 값 기억: 같은 문서에서 다시 실행하면 직전에 넣은 값이 채워져 있다(다시 다 적게 하지 않는다). 다른 문서로 가면 남지 않는다. 저장·undo에는 실리지 않는다(실행의 재료이지 문서가 아니다)
- '이 값으로 실행'은 기존 실행 절차(저장 먼저)를 그대로 탄다 — 저장 실패면 실행하지 않고 같은 토스트. 카드가 열려 있는 동안 실행 버튼 재클릭은 카드 닫기(토글)
- '그만두기'는 실행하지 않고 카드만 닫는다(값은 남는다). Esc = 그만두기(§1 체인 ①′ — 필드에 초점이 있으면 그 필드의 초점만 먼저 거둔다, gate-card 규칙과 동일)
- 실행이 시작되면 카드는 닫힌다. 실행 중·저장 왕복 중에는 카드를 열지 않는다(실행 버튼 잠금 규칙 그대로)

timeline-dock / event-list / toast
- 하단 스택 문법(§1). 이벤트 목록: 쉬운 말 본문 + event_type 원문 caption, 현재 항목 강조
- **실행 실패 줄(run.failed)**: payload의 실패 갈래(reason)별로 쉬운 말 문구를 갈라 말하고, 이유로 끝내지 않고 **다음 걸음**을 말한다(connection-hint 문구 규칙과 같은 원칙 — 예: 열쇠가 없으면 누가 무엇을 하면 되는지). 서버가 보낸 message·reason 원문은 화면에 쓰지 않는다(원문 노출 금지 — caption의 event_type만 원문). 모르는 갈래는 기존 일반 문구로 말한다(조용히 숨기지 않는다)

compare-view (비교 화면 — 히스토리 카드 2개 선택 시)
- 위치: 캔버스 중앙 플로팅(공용 .layer + .compare-view) | glass + 1px hairline + shadow-float + radius-card
- 구조: 헤더[제목 --text-title + 닫기 ghost] + 2열(열 = 실행 요약 1줄 + 단계 목록) + 각 열 하단 [이쪽으로 계속 primary]
- 단계 목록: 노드 단위 한 줄(쉬운 말), 갈라지기 전 구간 var(--ink-soft), first divergence 항목은 양쪽 모두 warn 3층(-soft 바탕 + -ink 글자 + '⑂' 기호) + '여기부터 달라져요' 1줄, 이후 구간 var(--ink)
- 두 실행이 완전히 같으면: divergence 강조 대신 '두 실행이 똑같아요' 안내 1줄 (조용한 무시 금지)
- 한쪽이 먼저 끝났으면: 멈춘 그 단계를 양쪽 모두 divergence 강조하고, 멈춘 열에만 '여기서 끝났어요' 1줄(--text-caption, ink-soft). 둘 다 같은 자리에 멈췄으면 강조·안내 없음
- Esc: 비교 닫기(선택 해제) — §1 Esc 체인의 ④ (열린 독 패널 다음)
- 스크롤: 목록이 길면 열 내부 스크롤, 화면 밖으로 카드가 자라지 않는다

run-history 카드 비교 선택 (pill variant 확장)
- 선택 방법: 카드 안 '비교' 보조 컨트롤(ghost, --text-caption) — 카드 본체 클릭=재생 동작은 그대로 유지
- 비교 선택 상태: var(--ring-accent) + accent-soft 바탕, '비교 1/2' caption. 재클릭 시 해제
- 2개 선택 시 compare-view 자동 오픈, 3번째 선택은 가장 오래된 선택을 교체
- 채택된 실행 카드: '✓ 채택' success 3층 뱃지 (상시, hover 뒤 숨김 금지)
- **실패로 끝난 실행 카드**: '✕ 실패' danger 3층 뱃지(상시, hover 뒤 숨김 금지 — §9 문제 상시 노출). 종결 상태는 그 실행의 이벤트에서 파생한다(따로 저장하지 않는다)

optimize-card (고치기 — Optimize 모드의 화면, OPT-1)
- 진입: ModeSegment의 네 번째 항목(쉬운 말 '고치기'). 모드여도 캔버스는 배경에 그대로 — 중앙 모달 금지, 자리는 `.layer-right` 세로 스택(eval-panel과 같은 문법·폭 var(--panel-inspector)). **빈 캔버스에서는 뜨지 않는다** — 고칠 그래프가 있어야 한다(문서 없으면 모드 버튼 disabled + title '먼저 만들거나 열어야 고칠 수 있어요')
- guided-architect-card의 3상태 흐름(입력→review→승인)을 물려받는다. 다른 점만 적는다
- 입력 상태: 제목 '무엇을 고칠까요'(--text-title) + 쉬운 설명 한 줄(--text-body — "지금 그래프에서 개선하고 싶은 것을 적으면, 바꿔 볼 후보를 지어 드려요") + objective textarea(.control, placeholder는 초대말 예: "비용을 줄이고 싶어요 / 이 케이스들을 더 맞히고 싶어요") + [후보 지어 줘 primary][그만두기 ghost]. 빈 입력은 primary disabled + title
- 시험 결과가 없을 때: objective 입력 위 한 줄(--text-caption, ink-soft) '아직 시험 결과가 없어 추측으로 제안해요 — 시험을 먼저 돌리면 더 나은 근거로 고쳐요'(사전 경유). 없는 근거를 지어내지 않는다(§9 정직)
- 기다림·실패: 비동기 loading/error는 guided 카드 문법. raw 모델 응답·서버 message 원문 미노출(§9). 실패해도 적은 objective 보존
- review 상태(제안문이 핵심 — 왜 이렇게 바꾸자는지가 후보 검사보다 먼저 읽혀야 한다):
  - **제안문 묶음**(맨 위): 가설 한 줄(hypothesis, --text-body '왜 지금이 약한가·무엇을 바꾸나') + 대상 노드(target_nodes — 그 노드 이름을 칩으로, 어디를 건드리는지) + 기대 효과(expected_effect, --text-body 서술). **수치를 지어내지 않는다** — 비용·지연 숫자는 텔레메트리(OPT-3) 전까지 없고, 있는 것은 서술뿐(vision '증거 없는 정밀도 금지')
  - **근거 줄**(evidence): 어느 시험이 근거인가(배치·못 맞힌 케이스 요약, --text-caption). 시험 없이 지은 후보면 '시험 없이 추측으로 지었어요'
  - **후보 검사 3종**(guided review 그대로): ✓ 계약 확인 / ✓ 흐름 확인 / ✓ 가짜 실행 + [후보 노드 N개·연결 M개] summary
  - 버튼 행: [이 후보로 바꾸기 primary][다시 적기 ghost]. 승인=보통의 revision(architect 승인 경로 그대로), 1 undo 걸음. 승인 즉시 캔버스가 그 후보로 바뀐다 — 결과가 그 자리에서 보인다. **승인 전에는 그래프·시험·실행 무엇도 바뀌지 않는다**(제안문은 실행물이 아니다)
- 문구 전부 사전 경유(ko/en 쉬운 말), 4상태는 기존 .control·button 재사용. 실행/저장 왕복 중 잠금은 기존 규칙

eval-panel (시험해 보기 — Evaluate 모드의 화면)
- 진입: ModeSegment의 새 항목(쉬운 말 '시험'). 모드여도 캔버스는 배경에 그대로 — 중앙 모달 금지, 자리는 `.layer-right` 세로 스택(inspector 문법·폭 var(--panel-inspector))
- 구조: 헤더[제목 '시험해 보기' --text-title] + 요약 pill 1개 + '전부 실행해 보기' primary + 케이스 카드 세로 스택(간격 var(--space-2)). 실행 중에는 primary disabled + title '지금 돌려 보는 중이에요'
- 케이스가 다루는 대상은 지금 보는 문서다 — 문서가 저장 안 됐으면 실행 primary disabled + title '먼저 저장해야 돌려 볼 수 있어요' (기존 실행 절차의 저장 우선 규칙 그대로)
- 심판 체크 한 줄(EVAL-5 — '전부 실행해 보기' primary 바로 아래 인라인, 새 레이어·설정 화면 금지): 한 줄 안에 나란히 — 체크 1개 + 라벨 '심판 모델까지 쓰기'(--text-label) + 그 옆에 비용 '모델 호출 비용이 들어요'(--text-caption, ink-soft). **기본은 꺼짐** — 값이 드는 일은 사람이 켤 때만 일어난다. 비용 문구는 hover·title 뒤에 숨기지 않는다(누르기 전에 읽힌다). 판정기 원명(llm_judge)·모델 이름·가격은 쓰지 않는다
- 이 체크는 이번 실행의 선택이고 시험 묶음(dataset)에 저장되지 않는다 — 다음에 열면 다시 꺼진 채다(저장한 적 없는 것을 저장했다고 보이게 하지 않는다). 돌리는 중에는 disabled + title '지금 돌려 보는 중이에요'(실행 primary와 같은 까닭·같은 말)
- **심판을 부를 수 없는 서버에서는 이 체크가 disabled + title '심판이 쓸 모델을 이 서버에서 부를 수 없어요'**(EVAL_HONESTY — 비활성은 이유를 말한다, §9). 부를 수 없는 층을 켤 수 있게 두면 화면은 '심판이 보고 판정했다'는 거짓을 예고하는 셈이다. 판정기 원명(llm_judge)·모델 이름·열쇠 이름은 쓰지 않는다. 서버가 무엇을 세웠는지 **알아내지 못했으면 막지 않는다**(조용한 fail-open — 모르는 것을 없다고 말하지 않고 기능도 막지 않는다). 돌리는 중과 겹치면 실행 중이라는 말이 먼저다(지금 당장 바꿀 수 없는 까닭이 먼저 읽힌다)
- 이 체크의 **켜짐 표시와 실행이 실어 보내는 값은 같은 판정 하나**에서 나온다: 아직 모르는 사이에 켜 두었더라도 뒤늦게 '심판은 설 수 없다'가 닿으면 체크는 꺼진 것으로 보이고 실행도 심판을 청하지 않는다. 켜진 채로 잠긴 체크(보기에는 켬, 실제로는 안 딛음)를 만들지 않는다 — 화면과 실제가 같아야 한다
- **이 서버에 뜻 검사가 없다는 사실 한 줄은 고급 보기(eval-expert-toggle)에서만** 말한다: '이 서버에는 뜻 검사가 설치되지 않아 글자 검사만 해요'(--text-caption, ink-soft — 알림 상자가 아니라 관찰 한 줄, tone 없음). 기본 화면은 조용하다(설치 여부는 만드는 사람의 사정이지 시험을 적는 사람의 걱정이 아니다). 서버가 말해 주지 않았으면 이 줄도 없다(모르는 것을 없다고 말하지 않는다). 판정기 원명(nli_entailment)·설치 명령·서버 로그 원문은 화면에 쓰지 않는다
- 빈 상태(케이스 0): 카드 스택 자리에 초대 1줄 + '첫 시험 만들기' ghost — "무엇을 넣으면 무슨 말이 나와야 하는지 하나 적어 봐요" (first-steps-card 초대 문법: 첫 케이스가 생기면 스스로 사라진다, 튜토리얼 상태 머신 금지)
- 케이스가 있을 때의 추가 진입: 카드 스택 맨 아래 '새 시험 만들기' ghost(빈 상태의 버튼과 같은 문법·같은 사전 계열 — 한 행동을 두 이름으로 부르지 않는다)
- 목록이 길거나 우측 스택이 붐비면 패널 내부 스크롤(compare-view 스크롤 규칙과 같은 정신 — 화면 밖으로 자라지 않고, 잘림은 잘린 채가 아니라 스크롤로 보인다). 이웃 카드(inspector·이벤트 목록)에 눌려 카드 한 장도 온전히 못 보이는 높이로 접히지 않는다
- 전문가 확장(Advanced 토글·회차 상세·비교)은 §10 gap — v1은 기본 뷰만

eval-summary-pill (pill variant 확장 — 결론이 숫자보다 먼저)
- 문법: pill 그대로. 내용 = [기호] [쉬운 말 결론] — '10개 중 8개 통과했어요'
- 3중 표기(§9): 전부 통과 ✓ success 3층 / 일부 실패 ✕ danger 3층('N개가 아직 못 갔어요' — 실패는 상시 노출) / 돌리는 중 회전 없는 '…' + var(--running-ink) '확인하는 중이에요' (개수 없이 — 서버가 부분 진행을 말하지 않는 동안 거짓 정밀도 금지, 부분 진행이 생기면 그때 (M/N)) / 아직 안 돌림 ink-soft '아직 돌려 보지 않았어요'
- 점수·백분율·지표 원명을 pill에 쓰지 않는다 — 숫자 상세는 케이스 카드와 확장(§10)의 것

eval-prompt-card (지금 시험받는 지시문 — EVAL-1, 읽기 전용 투영)
- 언제: 그래프에 지시문(instruction)을 갖는 노드가 하나라도 있을 때만. 하나도 없으면 구역 자체를 그리지 않는다(빈 상자·'없어요' 상자 금지 — 시험은 여전히 그래프 전체 단위다)
- 위치: eval-panel 안, 시험 묶음 줄 아래·요약 pill 위. 케이스 결과(✕·마지막 답)와 같은 화면에서 함께 읽히도록 패널 위쪽에 둔다. 모달·새 레이어·별도 패널 금지
- 구역 머리: 라벨 1줄 '지금 시험하는 지시문'(--text-label, ink-soft). 카드는 세로 스택(간격 var(--space-2))
- 카드 한 장 = 지시문을 가진 노드 하나: [노드 이름 --text-label] [노드 id --text-caption mono ink-soft] + 지시문 본문(--text-caption, 읽기 전용, 길면 블록 내부 스크롤 — 패널을 늘리지 않는다). 노드 이름은 node-list와 같은 원천(registry display_name, 없으면 type)이다 — 한 노드를 두 화면이 다르게 부르지 않는다
- 대상 고르기는 registry가 정한다: config_schema에 `instruction`이 있는 노드 타입. 화면이 노드 타입 이름으로 분기하지 않는다(새 타입이 생겨도 화면을 고치지 않는다)
- 지시문이 비어 있으면 '아직 지시문이 없어요 — 눌러서 적어요' 1줄(ink-soft). 조용한 빈 칸 금지
- 카드는 누를 수 있다 = 그 노드를 고른다(기존 노드 선택). 고치는 곳은 인스펙터 하나뿐이다 — 이 카드는 원본을 베끼지 않는 투영이라 여기서 편집하지 않는다. title로 '눌러서 이 지시문을 고쳐요'
- 4상태: hover `--surface-hover` / active `--surface-active` / focus-visible `--ring-focus` / disabled 없음(언제나 고를 수 있다)
- 그래프에서 지시문을 고치면 카드가 그 자리에서 따라 바뀐다(사본 없음 — 원본은 노드 config 하나뿐)

eval-case-card (시험 한 줄 — node-card 문법 준용)
- Surface·Border·Radius·Shadow: node-card 기본과 동일 토큰
- 구조(상시 한 줄): [상태 기호] [케이스 제목 --text-title] [보조 caption] — 통과 ✓ success-ink / 실패 ✕ danger-ink + '몇 번 중 몇 번 됐는지'(예: '3번 중 1번만 통과') / 돌리는 중 rail 3px var(--running) + pulse / 아직 기호 없음 ink-soft
- 실패 이유는 이유로 끝내지 않는다: caption에 다음 걸음 — '기대한 말이 답에 없었어요 — 카드를 눌러 무엇이 나왔는지 봐요'
- selected: ring var(--ring-accent) + 편집 폼과 **결과 한 토막**이 이 카드 아래 같은 카드 안에서 펼쳐진다(inspector-card 필드 문법 재사용, 새 레이어·모달 금지 — 노드 부속 카드 규칙 §4와 같은 정신)
- 결과 한 토막(돌린 적 있는 케이스만): 라벨 '실제로 나온 답'(--text-label) + 마지막 회차 output_text 원문(--text-caption, 읽기 전용, 길면 블록 내부 스크롤). 실패 캡션("눌러 무엇이 나왔는지 봐요")이 이 토막으로 지켜진다 — 회차별 전체(N회 각각)는 §10 EVAL-4. 답이 빈 문자열이면 '답이 없었어요' 1줄(조용한 빈 칸 금지)
- 결과 토막이 말하는 회차: 실패한 회차가 있으면 **가장 최근 실패한 회차**, 없으면 마지막 회차다. 집계로 실패한 케이스(예: 2번 중 1번만 통과)에서 마지막(통과한) 회차를 보여 주면 실패의 까닭이 화면에서 사라진다. 여러 번 돌린 케이스는 라벨 옆에 '{N}번째 돌림의 답'(--text-caption)으로 어느 회차인지 말한다
- 빠진 말 토막(실패한 케이스를 펼쳤을 때만 — EVAL-1, 원천은 EVAL-3에서 서버로 옮겼다): 라벨 '답에 없던 말'(--text-label) + **바로 위 결과 토막이 보여 주는 그 회차의 `missing_phrases`**를 그대로 danger-ink 칩 목록으로. 판정한 쪽(서버)이 근거도 적는다 — 화면은 판정 규칙(NFC·대소문자 무시·연속 공백 1칸)을 다시 구현하지 않는다. 규칙을 두 곳에 적으면 '실패인데 빠진 말이 없다'는 모순 화면이 나온다. 답 A를 보여 주며 답 B의 빠진 말을 붙이지 않는다. ✕만 보여 주고 침묵하지 않는다 — 실패의 까닭이 위의 지시문 카드와 같은 화면에서 읽힌다. 서버가 근거를 싣지 않은 옛 배치(근거가 빈 목록)인데 실패했다면 그것도 말하되 **지금 화면에 있는 손잡이**를 가리킨다: '어느 말이 빠졌는지 찾지 못했어요 — 자세히 보기를 켜면 회차마다 무엇이 나왔는지 볼 수 있어요'(없는 곳을 가리키지 않는다)
- 뜻으로 구제된 통과 한 줄(EVAL-4 — 결과 토막이 보여 주는 **그 회차**가 통과했고, 서버가 그 회차를 0층 위의 층으로 판정했을 때만: `judged_by`가 그 층의 이름일 때). 문구는 **판정한 층마다 다르다**(무엇이 통과시켰는지가 다르므로): 뜻 검사(`nli_entailment`)면 '글자는 달랐지만 뜻이 같아 통과했어요', 심판 모델(`llm_judge`, EVAL-5)이면 '심판 모델이 뜻을 보고 통과로 판정했어요'. 둘 다 --text-caption, ink-soft — 이미 ✓로 말한 통과를 성공 색으로 다시 외치지 않는다. 문구는 층 이름 → 문장 표 하나에서 고른다(화면이 층 이름으로 분기하지 않는다 — 층이 늘면 표에 한 줄이 는다). 판정기 원명(nli_entailment·llm_judge)·모델 이름·확신도·점수·백분율은 화면에 쓰지 않는다(서버가 주지 않는 정밀도를 화면이 지어내지 않는다). 판정한 이름을 서버가 싣지 않은 옛 배치, 그리고 화면이 모르는 이름으로 판정된 회차에는 이 줄이 없다 — 없는 사실을 추측해 붙이지 않고, 나머지 렌더는 그대로다. 실패한 회차에는 그리지 않는다(구제되지 못한 회차의 까닭은 빠진 말 토막이 말한다)
- 주의 신호 한 줄(통과한 케이스를 펼쳤을 때만 — EVAL-3, 무료 안정성 층): 회차 답이 서로 갈렸으면 관찰 한 줄 '3번 중 답이 2가지로 갈렸어요'(--text-caption, ink-soft — danger 아님). **판정이 아니다**: 통과/실패를 바꾸지 않고 기호(✓)도 캡션도 건드리지 않는다. 1번만 돌렸거나 회차 답이 모두 같으면 아무 말도 하지 않는다(없는 경고를 만들지 않는다). 실패한 케이스에는 그리지 않는다 — 실패의 까닭(빠진 말)이 먼저이고, 주의를 겹쳐 놓으면 무엇부터 볼지 흐려진다
- 지우기: 펼친 상세 맨 아래 '이 시험 지우기'(ghost + danger-ink 글자, 확인 대화 없음 — inspector-card와 같은 정신). 단 시험은 문서 undo 스택(Cmd+Z) 밖의 저장물이므로 캡션 대신 **인라인 되돌리기**: 지우면 카드 자리에 한 줄 '지웠어요 — 되돌리기' (되돌리기는 ghost 액션, 마지막 1건을 원래 자리에 복원). 새 지우기가 오면 갈아탄다(항상 하나). 되돌릴 수 없는 문구를 쓰지 않는다 — 말과 실제가 같아야 한다

eval-case-form (펼친 케이스의 편집 필드 — 전부 기존 .control 재사용, 새 시각 발명 금지)
- 필드 순서: 제목 → 넣을 값 → 들어있어야 하는 말 → 몇 번 돌려볼까 → 그중 몇 번 통과해야 할까
- '넣을 값': run-input-card와 같은 원천(입력 노드 bindings·input_schema) — 같은 값 이름에는 같은 라벨(한 값을 두 화면이 다르게 부르지 않는다)
- '들어있어야 하는 말': 여러 개면 줄마다 하나(textarea, 초대말 "답에 꼭 들어있어야 하는 말을 줄마다 하나씩 적어요"). 지표 원명(expected_phrases)은 화면에 쓰지 않는다 — 카탈로그 plain_description이 라벨·설명의 원천
- 횟수 두 필드: 숫자 입력(.control), 라벨 쉬운 말('몇 번 돌려볼까요' / '몇 번 통과해야 합격일까요'). 통과 수 > 횟수는 그릴 때 막는다(§9 — 프론트 판정은 계약 검증과 같아야 한다) + 이유 한 줄
- 편집은 곧 저장값(문서 편집과 같은 undo 문법) — 시험 묶음은 문서가 아니라 별도 저장이므로, 저장 상태 캡션 1줄(doc-card 문구 재사용: '저장하는 중이에요/저장했어요/저장 안 된 변경이 있어요')을 폼 하단에 둔다

eval-suggest-card (AI가 지어 준 시험 제안 — EVAL-2, 담기 전에는 저장이 아니다)
- 위치: eval-panel 케이스 스택 아래, '새 시험 만들기' ghost 다음의 인라인 구역. 모달·새 레이어·별도 패널 금지 — 지어 준 것을 지시문 카드(eval-prompt-card)와 같은 화면에서 읽는다
- 청하는 줄: 라벨 '시험을 지어 드릴까요'(--text-label, ink-soft) + 개수 숫자 입력(.control, 1..20) + '까다로운 경우도 섞기' 체크(기본 켬) + '지어 줘' primary(eval-panel__run과 같은 토큰)
- 개수는 그릴 때 막는다(§9): 범위 밖이면 primary disabled + title과 인라인 한 줄로 '한 번에 1개부터 20개까지 지어 드릴 수 있어요' — 요청을 보내 놓고 서버가 물리게 하지 않는다
- 게이트는 지시문 자리의 **있음**이 아니라 **적힌 내용**을 본다: 공백 아닌 지시문이 하나도 없으면(자리조차 없는 그래프 포함) primary disabled + title '지시문이 있어야 지어 줄 수 있어요 — 단계에 무엇을 하라고 적어 주세요'(조용한 무시 금지). 공백 한 칸은 적은 것이 아니다 — 실행기의 지시문 판정과 같은 규칙이고, 판정은 순수 함수 한 곳(writtenInstructions)에 있다. 지어 준 모델이 읽는 본문에도 빈 지시문은 실리지 않는다
- 대상 고르기는 eval-prompt-card와 같은 registry 규칙(config_schema에 `instruction`)이고, 화면이 노드 타입 이름으로 분기하지 않는다. 빈 지시문을 카드로 보여 주는 일은 eval-prompt-card의 몫이며 이 게이트와 서로 모순되지 않는다(카드는 '아직 적지 않았어요'라고 말하고, 게이트는 그래서 막는다)
- 지어 보는 동안: primary disabled + '지어 보는 중이에요' 한 줄(회전 없는 상태 표기 — 개수 없이, 서버가 부분 진행을 말하지 않는 동안 거짓 정밀도 금지)
- 결과 머리: '{N}개 중 {M}개를 지었어요 — 담을 것만 골라요'(--text-caption, ink-soft). 청한 수보다 적게 왔어도 사실대로 말하고 빈 자리를 지어내지 않는다
- 카드 한 장 = 제안 하나: [제목 --text-label] + 한 줄 요약 '넣을 값: {넣을 값} → 있어야 할 말: {들어있어야 하는 말}'(--text-caption, ink-soft). 넣을 값이 없으면 '넣을 값 없음 →'으로 말한다(조사가 값에 따라 어긋나지 않게 라벨로 잇는다) — 처음 본 사람이 3초 안에 무엇을 시험하는지 읽지 못하면 이 카드는 실패다
- 표면: eval-case-card와 같은 토큰(--surface / --hairline / --radius-card / --shadow-card). 고른 카드는 `aria-pressed`와 var(--ring-accent) + var(--accent-soft) 바탕으로 말한다(색만으로 말하지 않는다). 4상태: hover --surface-hover / active --surface-active / focus-visible --ring-focus / disabled 없음(언제나 고를 수 있다)
- 담기: '고른 것 담기' primary — 하나도 고르지 않았으면 disabled + title '담을 시험을 먼저 골라 주세요'. 이 손잡이를 누른 뒤에야 묶음에 들어가고 저장된다(케이스를 손으로 저장할 때와 같은 길이며, 이름은 담는 그 순간 붙는다). 고르지 않은 나머지는 그 자리에서 버려진다
- '지은 것 버리기' ghost는 지어 온 것과 고른 것을 함께 놓는다. 패널을 떠나거나 문서를 놓아도 같은 자리로 돌아간다 — 담지 않은 제안은 어디에도 남지 않는다
- 지어 오지 못했을 때는 패널 알림 한 줄(eval-panel notice, tone=danger)로 쉬운 말로 말한다. 서버 원문·JSON 봉투·모델 이름은 화면에 쓰지 않는다
- 담은 뒤에는 보통 케이스와 같다 — 펼쳐 고치고, 지우고, 돌린다. 이미 있는 시험과 제목이 같아도 막지 않는다

eval-expert-toggle (시험 상세 보기 전환 — EVAL-4A)
- 위치: eval-panel 헤더의 제목 옆. 패널을 다른 표면으로 옮기지 않는다
- 기본: 쉬운 말 중심의 현재 카드·pill 화면. 전환 버튼은 '자세히 보기'처럼 행동을 말하고, `aria-pressed`로 현재 상태를 알린다
- 전문가 상태: 같은 dataset·batch를 기술적인 투영으로 확장한다 — 새 실행·새 판정·별도 저장 상태를 만들지 않는다
- 4상태: hover `--surface-hover` / active `--accent-soft` / focus-visible `--ring-focus` / disabled `--ink-soft` + title로 까닭. 버튼 글자와 aria-label은 i18n 사전 경유
- 기본/전문가 전환은 패널 안에서만 일어나며, 문서·모드·폴링을 초기화하지 않는다

eval-attempt-list (전문가 회차 상세 — 선택한 eval-case-card 안)
- 위치: 선택한 카드의 결과 토막과 편집 폼 사이에 인라인으로 펼친다. 모달·새 레이어·중첩 카드 금지
- 각 줄: [회차 N] [✓/✕ + 통과/실패] [실제로 나온 답] — output_text 원문은 읽기 전용이며 빈 문자열은 '답이 없었어요'로 말한다
- 기술 정보: evaluator 이름·버전과 run id는 전문가 보기에서만 mono caption으로 보조 노출한다. 이름·버전은 **그 회차를 판정한 층**의 것이다(EVAL-4 — `judged_by`가 있으면 그 이름). 버전은 그 층이 케이스가 실은 층과 같으면 배치가 적어 둔 판(그때 실제로 돈 판이 권위다), 윗층이 판정한 회차만 그 층의 판을 판정기 카탈로그에서 가져온다. 뜻으로 구제됐다고 말해 놓고 바로 아래에서 0층 이름을 적으면 한 화면이 두 가지를 주장하게 된다. 판정한 이름을 싣지 않은 옛 배치만 케이스가 실은 이름·버전을 그대로 쓴다. 서버 원문 오류·JSON 봉투·없는 점수는 만들지 않는다
- 결과 상태는 색+기호+쉬운 말 3층. 목록이 길면 목록 블록만 스크롤하고 선택 카드·패널 전체의 높이를 무한히 늘리지 않는다

eval-batch-history (지난 시험 실행 목록 — 전문가 보기)
- 위치: eval-panel 케이스 스택 아래의 인라인 목록. 기존 eval-case-card와 같은 표면 문법을 복제하지 않고 얇은 행으로 둔다
- 각 행: 시작 시각 + 'N개 중 M개 통과했어요' + 선택 상태. 목록 응답의 `has_more`가 true일 때만 마지막에 더 있음 안내를 그린다 — 개수로 추측하지 않는다
- 행을 고르면 해당 batch의 상세를 다시 읽어 현재 전문가 결과로 보여 준다. 현재 batch와 dataset/spec 정체가 맞지 않으면 선택하지 않고 쉬운 말 오류를 손이 있는 자리에서 말한다
- 로딩·오프라인·빈 목록·더 있음은 각각 조용한 빈칸이 아닌 한 줄 안내로 말한다. API가 주지 않은 진행률·점수·모델 비교는 화면에 쓰지 않는다

eval-batch-compare (두 시험 결과 비교 — EVAL-4B-1)
- 선택: 배치 이력 행의 보조 '비교' 손잡이. 행 본체 클릭은 기존처럼 현재 상세를 여는 일이고, 비교 손잡이는 최대 두 batch를 고른다. 셋째를 고르면 가장 오래 고른 것이 물러난다
- 위치: 두 batch가 선택되면 기존 `compare-view`의 중앙 2열·닫기·내부 스크롤 문법을 공유하는 별도 `EvalCompareView`를 캔버스 위에 연다. 실행용 `CompareView`의 이벤트 단계·그래프 채택 계약은 재사용하지 않는다
- 각 열: 시작 시각과 'N개 중 M개 통과했어요' 요약 + 현재 dataset 케이스 순서의 결과 행. 한 행은 케이스 쉬운 제목, 통과/실패 기호와 말, 마지막 output_text를 보여 준다. batch에 결과가 없으면 '결과가 없어요'로 말한다
- 비교 판정: `passed`와 회차별 `passed`·`output_text`만 비교하고 `id`·`run_id`·시각·evaluator version은 판정에서 제외한다. 첫 번째로 다른 케이스 양쪽에 '여기부터 달라져요'를 붙인다. 끝까지 같으면 '두 시험이 똑같아요' 한 줄을 말한다
- 비교 화면에는 점수·백분율·모델 비교·실행 채택 버튼을 만들지 않는다. 실패 실행 승격은 별도 EVAL-4B 후속 계약이다
- 로딩·실패·선택된 batch 누락은 비교 화면 안에서 쉬운 말로 말하고, 닫기는 선택을 모두 놓는다. 현재 batch 상세와 비교용 batch는 별도 상태로 보존한다

eval-failed-run-promotion (실패 실행에서 시험 초안 만들기 — EVAL-4B-2)
- 대상: 실행 이벤트의 마지막 결말이 `run.failed`인 실행만 대상이다. `run.completed`는 사람이 거절해 그 자리에서 끝난 경우도 포함하므로 실패 승격 버튼을 만들지 않는다
- 위치: 하단 실행 히스토리에서 실패 뱃지와 나란히 보조 손잡이 '시험으로 남기기'를 둔다. 실행 다시 보기 본체·비교 손잡이와 행동을 섞지 않으며, 버튼 안에 버튼을 넣지 않는다
- 입력: `run.started` 이벤트의 `payload.input`을 JSON 값으로 복사해 새 EvalCase 초안의 `input`에 채운다. 입력이 기록되지 않은 옛 실행은 빈 입력으로 열고, 입력·실패 원문·run id를 화면에 추측하거나 노출하지 않는다
- 전환: 현재 실행 재생과 비교 선택을 닫고 Evaluate 패널을 연 뒤, 저장되지 않은 새 케이스 초안을 연다. 제목은 '실패한 실행에서 시작'으로 미리 채우고 기대 문구는 비워 둔다 — EvalCase의 필수 `expected_phrases`를 지어내거나 자동 저장하지 않는다
- 안전: 현재 문서의 실행 기록만 승격할 수 있고, 기존 케이스 편집 초안이 있으면 손실시키지 않도록 손잡이를 비활성화한다. 데이터셋 GET이 늦게 돌아와도 초안 입력을 덮어쓰지 않는다
- 범위: 새 API·계약·EvalBatch 변경은 없다. 사용자가 제목과 기대 문구를 채워 기존 `saveCaseDraft` 경로로 저장하며, 그 뒤의 POST/PUT·undo 의미는 기존 케이스 저장 계약을 그대로 따른다
- 상태: 승격 완료 뱃지는 만들지 않는다. 저장 전에는 새 초안, 저장 후에는 기존 케이스 카드가 사실을 말한다. 서버/provider가 실제로 보낸 입력 이벤트는 별도 브라우저·실서버 검증 대상이다

eval-dataset-sharing (여러 문서가 시험 묶음을 함께 쓰는 화면 — EVAL-4B-3)
- 대상: 서버의 독립 dataset 목록(`/eval/datasets`)에서 현재 문서가 사용할 시험 묶음을 고른다. 현재 dataset id는 batch 시작·이력 조회·케이스 저장에 그대로 쓴다 — 화면만 공유인 척 복사본을 만들지 않는다
- 위치: `eval-panel` 제목 아래에 현재 시험 묶음 이름·연결 상태·`시험 묶음 고르기` 보조 손잡이를 둔다. 선택 목록은 패널 안 인라인으로 열고 모달·중앙 레이어를 만들지 않는다
- 목록 한 줄: 쉬운 dataset 이름 + `N개 시험`, 현재 선택은 `aria-pressed`와 accent ring으로 말한다. 내부 id·권한·서버 원문은 화면에 노출하지 않는다. 로딩·오프라인·빈 목록은 각각 한 줄 안내를 둔다
- 연결: 기존 케이스 초안이 열렸거나 dataset 저장이 오가는 동안에는 목록 손잡이를 비활성화하고 title로 `먼저 시험 초안을 저장하거나 닫아 주세요`를 말한다. 선택은 상세 GET 성공 뒤에만 적용하며, 기존 dataset·배치 이력·비교 요청은 초기화하고 늦은 응답은 버린다
- 기억: 서버에 문서↔dataset 연결 필드가 아직 없으므로 `spec.id`별 선택 id만 브라우저 저장소에 기억한다. 같은 브라우저의 여러 문서가 같은 dataset id를 선택하면 실제로 같은 서버 dataset을 보고 고친다. 저장소가 비어 있거나 읽히지 않으면 문서 id에서 파생한 기본 dataset으로 돌아간다
- 기본 복귀: `이 문서의 시험으로 돌아가기`는 연결 기억을 지우고 `ds-<spec_id>` 기본 dataset을 다시 읽는다. 공유 dataset을 삭제·복제하지 않으며, 연결 해제는 데이터 삭제가 아니다
- 이름: 서버에 저장된 현재 dataset만 인라인 이름 변경을 열 수 있다. 빈 이름은 그릴 때 막고, 성공한 PUT 응답만 dataset·목록 이름에 반영한다. 현재 케이스 내용과 batch 결과는 이름 변경 때문에 새로 만들지 않는다
- 안전: dataset 전환은 현재 문서 id와 요청 순번을 함께 확인한다. 현재 문서가 바뀌거나 패널이 닫히면 응답을 버리고, 전환 직후의 dataset GET이 기존 케이스 초안을 초기화하지 않는다
- 범위: 기존 GET 목록·GET 상세·PUT dataset API만 사용한다. 계정·권한·초대 링크·workspace 영속 연결·삭제·복제·다른 브라우저 동기화는 후속이며 이 화면이 지원한다고 말하지 않는다
```

## 8. Motion (모션은 데이터의 사실 — 장식 금지)

| 토큰/값 | 용도 |
|---|---|
| `--ease-spring` cubic-bezier(0.2,0.8,0.2,1) | 기본 전환 |
| `--dur-tap` 100ms | 즉각 피드백 (모든 행동 100ms 내 반응) |
| `--dur-enter` 240 / `--dur-exit` 160 | 등장/퇴장 |
| 생성 팝인 scale .96→1, 엣지 드로우인 1회 | 만들어졌다는 사실 |
| `--dur-pipe` 800ms ÷ 재생 속도 | 물방울 관 통과 |
| pulse 1600ms | running에만 |
| `--dur-hint` | 스스로 사라지는 안내(§7 connection-hint)가 머무는 시간 — **reduced-motion에서도 줄이지 않는다**(읽을 시간이지 모션이 아니다) |

- reduced-motion: 시간 토큰 일괄 축소 + 반복 애니메이션 정지 (정보는 상태 표기로 동일 전달).
- transform/opacity/scale만 애니메이션. layout 속성 금지.

## 9. Do / Don't

- **Do** 브랜드 cyan은 크롬(버튼·선택·포커스·모드)에만 / **Don't** 캔버스 위 노드·관 상태에 cyan 사용 금지 — 상태색과 혼동된다
- **Do** 상태는 색+기호+쉬운 말 3중 표기 / **Don't** 색만으로 상태 전달 금지 (색맹 안전)
- **Do** 문제(미설정·오류)는 상시 노출 / **Don't** hover 뒤에 숨기기 금지 (WCAG 1.4.13, "모르고 넘어감" 방지)
- **Do** 비활성 요소는 title로 이유를 말한다 / **Don't** 조용한 무시 금지
- **Do** 안 되는 이유는 **손이 있는 자리에서** 말한다(§7 connection-hint) / **Don't** 사용자가 실패한 곳과 먼 자리에서 말하지 않는다
- **Do** 그릴 때 막을 것은 그릴 때 막는다 / **Don't** 저장·실행까지 미뤄 두었다가 거절하지 않는다 — 프론트 판정은 서버 판정과 같아야 한다
- **Do** 노드 부속 카드는 아래에 스택 / **Don't** 노드 좌우 배치 금지 (포트 라벨과 충돌)
- **Don't** 점/선 그리드 배경 금지 — 정렬 신호는 드래그 중 가이드만
- **Don't** hex·px·ms 하드코딩 금지 (tokens.css만, lint가 잡음) / 외부 CDN 금지 / 이모지 아이콘 금지(SVG·기호)
- **Don't** '밸브·파이프' 등 은유 단어를 UI 문구에 금지 — 은유는 모션으로만, 언어는 보편 문법

## 10. Current boundaries

이 문서는 현재 구현된 Studio interaction을 설명합니다. 다음 영역은 구현되기 전까지 이 문서의 암시만으로 추가하지 않습니다.

- 모바일/터치 전용 layout과 multi-select context toolbar
- rejected gate branch의 별도 graph 실행 시각화
- file upload, signature 같은 human-gate 확장 control
- synchronized/ghost replay와 full configuration diff
- account, permission, persistent workspace sharing와 multi-user collaboration
- Guided candidate의 자동 저장·publish 또는 existing-graph patch UI
- Release, Investigation, MCP execution과 3D Runtime World

현재 Evaluate는 phrase-contract dataset, repeated attempts, batch history/detail/comparison과 browser-side dataset selection을 제공합니다. Browser-side selection은 account, permission, invite 또는 server-persisted workspace relation이 아닙니다.

Guided Architect는 blank canvas에서 provider-backed preview를 만들고 local contract/graph/dry-run review 후 사용자가 승인할 때만 draft를 적용합니다. Candidate는 preview-only이고 provider failure를 deterministic success로 바꾸지 않습니다. OpenAI key와 explicit model ID가 모두 필요하며 real-provider 품질·비용·latency는 이 UI contract가 보장하지 않습니다.

장기 UX 제안은 [`docs/vision/`](docs/vision/)에 따로 두며 현재 capability로 해석하지 않습니다.
