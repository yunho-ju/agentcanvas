import type { StateCreator } from "zustand";
import { fetchDatasetSummariesFromServer } from "../api/eval";
import { datasetIdFor } from "../eval/datasetId";
import { datasetIdForSpec, setDatasetIdForSpec, type EvalDatasetSummary } from "../eval/dataset";
import { msg, type Message } from "../i18n/messages";
import type { EditorState } from "./editor";

export type EvalDatasetListState = "idle" | "loading" | "ready" | "failed";
export interface EvalDatasetSlice {
  evalDatasetList: EvalDatasetSummary[];
  evalDatasetListState: EvalDatasetListState;
  evalDatasetListFailure: Message | null;
  evalDatasetSwitching: boolean;
  evalDatasetRenaming: boolean;
  evalDatasetRequest: number;
  loadEvalDatasetList: () => Promise<void>;
  fetchEvalDatasetList: typeof fetchDatasetSummariesFromServer;
  loadCurrentEvalDataset: () => void;
  switchEvalDataset: (id: string) => Promise<void>;
  detachEvalDataset: () => Promise<void>;
  renameEvalDataset: (name: string) => Promise<boolean>;
}

export const createEvalDatasetSlice: StateCreator<EditorState, [], [], EvalDatasetSlice> = (set, get) => {
  let listRequest = 0;
  let detailRequest = 0;
  const current = () => ({ specId: get().spec?.id ?? null, open: get().evalPanelOpen });
  const read = async (id: string, specId: string, request: number, manual = false, clearOnNotFound = false): Promise<"ok" | "not-found" | "failed"> => {
    const outcome = await get().fetchDataset(id);
    if (request !== detailRequest || !get().evalPanelOpen || get().spec?.id !== specId) return "failed";
    if (outcome.dataset) {
      get().resetEvalBatchHistory();
      set({ dataset: outcome.dataset, datasetSynced: outcome.dataset, datasetKnownOnServer: true, caseSaveNotice: null });
      if (get().evalAdvanced) void get().refreshEvalBatchHistory();
      return "ok";
    }
    if (outcome.notFound) {
      if (manual) set({ caseSaveNotice: { message: msg("eval.dataset.notFound"), tone: "danger" } });
      if (clearOnNotFound) set({ dataset: null, datasetSynced: null, datasetKnownOnServer: false });
      return "not-found";
    }
    set({ caseSaveNotice: { message: outcome.failure, tone: "danger" } });
    return "failed";
  };
  const readCurrent = async (id: string, specId: string, linked: boolean) => {
    const request = ++detailRequest;
    const outcome = await read(id, specId, request, false, !linked);
    if (outcome === "not-found" && linked && datasetIdForSpec(specId) === id) {
      const fallbackRequest = ++detailRequest;
      const fallback = await read(datasetIdFor(specId), specId, fallbackRequest, false, true);
      if ((fallback === "ok" || fallback === "not-found") && fallbackRequest === detailRequest && get().evalPanelOpen && get().spec?.id === specId) {
        setDatasetIdForSpec(specId, null);
      }
    }
  };
  return {
    evalDatasetList: [], evalDatasetListState: "idle", evalDatasetListFailure: null,
    evalDatasetSwitching: false, evalDatasetRenaming: false, evalDatasetRequest: 0,
    fetchEvalDatasetList: (options) => fetchDatasetSummariesFromServer(options),
    loadEvalDatasetList: async () => {
      const { specId, open } = current();
      if (!specId || !open) return;
      const request = ++listRequest;
      set({ evalDatasetListState: "loading", evalDatasetListFailure: null, evalDatasetRequest: request });
      const outcome = await get().fetchEvalDatasetList();
      if (request !== listRequest || !get().evalPanelOpen || get().spec?.id !== specId) return;
      set(outcome.datasets ? { evalDatasetList: outcome.datasets, evalDatasetListState: "ready" } : { evalDatasetListState: "failed", evalDatasetListFailure: outcome.failure });
    },
    loadCurrentEvalDataset: () => {
      const specId = get().spec?.id;
      if (!specId || !get().evalPanelOpen) return;
      const linked = datasetIdForSpec(specId);
      void readCurrent(linked ?? datasetIdFor(specId), specId, linked !== null);
    },
    switchEvalDataset: async (id) => {
      const specId = get().spec?.id;
      if (!specId || !get().evalPanelOpen || get().caseDraft || get().caseSaving || get().evalDatasetSwitching || get().evalDatasetRenaming || get().dataset?.id === id) return;
      set({ evalDatasetSwitching: true });
      const request = ++detailRequest;
      try {
        const ok = await read(id, specId, request, true);
        if (ok === "ok" && get().spec?.id === specId && get().evalPanelOpen) setDatasetIdForSpec(specId, id);
      } finally {
        if (request === detailRequest) set({ evalDatasetSwitching: false });
      }
    },
    detachEvalDataset: async () => {
      const specId = get().spec?.id;
      if (!specId || !get().evalPanelOpen || get().caseDraft || get().caseSaving || get().evalDatasetSwitching || get().evalDatasetRenaming) return;
      set({ evalDatasetSwitching: true });
      const request = ++detailRequest;
      try {
        const outcome = await read(datasetIdFor(specId), specId, request, false, true);
        if ((outcome === "ok" || outcome === "not-found") && request === detailRequest && get().evalPanelOpen && get().spec?.id === specId) {
          setDatasetIdForSpec(specId, null);
        }
      } finally {
        if (request === detailRequest) set({ evalDatasetSwitching: false });
      }
    },
    renameEvalDataset: async (name) => {
      const dataset = get().dataset;
      const specId = get().spec?.id;
      if (!dataset || !specId || !get().evalPanelOpen || !get().datasetKnownOnServer || get().caseDraft || get().caseSaving || get().evalDatasetSwitching || get().evalDatasetRenaming || !name.trim()) return false;
      const datasetId = dataset.id;
      set({ evalDatasetRenaming: true });
      try {
        const outcome = await get().updateDataset({ ...dataset, name: name.trim() });
        if (!outcome.dataset) { if (get().spec?.id === specId && get().dataset?.id === datasetId) set({ caseSaveNotice: { message: outcome.failure, tone: "danger" } }); return false; }
        if (get().spec?.id !== specId || !get().evalPanelOpen || get().dataset?.id !== datasetId) return false;
        set({ dataset: outcome.dataset, datasetSynced: outcome.dataset, evalDatasetList: get().evalDatasetList.map((item) => item.id === outcome.dataset!.id ? { ...item, name: outcome.dataset!.name, case_count: outcome.dataset!.cases?.length ?? item.case_count } : item) });
        return true;
      } finally { set({ evalDatasetRenaming: false }); }
    },
  };
};
