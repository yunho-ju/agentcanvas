// 시험해 보기 — 이 자리는 조율만 한다 (DESIGN §7 eval-panel, 확정 결정: store는 상태 전이만).
// 직렬화·요약 판정·dataset id 파생은 src/eval/ 순수 모듈의 것이고, 여기는 그 결과를 부르고 담는다.
// 부수효과(fetch·타이머)는 io로 주입한다 — 시험은 이 자리에 가짜를 꽂는다 (runSlice와 같은 문법).
import type { StateCreator } from "zustand";
import {
  type DatasetOutcome,
  type DatasetReadOutcome,
  type BatchStartOutcome,
  createDatasetOnServer,
  fetchDatasetFromServer,
  startBatchOnServer,
  updateDatasetOnServer,
  fetchBatchFromServer,
} from "../api/eval";
import { BatchPoller, batchUpdatePatch, type ClearTimer, type FetchBatch, type SetTimer } from "../eval/batchPoller";
import {
  type EvalCaseDraft,
  type NewCaseSeed,
  caseFromDraft,
  draftFromCase,
  draftIsSavable,
  emptyCaseDraft,
} from "../eval/caseForm";
import {
  caseIds,
  datasetSyncedPatch,
  newDataset,
  withCase,
  withCaseAt,
  withoutCase,
} from "../eval/dataset";
import { datasetIdFor } from "../eval/datasetId";
import { type EvalSummary, summaryOf } from "../eval/summary";
import type { EvalBatch } from "../generated/eval_batch";
import type { EvalCase } from "../generated/eval_case";
import type { EvalDataset } from "../generated/eval_dataset";
import { getLocale } from "../i18n/localeStore";
import { type Message, msg, translate } from "../i18n/messages";
import type { EditorState } from "./editor";
import { unsavedChanges } from "./saveSlice";

export type { EvalCaseDraft } from "../eval/caseForm";

export type EvalBatchStatus = "idle" | "running" | "completed" | "failed";

export interface EvalCaseSaveNotice {
  message: Message;
  tone: "warn" | "danger";
}

/** 지웠던 케이스를 되돌리는 데 필요한 만큼 — 있던 자리까지 함께 들고 있는다. */
interface DeletedCase {
  case: EvalCase;
  index: number;
}

export interface EvalSlice {
  evalPanelOpen: boolean;
  /** 지금 캔버스의 문서가 지닌 시험 묶음 — 아직 한 번도 저장하지 않았으면 비어 있어도 null이 아니다 */
  dataset: EvalDataset | null;
  /** 서버가 준 그대로 — 지금 dataset과 견주어 "저장 안 된 변경"을 안다 */
  datasetSynced: EvalDataset | null;
  /** 서버에 이 묶음이 있다고 확인된 적이 있는가 — 없으면 다음 저장은 POST(생성)다 */
  datasetKnownOnServer: boolean;
  caseSaving: boolean;
  caseSaveNotice: EvalCaseSaveNotice | null;
  /** 펼쳐서 고치고 있는 초안 — 새 케이스면 id가 없다 */
  caseDraft: EvalCaseDraft | null;
  lastDeletedCase: DeletedCase | null;
  batchId: string | null;
  batchStatus: EvalBatchStatus;
  batch: EvalBatch | null;

  fetchDataset: (id: string) => Promise<DatasetReadOutcome>;
  createDataset: (dataset: EvalDataset) => Promise<DatasetOutcome>;
  updateDataset: (dataset: EvalDataset) => Promise<DatasetOutcome>;
  startBatch: (
    datasetId: string,
    specId: string,
    specRevision: string,
  ) => Promise<BatchStartOutcome>;
  fetchBatch: FetchBatch;
  setPollTimer: SetTimer;
  clearPollTimer: ClearTimer;
  /** 지금 묶음을 서버에 맡긴다 — 처음이면 짓고(POST), 이미 있으면 고친다(PUT). */
  persistDataset: (dataset: EvalDataset) => Promise<void>;

  /** 시험 모드로 들어온다 — 이 문서의 시험 묶음을 연다 */
  enterEvalMode: () => void;
  /** 시험 모드를 떠난다 — 패널이 닫히고, 돌던 폴링도 멎고, 남은 되돌리기 줄도 잊는다 */
  leaveEvalMode: () => void;
  /**
   * 문서 정체가 바뀌었다 — 이 문서의 시험 상태 전체(dataset·배치·폴링·되돌리기)를 놓고,
   * 패널이 열려 있으면 새 문서의 시험 묶음을 다시 읽는다. loadSpec이 문서를 열 때마다 부른다.
   */
  abandonEval: () => void;
  startNewCase: (seed?: Partial<NewCaseSeed>) => void;
  /** 이 케이스를 펼쳐 고친다 — 이미 펼쳐 둔 것을 다시 누르면 접는다 */
  expandCase: (id: string) => void;
  collapseCase: () => void;
  setCaseDraft: (patch: Partial<EvalCaseDraft>) => void;
  saveCaseDraft: () => Promise<void>;
  deleteCase: (id: string) => Promise<void>;
  restoreDeletedCase: () => Promise<void>;
  runAllCases: () => Promise<void>;
}

export function evalCases(state: EditorState): EvalCase[] {
  return state.dataset?.cases ?? [];
}

export function evalSummary(state: EditorState): EvalSummary {
  return summaryOf({
    caseCount: evalCases(state).length,
    running: state.batchStatus === "running",
    batch: state.batch,
  });
}

/** 지금 '전부 실행해 보기'를 막는 까닭 — 없으면 눌러도 된다. */
export function evalRunBlocked(state: EditorState): Message | null {
  if (state.batchStatus === "running") return msg("eval.run.all.blocked.running");
  if (evalCases(state).length === 0) return msg("eval.run.all.blocked.empty");
  if (state.spec === null || state.savedSpec === null || unsavedChanges(state))
    return msg("eval.run.all.blocked.unsaved");
  return null;
}

/** 이름 없는 문서도 시험 묶음은 지어야 한다 — doc-card와 같은 말을 쓴다. */
function fallbackDatasetName(name: string | null | undefined): string {
  return name ?? translate(getLocale(), msg("doc.unnamed"));
}

/**
 * 지금 케이스를 담을 묶음 — 이미 연 묶음이거나, 이 문서 이름으로 처음 여는 묶음이다.
 * 케이스를 손으로 저장할 때와 AI 제안을 담을 때가 같은 묶음을 본다(규칙은 이 한 곳뿐).
 */
export function currentOrNewDataset(state: EditorState): EvalDataset {
  const spec = state.spec!;
  return (
    state.dataset ?? newDataset(datasetIdFor(spec.id), fallbackDatasetName(spec.name))
  );
}

/** 문서를 놓을 때(abandonEval)·패널을 열 때(evalPanelOpen 제외) 시험 상태가 돌아가는 처음 모습. */
const RESET_EVAL_STATE = {
  dataset: null,
  datasetSynced: null,
  datasetKnownOnServer: false,
  caseSaving: false,
  evalDatasetSwitching: false,
  evalDatasetRenaming: false,
  caseSaveNotice: null,
  caseDraft: null,
  lastDeletedCase: null,
  batchId: null,
  batchStatus: "idle" as const,
  batch: null,
};

export const createEvalSlice: StateCreator<EditorState, [], [], EvalSlice> = (set, get) => {
  const poller = new BatchPoller({
    fetchBatch: (batchId) => get().fetchBatch(batchId),
    onUpdate: (outcome) => {
      set(batchUpdatePatch(outcome));
      if (outcome.status === "completed") {
        set({ evalSelectedHistoryId: outcome.batch.id });
        if (get().evalAdvanced) void get().refreshEvalBatchHistory();
      }
    },
    setTimer: (tick, ms) => get().setPollTimer(tick, ms),
    clearTimer: (handle) => get().clearPollTimer(handle),
  });

  /** 지금 dataset을 서버에 맡긴다 — 처음이면 짓고(POST), 이미 있으면 고친다(PUT). */
  async function persist(dataset: EvalDataset): Promise<void> {
    set({ caseSaving: true });
    const outcome = get().datasetKnownOnServer
      ? await get().updateDataset(dataset)
      : await get().createDataset(dataset);
    set(
      outcome.dataset
        ? { caseSaving: false, ...datasetSyncedPatch(outcome.dataset) }
        : { caseSaving: false, caseSaveNotice: { message: outcome.failure, tone: "danger" } },
    );
  }

  /** 지금 문서의 시험 묶음을 읽는다 — 패널이 열려 있고 문서가 있을 때만. */
  function loadDatasetForCurrentDoc(): void { get().loadCurrentEvalDataset(); }

  return {
    evalPanelOpen: false,
    ...RESET_EVAL_STATE,

    fetchDataset: (id) => fetchDatasetFromServer(id),
    createDataset: (dataset) => createDatasetOnServer(dataset),
    updateDataset: (dataset) => updateDatasetOnServer(dataset),
    startBatch: (datasetId, specId, specRevision) =>
      startBatchOnServer(datasetId, specId, specRevision),
    fetchBatch: (batchId) => fetchBatchFromServer(batchId),
    persistDataset: (dataset) => persist(dataset),
    setPollTimer: (tick, ms) => globalThis.setTimeout(tick, ms),
    clearPollTimer: (handle) => globalThis.clearTimeout(handle as Parameters<typeof clearTimeout>[0]),

    enterEvalMode: () => {
      set({ evalPanelOpen: true });
      loadDatasetForCurrentDoc();
    },

    leaveEvalMode: () => {
      // 패널을 떠나면 아직 도는 배치를 배경에서 계속 묻지 않는다 — 다시 열면 새로 알아본다.
      poller.stop();
      set({ evalPanelOpen: false, caseDraft: null, lastDeletedCase: null, evalDatasetSwitching: false, evalDatasetRenaming: false });
      // 담지 않은 제안은 남지 않는다 — 승인 없이 묶음에 들어가는 길은 어디에도 없다.
      get().discardSuggestions();
      get().resetEvalBatchHistory();
    },

    abandonEval: () => {
      poller.stop();
      set(RESET_EVAL_STATE);
      get().discardSuggestions();
      get().resetEvalBatchHistory();
      loadDatasetForCurrentDoc();
    },

    startNewCase: (seed) => set({ caseDraft: { ...emptyCaseDraft(), ...seed } }),

    expandCase: (id) => {
      if (get().caseDraft?.id === id) {
        set({ caseDraft: null });
        return;
      }
      const found = evalCases(get()).find((item) => item.id === id);
      if (!found) return;
      set({ caseDraft: draftFromCase(found) });
    },

    collapseCase: () => set({ caseDraft: null }),

    setCaseDraft: (patch) => {
      const draft = get().caseDraft;
      if (!draft) return;
      set({ caseDraft: { ...draft, ...patch } });
    },

    saveCaseDraft: async () => {
      const draft = get().caseDraft;
      if (!draft || !draftIsSavable(draft)) return;
      // 문서 정체는 graphSlice의 문 하나(ensureDoc)에서만 온다 — addNode·피커와 같은 승격이다
      // (조용히 실패하지 않는다, evalSlice가 spec을 직접 set하지 않는다).
      get().ensureDoc();
      const base = currentOrNewDataset(get());
      const evalCase = caseFromDraft(draft, caseIds(base));
      if (!evalCase) return;
      const next = withCase(base, evalCase);
      set({ dataset: next, caseDraft: draftFromCase(evalCase) });
      await persist(next);
    },

    deleteCase: async (id) => {
      const dataset = get().dataset;
      if (!dataset) return;
      const removal = withoutCase(dataset, id);
      if (!removal) return;
      // 되돌리기는 카드가 있던 그 자리에서 인라인으로 말한다(패널 상단 알림과는 다른 자리) —
      // caseSaveNotice는 건드리지 않는다 (DESIGN §7 eval-case-card 갱신본).
      set({
        dataset: removal.dataset,
        lastDeletedCase: { case: removal.removed, index: removal.index },
        caseDraft: get().caseDraft?.id === id ? null : get().caseDraft,
      });
      await persist(removal.dataset);
    },

    restoreDeletedCase: async () => {
      const pending = get().lastDeletedCase;
      const dataset = get().dataset;
      if (!pending || !dataset) return;
      const restored = withCaseAt(dataset, pending.case, pending.index);
      set({ dataset: restored, lastDeletedCase: null });
      await persist(restored);
    },

    runAllCases: async () => {
      if (evalRunBlocked(get())) return;
      const spec = get().spec;
      const savedSpec = get().savedSpec;
      const dataset = get().dataset;
      if (!spec || !savedSpec || !dataset) return;
      set({ batchStatus: "running", batch: null, batchId: null });
      const outcome = await get().startBatch(dataset.id, spec.id, savedSpec.revision);
      if (outcome.failure) {
        set({
          batchStatus: "failed",
          caseSaveNotice: { message: outcome.failure, tone: "danger" },
        });
        return;
      }
      set({ batchId: outcome.batchId });
      poller.start(outcome.batchId);
    },
  };
};
