// 오른쪽 클릭 메뉴에 서는 항목들 (DESIGN §7 context-menu) — 대상 종류 → 항목 표.
// 새 조작은 없다: 항목은 모두 이미 있는 store 행동을 부른다(더블클릭·Delete·inspector 버튼과 같은 함수).
import { type Message, type MessageKey, msg } from "../i18n/messages";
import type { ContextMenuRequest, ContextTarget } from "../store/contextMenuSlice";
import type { EditorState } from "../store/editor";

/** 항목이 일할 때 손에 쥐는 것 — 지금의 편집 상태와, 설정으로 데려가는 길. */
export interface ContextMenuTarget {
  editor: EditorState;
  focusInspector: () => void;
}

/** 항목의 말과 잠금이 보는 것 — 화면은 이만큼만 구독하면 표가 낡지 않는다. */
export interface MenuFacts {
  running: boolean;
  breakpoints: string[];
}

export interface ContextMenuItem {
  key: MessageKey;
  run: (target: ContextMenuTarget) => void;
  /** 지금 누를 수 없는 까닭 — 누를 수 있으면 null */
  disabled: Message | null;
}

type ItemsFor<T extends ContextTarget> = (
  target: T,
  request: ContextMenuRequest,
  facts: MenuFacts,
) => ContextMenuItem[];

/** 실행을 보는 동안 그래프는 잠긴다 — 잠근 자리는 그 까닭을 말한다. */
function lockedWhileRunning(facts: MenuFacts): Message | null {
  return facts.running ? msg("run.locked") : null;
}

const ITEMS: { [K in ContextTarget["kind"]]: ItemsFor<Extract<ContextTarget, { kind: K }>> } =
  {
    pane: (_target, request, facts) => [
      {
        key: "context.addHere",
        run: ({ editor }) =>
          editor.openPicker({ at: request.at, screen: request.screen, from: null }),
        disabled: lockedWhileRunning(facts),
      },
      {
        key: "context.fitAll",
        run: ({ editor }) => editor.fitAll(),
        disabled: null,
      },
      {
        key: "doc.arrange",
        run: ({ editor }) => editor.arrangeNodes(),
        disabled: lockedWhileRunning(facts),
      },
    ],

    node: (target, _request, facts) => [
      {
        key: "context.openSettings",
        run: ({ editor, focusInspector }) => {
          editor.select("node", target.id);
          focusInspector();
        },
        disabled: null,
      },
      {
        key: facts.breakpoints.includes(target.id)
          ? "context.breakpoint.clear"
          : "breakpoint.toggle",
        run: ({ editor }) => editor.toggleBreakpoint(target.id),
        disabled: null,
      },
      {
        key: "context.detach",
        run: ({ editor }) => editor.requestDetach(target.id),
        disabled: lockedWhileRunning(facts),
      },
    ],

    edge: (target, _request, facts) => [
      {
        key: "context.editCondition",
        run: ({ editor, focusInspector }) => {
          editor.select("edge", target.id);
          focusInspector();
        },
        disabled: null,
      },
      {
        key: "context.removeEdge",
        run: ({ editor }) => {
          editor.select("edge", target.id);
          editor.deleteSelection();
        },
        disabled: lockedWhileRunning(facts),
      },
    ],
  };

export function contextMenuItems(
  request: ContextMenuRequest,
  facts: MenuFacts,
): ContextMenuItem[] {
  const target = request.target;
  // 표에서 꺼낸 함수와 대상은 같은 kind에서 왔다 — 그 짝을 타입 표기로만 다시 말해 준다.
  const items = ITEMS[target.kind] as ItemsFor<typeof target>;
  return items(target, request, facts);
}
