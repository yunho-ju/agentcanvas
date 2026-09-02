// 이 서버가 부를 수 있는 모델 — 상태 전이만 한다. 무엇을 어떤 차례로 보여 줄지는
// registry/modelOptions.ts의 규칙이고, 묻는 일은 api/models.ts의 것이다
// (evalStandingSlice와 같은 문법).
import type { StateCreator } from "zustand";
import { fetchServerModelsFromServer } from "../api/models";
import type { ServerCatalog } from "../registry/modelOptions";
import type { EditorState } from "./editor";

export interface ModelsSlice {
  /** 이 서버가 말한 제 사정. null은 아직·끝내 모른다는 뜻이다(모르면 번들 목록으로 돌아간다) */
  serverModels: ServerCatalog | null;
  fetchServerModels: typeof fetchServerModelsFromServer;
  loadServerModels: () => Promise<void>;
}

export const createModelsSlice: StateCreator<EditorState, [], [], ModelsSlice> = (
  set,
  get,
) => {
  // 지금 길 위에 있는 물음 — 여러 자리가 동시에 물어도 서버에 가는 것은 하나다.
  let asking: Promise<void> | null = null;

  return {
    serverModels: null,
    fetchServerModels: (options) => fetchServerModelsFromServer(options),
    loadServerModels: async () => {
      // 들은 것이 있으면 다시 묻지 않는다. 못 들은 것은 다음 기회에 다시 묻는다 —
      // 한 번의 실패로 이 화면이 번들 목록에 영영 갇히지 않게.
      if (get().serverModels !== null) return;
      if (asking !== null) return asking;
      asking = (async () => {
        const said = await get().fetchServerModels();
        if (said !== null) set({ serverModels: said });
      })().finally(() => {
        asking = null;
      });
      return asking;
    },
  };
};
