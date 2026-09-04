// 문서 카드 위에 잠깐 뜨는 것 — 문서 메뉴와 판 기록. 한 번에 하나만 뜬다 (DESIGN §7 doc-card).
// 열림 상태를 컴포넌트가 아니라 여기에 두는 까닭: Esc가 물러나는 순서(DESIGN §1)가 이것을 봐야 한다.
import type { StateCreator } from "zustand";
import type { EditorState } from "./editor";

/** 문서 카드 위에 지금 무엇이 떠 있는가 — 둘이 함께 뜨는 자리는 없다. */
export type DocPopover = "closed" | "menu" | "history";

export interface DocPopoverSlice {
  docPopover: DocPopover;
  /** 문서 메뉴를 펴거나 접는다 — 판 기록이 떠 있었으면 그것과 자리를 바꾼다 */
  toggleDocMenu: () => void;
  openRevisionHistory: () => void;
  closeDocPopover: () => void;
}

export const createDocPopoverSlice: StateCreator<EditorState, [], [], DocPopoverSlice> = (
  set,
  get,
) => ({
  docPopover: "closed",

  toggleDocMenu: () => {
    // 잠깐 뜨는 것은 한 번에 하나다 (DESIGN §7 context-menu 닫힘).
    get().closeContextMenu();
    set({ docPopover: get().docPopover === "menu" ? "closed" : "menu" });
  },

  openRevisionHistory: () => {
    get().closeContextMenu();
    set({ docPopover: "history" });
  },

  closeDocPopover: () => set({ docPopover: "closed" }),
});
