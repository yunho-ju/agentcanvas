// 캔버스에서 오른쪽 클릭한 순간 — 무엇 위에서, 어디에서 열렸는가 (DESIGN §7 context-menu).
// 열림 상태를 컴포넌트가 아니라 여기에 두는 까닭: Esc가 물러나는 순서(DESIGN §1)가 이것을 봐야 한다.
import type { StateCreator } from "zustand";
import type { Position } from "../history/graphCommands";
import type { EditorState } from "./editor";

/** 메뉴가 말하는 대상 — 빈 곳이거나, 그 노드거나, 그 선이다. */
export type ContextTarget =
  | { kind: "pane" }
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string };

export interface ContextMenuRequest {
  target: ContextTarget;
  /** 메뉴가 뜰 화면 위의 자리 */
  screen: Position;
  /** 그 지점이 가리키는 캔버스 좌표 — 새 노드는 여기에 놓인다 */
  at: Position;
}

export interface ContextMenuSlice {
  contextMenu: ContextMenuRequest | null;
  openContextMenu: (request: ContextMenuRequest) => void;
  closeContextMenu: () => void;
}

export const createContextMenuSlice: StateCreator<
  EditorState,
  [],
  [],
  ContextMenuSlice
> = (set, get) => ({
  contextMenu: null,

  openContextMenu: (request) => {
    // 잠깐 뜨는 것은 한 번에 하나다 (DESIGN §7 context-menu 닫힘).
    get().closePicker();
    get().closeDocPopover();
    // 메뉴가 말하는 대상은 화면에서도 강조돼 있어야 한다.
    if (request.target.kind !== "pane") {
      get().select(request.target.kind, request.target.id);
    }
    set({ contextMenu: request });
  },

  closeContextMenu: () => set({ contextMenu: null }),
});
