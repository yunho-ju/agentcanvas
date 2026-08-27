// 무엇이 선택돼 있는가 — 고르기와 지우기.
import type { StateCreator } from "zustand";
import {
  type SelectionKind,
  adjacentNodeId,
  selectedEdgeOf,
  selectedNodeOf,
  withSelection,
  withoutSelection,
} from "../graph/selection";
import { type Scene, sceneOf } from "../graph/scene";
import { removeParts } from "../history/graphCommands";
import type { EditorState } from "./editor";

export interface SelectionSlice {
  select: (kind: SelectionKind, id: string) => void;
  clearSelection: () => void;
  /** 키보드로 노드를 순회한다 (설계 §13) */
  selectAdjacentNode: (offset: number) => void;
  deleteSelection: () => void;
}

export const createSelectionSlice: StateCreator<EditorState, [], [], SelectionSlice> = (
  set,
  get,
) => {
  const scene = (): Scene => sceneOf(get());

  return {
    select: (kind, id) => set(withSelection(scene(), kind, id)),

    clearSelection: () => set(withoutSelection(scene())),

    selectAdjacentNode: (offset) => {
      const id = adjacentNodeId(scene(), offset);
      if (id) set(withSelection(scene(), "node", id));
    },

    deleteSelection: () => {
      // 노드는 빼기 전에 무엇이 망가지는지 먼저 보여준다 — 그리고 지우는 대신 보관한다.
      const node = selectedNodeOf(scene());
      if (node) return get().requestDetach(node.id);
      const edge = selectedEdgeOf(scene());
      if (edge) get().runCommand(removeParts(scene(), { edges: [edge.id] }));
    },
  };
};
