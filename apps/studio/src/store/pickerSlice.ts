// 빈 캔버스에서 노드를 고르는 순간 — 어디에서 열렸고, 무엇에 이어질 것인가 (브리프 B4·B5).
// 무엇을 고를 수 있는지는 canvas/nodePicker가, 놓고 잇는 일은 history/graphCommands가 안다.
import type { StateCreator } from "zustand";
import type { PortAddress } from "../canvas/portLink";
import { newNode } from "../graph/draft";
import { uniqueId } from "../graph/ids";
import type { FlowEdge } from "../graph/serialize";
import { addNodeWithEdge, addNode as addNodeCommand } from "../history/graphCommands";
import type { Position } from "../history/graphCommands";
import { nodeTypes } from "../registry/registry";
import type { EditorState } from "./editor";

export interface PickerRequest {
  /** 노드가 놓일 캔버스 위의 자리 */
  at: Position;
  /** 피커가 뜰 화면 위의 자리 */
  screen: Position;
  /** 끌고 온 포트 — 없으면 빈 캔버스를 두 번 눌러 연 것이다 */
  from: PortAddress | null;
}

export interface PickerSlice {
  picker: PickerRequest | null;
  openPicker: (request: PickerRequest) => void;
  closePicker: () => void;
  /** 고른 종류를 그 자리에 놓고, 끌고 온 포트가 있으면 함께 잇는다 (되돌리기 한 걸음) */
  addPickedNode: (type: string, port?: string) => void;
}

export const createPickerSlice: StateCreator<EditorState, [], [], PickerSlice> = (
  set,
  get,
) => ({
  picker: null,

  openPicker: (request) => {
    set({ picker: request });
    // 잠깐 뜨는 것은 한 번에 하나다 (DESIGN §7 context-menu 닫힘).
    get().closeContextMenu();
    // 갈 곳이 없다던 안내는 여기까지가 제 할 일이다 — 예고한 일이 일어났으면 물러난다 (DESIGN §7).
    get().clearConnectionHint();
  },

  closePicker: () => set({ picker: null }),

  addPickedNode: (type, port) => {
    const picker = get().picker;
    const nodeType = nodeTypes[type];
    if (!picker || !nodeType) return;

    const node = newNode(
      nodeType,
      picker.at,
      get().nodes.map((candidate) => candidate.id),
    );
    get().ensureDoc();
    set({ picker: null });

    const from = picker.from;
    if (!from || !port) {
      get().runCommand(addNodeCommand(node));
      // 아직 아무것도 이어 보지 않은 사람에게는 다음 걸음을 건넨다 (규칙은 hintSlice 한 자리).
      get().inviteFirstLink(node, picker.screen);
      return;
    }

    // 끌고 온 쪽이 보내는 자리였다면 새 노드가 받는 쪽이 된다 — 방향은 손이 정한 그대로다.
    const [source, target] =
      from.side === "source"
        ? [
            { node: from.nodeId, port: from.portId },
            { node: node.id, port },
          ]
        : [
            { node: node.id, port },
            { node: from.nodeId, port: from.portId },
          ];
    const edge: FlowEdge = {
      id: uniqueId(
        `${source.node}-${target.node}`,
        get().edges.map((candidate) => candidate.id),
      ),
      source: source.node,
      sourceHandle: source.port,
      target: target.node,
      targetHandle: target.port,
      data: { kind: "data" },
    };
    get().runCommand(addNodeWithEdge(node, edge));
  },
});
