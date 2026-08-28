// 화면에 나가는 모든 문구가 사는 곳 — 컴포넌트에는 문구를 적지 않는다.
// 한 줄에 한 언어씩, 같은 뜻을 각 언어의 쉬운 말로 적는다 (직역하지 않는다).
// 빈칸은 `{이름}`으로 적고, 채울 값은 메시지가 들고 다닌다.
import type { Locale } from "./locale";

/**
 * 빈칸에 들어갈 수 있는 것 — 다른 메시지나 계약이 준 두 언어짜리 글도 그대로 넣는다.
 * 어느 쪽이든 언어는 읽는 순간에 정해진다.
 */
export type MessageParam =
  | string
  | number
  | Message
  | Message[]
  | Record<Locale, string>;

export type MessageParams = Record<string, MessageParam>;

/** 아직 언어가 정해지지 않은 한 문장. store와 순수 모듈은 글자가 아니라 이것을 들고 다닌다. */
export interface Message {
  key: MessageKey;
  params?: MessageParams;
}

const TEXTS = {
  // 단일 관리자 세션
  "auth.login.title": { ko: "관리자 로그인", en: "Administrator sign in" },
  "auth.password.label": { ko: "관리자 비밀번호", en: "Administrator password" },
  "auth.checking": { ko: "세션을 확인하고 있습니다.", en: "Checking your session." },
  "auth.offline": { ko: "서버에 연결할 수 없습니다.", en: "Could not reach the server." },
  "auth.retry": { ko: "다시 시도", en: "Try again" },
  "auth.wrongPassword": { ko: "비밀번호가 맞지 않습니다.", en: "The password is incorrect." },
  "auth.submit": { ko: "로그인", en: "Sign in" },
  "auth.submitting": { ko: "확인 중…", en: "Checking…" },
  "auth.logout": { ko: "로그아웃", en: "Sign out" },

  // 문서와 파일
  "doc.menu.hint": {
    ko: "문서 메뉴 — 파일을 열고 내보내고 캔버스를 정리한다",
    en: "Document menu — open a file, save one, tidy the canvas",
  },
  "doc.menu.label": { ko: "문서 메뉴: {name}", en: "Document menu: {name}" },
  "doc.untitled": { ko: "새 초안", en: "New draft" },
  // 이름을 짓지 않은 문서를 부르는 말 — 문서 카드와 열기 목록이 같은 말을 쓴다.
  "doc.unnamed": { ko: "이름 없는 문서", en: "Document with no name" },
  "architect.title": { ko: "AI 설계 도우미", en: "AI Architect" },
  "architect.description": { ko: "자연어 요구를 서버의 AI 설계 도우미에게 보내 초안을 만들어요. 확인하기 전에는 캔버스를 바꾸지 않아요.", en: "Ask the server's AI Architect for a draft. The canvas stays unchanged until you review it." },
  "architect.request.label": { ko: "무엇을 만들까요", en: "What should it make?" },
  "architect.request.placeholder": { ko: "예: 고객 문의를 읽고 알맞은 답변을 만들어요", en: "Example: Read customer questions and draft a helpful answer" },
  "architect.error.empty": { ko: "요구를 한 줄 적어 주세요.", en: "Write what you need in a sentence." },
  "architect.create": { ko: "초안 만들기", en: "Create draft" },
  "architect.create.hint": { ko: "서버의 AI 설계 도우미에게 초안을 물어봐요", en: "Ask the server's AI Architect for a draft" },
  "architect.loading": { ko: "AI 설계 도우미가 초안을 만드는 중이에요", en: "The AI Architect is preparing a draft" },
  "architect.error.offline": { ko: "AI 설계 도우미에 닿지 못했어요 — 서버가 켜져 있는지 확인하고 다시 해보세요", en: "Could not reach the AI Architect — check that the server is running and try again" },
  "architect.error.strange": { ko: "AI 설계 도우미가 알 수 없는 답을 보냈어요 — 잠시 뒤 다시 해보세요", en: "The AI Architect sent an answer we cannot read — try again in a moment" },
  "architect.error.failed": { ko: "초안을 만들지 못했어요 ({status}) — 잠시 뒤 다시 해보세요", en: "Could not create the draft ({status}) — try again in a moment" },
  "architect.create.disabled": { ko: "요구를 먼저 적어 주세요", en: "Write a request first" },
  "architect.skip": { ko: "직접 조립할게요", en: "I’ll build it myself" },
  "architect.skip.hint": { ko: "기존 고급 안내를 열어요", en: "Show the existing advanced guide" },
  "architect.review.title": { ko: "초안 확인", en: "Review the draft" },
  "architect.review.checks": { ko: "초안 확인 결과", en: "Draft review results" },
  "architect.check.schema": { ko: "계약 확인", en: "Contract check" },
  "architect.check.graph": { ko: "흐름 확인", en: "Flow check" },
  "architect.check.dryRun": { ko: "가짜 실행", en: "Fake run" },
  "architect.summary": { ko: "노드 {nodes}개 · 연결 {edges}개", en: "{nodes} nodes · {edges} connections" },
  "architect.apply": { ko: "캔버스에 적용", en: "Apply to canvas" },
  "architect.apply.hint": { ko: "빈 캔버스에 초안을 적용해요", en: "Apply the draft to the empty canvas" },
  "architect.apply.disabled": { ko: "모든 확인을 통과해야 적용할 수 있어요", en: "Every check must pass before applying" },
  "architect.back": { ko: "다시 적기", en: "Write again" },
  "architect.back.hint": { ko: "요구 입력으로 돌아가요", en: "Go back to the request" },
  "doc.rename": { ko: "문서 이름 바꾸기: {name}", en: "Rename the document: {name}" },
  "doc.rename.field": { ko: "문서 이름", en: "Document name" },
  "doc.rename.hint": {
    ko: "Enter로 확정하고 Esc로 무른다 — 빈 이름은 받지 않는다",
    en: "Enter keeps it, Esc lets it go — an empty name is not allowed",
  },
  "doc.open": { ko: "파일 열기", en: "Open a file" },
  "doc.export": { ko: "내보내기", en: "Save to a file" },
  "doc.export.none": {
    ko: "아직 내보낼 그래프가 없다",
    en: "There is no graph to save yet",
  },
  "doc.export.hint": {
    ko: "AgentSpec JSON으로 내려받는다",
    en: "Downloads the graph as an AgentSpec JSON file",
  },
  "doc.arrange": { ko: "정리하기", en: "Tidy up" },
  "doc.arrange.hint": {
    ko: "노드를 데이터가 흐르는 순서대로 왼쪽에서 오른쪽으로 줄 세운다",
    en: "Lines the nodes up left to right, the way the data flows",
  },
  "doc.readFailed": {
    ko: "JSON을 읽을 수 없다: {reason}",
    en: "This file is not readable JSON: {reason}",
  },
  "doc.specProblem": {
    ko: "계약에 맞지 않는 곳이 있다: {problem}",
    en: "This does not match the contract: {problem}",
  },

  // 저장 (서버에 맡기는 일)
  "save.action": { ko: "저장", en: "Save" },
  "save.hint": {
    ko: "지금 그래프를 서버에 맡긴다 (Cmd+S)",
    en: "Puts this graph on the server (Cmd+S)",
  },
  "save.ok": { ko: "저장했어요", en: "Saved" },
  "save.ok.issues": {
    ko: "저장했어요 — 손볼 곳 {count}곳",
    en: "Saved — {count} things still need a look",
  },
  "save.offline": {
    ko: "서버에 닿지 못했어요 — 고친 내용은 화면에 그대로 있어요",
    en: "Could not reach the server — your work is still here",
  },
  "save.conflict": {
    ko: "다른 변경이 먼저 저장되어 이 내용은 덮어쓰지 않았어요 — 문서를 다시 열어 최신 판을 확인하세요",
    en: "Someone saved a different change first, so nothing was overwritten — reopen the document to see the latest version",
  },
  "save.precondition": {
    ko: "최신 판을 확인하지 못해 저장하지 않았어요 — 문서를 다시 열어 주세요",
    en: "The latest version was not confirmed, so nothing was saved — reopen the document and try again",
  },
  "save.refused": {
    ko: "서버가 이 그래프를 받지 않았어요: {reason}",
    en: "The server would not take this graph: {reason}",
  },
  "save.unreadable": {
    ko: "서버가 알 수 없는 답을 보냈어요 ({status}) — 잠시 뒤 다시 저장해 보세요",
    en: "The server sent an answer we cannot read ({status}) — try saving again in a moment",
  },
  "save.refused.contract": {
    ko: "계약에 맞지 않아 서버가 받지 않았어요 — 그래프를 한 번 살펴보세요",
    en: "The server refused it because it does not match the contract — take a look at the graph",
  },
  "save.failed": {
    ko: "저장하지 못했어요: {reason}",
    en: "Could not save it: {reason}",
  },
  "save.caption.never": { ko: "아직 저장 안 했어요", en: "Not saved yet" },
  "save.caption.changed": {
    ko: "저장 안 된 변경이 있어요",
    en: "There are changes you have not saved",
  },
  "save.caption.saved": {
    ko: "저장했어요 · {version}번째 판",
    en: "Saved · version {version}",
  },
  "save.caption.saving": { ko: "저장하는 중이에요", en: "Saving it now" },
  "save.locked.running": {
    ko: "실행을 보는 중에는 저장할 수 없어요 — 실행 보기를 닫고 저장하세요",
    en: "You cannot save while watching a run — close the run view first",
  },
  "save.locked.asking": {
    ko: "묻고 있는 것에 먼저 답해 주세요 — 그다음 저장할 수 있어요",
    en: "Answer the question on screen first, then you can save",
  },
  "save.none": {
    ko: "아직 저장할 그래프가 없어요",
    en: "There is no graph to save yet",
  },
  // 서버는 저장된 판을 돌린다 — 저장하지 못했으면 실행할 판도 없다.
  "save.run.blocked": {
    ko: "저장하지 못해 실행할 수 없어요 — 서버가 켜져 있는지 보고 다시 눌러 주세요",
    en: "It did not save, so there is nothing to run — check the server is up and press it again",
  },

  // 서버에 저장해 둔 문서를 다시 여는 일
  "open.action": { ko: "열기", en: "Open" },
  "open.action.hint": {
    ko: "서버에 저장해 둔 문서를 골라 연다",
    en: "Pick one of the documents kept on the server",
  },
  "open.title": { ko: "어떤 문서를 열까요", en: "Which document shall we open?" },
  "open.loading": { ko: "문서 목록을 불러오는 중이에요", en: "Loading saved documents" },
  "open.reload": {
    ko: "문서 목록 새로 불러오기",
    en: "Reload documents",
  },
  "open.fileAsk.title": { ko: "파일을 열까요", en: "Open this file?" },
  "open.close": { ko: "닫기", en: "Close" },
  "open.when": { ko: "{when} · {version}번째 판", en: "{when} · version {version}" },
  "open.when.unknown": {
    ko: "언제 저장했는지 몰라요",
    en: "We do not know when",
  },
  "open.current": { ko: "지금 보는 문서", en: "The one you have open" },
  "open.empty": {
    ko: "아직 저장한 문서가 없어요 — 지금 만드는 것을 저장하면 여기 쌓여요",
    en: "Nothing is saved yet — save what you are making and it will show up here",
  },
  "open.truncated": {
    ko: "오래된 문서는 아직 보여줄 수 없어요",
    en: "We cannot show the older documents yet",
  },
  "open.retry": { ko: "다시 해보기", en: "Try again" },
  "open.list.offline": {
    ko: "문서 목록을 불러오지 못했어요 — 서버에 닿지 못했어요",
    en: "Could not get the list — the server could not be reached",
  },
  "open.list.failed": {
    ko: "문서 목록을 불러오지 못했어요 ({reason})",
    en: "Could not get the list ({reason})",
  },
  "open.list.strange": {
    ko: "서버가 알 수 없는 답을 보냈어요 — 잠시 뒤 다시 해보세요",
    en: "The server sent an answer we cannot read — try again in a moment",
  },
  "open.offline": {
    ko: "문서를 불러오지 못했어요 — 서버에 닿지 못했어요",
    en: "Could not get the document — the server could not be reached",
  },
  "open.notFound": { ko: "그 문서를 찾지 못했어요", en: "We could not find that document" },
  "open.failed": {
    ko: "문서를 열지 못했어요 ({reason})",
    en: "Could not open the document ({reason})",
  },
  "open.ask": {
    // 한 번도 저장하지 않은 문서에도 나오는 말이라 '변경'이 아니라 '작업'이라 부른다.
    ko: "아직 저장하지 않은 작업이 있어요",
    en: "There is work you have not saved yet",
  },
  "open.ask.save": { ko: "저장하고 열기", en: "Save, then open" },
  "open.ask.anyway": { ko: "그냥 열기", en: "Open without saving" },
  "open.ask.anyway.hint": {
    ko: "아직 저장하지 않은 작업은 사라져요",
    en: "The work you have not saved will be gone",
  },
  "open.ask.back": { ko: "돌아가기", en: "Go back" },

  // 지금 문서의 저장된 판 머리말을 읽는 일 — 복원·diff는 하지 않는다.
  "revisionHistory.action": { ko: "판 기록", en: "Revision history" },
  "revisionHistory.none": {
    ko: "문서를 먼저 열어야 판 기록을 볼 수 있어요",
    en: "Open a document before viewing its revision history",
  },
  "revisionHistory.title": { ko: "판 기록", en: "Revision history" },
  "revisionHistory.close": { ko: "판 기록 닫기", en: "Close revision history" },
  "revisionHistory.loading": { ko: "판 기록을 불러오는 중이에요", en: "Loading revision history" },
  "revisionHistory.empty": { ko: "아직 저장된 판이 없어요", en: "No saved revisions yet" },
  "revisionHistory.offline": {
    ko: "판 기록을 불러오지 못했어요 — 서버에 닿지 못했어요",
    en: "Could not get revision history — the server could not be reached",
  },
  "revisionHistory.notFound": {
    ko: "이 문서의 판 기록을 찾지 못했어요",
    en: "We could not find this document's revision history",
  },
  "revisionHistory.failed": {
    ko: "판 기록을 불러오지 못했어요 ({status})",
    en: "Could not get revision history ({status})",
  },
  "revisionHistory.strange": {
    ko: "서버가 판 기록을 알 수 없는 답으로 보냈어요 — 잠시 뒤 다시 해보세요",
    en: "The server sent an unknown revision-history answer — try again in a moment",
  },
  "revisionHistory.version": {
    ko: "{version}번째 판 · {when}",
    en: "Version {version} · {when}",
  },
  "revisionHistory.retry": { ko: "다시 해보기", en: "Try again" },

  // 화면의 밝기와 언어
  "theme.toDark": { ko: "어둡게 보기", en: "Switch to a dark screen" },
  "theme.toLight": { ko: "밝게 보기", en: "Switch to a light screen" },
  "locale.switchTo.ko": { ko: "한국어로 보기", en: "Read this in Korean" },
  "locale.switchTo.en": { ko: "English로 보기", en: "Read this in English" },

  // 독과 패널
  "dock.label": { ko: "도구", en: "Tools" },
  "palette.title": { ko: "노드 추가", en: "Add a node" },
  "palette.hint": {
    ko: "캔버스에 새 노드를 놓는다",
    en: "Puts a new node on the canvas",
  },
  "tray.title": { ko: "보관함", en: "Shelf" },
  "tray.hint": {
    ko: "캔버스에서 뺀 노드가 설정을 지닌 채 기다린다",
    en: "Nodes you took off wait here, settings and all",
  },
  "tray.empty": {
    ko: "뺀 노드가 여기에 보관된다. 언제든 다시 꽂을 수 있다.",
    en: "Nodes you take off wait here. You can put them back any time.",
  },
  "tray.restore": { ko: "캔버스에 다시 꽂기", en: "Put it back on the canvas" },
  "nodeList.title": { ko: "노드 목록", en: "Node list" },
  "nodeList.hint": {
    ko: "캔버스를 보지 않고 목록으로 읽는다",
    en: "Read the graph as a list instead of a picture",
  },
  "nodeList.detach": { ko: "{id} 빼기", en: "Take {id} off" },
  "nodeList.focus.hint": {
    ko: "두 번 누르면 캔버스가 그 노드로 데려간다",
    en: "Double-click and the canvas takes you to that node",
  },

  // 캔버스와 카드
  "canvas.label": { ko: "캔버스", en: "Canvas" },
  "nodeCard.setup": { ko: "설정 필요", en: "Needs a look" },
  "statusBar.ok": { ko: "확인", en: "Got it" },

  // 빈 자리에서 노드를 고르는 순간
  "picker.title": { ko: "노드 고르기", en: "Pick a node" },
  "picker.search": { ko: "이름으로 찾기", en: "Find one by name" },
  "picker.linked": {
    ko: "'{port}'에 이을 수 있는 노드만 보여줘요",
    en: "Only the nodes that can join '{port}'",
  },
  "picker.free": { ko: "여기에 놓을 노드를 고르세요", en: "Pick a node to drop here" },
  "picker.empty": {
    ko: "여기에 놓을 수 있는 노드가 없어요",
    en: "No node fits here",
  },

  // 빼기 전에 보여주는 물음
  "impact.label": { ko: "빼기 전에 확인", en: "Check before taking it off" },
  "impact.title": { ko: "'{id}' 노드를 빼면", en: "If you take '{id}' off" },
  "impact.subtitle": {
    ko: "데이터가 닿지 않게 되는 노드",
    en: "Nodes that will stop getting data",
  },
  "impact.confirm": { ko: "그래도 빼기", en: "Take it off anyway" },
  "impact.cancel": { ko: "취소", en: "Cancel" },
  "impact.nothing": { ko: "아무것도 끊어지지 않는다", en: "Nothing gets cut off" },
  "impact.edges.will": {
    ko: "연결 {count}개가 끊어진다",
    en: "Connections that will be cut: {count}",
  },
  "impact.edges.did": {
    ko: "연결 {count}개가 끊어졌다",
    en: "Connections that were cut: {count}",
  },
  "impact.nodes.will": {
    ko: "노드 {count}개에 데이터가 닿지 않게 된다",
    en: "Nodes that will stop getting data: {count}",
  },
  "impact.nodes.did": {
    ko: "노드 {count}개에 데이터가 닿지 않게 됐다",
    en: "Nodes that stopped getting data: {count}",
  },

  // 되돌리기
  "history.undo": { ko: "되돌리기", en: "Undo" },
  "history.redo": { ko: "다시하기", en: "Redo" },
  "history.undo.of": { ko: "되돌리기: {edit}", en: "Undo: {edit}" },
  "history.redo.of": { ko: "다시하기: {edit}", en: "Redo: {edit}" },
  "history.undo.none": { ko: "되돌릴 편집이 없다", en: "There is nothing to undo" },
  "history.redo.none": { ko: "다시 할 편집이 없다", en: "There is nothing to redo" },

  // 편집 하나하나의 이름 (되돌리기 목록에 적힌다)
  "edit.addNode": { ko: "노드 추가", en: "Adding a node" },
  "edit.addEdge": { ko: "연결 추가", en: "Adding a connection" },
  "edit.addLinkedNode": { ko: "노드 이어 붙이기", en: "Adding a node and joining it" },
  "edit.removeNode": { ko: "노드 삭제", en: "Deleting a node" },
  "edit.removeEdge": { ko: "연결 삭제", en: "Deleting a connection" },
  "edit.moveNodes": { ko: "노드 이동", en: "Moving nodes" },
  "edit.changeConfig": { ko: "설정 변경", en: "Changing settings" },
  "edit.changeEdge": { ko: "연결 설정 변경", en: "Changing a connection" },
  "edit.detach": { ko: "노드 빼기", en: "Taking a node off" },
  "edit.restore": { ko: "보관함에서 꺼내기", en: "Taking a node off the shelf" },
  "edit.nothing": { ko: "그대로 두기", en: "Leaving it as it is" },
  "edit.rename": { ko: "문서 이름 바꾸기", en: "Renaming the document" },
  "edit.adoptRun": {
    ko: "지난 실행의 설정 가져오기",
    en: "Taking the settings from an earlier run",
  },
  "edit.detach.notice": {
    ko: "'{id}' 노드를 보관함에 넣었다 — 언제든 다시 꽂을 수 있다",
    en: "'{id}' is on the shelf now — you can put it back any time",
  },
  "edit.restore.renamed": {
    ko: "'{taken}'라는 이름이 이미 있어 '{given}'로 꽂았다",
    en: "'{taken}' was already taken, so it went back as '{given}'",
  },
  "edit.detach.gone": {
    ko: "'{id}' 노드는 이미 캔버스에 없다",
    en: "'{id}' is not on the canvas any more",
  },
  "edit.config.notice": {
    ko: "'{id}' 노드의 설정을 바꿔서 {impact}",
    en: "Changing the settings on '{id}' left this — {impact}",
  },

  // 모드
  "mode.label": { ko: "모드", en: "Mode" },
  "mode.build": { ko: "만들기", en: "Build" },
  "mode.build.hint": {
    ko: "그래프를 고치는 자리로 돌아간다",
    en: "Goes back to where you edit the graph",
  },
  "mode.run": { ko: "실행", en: "Run" },
  "mode.run.none": {
    ko: "아직 실행해 볼 그래프가 없다",
    en: "There is no graph to try yet",
  },
  "mode.run.hint": {
    ko: "진짜 모델을 부르지 않고 그래프가 어떻게 도는지 보여준다",
    en: "Shows how the graph moves without calling a real model",
  },
  "mode.eval": { ko: "시험", en: "Test" },
  "mode.eval.hint": {
    ko: "케이스를 모아 두고 한 번에 돌려 본다",
    en: "Gathers cases and runs them all at once",
  },

  // 실행 버튼과 실행 전 확인
  "run.start": { ko: "실행해 보기", en: "Try a run" },
  "run.waiting": {
    ko: "노드 {count}개에 확인이 필요해요",
    en: "Nodes that need a look: {count}",
  },
  "run.waiting.hint": {
    ko: "확인이 필요한 첫 노드로 데려간다",
    en: "Takes you to the first node that needs a look",
  },
  "run.waiting.blocked": {
    ko: "확인이 필요한 노드가 있어요 — 누르면 그 노드로 데려간다",
    en: "Some nodes still need a look — press to go to the first one",
  },
  "run.waiting.notice": {
    ko: "노드 {count}개에 확인이 필요해요 — 설정을 채우면 실행해 볼 수 있어요",
    en: "Nodes that need a look: {count} — fill their settings in and you can try a run",
  },
  "run.locked": {
    ko: "실행 중에는 고칠 수 없다",
    en: "You cannot edit while a run is playing",
  },
  "run.elapsed": { ko: "{seconds}초", en: "{seconds}s" },

  "run.starting": { ko: "실행을 여는 중이에요", en: "Opening the run" },

  // 실행은 서버가 돌린다 — 못 돌린 까닭과 다음 걸음을 한 목소리로 말한다.
  "run.start.offline": {
    ko: "서버에 닿지 못해 실행할 수 없어요 — 서버가 켜져 있는지 보고 다시 눌러 주세요",
    en: "Could not reach the server, so nothing ran — check the server is up and press it again",
  },
  "run.start.notSaved": {
    ko: "서버에 이 그래프가 없어요 — 저장한 뒤에 실행할 수 있어요",
    en: "The server does not have this graph — save it first and you can run it",
  },
  "run.start.moved": {
    ko: "저장된 그래프가 그 사이 달라졌어요 — 다시 저장한 뒤 실행해 주세요",
    en: "The saved graph has changed since — save it again and then run it",
  },
  "run.start.strange": {
    ko: "서버가 알 수 없는 답을 보냈어요 — 잠시 뒤 다시 실행해 주세요",
    en: "The server sent an answer we cannot read — try running it again in a moment",
  },
  "run.start.failed": {
    ko: "실행하지 못했어요: {reason}",
    en: "Could not run it: {reason}",
  },
  "run.answer.offline": {
    ko: "서버에 닿지 못해 답을 보내지 못했어요 — 서버가 켜져 있는지 보고 다시 눌러 주세요",
    en: "Could not reach the server, so your answer did not go — check the server is up and press it again",
  },
  // 서버는 두 가지 까닭(이미 답이 접수됨·멈춰 있지 않음)을 같은 409로 물린다 — 우리도 한 목소리로 말한다.
  // 화면에 없는 행동을 시키지 않는다: 무슨 일이 있었는지만 말한다.
  "run.answer.moved": {
    ko: "이 답은 받을 수 없어요 — 이미 처리됐거나 확인을 기다리는 중이 아니에요",
    en: "That answer cannot be taken — it was already handled, or nothing is waiting to be checked",
  },
  "run.answer.strange": {
    ko: "서버가 답을 받았는지 알 수 없어요 — 실행을 다시 열어 확인해 보세요",
    en: "We cannot tell whether the server took your answer — open the run again to check",
  },
  "run.answer.gone": {
    ko: "서버가 이 실행을 모른다고 해요 — 처음부터 다시 실행해 주세요",
    en: "The server does not know this run — start a new run",
  },
  "run.answer.failed": {
    ko: "답을 보내지 못했어요: {reason}",
    en: "Could not send your answer: {reason}",
  },
  "run.stream.lost": {
    ko: "실행 소식이 끊겼어요 — 여기까지는 남아 있어요. 다시 실행하면 이어서 볼 수 있어요",
    en: "We stopped hearing about the run — what you see is what arrived. Run it again to watch it through",
  },

  // 처음 온 사람의 네 걸음 (DESIGN §7 first-steps-card)
  "guide.title": {
    ko: "첫 그래프, 네 걸음이면 돼요",
    en: "Build your first graph in four steps",
  },
  "guide.step.place": { ko: "노드를 하나 놓아요", en: "Put down one node" },
  "guide.how.place": {
    ko: "빈 곳을 두 번 눌러 보세요",
    en: "Double-click an empty spot",
  },
  "guide.step.link": { ko: "두 노드를 이어요", en: "Link two nodes" },
  "guide.how.link": {
    ko: "노드 가장자리의 점을 잡아 다른 노드나 빈 곳으로 끌어요",
    en: "Drag from a dot on the edge of a node to another node or an empty spot",
  },
  "guide.step.fill": { ko: "빈 칸을 채워요", en: "Fill in the empty boxes" },
  "guide.how.fill": {
    ko: "노드를 누르면 오른쪽에 채울 칸이 나와요",
    en: "Click a node and the boxes to fill show up on the right",
  },
  "guide.step.run": { ko: "실행해 봐요", en: "Try a run" },
  "guide.how.run": {
    ko: "오른쪽 위 '실행해 보기'를 눌러요",
    en: "Press 'Try a run' at the top right",
  },
  "guide.done": { ko: "첫 실행까지 해냈어요", en: "You made it all the way to a run" },
  "guide.hide": { ko: "이제 안 봐도 돼요", en: "Hide these steps" },

  // 실행에 넣을 값을 묻는 카드
  "runInput.label": { ko: "실행에 넣을 값", en: "Values for this run" },
  "runInput.title": {
    ko: "무엇으로 실행해 볼까요",
    en: "What should this run start with",
  },
  "runInput.confirm": { ko: "이 값으로 실행", en: "Run with these" },
  "runInput.cancel": { ko: "그만두기", en: "Never mind" },
  "runInput.blocked": {
    ko: "필수 입력을 채우면 실행할 수 있어요",
    en: "Fill in what is required and you can run it",
  },

  // 흐름을 막는 밸브 — 사람 확인과 손으로 꽂은 멈춤
  "gate.label": {
    ko: "'{id}' 노드에서 사람의 확인을 기다린다",
    en: "'{id}' is waiting for a person to check",
  },
  "gate.title": { ko: "여기서 멈춰 있어요", en: "The run is holding here" },
  "gate.body": {
    ko: "사람이 확인해야 다음으로 가요",
    en: "It goes on once a person has checked it",
  },
  "gate.approve": { ko: "승인하고 계속", en: "Approve and keep going" },
  "gate.reject": { ko: "거절하기", en: "Turn it down" },
  "gate.reject.body": {
    ko: "거절하면 흐름이 여기서 끝나요",
    en: "Turning it down ends the run here",
  },
  "gate.reject.confirm": { ko: "정말 거절하기", en: "Yes, turn it down" },
  "gate.reject.back": { ko: "돌아가기", en: "Go back" },
  // 사람이 값을 적어 넘기는 자리 — 양식을 찾지 못해도 승인은 막지 않는다.
  "form.required": { ko: "{label} (필수)", en: "{label} (required)" },
  "gate.form.missing": {
    ko: "이 단계가 요구한 입력 양식을 찾지 못했어요 — 입력 없이 승인만 할 수 있어요",
    en: "We could not find the form this step asks for — you can still approve without filling anything in",
  },
  "gate.approve.blocked": {
    ko: "필수 입력을 채우면 승인할 수 있어요",
    en: "Fill in what is required and you can approve",
  },
  "gate.leave": { ko: "멈춘 채 두기", en: "Leave it held" },
  // 답은 서버가 받는다 — 오가는 사이에는 버튼이 기다린다고 말한다.
  "gate.answering": { ko: "답을 보내는 중이에요", en: "Sending your answer" },
  "gate.reopen": { ko: "확인하러 가기", en: "Go and check it" },
  "breakpoint.toggle": { ko: "여기서 멈추기", en: "Stop here" },
  "breakpoint.hint": {
    ko: "재생이 이 노드가 일을 시작하기 직전에 멈춘다 — 그래프에는 남지 않는다",
    en: "Playing stops just before this node starts working — nothing is saved in the graph",
  },
  "breakpoint.mark": {
    ko: "여기서 멈추기로 해 둔 노드",
    en: "Playing stops before this node",
  },
  "breakpoint.notice": {
    ko: "'{id}' 앞에서 멈췄어요 — 살펴본 뒤 이어서 보세요",
    en: "Held just before '{id}' — take a look, then keep watching",
  },

  // 되감기
  "timeline.label": { ko: "실행 되감기", en: "Rewind the run" },
  "timeline.mode": {
    ko: "실행을 보는 중이다 — 그래프는 잠겨 있다",
    en: "You are watching a run — the graph is locked",
  },
  "timeline.pause": { ko: "잠시 멈추기", en: "Hold on a moment" },
  "timeline.play": { ko: "이어서 보기", en: "Keep watching" },
  "timeline.restart": { ko: "처음부터", en: "From the start" },
  "timeline.scrubber": { ko: "재생 위치", en: "Where you are watching" },
  "timeline.position": { ko: "{total}개 중 {at}번째", en: "{at} of {total}" },
  "timeline.speed": { ko: "재생 속도", en: "How fast" },
  "timeline.speedOption": { ko: "{speed}배", en: "{speed}x" },

  // 실행 기록
  "eventList.label": { ko: "실행 기록", en: "What happened" },
  "runHistory.label": { ko: "지난 실행", en: "Runs you have tried" },
  "runHistory.replay": {
    ko: "이 실행을 처음부터 다시 본다",
    en: "Watch this run again from the start",
  },
  "runHistory.failed": { ko: "실패", en: "Did not finish" },
  "runHistory.promote": { ko: "시험으로 남기기", en: "Save as test" },
  "runHistory.promote.disabled": {
    ko: "먼저 열어 둔 시험 초안을 저장하거나 닫아 주세요",
    en: "Save or close the test draft that is already open first",
  },
  "runHistory.name": { ko: "실행 {number}", en: "Run {number}" },
  "compare.step": {
    ko: "'{node}' 노드가 {what}",
    en: "The '{node}' node — {what}",
  },
  "compare.pick": { ko: "비교", en: "Compare" },
  "compare.picked": { ko: "비교 {at}/{of}", en: "Compare {at}/{of}" },
  "compare.pick.hint": {
    ko: "다른 실행과 나란히 놓고 견준다",
    en: "Puts this run side by side with another one",
  },
  "compare.pick.none": {
    ko: "견주려면 실행이 둘 이상이어야 해요",
    en: "You need two runs before you can compare",
  },
  "compare.title": { ko: "두 실행 견주기", en: "Two runs side by side" },
  "compare.close": { ko: "견주기 닫기", en: "Close the comparison" },
  "compare.same": { ko: "두 실행이 똑같아요", en: "These two runs are the same" },
  "compare.diverged": { ko: "여기부터 달라져요", en: "They differ from here on" },
  "compare.ended": { ko: "여기서 끝났어요", en: "It ended here" },
  "compare.adopt": { ko: "이쪽으로 계속", en: "Keep going with this one" },
  "compare.adopt.hint": {
    ko: "이 실행이 돌던 설정을 캔버스에 가져온다 — 되돌리기로 물릴 수 있다",
    en: "Brings this run's settings back to the canvas — undo puts it back",
  },
  "compare.adopted": { ko: "채택", en: "Adopted" },
  "runHistory.steps.one": { ko: "1단계", en: "1 step" },
  "runHistory.steps.many": { ko: "{count}단계", en: "{count} steps" },

  // 노드가 지금 무엇을 하고 있는가
  "status.idle": { ko: "아직 차례가 아니다", en: "Not its turn yet" },
  "status.queued": { ko: "차례를 기다린다", en: "Waiting its turn" },
  "status.running": { ko: "일하는 중", en: "Working on it" },
  "status.waiting": { ko: "확인을 기다려요", en: "Waiting for you to check" },
  "status.rejected": { ko: "거절했어요", en: "Turned down" },
  "status.completed": { ko: "마쳤다", en: "All done" },
  "status.failed": { ko: "끝내지 못했다", en: "Could not finish" },

  // 실행 중에 일어난 일 (이벤트 한 줄) — 기술 용어를 쓰지 않는다
  "event.node.unnamed": { ko: "이름 없는", en: "an unnamed" },
  "event.state.from": { ko: "앞", en: "the one before" },
  "event.state.to": { ko: "뒤", en: "the one after" },
  "event.run.started": { ko: "실행을 시작했다", en: "The run started" },
  "event.node.queued": {
    ko: "'{node}' 노드가 차례를 기다린다",
    en: "The '{node}' node is waiting its turn",
  },
  "event.node.started": {
    ko: "'{node}' 노드가 일을 시작했다",
    en: "The '{node}' node started working",
  },
  "event.prompt.compiled": {
    ko: "'{node}' 노드가 물어볼 말을 다 지었다",
    en: "The '{node}' node finished writing what to ask",
  },
  "event.llm.requested": {
    ko: "'{node}' 노드가 인공지능에게 물어봤다",
    en: "The '{node}' node asked the AI",
  },
  "event.llm.completed": {
    ko: "'{node}' 노드가 인공지능의 답을 받았다",
    en: "The '{node}' node got the AI's answer back",
  },
  "event.decision.recorded": {
    ko: "'{node}' 노드가 어느 길로 갈지 정했다",
    en: "The '{node}' node picked which way to go",
  },
  "event.tool.policyChecked": {
    ko: "'{node}' 노드가 도구를 써도 되는지 확인했다",
    en: "The '{node}' node checked whether it may use the tool",
  },
  "event.tool.requested": {
    ko: "'{node}' 노드가 도구를 불렀다",
    en: "The '{node}' node called the tool",
  },
  "event.tool.completed": {
    ko: "'{node}' 노드가 도구의 결과를 받았다",
    en: "The '{node}' node got the tool's result back",
  },
  "event.state.patch": {
    ko: "'{from}'에서 만든 값이 '{to}'로 넘어갔다",
    en: "The value made at '{from}' went over to '{to}'",
  },
  "event.checkpoint.created": {
    ko: "여기까지의 내용을 저장해 뒀다",
    en: "Everything so far was saved",
  },
  "event.human.approvalRequested": {
    ko: "'{node}' 노드가 사람의 확인을 기다린다",
    en: "The '{node}' node is waiting for a person to check",
  },
  "event.run.paused": { ko: "실행을 잠시 멈췄다", en: "The run stopped for a moment" },
  "event.run.resumed": {
    ko: "멈췄던 실행을 이어서 한다",
    en: "The run picked up where it stopped",
  },
  "event.node.completed": {
    ko: "'{node}' 노드가 일을 마쳤다",
    en: "The '{node}' node finished its work",
  },
  "event.run.rejected": {
    ko: "사람이 거절했다",
    en: "A person turned it down",
  },
  "event.node.rejected": {
    ko: "사람이 거절해서 흐름을 여기서 마쳤다",
    en: "A person turned it down, so the run ended here",
  },
  "event.node.failed": {
    ko: "'{node}' 노드가 하던 일을 끝내지 못했다",
    en: "The '{node}' node could not finish its work",
  },
  "event.run.completed": { ko: "실행을 모두 마쳤다", en: "The run finished" },
  "event.run.failed": {
    ko: "실행이 끝까지 가지 못했다",
    en: "The run did not make it to the end",
  },
  // 왜 끝까지 가지 못했는지는 갈래대로 갈라 말하고, 이유로 끝내지 않고 다음 걸음까지 말한다.
  "event.run.failed.runtime_error": {
    ko: "실행 도중 문제가 생겨 여기서 멈췄어요 — 다시 한 번 실행해 보세요",
    en: "Something went awry partway and it stopped here — give the run another try",
  },
  "event.run.failed.unknown_model": {
    ko: "고른 모델을 찾지 못했어요 — 노드 설정에서 쓸 모델을 다시 골라 주세요",
    en: "We could not find the model it was told to use — pick one again in the node settings",
  },
  "event.run.failed.missing_secret": {
    ko: "이 모델을 부르려면 열쇠가 필요해요 — 서버에 열쇠를 넣고 다시 실행해 주세요",
    en: "This model needs a key before it can be called — put the key on the server, then run it again",
  },
  "event.run.failed.provider_error": {
    ko: "모델 쪽에서 답을 주지 않았어요 — 잠시 뒤에 다시 실행해 주세요",
    en: "The model service did not answer — wait a moment, then run it again",
  },

  // 설정 카드
  "inspector.label": { ko: "설정", en: "Settings" },
  "inspector.close": { ko: "설정 닫기", en: "Close the settings" },
  "inspector.close.hint": {
    ko: "설정을 접고 캔버스만 본다",
    en: "Folds the settings away and leaves just the canvas",
  },
  // 지우는 길은 손이 있는 자리에 있다 — 되묻지 않고, 무섭지 않다고 말한다 (DESIGN §7).
  "inspector.delete": { ko: "이 노드 지우기", en: "Delete this node" },
  "inspector.delete.hint": {
    ko: "이 노드를 캔버스에서 뺀다 (Delete)",
    en: "Takes this node off the canvas (Delete)",
  },
  "inspector.delete.undo": {
    ko: "되돌리기로 언제든 살릴 수 있어요",
    en: "Undo brings it back any time",
  },
  "edge.title": { ko: "연결", en: "Connection" },
  "edge.kind.label": { ko: "연결 종류", en: "Kind of connection" },
  "edge.kind.data": { ko: "값 전달 (data)", en: "Carries a value (data)" },
  "edge.kind.control": { ko: "순서만 잇기 (control)", en: "Only sets the order (control)" },
  "edge.kind.approval": {
    ko: "승인 결과 전달 (approval)",
    en: "Carries a person's answer (approval)",
  },
  "edge.kind.hint": {
    ko: "값 전달은 앞 노드의 결과가 흘러가고, 순서만 잇기는 순서만 정하며, 승인 결과 전달은 사람이 확인한 결과가 흘러간다.",
    en: "Carries a value means the node before hands its result over, only sets the order means nothing is handed over, and carries a person's answer means what the person decided goes through.",
  },
  "edge.condition.label": { ko: "지나갈 조건", en: "When to go through" },
  "edge.condition.hint": {
    ko: "이 연결을 탈 조건을 CEL이라는 짧은 식으로 적는다. 비워 두면 항상 지나간다. 지금은 저장만 하고 실행하지 않는다.",
    en: "Write when to take this connection as a short CEL formula. Leave it empty and it always goes through. For now this is only saved, not run.",
  },
  "config.raw.label": { ko: "설정 직접 편집 (JSON)", en: "Edit the settings as JSON" },
  "config.raw.hint": {
    ko: "이 노드의 설정은 폼으로 읽을 수 없어 JSON 그대로 편집한다.",
    en: "We cannot draw a form for this node's settings, so you edit the JSON itself.",
  },
  "control.select.none": { ko: "(고르지 않음)", en: "(not chosen)" },
  "control.secret.hint": {
    ko: "비밀 값 자체가 아니라 값이 저장된 자리의 이름(secretRef)만 적는다.",
    en: "Write only the name of the place the secret is kept (secretRef), never the secret itself.",
  },
  // 이름을 알 수 없는 양식도 값은 그대로 둔다 — 내부 이름을 화면에 쓰지 않는다.
  "control.schemaRef.unknown": {
    ko: "알 수 없는 양식",
    en: "A form we do not know",
  },
  // 목록에 없는 값은 직접 적는다 — 이 자리는 값을 적는 상자의 이름이기도 하다.
  "control.preset.custom": { ko: "직접 적기…", en: "Type it yourself…" },
  // 빈 상자 앞에서 무엇을 적을지 모르는 사람에게 주는 시작 글 — 고르면 채워지고 거기서 고쳐 쓴다.
  "control.presetFill.placeholder": {
    ko: "이런 일을 시켜 보세요…",
    en: "Try one of these…",
  },
  "control.presetFill.name": { ko: "{field} 프리셋", en: "{field} presets" },
  // 빈 상자는 값의 예가 아니라 무엇을 하면 되는지를 초대한다 (DESIGN.md §7 preset-fill).
  "control.instruction.invite": {
    ko: "이 단계가 무엇을 하면 되는지 적어요 — 위에서 골라 시작해도 돼요",
    en: "Write what this step should do — or pick a start above",
  },
  "control.json.broken": {
    ko: "아직 JSON 형식이 아니다 — 저장하지 않고 기다린다",
    en: "This is not JSON yet — nothing is saved until it is",
  },
  "control.map.name": { ko: "{row}번째 이름", en: "Name on row {row}" },
  "control.map.value": {
    ko: "{row}번째 가져올 위치",
    en: "Where to take it from, row {row}",
  },
  "control.map.remove": { ko: "이 줄 지우기", en: "Remove this row" },
  "control.map.add": { ko: "줄 추가", en: "Add a row" },
  "control.map.duplicate": {
    ko: "같은 이름이 두 개 있다 — 마지막 값만 저장된다",
    en: "That name is used twice — only the last value is kept",
  },

  // 설정 값이 규칙에 맞지 않을 때
  "validate.required": { ko: "꼭 채워야 하는 값이다", en: "This one has to be filled in" },
  "validate.type": { ko: "{name}를 넣어야 한다", en: "This needs {name}" },
  "validate.type.raw": {
    ko: "{type} 형식이어야 한다",
    en: "This has to be in {type} form",
  },
  "validate.minimum": { ko: "{limit} 이상이어야 한다", en: "This has to be {limit} or more" },
  "validate.maximum": { ko: "{limit} 이하여야 한다", en: "This has to be {limit} or less" },
  "validate.pattern": {
    ko: "정해진 형태와 다르다 (형태: {pattern})",
    en: "This does not match the shape we expect (shape: {pattern})",
  },
  "validate.enum": {
    ko: "정해진 값 중에서 골라야 한다 (고를 수 있는 값: {values})",
    en: "Pick one of the values we allow (you can pick: {values})",
  },
  "validate.other": {
    ko: "입력값이 조건에 맞지 않는다 (조건: {rule})",
    en: "This value does not meet the rule (rule: {rule})",
  },
  "validate.other.unknown": { ko: "알 수 없음", en: "not known" },
  "validate.type.string": { ko: "글자", en: "text" },
  "validate.type.number": { ko: "숫자", en: "a number" },
  "validate.type.integer": { ko: "정수", en: "a whole number" },
  "validate.type.boolean": { ko: "예/아니오", en: "a yes or no" },
  "validate.type.array": { ko: "목록", en: "a list" },
  "validate.type.object": { ko: "묶음", en: "a group" },

  // 아직 손볼 곳이 남은 노드
  "setup.unknownType": {
    ko: "'{type}'는 알 수 없는 종류의 노드예요",
    en: "'{type}' is a kind of node we do not know",
  },
  "setup.empty": { ko: "{title}: 아직 비어 있어요", en: "{title}: still empty" },
  "setup.bindings.shape": {
    ko: "가져올 입력 값을 이름과 위치의 묶음으로 적어야 해요",
    en: "Write the values to bring in as name-and-place pairs",
  },
  "setup.bindings.emptyName": {
    ko: "이름이 비어 있는 입력 값이 있어요",
    en: "One of the values to bring in has no name",
  },
  "setup.bindings.path": {
    ko: "'{name}'의 위치를 글자로 적어야 해요",
    en: "Write where '{name}' comes from as text",
  },

  // 값의 종류를 부르는 쉬운 말 — 자료형 원문(string·array…)은 화면에 쓰지 않는다.
  "type.text": { ko: "글자", en: "text" },
  "type.number": { ko: "숫자", en: "a number" },
  "type.yesno": { ko: "예·아니오", en: "a yes-or-no" },
  "type.list": { ko: "목록", en: "a list" },
  "type.bundle": { ko: "묶음", en: "a bundle" },
  "type.nothing": { ko: "빈 값", en: "nothing" },

  // 이을 수 없는 연결 — 이 카드의 말은 모두 [이유] — [다음 걸음] 한 목소리다 (DESIGN §7).
  // 화면에 보이는 포트 이름만 가리키고, 내부 이름표(node.port)는 쓰지 않는다.
  "connection.unknownNode": {
    ko: "이으려던 노드가 캔버스에 없어요 — 노드를 다시 놓고 이어 보세요",
    en: "The node you were joining to is not on the canvas — put it back and join again",
  },
  "connection.unknownType": {
    ko: "이 노드의 종류를 알지 못해요 — 다른 노드에 이어 보세요",
    en: "We do not know this kind of node — join to another node instead",
  },
  "connection.missingInput": {
    ko: "그 노드에는 '{port}' 받는 자리가 없어요 — 노드에 보이는 받는 자리에 이어 보세요",
    en: "That node has no '{port}' spot to receive — join to a receiving spot you can see on it",
  },
  "connection.missingOutput": {
    ko: "그 노드에는 '{port}' 내보내는 자리가 없어요 — 노드에 보이는 내보내는 자리에서 끌어 보세요",
    en: "That node has no '{port}' spot to send from — drag from a sending spot you can see on it",
  },
  "connection.typeMismatch": {
    ko: "'{source}'에서 나가는 것({sourceWord})과 '{target}'에 들어가는 것({targetWord})의 종류가 달라요 — 종류가 같은 자리끼리 이어 보세요",
    en: "'{source}' sends out {sourceWord} but '{target}' takes {targetWord} — join spots that carry the same kind of value",
  },
  // 종류에 쉬운 이름이 없을 때(여러 종류를 겹친 값 등)는 이름 없이 다르다고만 말한다.
  "connection.typeMismatch.unnamed": {
    ko: "'{source}'에서 나가는 것과 '{target}'에 들어가는 것의 종류가 달라요 — 종류가 같은 자리끼리 이어 보세요",
    en: "'{source}' and '{target}' carry different kinds of value — join spots that carry the same kind of value",
  },
  "connection.duplicate": {
    ko: "'{source}'에서 '{target}'에 이미 이어 두었어요 — 다른 자리에 이어 보세요",
    en: "'{source}' is already joined to '{target}' — join a different spot",
  },
  "connection.cycle": {
    ko: "이렇게 이으면 흐름이 왔던 곳으로 되돌아가 끝나지 않아요 — 흐름이 나아가는 쪽에 이어 보세요",
    en: "This would send the flow back where it came from and it would never end — join it further along the flow",
  },
  "connection.nowhere": {
    ko: "'{port}'에서 갈 수 있는 자리가 아직 없어요 — 빈 곳에 놓으면 이을 수 있는 노드를 골라 드릴게요",
    en: "There is nowhere for '{port}' to go yet — drop it on an empty spot and we will offer the nodes that fit",
  },
  "connection.refused": {
    ko: "이 둘은 이을 수 없어요 — 다른 자리에 이어 보세요",
    en: "These two cannot be joined — join a different spot",
  },

  // 안내 톤으로 같은 카드가 건네는 초대 — 아직 아무것도 이어 보지 않은 사람에게 한 번 (DESIGN §7).
  "hint.firstLink": {
    ko: "가장자리 점을 끌어 다음 단계를 이어요 — 이을 수 있는 것만 보여 드려요",
    en: "Drag a dot on the edge to link the next step — only what fits will show",
  },

  // 시험해 보기 (Evaluate 모드, DESIGN §7 eval-panel)
  "eval.panel.label": { ko: "시험해 보기", en: "Try some tests" },
  "eval.panel.title": { ko: "시험해 보기", en: "Try some tests" },
  "eval.dataset.picker": { ko: "시험 묶음 고르기", en: "Choose a test set" },
  "eval.dataset.default": { ko: "이 문서의 시험", en: "This document's tests" },
  "eval.dataset.unsaved": { ko: "아직 저장하지 않은 시험", en: "Tests not saved yet" },
  "eval.dataset.shared": { ko: "공유 시험 묶음", en: "Shared test set" },
  "eval.dataset.count": { ko: "{count}개 시험", en: "{count} tests" },
  "eval.dataset.loading": { ko: "시험 묶음 목록을 불러오는 중이에요", en: "Loading test sets" },
  "eval.dataset.empty": { ko: "아직 고를 시험 묶음이 없어요", en: "There are no test sets to choose from" },
  "eval.dataset.offline": { ko: "시험 묶음 목록을 불러오지 못했어요 — 서버에 닿지 못했어요", en: "Could not reach the server for test sets" },
  "eval.dataset.failed": { ko: "시험 묶음 목록을 읽지 못했어요 — 잠시 뒤 다시 해보세요", en: "Could not read test sets — try again shortly" },
  "eval.dataset.detailFailed": { ko: "시험 묶음을 열지 못했어요 — 기본 시험으로 돌아갔어요", en: "Could not open that test set — returned to the default" },
  "eval.dataset.notFound": { ko: "선택한 시험 묶음을 찾지 못했어요 — 지금 시험은 그대로예요", en: "That test set was not found — your current tests are unchanged" },
  "eval.dataset.detach": { ko: "이 문서의 시험으로 돌아가기", en: "Return to this document's tests" },
  "eval.dataset.rename": { ko: "이름 바꾸기", en: "Rename" },
  "eval.dataset.rename.save": { ko: "이름 저장", en: "Save name" },
  "eval.dataset.rename.cancel": { ko: "취소", en: "Cancel" },
  "eval.dataset.blocked": { ko: "먼저 시험 초안을 저장하거나 닫아 주세요", en: "Save or close the test draft first" },
  "eval.advanced.label": { ko: "시험 상세 보기", en: "Test details" },
  "eval.advanced.show": { ko: "자세히 보기", en: "Show details" },
  "eval.advanced.hide": { ko: "간단히 보기", en: "Hide details" },
  "eval.attempts.label": { ko: "회차별 결과", en: "Results by attempt" },
  "eval.attempts.round": { ko: "회차 {round}", en: "Attempt {round}" },
  "eval.attempts.passed": { ko: "통과", en: "Passed" },
  "eval.attempts.failed": { ko: "실패", en: "Failed" },
  "eval.history.label": { ko: "지난 시험 실행", en: "Past test runs" },
  "eval.history.title": { ko: "지난 시험 실행", en: "Past test runs" },
  "eval.history.loading": { ko: "지난 실행을 불러오는 중이에요", en: "Loading past runs" },
  "eval.history.empty": { ko: "아직 지난 실행이 없어요", en: "There are no past runs yet" },
  "eval.history.more": { ko: "더 지난 실행이 있어요", en: "There are more past runs" },
  "eval.history.count": { ko: "{total}개 중 {passed}개 통과했어요", en: "{passed} of {total} passed" },
  "eval.history.offline": { ko: "지난 실행을 불러오지 못했어요 — 서버에 닿지 못했어요", en: "Could not reach the server for past runs" },
  "eval.history.strange": { ko: "지난 실행을 읽지 못했어요 — 잠시 뒤 다시 해보세요", en: "Could not read past runs — try again shortly" },
  "eval.history.selectionFailed": { ko: "그 실행을 열지 못했어요 — 다른 실행을 골라 보세요", en: "Could not open that run — choose another" },
  "eval.compare.pick": { ko: "비교", en: "Compare" },
  "eval.compare.picked": { ko: "비교 {at}/2", en: "Compare {at}/2" },
  "eval.compare.title": { ko: "두 시험 결과 견주기", en: "Compare two test results" },
  "eval.compare.close": { ko: "시험 결과 견주기 닫기", en: "Close test comparison" },
  "eval.compare.loading": { ko: "시험 결과를 불러오는 중이에요", en: "Loading test results" },
  "eval.compare.failed": { ko: "시험 결과를 읽지 못했어요 — 잠시 뒤 다시 해보세요", en: "Could not read test results — try again shortly" },
  "eval.compare.missing": { ko: "이 시험의 결과가 없어요", en: "This test has no result" },
  "eval.compare.result.passed": { ko: "통과", en: "Passed" },
  "eval.compare.result.failed": { ko: "실패", en: "Failed" },
  "eval.compare.same": { ko: "두 시험 결과가 똑같아요", en: "These two test results are the same" },
  "eval.compare.divergence": { ko: "{at}번째 시험부터 달라져요", en: "They differ from test {at}" },
  "eval.compare.column": { ko: "비교 열 {at}", en: "Comparison column {at}" },
  "eval.run.all": { ko: "전부 실행해 보기", en: "Run them all" },
  "eval.run.all.hint": {
    ko: "모든 케이스를 지금 그래프로 한 번에 돌려 본다",
    en: "Runs every case against this graph, all at once",
  },
  "eval.run.all.blocked.running": {
    ko: "지금 돌려 보는 중이에요",
    en: "Already running these now",
  },
  "eval.run.all.blocked.unsaved": {
    ko: "먼저 저장해야 돌려 볼 수 있어요",
    en: "Save it first, then you can run it",
  },
  "eval.run.all.blocked.empty": {
    ko: "돌려 볼 케이스가 아직 없어요",
    en: "There are no cases to run yet",
  },
  "eval.empty.invite": {
    ko: "무엇을 넣으면 무슨 말이 나와야 하는지 하나 적어 봐요",
    en: "Write down what you put in and what should come back",
  },
  "eval.empty.cta": { ko: "첫 시험 만들기", en: "Make your first test" },
  "eval.case.add": { ko: "새 시험 만들기", en: "Make another test" },
  "eval.case.promoted.title": { ko: "실패한 실행에서 시작", en: "Started from a failed run" },
  "eval.case.result.failed.count": {
    ko: "{runs}번 중 {passed}번만 통과",
    en: "Only {passed} of {runs} runs passed",
  },
  "eval.case.result.failed.next": {
    ko: "기대한 말이 답에 없었어요 — 카드를 눌러 무엇이 나왔는지 봐요",
    en: "The answer did not have what we expected — open the card to see what came back",
  },
  // 펼친 카드의 결과 토막 — 마지막 회차의 실제 답 (DESIGN §7 eval-case-card 갱신본).
  "eval.case.result.label": { ko: "실제로 나온 답", en: "What actually came back" },
  "eval.case.result.empty": { ko: "답이 없었어요", en: "There was no answer" },
  // 여러 번 돌린 케이스는 어느 회차의 답을 보고 있는지 말한다 (DESIGN §7 eval-case-card).
  "eval.case.result.round": { ko: "{round}번째 돌림의 답", en: "The answer from run {round}" },
  // 빠진 말 토막 — 실패한 케이스가 무엇을 놓쳤는지 (DESIGN §7 eval-case-card).
  "eval.case.missing.label": { ko: "답에 없던 말", en: "Words the answer was missing" },
  "eval.case.missing.none": {
    ko: "어느 말이 빠졌는지 찾지 못했어요 — '자세히 보기'를 켜면 회차마다 무엇이 나왔는지 볼 수 있어요",
    en: "We could not tell which words were missing — turn on 'Show details' to see what came back each run",
  },
  // 뜻으로 구제된 통과 한 줄 — 판정기 원명·점수 없이 무슨 일이 있었는지만 말한다 (DESIGN §7 eval-case-card).
  "eval.case.rescued": {
    ko: "글자는 달랐지만 뜻이 같아 통과했어요",
    en: "The words were different, but the meaning matched, so it passed",
  },
  // 주의 신호 한 줄 — 통과했어도 회차마다 답이 갈렸다는 관찰이다 (DESIGN §7 eval-case-card).
  // 판정이 아니므로 '틀렸다'고 말하지 않는다: 본 것만 말한다.
  "eval.case.spread": {
    ko: "{rounds}번 중 답이 {answers}가지로 갈렸어요",
    en: "Across {rounds} runs the answer came back {answers} different ways",
  },
  // 지금 시험받는 지시문 (DESIGN §7 eval-prompt-card).
  "eval.prompt.label": { ko: "지금 시험하는 지시문", en: "The instructions being tested" },
  "eval.prompt.empty": {
    ko: "아직 지시문이 없어요 — 눌러서 적어요",
    en: "No instructions yet — click here to write them",
  },
  "eval.prompt.hint": {
    ko: "눌러서 이 지시문을 고쳐요",
    en: "Click to edit these instructions",
  },
  "eval.prompt.card.label": {
    ko: "{name} 단계의 지시문 고치기",
    en: "Edit the instructions for the {name} step",
  },
  // AI가 시험을 지어 준다 (DESIGN §7 eval-suggest-card, EVAL-2). 담기 전에는 아무것도 저장되지 않는다.
  "eval.suggest.label": { ko: "시험을 지어 드릴까요", en: "Shall we write some tests for you?" },
  "eval.suggest.count.label": { ko: "몇 개 지어 볼까요", en: "How many should we write?" },
  "eval.suggest.count.range": {
    ko: "한 번에 {min}개부터 {max}개까지 지어 드릴 수 있어요",
    en: "We can write between {min} and {max} tests at a time",
  },
  "eval.suggest.edge.label": { ko: "까다로운 경우도 섞기", en: "Mix in tricky cases" },
  "eval.suggest.ask": { ko: "지어 줘", en: "Write them" },
  "eval.suggest.asking": { ko: "지어 보는 중이에요", en: "Writing them now" },
  "eval.suggest.blocked.noPrompts": {
    ko: "지시문이 있어야 지어 줄 수 있어요 — 단계에 무엇을 하라고 적어 주세요",
    en: "We need instructions before we can write tests — tell a step what to do first",
  },
  "eval.suggest.blocked.asking": { ko: "지금 지어 보는 중이에요", en: "Already writing them now" },
  "eval.suggest.made": {
    ko: "{asked}개 중 {made}개를 지었어요 — 담을 것만 골라요",
    en: "We wrote {made} of {asked} — pick the ones to keep",
  },
  "eval.suggest.failed": {
    ko: "시험을 지어 오지 못했어요 — 잠시 뒤 다시 해보세요",
    en: "We could not write the tests — try again in a moment",
  },
  "eval.suggest.offline": {
    ko: "시험을 지어 줄 곳에 닿지 못했어요 — 서버가 켜져 있는지 확인해 주세요",
    en: "Could not reach the server that writes tests — check that it is running",
  },
  "eval.suggest.card.summary": {
    ko: "넣을 값: {given} → 있어야 할 말: {expected}",
    en: "Put in: {given} → must contain: {expected}",
  },
  "eval.suggest.card.summary.noInput": {
    ko: "넣을 값 없음 → 있어야 할 말: {expected}",
    en: "Nothing to put in → must contain: {expected}",
  },
  "eval.suggest.card.label": { ko: "이 시험 담기 — {title}", en: "Keep this test — {title}" },
  "eval.suggest.keep": { ko: "고른 것 담기", en: "Keep the ones I picked" },
  "eval.suggest.keep.blocked": {
    ko: "담을 시험을 먼저 골라 주세요",
    en: "Pick at least one test to keep",
  },
  "eval.suggest.discard": { ko: "지은 것 버리기", en: "Throw these away" },
  "eval.case.delete": { ko: "이 시험 지우기", en: "Delete this test" },
  "eval.case.delete.hint": {
    ko: "확인 없이 바로 지운다 — 되돌리기로 되살릴 수 있다",
    en: "Deletes it right away — press Undo to bring it back",
  },
  // Cmd+Z(전체 되돌리기)가 아니라 이 자리의 인라인 되돌리기다 — 카드 있던 그 자리에서 한 줄로 말한다
  // (DESIGN §7 eval-case-card 갱신본). 말은 이 문구 + 되돌리기 액션 버튼이 이어져 한 줄이 된다.
  "eval.case.delete.restore": { ko: "지웠어요 —", en: "Deleted —" },
  "eval.case.delete.restore.action": { ko: "되돌리기", en: "Undo" },
  "eval.case.form.title.label": { ko: "제목", en: "Title" },
  "eval.case.form.expected.label": { ko: "들어있어야 하는 말", en: "What the answer must contain" },
  "eval.case.form.expected.hint": {
    ko: "답에 꼭 들어있어야 하는 말을 줄마다 하나씩 적어요",
    en: "Write what the answer must contain, one per line",
  },
  "eval.case.form.runs.label": { ko: "몇 번 돌려볼까요", en: "How many times to run it" },
  "eval.case.form.passes.label": {
    ko: "몇 번 통과해야 합격일까요",
    en: "How many of those must pass",
  },
  "eval.case.form.passes.exceeds": {
    ko: "통과해야 할 횟수가 돌리는 횟수보다 많을 수 없어요",
    en: "Passes needed cannot be more than the number of runs",
  },
  "eval.case.form.count.tooLow": {
    ko: "횟수는 최소 1번이어야 해요",
    en: "Both counts must be at least 1",
  },
  "eval.case.form.save": { ko: "저장", en: "Save" },
  "eval.summary.allPassed": {
    ko: "{total}개 중 {total}개 통과했어요",
    en: "{total} of {total} passed",
  },
  "eval.summary.someFailed": {
    ko: "{failed}개가 아직 못 갔어요",
    en: "{failed} have not passed yet",
  },
  // 서버가 부분 진행을 주지 않는다(all-or-nothing) — 개수를 보여주면 거짓 정밀도가 된다.
  "eval.summary.running": {
    ko: "확인하는 중이에요",
    en: "Checking",
  },
  "eval.summary.none": { ko: "아직 돌려 보지 않았어요", en: "Not run yet" },
  "eval.batch.failed": {
    ko: "돌리다가 문제가 생겼어요 — 다시 시도해 보세요",
    en: "Something went wrong while running — try it again",
  },
  "eval.offline": {
    ko: "서버에 닿지 못했어요 — 잠시 뒤 다시 열어 보세요",
    en: "Could not reach the server — try opening it again in a moment",
  },
  "eval.strange": {
    ko: "서버가 알 수 없는 답을 보냈어요",
    en: "The server sent an answer we cannot read",
  },
  "eval.save.offline": {
    ko: "서버에 닿지 못해 저장하지 못했어요 — 고친 내용은 화면에 그대로 있어요",
    en: "Could not reach the server, so it did not save — your work is still here",
  },
  "eval.save.strange": {
    ko: "서버가 알 수 없는 답을 보냈어요 — 잠시 뒤 다시 저장해 보세요",
    en: "The server sent an answer we cannot read — try saving again in a moment",
  },
  "eval.save.failed": {
    ko: "저장하지 못했어요: {reason}",
    en: "Could not save it: {reason}",
  },
  "eval.run.offline": {
    ko: "서버에 닿지 못해 실행할 수 없어요 — 서버가 켜져 있는지 보고 다시 눌러 주세요",
    en: "Could not reach the server, so nothing ran — check the server is up and press it again",
  },
  "eval.run.notSaved": {
    ko: "서버에 이 시험 묶음이나 그래프가 없어요 — 저장한 뒤에 실행할 수 있어요",
    en: "The server does not have this test set or graph — save it first and you can run it",
  },
  "eval.run.moved": {
    ko: "저장된 그래프가 그 사이 달라졌어요 — 다시 저장한 뒤 실행해 주세요",
    en: "The saved graph has changed since — save it again and then run it",
  },
  "eval.run.strange": {
    ko: "서버가 알 수 없는 답을 보냈어요 — 잠시 뒤 다시 실행해 주세요",
    en: "The server sent an answer we cannot read — try running it again in a moment",
  },
  "eval.run.failed": {
    ko: "실행하지 못했어요: {reason}",
    en: "Could not run it: {reason}",
  },
  "eval.poll.offline": {
    ko: "서버에 닿지 못해 소식을 듣지 못했어요",
    en: "Could not reach the server to hear how it is going",
  },
  "eval.poll.strange": {
    ko: "서버가 알 수 없는 답을 보냈어요",
    en: "The server sent an answer we cannot read",
  },
} satisfies Record<string, Record<Locale, string>>;

export type MessageKey = keyof typeof TEXTS;

export const MESSAGES: Record<MessageKey, Record<Locale, string>> = TEXTS;

export function msg(key: MessageKey, params?: MessageParams): Message {
  return params ? { key, params } : { key };
}

/** 세는 말은 하나일 때와 여럿일 때의 말끝이 다르다 (영어). 세어 보고 알맞은 키를 고른다. */
export function counted<Base extends string>(
  base: Base,
  count: number,
): `${Base}.one` | `${Base}.many` {
  return count === 1 ? `${base}.one` : `${base}.many`;
}

function filled(param: MessageParam, locale: Locale): string {
  if (Array.isArray(param)) {
    return param.map((item) => translate(locale, item)).join(", ");
  }
  if (typeof param === "object") {
    return "key" in param ? translate(locale, param) : param[locale];
  }
  return String(param);
}

/** 메시지 하나를 그 언어의 한 문장으로. 채우지 못한 빈칸은 지우지 않고 그대로 남긴다. */
export function translate(locale: Locale, message: Message): string {
  const params = message.params ?? {};
  return MESSAGES[message.key][locale].replace(/\{(\w+)\}/g, (blank, name: string) =>
    name in params ? filled(params[name], locale) : blank,
  );
}
