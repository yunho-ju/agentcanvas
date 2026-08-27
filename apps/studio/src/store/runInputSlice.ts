// 실행에 넣을 값을 묻는 카드가 지금 무엇을 들고 있는가 — 열려 있는가, 무엇을 적어 두었는가.
// 무엇을 물을지는 run/runInput의 순수 함수가 정하고, 실행 자체는 saveSlice가 맡는다:
// 여기 있는 것은 물음의 상태뿐이다 (DESIGN §7 run-input-card).
import type { StateCreator } from "zustand";
import { filledInput, runInputFields } from "../run/runInput";
import type { EditorState } from "./editor";

export interface RunInputSlice {
  /** 실행에 넣을 값을 묻는 카드가 열려 있는가 */
  runInputOpen: boolean;
  /** 이 문서에서 마지막으로 적어 넣은 값 — 다시 실행할 때 그대로 채워져 있다 */
  runInputValues: Record<string, unknown>;
  /** 실행 버튼을 눌렀다 — 물을 것이 있으면 카드를 열고(다시 누르면 접고), 없으면 곧장 실행한다 */
  requestRun: () => Promise<void>;
  /** 적어 넣은 값으로 실행한다 — 저장부터 하는 기존 절차를 그대로 탄다 */
  runWithInput: () => Promise<void>;
  /** 카드를 접는다 — 실행하지 않고, 적어 둔 값은 남는다 */
  closeRunInput: () => void;
  /** 칸 하나에 적어 넣는다 */
  setRunInputValue: (name: string, value: unknown) => void;
}

/** 이번 실행이 사람에게 물을 칸들 — 그래프가 정한다. */
export function runInputAsks(state: EditorState) {
  return runInputFields(state.exportSpec());
}

/** 카드가 지금 사람에게 묻고 있는가 — Esc가 무엇을 먼저 무를지 정하는 자리다 (DESIGN §1 ①′). */
export function runInputIsAsking(state: EditorState): boolean {
  return state.runInputOpen && runInputAsks(state).length > 0;
}

export const createRunInputSlice: StateCreator<EditorState, [], [], RunInputSlice> = (
  set,
  get,
) => ({
  runInputOpen: false,
  runInputValues: {},

  requestRun: async () => {
    // 물을 것이 없으면 빈 카드를 띄우지 않는다 — 누른 뜻 그대로 실행한다.
    if (runInputAsks(get()).length === 0) return get().saveThenRun();
    set({ runInputOpen: !get().runInputOpen });
  },

  runWithInput: async () => {
    const input = filledInput(get().runInputValues);
    // 실행이 열리면 그 실행이 기록에 한 줄 남는다 — 그것이 시작됐다는 증거다.
    const before = get().runHistory.length;
    await get().saveThenRun(Object.keys(input).length > 0 ? input : undefined);
    // 실행이 시작되면 카드는 물러난다. 시작하지 못했으면(저장 실패 등) 적어 둔 값과 함께
    // 자리를 지킨다 — 다시 적게 하지 않는다. 왜 안 됐는지는 저장 쪽이 이미 말했다.
    if (get().runHistory.length > before) set({ runInputOpen: false });
  },

  closeRunInput: () => set({ runInputOpen: false }),

  setRunInputValue: (name, value) =>
    set({ runInputValues: { ...get().runInputValues, [name]: value } }),
});
