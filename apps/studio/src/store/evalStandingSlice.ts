// 이 서버에 선 판정 층 — 상태 전이만 한다. 무엇이 없는지 판정하는 규칙은 eval/evaluatorStanding.ts,
// 서버에 묻는 일은 api/eval.ts의 것이고, 여기는 물어보고 담을 뿐이다 (evalHistorySlice와 같은 문법).
import type { StateCreator } from "zustand";
import { fetchEvaluatorStandingFromServer } from "../api/eval";
import type { EvaluatorStanding } from "../eval/evaluatorStanding";
import type { EditorState } from "./editor";

export interface EvalStandingSlice {
  /** 층 이름 → 이 서버에서 서는가. null은 아직·끝내 모른다는 뜻이다(모르면 아무것도 막지 않는다) */
  evaluatorStanding: EvaluatorStanding | null;
  fetchEvaluatorStanding: typeof fetchEvaluatorStandingFromServer;
  loadEvaluatorStanding: () => Promise<void>;
}

export const createEvalStandingSlice: StateCreator<EditorState, [], [], EvalStandingSlice> = (
  set,
  get,
) => ({
  evaluatorStanding: null,
  fetchEvaluatorStanding: (options) => fetchEvaluatorStandingFromServer(options),
  loadEvaluatorStanding: async () => {
    const standing = await get().fetchEvaluatorStanding();
    // 못 들었으면 지난번에 들은 것도 지운다 — 옛 답으로 지금 서버를 말하지 않는다.
    set({ evaluatorStanding: standing });
  },
});
