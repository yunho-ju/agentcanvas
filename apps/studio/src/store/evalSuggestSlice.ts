// AI가 지어 준 시험 제안 — 조율만 한다 (DESIGN §7 eval-suggest-card, EVAL-2).
// 승인 전에는 dataset이 바뀌지 않는다: 지어 온 것은 이 자리에만 있고, keepChosenSuggestions만이
// 묶음에 넣는다. 판정·이름 붙이기는 eval/caseSuggestions.ts 순수 모듈의 것이다.
import type { StateCreator } from "zustand";
import { suggestCasesOnServer } from "../api/caseSuggestions";
import {
  SUGGEST_DEFAULT,
  type CaseSuggestion,
  type SuggestOutcome,
  casesFromSuggestions,
  howManyIssue,
} from "../eval/caseSuggestions";
import { caseIds, withCase } from "../eval/dataset";
import type { AgentSpec } from "../generated/agent_spec";
import type { EditorState } from "./editor";
import { currentOrNewDataset, evalCases } from "./evalSlice";

/** 지어 달라고 청하는 일 — 시험은 이 자리에 가짜를 꽂는다 (runSlice와 같은 문법). */
export type FetchCaseSuggestions = (
  spec: AgentSpec,
  howMany: number,
  includeEdgeCases: boolean,
  existingTitles: string[],
) => Promise<SuggestOutcome>;

export interface EvalSuggestSlice {
  /** 몇 개를 지어 달라고 할까 — 아직 다 못 친 빈 칸은 값이 아니다(케이스 폼과 같은 규칙) */
  suggestHowMany: number | undefined;
  suggestEdgeCases: boolean;
  suggesting: boolean;
  /** 지어 온 제안들 — 담기 전까지 여기에만 있다 */
  suggestions: CaseSuggestion[] | null;
  /** 몇 개를 청했는가 — 화면이 'N개 중 M개'를 사실대로 말한다 */
  suggestAskedFor: number;
  /** 담기로 고른 제안의 자리들 */
  suggestChosen: number[];
  /**
   * 청하는 줄로 손을 데려가 달라는 부탁 — 들어줄 때마다 하나씩 오른다 (viewSlice의 부탁과 같은 문법).
   * 초점은 DOM의 일이라 store가 옮기지 않는다: 그 줄을 그리는 화면이 부탁을 보고 옮긴다.
   */
  suggestFocusRequest: number;

  fetchCaseSuggestions: FetchCaseSuggestions;
  setSuggestHowMany: (howMany: number | undefined) => void;
  setSuggestEdgeCases: (mixThemIn: boolean) => void;
  suggestCases: () => Promise<void>;
  toggleSuggestion: (at: number) => void;
  keepChosenSuggestions: () => Promise<void>;
  /** 지어 둔 제안을 놓는다 — 패널을 떠나거나 문서를 놓을 때도 같은 자리로 돌아간다 */
  discardSuggestions: () => void;
  /** 청하는 줄로 손을 데려가 달라고 부탁한다 (skill을 만든 뒤의 [시험 짓기]) */
  focusSuggestAsk: () => void;
  /** 화면이 부탁을 들어주었다 — 한 부탁은 한 번만 손을 옮긴다 */
  suggestFocusDone: () => void;
}

/** 아직 아무것도 지어 보지 않은 처음 모습 — 떠날 때도 이 자리로 돌아온다. */
function noSuggestions(): Pick<
  EvalSuggestSlice,
  "suggesting" | "suggestions" | "suggestAskedFor" | "suggestChosen"
> {
  return { suggesting: false, suggestions: null, suggestAskedFor: 0, suggestChosen: [] };
}

export const createEvalSuggestSlice: StateCreator<EditorState, [], [], EvalSuggestSlice> = (
  set,
  get,
) => {
  // 몇 번째 청인가 — 늦게 온 답을 버리는 요청 토큰 (evalDatasetSlice와 같은 관례).
  let asked = 0;
  return {
    suggestHowMany: SUGGEST_DEFAULT,
    suggestEdgeCases: true,
    suggestFocusRequest: 0,
    ...noSuggestions(),

    fetchCaseSuggestions: (spec, howMany, includeEdgeCases, existingTitles) =>
      suggestCasesOnServer(spec, howMany, includeEdgeCases, existingTitles),

    setSuggestHowMany: (howMany) => set({ suggestHowMany: howMany }),
    setSuggestEdgeCases: (mixThemIn) => set({ suggestEdgeCases: mixThemIn }),

    suggestCases: async () => {
      const howMany = get().suggestHowMany;
      // 그릴 때 막은 것은 여기서도 막힌다 — 화면과 store가 같은 판정 한 곳을 본다.
      if (get().suggesting || howManyIssue(howMany) !== null) return;
      const specId = get().spec?.id ?? null;
      const mine = ++asked;
      set({ ...noSuggestions(), suggesting: true, caseSaveNotice: null });
      const outcome = await get().fetchCaseSuggestions(
        get().exportSpec(),
        howMany as number,
        get().suggestEdgeCases,
        evalCases(get()).map((one) => one.title),
      );
      // 기다리는 사이 이 청을 놓았거나(버리기·패널 이탈) 문서가 바뀌었으면 늦은 답은 버린다.
      if (mine !== asked || !get().evalPanelOpen || (get().spec?.id ?? null) !== specId) return;
      set(
        outcome.payload
          ? {
              ...noSuggestions(),
              suggestions: outcome.payload.suggestions,
              suggestAskedFor: outcome.payload.askedFor,
            }
          : { ...noSuggestions(), caseSaveNotice: { message: outcome.failure, tone: "danger" } },
      );
    },

    toggleSuggestion: (at) => {
      const chosen = get().suggestChosen;
      set({
        suggestChosen: chosen.includes(at)
          ? chosen.filter((one) => one !== at)
          : [...chosen, at].sort((a, b) => a - b),
      });
    },

    keepChosenSuggestions: async () => {
      const suggestions = get().suggestions;
      const chosen = get().suggestChosen;
      if (!suggestions || chosen.length === 0) return;
      // 문서 정체는 graphSlice의 문 하나(ensureDoc)에서만 온다 — 케이스를 손으로 저장할 때와 같다.
      get().ensureDoc();
      const base = currentOrNewDataset(get());
      const kept = casesFromSuggestions(
        chosen.map((at) => suggestions[at]),
        caseIds(base),
      );
      const next = kept.reduce(withCase, base);
      set({ dataset: next, ...noSuggestions() });
      await get().persistDataset(next);
    },

    // 버린 제안은 되살아나지 않는다 — 아직 오는 중인 답도 이 자리에서 함께 놓는다.
    discardSuggestions: () => {
      asked += 1;
      set({ ...noSuggestions() });
    },

    focusSuggestAsk: () =>
      set({ suggestFocusRequest: get().suggestFocusRequest + 1 }),

    suggestFocusDone: () => set({ suggestFocusRequest: 0 }),
  };
};
