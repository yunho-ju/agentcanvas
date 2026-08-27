// 블록을 빼고, 보관하고, 다시 꽂는 흐름 — 빼기 전에 무엇이 망가지는지 먼저 보여준다.
import type { StateCreator } from "zustand";
import { analyzeDetach, breaksNothing } from "../graph/impact";
import { type Scene, sceneOf } from "../graph/scene";
import { msg } from "../i18n/messages";
import type { FlowNode } from "../graph/serialize";
import { detachToTray, restoreFromTray } from "../history/trayCommands";
import type { EditorState } from "./editor";
import { isRunning } from "./runSlice";

export interface DetachSlice {
  /** 캔버스에서 뺀 노드들. 이번 편집 시간 동안만 있고 AgentSpec에는 들어가지 않는다 */
  tray: FlowNode[];
  /**
   * 사용자가 빼겠다고 했지만 아직 확정하지 않은 노드의 이름.
   * 영향은 여기 담아 두지 않는다 — 보는 순간의 그래프에서 다시 재야 화면이 낡지 않는다.
   */
  pendingDetach: string | null;
  requestDetach: (nodeId: string) => void;
  confirmDetach: () => void;
  cancelDetach: () => void;
  restoreFromTray: (nodeId: string) => void;
}

export const createDetachSlice: StateCreator<EditorState, [], [], DetachSlice> = (
  set,
  get,
) => {
  const scene = (): Scene => sceneOf(get());

  return {
    tray: [],
    pendingDetach: null,

    requestDetach: (nodeId) => {
      // 실행을 보는 동안에는 물어볼 것도 없다 — 그래프가 잠겨 있다.
      if (isRunning(get())) return;
      if (!get().nodes.some((node) => node.id === nodeId)) return;
      // 망가질 것이 없으면 물어볼 것도 없다.
      if (breaksNothing(analyzeDetach(scene(), nodeId))) {
        return get().runCommand(detachToTray(scene(), nodeId));
      }
      set({ pendingDetach: nodeId });
    },

    confirmDetach: () => {
      const nodeId = get().pendingDetach;
      if (nodeId === null) return;
      set({ pendingDetach: null });
      // 묻는 사이에 노드가 사라졌다면 뺄 것도 없다 — 빈 걸음을 쌓지 않고 그 사실만 알린다.
      if (!get().nodes.some((node) => node.id === nodeId)) {
        set({ notice: msg("edit.detach.gone", { id: nodeId }) });
        return;
      }
      get().runCommand(detachToTray(scene(), nodeId));
    },

    cancelDetach: () => set({ pendingDetach: null }),

    restoreFromTray: (nodeId) => get().runCommand(restoreFromTray(scene(), nodeId)),
  };
};
