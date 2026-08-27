// 서버에 저장해 둔 문서를 다시 여는 일 — 목록을 묻고, 되묻고, 열고, 주소에 남긴다.
// 서버에 묻는 길은 api/specs가, 캔버스를 갈아 끼우는 일은 loadSpec이 안다. 여기는 그 순서만 정한다.
import type { StateCreator } from "zustand";
import {
  type DocListOutcome,
  type RevisionHistoryOutcome,
  type SaveOutcome,
  type SavedDoc,
  fetchSavedDocs,
  fetchSavedSpec,
  fetchSpecRevisions,
} from "../api/specs";
import type { AgentSpec } from "../generated/agent_spec";
import { asCanvasWouldWriteIt } from "../graph/serialize";
import type { Message } from "../i18n/messages";
import { type DocAddress, browserAddress } from "../shell/docAddress";
import type { EditorState } from "./editor";
import { unsavedWork } from "./saveSlice";

/** 열기 대화상자가 지금 무엇을 보여주고 있는가. 대화상자가 닫혀 있으면 이것 자체가 없다. */
export interface DocListState {
  /** 서버가 준 문서들 — 아직 오지 않았으면 없다 */
  documents: SavedDoc[] | null;
  /** 서버에 목록을 묻고 있는가 — 처음과 다시 해보기를 같은 말로 알린다 */
  loading: boolean;
  /** 이 뒤에 보여주지 못한 문서가 더 있는가 (서버가 세어 말해 준 것) */
  hasMore: boolean;
  /** 목록이나 문서를 못 가져온 까닭 */
  failure: Message | null;
  /** 저장 안 된 변경 때문에 "정말 열까요"라고 되묻고 있는 문서 */
  asking: string | null;
}

export interface OpenSlice {
  docList: DocListState | null;
  /** 파일을 읽었지만, 저장하지 않은 작업 때문에 아직 캔버스에 앉히지 않은 후보 */
  pendingFile: AgentSpec | null;
  /** 서버에 목록을 묻는 길. 시험은 이 자리에 가짜를 꽂는다 */
  fetchDocs: () => Promise<DocListOutcome>;
  /** 서버에 문서 하나를 묻는 길 */
  fetchDoc: (id: string) => Promise<SaveOutcome>;
  /** 지금 문서의 판 머리말을 묻는 길. 시험은 이 자리에 가짜를 꽂는다 */
  fetchRevisions: (id: string) => Promise<RevisionHistoryOutcome>;
  /** 지금 보는 문서를 적어 두는 주소창 */
  address: DocAddress;
  showDocList: () => Promise<void>;
  reloadDocList: () => Promise<void>;
  closeDocList: () => void;
  /** 목록에서 문서 하나를 골랐다 — 저장 안 된 변경이 있으면 먼저 되묻는다 */
  chooseDoc: (id: string) => Promise<void>;
  /** 저장하지 않은 채로 연다 (되묻기의 '그냥 열기') */
  openDocAnyway: (id: string) => Promise<void>;
  /** 먼저 저장하고, 저장이 된 뒤에만 연다 */
  saveThenOpenDoc: (id: string) => Promise<void>;
  cancelOpening: () => void;
  requestFileOpen: (spec: AgentSpec) => void;
  openFileAnyway: () => void;
  saveThenOpenFile: () => Promise<void>;
  cancelFileOpen: () => void;
  /** 주소가 가리키는 문서를 다시 연다 (새로고침하고 돌아온 자리) */
  restoreDocFromAddress: () => Promise<void>;
}

export function docListIsOpen(state: EditorState): boolean {
  return state.docList !== null;
}

/** 지금 되묻고 있는 문서 — 없으면 묻고 있지 않다. */
export function askingBeforeOpen(state: EditorState): string | null {
  return state.docList?.asking ?? null;
}

export function fileOpenIsAsking(state: EditorState): boolean {
  return state.pendingFile !== null;
}

export const createOpenSlice: StateCreator<EditorState, [], [], OpenSlice> = (
  set,
  get,
) => {
  // 서버 응답 자체를 끊지는 못해도, 닫힌 뒤 돌아온 응답이 화면을 다시 바꾸지는 못하게 한다.
  let openGeneration = 0;
  const restoringRequests = new Map<string, Promise<SaveOutcome>>();

  function beginOpenAttempt(): number {
    openGeneration += 1;
    return openGeneration;
  }

  function invalidateOpenAttempt(): void {
    openGeneration += 1;
  }

  function isCurrentOpenAttempt(generation: number): boolean {
    return generation === openGeneration;
  }

  function restoreRequestFor(id: string): Promise<SaveOutcome> {
    const existing = restoringRequests.get(id);
    if (existing) return existing;

    const request = get().fetchDoc(id);
    restoringRequests.set(id, request);
    void request.then(
      () => {
        if (restoringRequests.get(id) === request) restoringRequests.delete(id);
      },
      () => {
        if (restoringRequests.get(id) === request) restoringRequests.delete(id);
      },
    );
    return request;
  }

  /** 대화상자의 지금 모습을 고쳐 적는다 — 닫혀 있으면 아무 일도 하지 않는다. */
  function showing(change: Partial<DocListState>): void {
    const list = get().docList;
    if (list === null) return;
    set({ docList: { ...list, ...change } });
  }

  /** 서버가 준 문서를 캔버스에 앉힌다 — 판과 revision은 서버가 매긴 그대로다. */
  function adopt(saved: AgentSpec): void {
    const canvas = asCanvasWouldWriteIt(saved);
    // 다른 문서를 여는 일은 새 출발이다 — 실행 기록도 견주던 것도 앞 문서의 것이었다.
    get().loadSpec(canvas);
    set({ savedSpec: canvas, docList: null });
    get().address.remember(canvas.id);
  }

  async function loadList(generation: number): Promise<void> {
    if (!isCurrentOpenAttempt(generation)) return;
    showing({ loading: true, failure: null, asking: null });
    const outcome = await get().fetchDocs();
    if (!isCurrentOpenAttempt(generation)) return;
    showing({
      loading: false,
      documents: outcome.documents ?? null,
      hasMore: outcome.hasMore ?? false,
      failure: outcome.failure ?? null,
      asking: null,
    });
  }

  return {
    docList: null,
    pendingFile: null,
    fetchDocs: () => fetchSavedDocs(),
    fetchDoc: (id) => fetchSavedSpec(id),
    fetchRevisions: (id) => fetchSpecRevisions(id),
    address: browserAddress,

    showDocList: async () => {
      const generation = beginOpenAttempt();
      set({ docList: { documents: null, loading: true, hasMore: false, failure: null, asking: null } });
      await loadList(generation);
    },

    reloadDocList: async () => {
      await loadList(beginOpenAttempt());
    },

    closeDocList: () => {
      invalidateOpenAttempt();
      set({ docList: null });
    },

    chooseDoc: async (id) => {
      // 지금 보는 문서를 다시 고르는 것은 빈 걸음이다 — 다시 읽지 않고 대화상자만 접는다.
      // 다만 저장하지 않은 작업이 있으면 같은 문서도 최신 판을 확인할 선택지로 이어야 한다.
      if (id === get().spec?.id && !unsavedWork(get())) {
        get().closeDocList();
        return;
      }
      // 저장한 뒤로 달라진 곳뿐 아니라, 한 번도 맡기지 않은 문서도 여기서 잃는다.
      if (unsavedWork(get())) {
        // 목록을 다시 묻는 중이어도, 줄을 고른 순간부터는 되묻기가 최신 상태다.
        // 늦게 돌아온 목록 응답이 이 물음을 지우지 못하게 현재 시도를 끊는다.
        invalidateOpenAttempt();
        showing({ loading: false, asking: id, failure: null });
        return;
      }
      await get().openDocAnyway(id);
    },

    openDocAnyway: async (id) => {
      const generation = beginOpenAttempt();
      // 줄을 고른 순간 목록 요청은 더 이상 화면의 진행 상태가 아니다.
      showing({ loading: false });
      const outcome = await get().fetchDoc(id);
      if (!isCurrentOpenAttempt(generation)) return;
      if (!outcome.saved) {
        showing({ failure: outcome.failure, asking: null });
        return;
      }
      adopt(outcome.saved);
    },

    saveThenOpenDoc: async (id) => {
      // 저장하지 못했으면 열지 않는다 — 까닭은 저장이 이미 말했다.
      const generation = beginOpenAttempt();
      if ((await get().saveSpec()) !== "saved" || !isCurrentOpenAttempt(generation)) return;
      await get().openDocAnyway(id);
    },

    cancelOpening: () => {
      invalidateOpenAttempt();
      showing({ asking: null });
    },

    requestFileOpen: (spec) => {
      if (unsavedWork(get())) {
        set({ pendingFile: spec });
        return;
      }
      get().loadSpec(spec);
      set({ pendingFile: null });
    },

    openFileAnyway: () => {
      const pending = get().pendingFile;
      if (pending === null) return;
      get().loadSpec(pending);
      set({ pendingFile: null });
    },

    saveThenOpenFile: async () => {
      const pending = get().pendingFile;
      if (pending === null) return;
      if ((await get().saveSpec()) !== "saved" || get().pendingFile !== pending) return;
      get().loadSpec(pending);
      set({ pendingFile: null });
    },

    cancelFileOpen: () => set({ pendingFile: null }),

    restoreDocFromAddress: async () => {
      const id = get().address.docId();
      if (id === null) return;
      const generation = beginOpenAttempt();
      const outcome = await restoreRequestFor(id);
      if (!isCurrentOpenAttempt(generation)) return;
      if (!outcome.saved) {
        // 없는 문서를 가리키는 주소는 지운다 — 새로고침마다 같은 말을 되풀이하지 않는다.
        get().address.remember(null);
        set({ feedbackNotice: { message: outcome.failure, tone: "danger" } });
        return;
      }
      adopt(outcome.saved);
    },
  };
};
