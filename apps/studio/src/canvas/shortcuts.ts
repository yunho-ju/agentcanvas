// 키 -> 편집 동작 매핑 표. 새 단축키는 표에 한 줄을 더한다.
import type { EditorState } from "../store/editor";

export interface ShortcutTarget {
  editor: EditorState;
  /** 설정 패널로 초점을 옮긴다 */
  focusInspector: () => void;
  /** 독에서 펼쳐 놓은 패널을 접는다 */
  closePanel: () => void;
  /** 지금 글자를 치고 있던 칸에서 손을 뗀다 */
  blurField: () => void;
}

type ShortcutAction = (target: ShortcutTarget) => void;

/** 눌린 키를 표에서 찾을 이름으로 바꾼다. 예: Cmd+Shift+Z -> "mod+shift+z" */
export function shortcutName(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): string {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  return [event.metaKey || event.ctrlKey ? "mod" : "", event.shiftKey ? "shift" : "", key]
    .filter((part) => part !== "")
    .join("+");
}

/** 글자를 입력하는 중인가 — 입력 상자 안에서는 캔버스가 키를 가져가지 않는다. */
export function isEditingElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable
  );
}

const INTERACTIVE = "button, a, input, textarea, select, [contenteditable='true']";

/**
 * 그 영역 자체에 초점이 있는가.
 * 버튼·입력 상자 같은 요소가 초점을 가졌다면 그 키는 그 요소의 것이다 — 우리가 가로채지 않는다.
 */
function focusedWithin(target: EventTarget | null, area: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest(INTERACTIVE)) return false;
  return target.closest(area) !== null;
}

export function isCanvasFocused(target: EventTarget | null): boolean {
  return focusedWithin(target, '[role="application"]');
}

/** 승인 카드의 폼 칸에 손이 있는가 — 그 칸의 Esc는 손을 떼는 일이다 (DESIGN §7). */
export function isGateFieldFocused(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isEditingElement(target) && target.closest(".gate-card__form") !== null;
}

/** 실행에 넣을 값을 적는 칸에 손이 있는가 — 그 칸의 Esc는 손을 떼는 일이다 (DESIGN §7). */
export function isRunInputFieldFocused(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isEditingElement(target) && target.closest(".run-input-card__form") !== null;
}

/** 붙여 넣는 칸에 손이 있는가 — 그 칸의 Esc는 손을 떼는 일이다 (DESIGN §7 tool-wrap-card). */
export function isToolWrapFieldFocused(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isEditingElement(target) && target.closest(".tool-wrap-card") !== null;
}

/** 대화에서 할 말을 적는 칸에 손이 있는가 — 그 칸의 Esc는 손을 떼는 일이다 (DESIGN §7 chat-panel). */
export function isChatFieldFocused(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isEditingElement(target) && target.closest(".chat-panel") !== null;
}

/** 빼기 전 경고 자체에 초점이 있는가 — 그 안의 버튼은 자기 키를 스스로 받는다. */
export function isPreviewFocused(target: EventTarget | null): boolean {
  return focusedWithin(target, '[role="alertdialog"]');
}

/** 저장 키 — 이 키만은 어느 자리에서도 앱이 받는다. */
const SAVE_KEY = "mod+s";

const SHORTCUTS: Record<string, ShortcutAction> = {
  "mod+z": ({ editor }) => editor.undo(),
  [SAVE_KEY]: ({ editor }) => void editor.saveSpec(),
  "mod+shift+z": ({ editor }) => editor.redo(),
  ArrowDown: ({ editor }) => editor.selectAdjacentNode(1),
  ArrowRight: ({ editor }) => editor.selectAdjacentNode(1),
  ArrowUp: ({ editor }) => editor.selectAdjacentNode(-1),
  ArrowLeft: ({ editor }) => editor.selectAdjacentNode(-1),
  Tab: ({ editor }) => editor.selectAdjacentNode(1),
  "shift+Tab": ({ editor }) => editor.selectAdjacentNode(-1),
  Delete: ({ editor }) => editor.deleteSelection(),
  Backspace: ({ editor }) => editor.deleteSelection(),
  Enter: ({ focusInspector }) => focusInspector(),
  // 보고 싶은 것으로 데려가는 두 키 (Figma 관례).
  "shift+1": ({ editor }) => editor.fitAll(),
  "shift+2": ({ editor }) => editor.fitSelection(),
};

/**
 * 실행을 보는 동안 캔버스의 키는 시간을 다룬다 — 그래프는 잠겨 있으므로 편집 키는 듣지 않는다.
 */
const RUN_SHORTCUTS: Record<string, ShortcutAction> = {
  " ": ({ editor }) => (editor.isPlaying ? editor.pauseRun() : editor.playRun()),
  ArrowRight: ({ editor }) => editor.stepRun(1),
  ArrowLeft: ({ editor }) => editor.stepRun(-1),
};

/**
 * 무엇이 망가지는지 보여주는 동안에는 키가 그 물음에만 답한다 — 예/아니오 둘 뿐이다.
 * "아니오"(Esc)는 물러나는 순서의 한 걸음이므로 ESCAPE_CHAIN이 맡는다.
 */
const PREVIEW_SHORTCUTS: Record<string, ShortcutAction> = {
  Enter: ({ editor }) => editor.confirmDetach(),
};

/** 되돌리기와 저장은 앱 어디서나 듣는다. 나머지는 캔버스에 초점이 있을 때만이다. */
const ANYWHERE = new Set(["mod+z", "mod+shift+z", SAVE_KEY]);

/** 글자를 치는 중에도 듣는 키 — 저장은 어디서 눌러도 저장이다. */
const WHILE_TYPING = new Set([SAVE_KEY]);

/** Tab은 노드가 이미 선택돼 있을 때만 가로챈다 — 그렇지 않으면 캔버스를 떠날 수 없다. */
const NEEDS_SELECTION = new Set(["Tab", "shift+Tab"]);

/** 지금 화면에 무엇이 열려 있고 손이 어디에 있는가 — 키가 어디로 갈지는 이것으로 정해진다. */
export interface ShortcutContext {
  onCanvas: boolean;
  editing: boolean;
  hasSelection: boolean;
  /** 무엇이 망가지는지 보여주고 사용자의 답을 기다리는 중인가 */
  previewing: boolean;
  /** 그 경고 자체에 초점이 있는가 */
  onPreview: boolean;
  /** 실행을 재생해 보는 중인가 */
  running: boolean;
  /** 독에서 펼쳐 놓은 패널이 있는가 */
  panelOpen: boolean;
  /** 두 실행을 나란히 놓고 보는 중인가 */
  comparing: boolean;
  /** 노드를 고르는 피커가 열려 있는가 */
  pickerOpen: boolean;
  /** 문서 카드 위의 팝오버(문서 메뉴·판 기록)가 떠 있는가 */
  docPopoverOpen: boolean;
  /** 실행에 넣을 값을 묻는 카드가 사람에게 묻고 있는가 */
  runInputAsking: boolean;
  /** 손이 그 카드의 칸 안에 있는가 */
  onRunInputField: boolean;
  /** 밸브 앞 카드가 사람에게 묻고 있는가 */
  gateAsking: boolean;
  /** 그 물음이 "정말 거절할까요"인가 */
  gateConfirming: boolean;
  /** 손이 그 카드의 승인 폼 칸 안에 있는가 */
  onGateField: boolean;
  /** 서버에 저장해 둔 문서 목록이 떠 있는가 */
  docListOpen: boolean;
  /** 그 목록이 "아직 저장하지 않은 작업이 있어요"라고 되묻고 있는가 */
  askingBeforeOpen: boolean;
  /** 파일을 열기 전에 저장하지 않은 작업을 확인하고 있는가 */
  fileOpenAsking: boolean;
  /** 붙여 넣은 것을 연결로 바꾸는 카드가 떠 있는가 */
  toolWrapOpen: boolean;
  /** 손이 그 카드의 붙여 넣는 칸 안에 있는가 */
  onToolWrapField: boolean;
  /** 대화 패널이 열려 있는가 */
  chatOpen: boolean;
  /** 손이 대화에서 할 말을 적는 칸 안에 있는가 */
  onChatField: boolean;
  /** 대화를 정말 지울지 되묻는 중인가 */
  chatDeleteAsking: boolean;
  /** 기다리는 말이 있는데 지난 대화를 열지 되묻는 중인가 */
  chatSwitchAsking: boolean;
  /** 대화 안의 확인 카드가 사람에게 묻고 있는가 */
  chatGateAsking: boolean;
  /** 그 물음이 "정말 거절할까요"인가 */
  chatGateConfirming: boolean;
}

/** 물러나는 한 걸음 — 이 자리에 있으면(when) 이 일을 한다(step). */
interface RetreatStep {
  when: (context: ShortcutContext) => boolean;
  step: ShortcutAction;
}

/**
 * Esc가 물러나는 순서 (DESIGN §1). 위에서부터 처음 해당하는 **한 걸음만** 한다 —
 * 한 번의 Esc가 두 가지를 닫지 않는다. 새 단계는 이 표에 한 줄을 더한다.
 */
const ESCAPE_CHAIN: RetreatStep[] = [
  { when: (it) => it.pickerOpen, step: ({ editor }) => editor.closePicker() },
  // 문서 메뉴·판 기록도 잠깐 뜬 팝오버다 — 맨 위에 떠 있으므로 가장 먼저 물러난다
  // (DESIGN §1 팝오버 예외, §7 doc-card).
  { when: (it) => it.docPopoverOpen, step: ({ editor }) => editor.closeDocPopover() },
  { when: (it) => it.previewing, step: ({ editor }) => editor.cancelDetach() },
  { when: (it) => it.gateConfirming, step: ({ editor }) => editor.cancelReject() },
  { when: (it) => it.chatDeleteAsking, step: ({ editor }) => editor.cancelDeleteChat() },
  {
    when: (it) => it.chatSwitchAsking,
    step: ({ editor }) => editor.cancelSwitchPastChat(),
  },
  {
    when: (it) => it.chatGateConfirming,
    step: ({ editor }) => editor.cancelChatRejectGate(),
  },
  { when: (it) => it.askingBeforeOpen, step: ({ editor }) => editor.cancelOpening() },
  { when: (it) => it.fileOpenAsking, step: ({ editor }) => editor.cancelFileOpen() },
  // 실행에 넣을 값을 적던 칸에 손이 있으면 그 손만 뗀다 (DESIGN §7 run-input-card).
  { when: (it) => it.onRunInputField, step: ({ blurField }) => blurField() },
  // 실행 입력 카드는 되묻는 물음 다음, 밸브 카드보다 먼저 물러난다 (DESIGN §1 ①′).
  { when: (it) => it.runInputAsking, step: ({ editor }) => editor.closeRunInput() },
  // 폼 칸에 손이 있으면 그 손만 뗀다 — 카드는 그대로 서 있다 (DESIGN §7 승인 폼).
  { when: (it) => it.onGateField, step: ({ blurField }) => blurField() },
  { when: (it) => it.gateAsking, step: ({ editor }) => editor.setGateCardOpen(false) },
  // 대화 안의 확인 카드도 실행 화면의 것과 같은 자리에서 물러난다 — 멈춘 채로 두고 닫는다.
  {
    when: (it) => it.chatGateAsking,
    step: ({ editor }) => editor.setChatGateCardOpen(false),
  },
  { when: (it) => it.docListOpen, step: ({ editor }) => editor.closeDocList() },
  // 적던 말에 손이 있으면 그 손만 뗀다 — 긴 말을 한 번의 Esc로 잃지 않는다.
  { when: (it) => it.onChatField, step: ({ blurField }) => blurField() },
  // 대화 패널은 문서 목록 다음, 독 패널보다 먼저 물러난다 (DESIGN §1 ③′).
  { when: (it) => it.chatOpen, step: ({ editor }) => editor.leaveChatMode() },
  // 붙여 넣던 칸에 손이 있으면 그 손만 뗀다 — 긴 붙여넣기를 한 번의 Esc로 잃지 않는다.
  { when: (it) => it.onToolWrapField, step: ({ blurField }) => blurField() },
  { when: (it) => it.toolWrapOpen, step: ({ editor }) => editor.closeToolWrap() },
  { when: (it) => it.panelOpen, step: ({ closePanel }) => closePanel() },
  { when: (it) => it.comparing, step: ({ editor }) => editor.clearCompare() },
  { when: (it) => it.running, step: ({ editor }) => editor.stopRun() },
  { when: (it) => it.hasSelection, step: ({ editor }) => editor.clearSelection() },
];

export function findShortcut(
  name: string,
  context: ShortcutContext,
): ShortcutAction | undefined {
  // 글자를 치는 중이면 모든 키는 그 입력 상자의 것이다 (되돌리기도 마찬가지다).
  // 예외 셋 (DESIGN §1·§7): 저장은 어디서든 저장이고, 잠깐 뜬 팝오버(노드 피커·문서 메뉴·판 기록)의
  // Esc는 글자를 치는 중에도 그 팝오버의 것이며, 값을 적는 칸(승인 폼·실행 입력)의 Esc는
  // 그 칸에서 손을 떼는 일이다.
  const typingException =
    WHILE_TYPING.has(name) ||
    (name === "Escape" &&
      (context.pickerOpen ||
        context.docPopoverOpen ||
        context.onGateField ||
        context.onRunInputField ||
        context.onToolWrapField ||
        context.onChatField));
  if (context.editing && !typingException) return undefined;
  // Esc는 언제나 체인이 답한다 — 손이 어디에 있든 물러나는 순서는 같다.
  if (name === "Escape") return ESCAPE_CHAIN.find((retreat) => retreat.when(context))?.step;
  // 저장도 언제나 앱의 것이다 — 지금 저장할 수 없는 자리라도 브라우저 대화상자를 열게 두지 않는다
  // (저장할 수 없는 까닭은 saveSpec이 말한다 — DESIGN §7).
  if (name === SAVE_KEY) return SHORTCUTS[SAVE_KEY];
  // 답을 기다리는 동안 캔버스와 경고는 "예"만 더 듣는다. 경고 안의 버튼은 자기 키를 스스로 받는다.
  if (context.previewing) {
    return context.onCanvas || context.onPreview ? PREVIEW_SHORTCUTS[name] : undefined;
  }
  // 실행을 보는 동안 캔버스의 키는 시간만 다룬다.
  if (context.running) return context.onCanvas ? RUN_SHORTCUTS[name] : undefined;
  if (!context.onCanvas && !ANYWHERE.has(name)) return undefined;
  if (NEEDS_SELECTION.has(name) && !context.hasSelection) return undefined;
  return SHORTCUTS[name];
}
