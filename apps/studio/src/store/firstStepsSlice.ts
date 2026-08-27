// 첫 걸음 안내가 화면에 남아 있는가 (DESIGN §7 first-steps-card).
// 걸음 자체는 여기 담기지 않는다 — 걸음은 그래프에서 파생한다(guide/firstSteps).
import type { StateCreator } from "zustand";
import {
  readFirstStepsDismissed,
  rememberFirstStepsDismissed,
} from "../guide/firstStepsStore";
import type { EditorState } from "./editor";

export interface FirstStepsSlice {
  /** 이 브라우저에서 안내를 이미 접었는가 */
  firstStepsDismissed: boolean;
  /** 네 걸음을 다 걸은 것을 지금 축하하는 중인가 — 축하가 끝나면 안내는 물러난다 */
  firstStepsCelebrating: boolean;
  /** 다 걸었다고 한 줄로 말한다 */
  celebrateFirstSteps: () => void;
  /** 축하를 여기서 끝낸다 — 다 걸었다는 기억은 남긴다 */
  endFirstStepsCelebration: () => void;
  /** 안내를 접는다 — 숨기기와 완주가 함께 쓰는 하나의 문이다 */
  dismissFirstSteps: () => void;
}

export const createFirstStepsSlice: StateCreator<EditorState, [], [], FirstStepsSlice> = (
  set,
  get,
) => ({
  firstStepsDismissed: readFirstStepsDismissed(),
  firstStepsCelebrating: false,

  celebrateFirstSteps: () => set({ firstStepsCelebrating: true }),

  // 축하하던 중에 문서가 바뀌면 그 말은 새 문서의 것이 아니다 — 다만 다 걸은 일은 일어났다.
  endFirstStepsCelebration: () => {
    if (get().firstStepsCelebrating) get().dismissFirstSteps();
  },

  dismissFirstSteps: () => {
    rememberFirstStepsDismissed();
    set({ firstStepsDismissed: true, firstStepsCelebrating: false });
  },
});
