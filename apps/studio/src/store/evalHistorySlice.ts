import type { StateCreator } from "zustand";
import { fetchBatchListingFromServer } from "../api/eval";
import type { EvalBatchListing, EvalBatchSummary } from "../eval/batchHistory";
import { type Message, msg } from "../i18n/messages";
import type { EditorState } from "./editor";
import type { EvalBatch } from "../generated/eval_batch";

export type EvalCompareStatus = "idle" | "loading" | "ready" | "failed";

export interface EvalHistorySlice {
  evalAdvanced: boolean;
  evalBatchHistory: EvalBatchListing | null;
  evalBatchHistoryLoading: boolean;
  evalBatchHistoryFailure: Message | null;
  evalSelectedHistoryId: string | null;
  evalCompareSelection: string[];
  evalCompareBatches: [EvalBatch | null, EvalBatch | null];
  evalCompareStatus: EvalCompareStatus;
  evalCompareFailure: Message | null;
  setEvalAdvanced: (advanced: boolean) => void;
  refreshEvalBatchHistory: () => Promise<void>;
  selectEvalBatch: (summary: EvalBatchSummary) => Promise<void>;
  toggleEvalBatchCompare: (summary: EvalBatchSummary) => void;
  clearEvalBatchCompare: () => void;
  resetEvalBatchHistory: () => void;
  fetchEvalBatchListing: typeof fetchBatchListingFromServer;
}

export const createEvalHistorySlice: StateCreator<EditorState, [], [], EvalHistorySlice> = (
  set,
  get,
) => {
  let request = 0;
  const reset = () => {
    request += 1;
    set({
      evalBatchHistory: null,
      evalBatchHistoryLoading: false,
      evalBatchHistoryFailure: null,
      evalSelectedHistoryId: null,
      evalCompareSelection: [],
      evalCompareBatches: [null, null],
      evalCompareStatus: "idle",
      evalCompareFailure: null,
    });
  };
  return {
    evalAdvanced: false,
    evalBatchHistory: null,
    evalBatchHistoryLoading: false,
    evalBatchHistoryFailure: null,
    evalSelectedHistoryId: null,
    evalCompareSelection: [],
    evalCompareBatches: [null, null],
    evalCompareStatus: "idle",
    evalCompareFailure: null,
    setEvalAdvanced: (advanced) => {
      if (!advanced) {
        // Advanced owns history detail and comparison. Invalidate in-flight comparison
        // reads before hiding the controls so a late response cannot reopen the overlay.
        request += 1;
        set({
          evalAdvanced: false,
          evalSelectedHistoryId: null,
          evalCompareSelection: [],
          evalCompareBatches: [null, null],
          evalCompareStatus: "idle",
          evalCompareFailure: null,
        });
        return;
      }
      set({ evalAdvanced: true });
      void get().refreshEvalBatchHistory();
    },
    fetchEvalBatchListing: (datasetId) => fetchBatchListingFromServer(datasetId),
    resetEvalBatchHistory: reset,
    refreshEvalBatchHistory: async () => {
      const datasetId = get().dataset?.id;
      if (!datasetId || !get().evalPanelOpen) return;
      const current = ++request;
      set({ evalBatchHistoryLoading: true, evalBatchHistoryFailure: null });
      const outcome = await get().fetchEvalBatchListing(datasetId);
      if (current !== request || get().dataset?.id !== datasetId || !get().evalPanelOpen) return;
      if ("failure" in outcome) {
        set({ evalBatchHistoryLoading: false, evalBatchHistoryFailure: outcome.failure });
      } else {
        set({ evalBatchHistoryLoading: false, evalBatchHistory: outcome.listing });
      }
    },
    selectEvalBatch: async (summary) => {
      const datasetId = get().dataset?.id;
      if (!datasetId || summary.id === get().batch?.id) {
        if (summary.id === get().batch?.id) set({ evalSelectedHistoryId: summary.id });
        return;
      }
      const current = ++request;
      set({ evalBatchHistoryLoading: true, evalBatchHistoryFailure: null, evalSelectedHistoryId: summary.id });
      const outcome = await get().fetchBatch(summary.id);
      if (current !== request || get().dataset?.id !== datasetId || !get().evalPanelOpen) return;
      if (outcome.status === "completed" && outcome.batch.dataset_id === datasetId) {
        set({ batch: outcome.batch, batchId: outcome.batch.id, batchStatus: "completed", evalBatchHistoryLoading: false });
      } else {
        set({ evalBatchHistoryLoading: false, evalBatchHistoryFailure: msg("eval.history.selectionFailed") });
      }
    },
    toggleEvalBatchCompare: (summary) => {
      const selected = get().evalCompareSelection;
      const next = selected.includes(summary.id)
        ? selected.filter((id) => id !== summary.id)
        : [...selected, summary.id].slice(-2);
      if (next.length !== 2) {
        request += 1;
        set({ evalCompareSelection: next, evalCompareStatus: "idle", evalCompareBatches: [null, null], evalCompareFailure: null });
        return;
      }
      const datasetId = get().dataset?.id;
      if (!datasetId) return;
      const current = ++request;
      set({ evalCompareSelection: next, evalCompareStatus: "loading", evalCompareBatches: [null, null], evalCompareFailure: null });
      void Promise.all(next.map((id) => get().fetchBatch(id))).then((outcomes) => {
        if (current !== request || get().dataset?.id !== datasetId || !get().evalPanelOpen) return;
        const batches = outcomes.map((outcome) => outcome.status === "completed" && outcome.batch.dataset_id === datasetId ? outcome.batch : null) as [EvalBatch | null, EvalBatch | null];
        if (batches.every(Boolean)) set({ evalCompareBatches: batches, evalCompareStatus: "ready" });
        else set({ evalCompareBatches: [null, null], evalCompareStatus: "failed", evalCompareFailure: msg("eval.compare.failed") });
      });
    },
    clearEvalBatchCompare: () => {
      request += 1;
      set({ evalCompareSelection: [], evalCompareBatches: [null, null], evalCompareStatus: "idle", evalCompareFailure: null });
    },
  };
};
