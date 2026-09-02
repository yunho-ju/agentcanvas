// 어디를 보고 있는가 — 화면을 데려가 달라는 부탁만 남긴다 (브리프 B7).
// 실제로 화면을 옮기는 일은 캔버스가 한다. store는 지도를 그리지 않는다.
import type { StateCreator } from "zustand";
import type { Position } from "../history/graphCommands";
import type { EditorState } from "./editor";

export interface ViewRequest {
  /** 데려갈 노드들 — 비어 있으면 캔버스에 있는 것 전부 */
  nodes: string[];
  /** 다 담기게 할 것인가(fit), 줌은 그대로 두고 보이기만 할 것인가(reveal) — 없으면 fit */
  kind?: "reveal";
}

export interface ViewSlice {
  viewRequest: ViewRequest | null;
  /** 지금 보고 있는 화면의 한가운데 — 캔버스 좌표. 새 카드는 여기서부터 자리를 찾는다 */
  viewportCenter: Position;
  /** 캔버스가 자기 한가운데를 알려 준다 — 그 자리를 아는 것은 캔버스뿐이다 */
  noteViewportCenter: (at: Position) => void;
  /** 캔버스에 있는 것을 모두 한 화면에 */
  fitAll: () => void;
  /** 지금 고른 노드로 */
  fitSelection: () => void;
  /** 이름을 아는 노드로 (목록에서 두 번 누를 때) */
  fitNodes: (ids: string[]) => void;
  /** 새로 놓은 카드가 화면 밖이면 보이게 — 줌은 그대로 둔다 (DESIGN §7 palette 배치) */
  revealNode: (id: string) => void;
  /** 캔버스가 부탁을 들어주었다 — 한 부탁은 한 번만 화면을 옮긴다 */
  viewRequestDone: () => void;
}

export const createViewSlice: StateCreator<EditorState, [], [], ViewSlice> = (
  set,
  get,
) => ({
  viewRequest: null,

  // 캔버스가 아직 서기 전에는 원점이다 — 자리를 지어내지 않는다.
  viewportCenter: { x: 0, y: 0 },

  // 달라진 것이 없으면 상태도 그대로다 — 화면을 끄는 매 프레임마다 화면을 다시 그리지 않는다.
  noteViewportCenter: (at) => {
    const now = get().viewportCenter;
    if (at.x === now.x && at.y === now.y) return;
    set({ viewportCenter: at });
  },

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

  revealNode: (id) => set({ viewRequest: { kind: "reveal", nodes: [id] } }),

  viewRequestDone: () => set({ viewRequest: null }),
});
