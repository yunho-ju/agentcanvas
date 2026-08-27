// 어디를 보고 있는가 — 화면을 데려가 달라는 부탁만 남긴다 (브리프 B7).
// 실제로 화면을 옮기는 일은 캔버스가 한다. store는 지도를 그리지 않는다.
import type { StateCreator } from "zustand";
import type { EditorState } from "./editor";

export interface ViewRequest {
  /** 데려갈 노드들 — 비어 있으면 캔버스에 있는 것 전부 */
  nodes: string[];
}

export interface ViewSlice {
  viewRequest: ViewRequest | null;
  /** 캔버스에 있는 것을 모두 한 화면에 */
  fitAll: () => void;
  /** 지금 고른 노드로 */
  fitSelection: () => void;
  /** 이름을 아는 노드로 (목록에서 두 번 누를 때) */
  fitNodes: (ids: string[]) => void;
}

export const createViewSlice: StateCreator<EditorState, [], [], ViewSlice> = (
  set,
  get,
) => ({
  viewRequest: null,

  // 같은 곳을 다시 부탁해도 새 부탁이다 — 그래서 매번 새 객체를 놓는다.
  fitAll: () => set({ viewRequest: { nodes: [] } }),

  fitSelection: () => {
    const chosen = get()
      .nodes.filter((node) => node.selected === true)
      .map((node) => node.id);
    // 고른 것이 없는데 화면을 옮기면 사용자는 길을 잃는다.
    if (chosen.length > 0) set({ viewRequest: { nodes: chosen } });
  },

  fitNodes: (ids) => {
    if (ids.length > 0) set({ viewRequest: { nodes: ids } });
  },
});
