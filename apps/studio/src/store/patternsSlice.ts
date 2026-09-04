// 이 서버가 놓아 줄 수 있는 모양 — 상태 전이만 한다. 서버 답을 읽는 일은
// registry/patternCatalog.ts의 것이고, 묻는 일은 api/patterns.ts의 것이다
// (modelsSlice와 같은 문법).
import type { StateCreator } from "zustand";
import { fetchServerPatternsFromServer } from "../api/patterns";
import type { PatternChoice } from "../registry/patternCatalog";
import type { EditorState } from "./editor";

export interface PatternsSlice {
  /** 이 서버가 말한 모양들. null은 아직·끝내 모른다는 뜻이다(모르면 칩을 세우지 않는다) */
  serverPatterns: PatternChoice[] | null;
  fetchServerPatterns: typeof fetchServerPatternsFromServer;
  loadServerPatterns: () => Promise<void>;
}

export const createPatternsSlice: StateCreator<EditorState, [], [], PatternsSlice> = (
  set,
  get,
) => {
  // 지금 길 위에 있는 물음 — 여러 자리가 동시에 물어도 서버에 가는 것은 하나다.
  let asking: Promise<void> | null = null;

  return {
    serverPatterns: null,
    fetchServerPatterns: (options) => fetchServerPatternsFromServer(options),
    loadServerPatterns: async () => {
      // 들은 것이 있으면 다시 묻지 않는다. 못 들은 것은 다음 기회에 다시 묻는다.
      if (get().serverPatterns !== null) return;
      if (asking !== null) return asking;
      asking = (async () => {
        const said = await get().fetchServerPatterns();
        if (said !== null) set({ serverPatterns: said });
      })().finally(() => {
        asking = null;
      });
      return asking;
    },
  };
};
