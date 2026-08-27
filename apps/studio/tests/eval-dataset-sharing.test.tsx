import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvalDatasetPicker } from "../src/eval/EvalDatasetPicker";
import type { EvalDataset } from "../src/generated/eval_dataset";
import type { DatasetReadOutcome, DatasetOutcome } from "../src/eval/dataset";
import { setLocale } from "../src/i18n/localeStore";
import { useEditor } from "../src/store/editor";

const spec = { id: "doc-a", name: "문서 A" } as any;
const dataset = (id: string, name = id): EvalDataset => ({ id, name, cases: [] });

function store() {
  return useEditor.getState();
}

function setup(state: Partial<ReturnType<typeof store>> = {}) {
  useEditor.setState({
    spec,
    evalPanelOpen: true,
    caseDraft: null,
    caseSaving: false,
    dataset: dataset("ds-doc-a", "현재 묶음"),
    datasetSynced: dataset("ds-doc-a", "현재 묶음"),
    datasetKnownOnServer: true,
    evalDatasetSwitching: false,
    evalDatasetRenaming: false,
    evalDatasetList: [],
    evalDatasetListState: "idle",
    evalDatasetListFailure: null,
    batchId: "old-batch",
    batchStatus: "completed",
    batch: {} as any,
    ...state,
  });
  setLocale("ko");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  localStorage.clear();
  setup();
});

describe("EVAL-4B-3 dataset sharing store", () => {
  it("switches, resets batch history, and persists the per-spec link", async () => {
    const reset = vi.fn();
    const target = dataset("shared", "공유");
    setup({ fetchDataset: vi.fn(async () => ({ dataset: target })), resetEvalBatchHistory: reset });

    await act(async () => { await store().switchEvalDataset("shared"); });

    expect(store().dataset).toEqual(target);
    expect(reset).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem("aval.eval.dataset-links")!)).toEqual({ "doc-a": "shared" });
    expect(store().evalDatasetSwitching).toBe(false);
  });

  it.each([
    ["draft", { caseDraft: { id: null, title: "draft", input: {}, expectedText: "ok", runsPerCase: 1, passesNeeded: 1 } }],
    ["saving", { caseSaving: true }],
  ] as const)("blocks switch and detach while case is %s", async (_label, blocked) => {
    const fetchDataset = vi.fn(async () => ({ dataset: dataset("next") }));
    setup({ fetchDataset, ...blocked });
    await store().switchEvalDataset("next");
    await store().detachEvalDataset();
    expect(fetchDataset).not.toHaveBeenCalled();
  });

  it("keeps the current dataset and shows a truthful notice for a manual 404", async () => {
    setup({ fetchDataset: vi.fn(async (): Promise<DatasetReadOutcome> => ({ notFound: true })) });

    await act(async () => { await store().switchEvalDataset("missing"); });

    expect(store().dataset?.id).toBe("ds-doc-a");
    expect(store().datasetSynced?.id).toBe("ds-doc-a");
    expect(store().datasetKnownOnServer).toBe(true);
    expect(store().caseSaveNotice).toEqual({ message: { key: "eval.dataset.notFound" }, tone: "danger" });
  });

  it("clears stale state when detach cannot load the document default dataset", async () => {
    localStorage.setItem("aval.eval.dataset-links", JSON.stringify({ "doc-a": "shared" }));
    setup({ fetchDataset: vi.fn(async (): Promise<DatasetReadOutcome> => ({ notFound: true })) });

    await act(async () => { await store().detachEvalDataset(); });

    expect(store().dataset).toBeNull();
    expect(store().datasetSynced).toBeNull();
    expect(store().datasetKnownOnServer).toBe(false);
    expect(localStorage.getItem("aval.eval.dataset-links")).toBe("{}");
  });

  it("preserves the shared dataset and link when detach cannot load the document default dataset", async () => {
    localStorage.setItem("aval.eval.dataset-links", JSON.stringify({ "doc-a": "shared" }));
    const failure = { key: "eval.offline" } as const;
    setup({ fetchDataset: vi.fn(async (): Promise<DatasetReadOutcome> => ({ failure })) });

    await act(async () => { await store().detachEvalDataset(); });

    expect(store().dataset?.id).toBe("ds-doc-a");
    expect(store().datasetSynced?.id).toBe("ds-doc-a");
    expect(store().datasetKnownOnServer).toBe(true);
    expect(JSON.parse(localStorage.getItem("aval.eval.dataset-links")!)).toEqual({ "doc-a": "shared" });
    expect(store().caseSaveNotice).toEqual({ message: failure, tone: "danger" });
  });

  it("clears stale state when the unlinked default dataset is missing on startup", async () => {
    const fetchDataset = vi.fn(async (): Promise<DatasetReadOutcome> => ({ notFound: true }));
    setup({ fetchDataset });

    await act(async () => { store().loadCurrentEvalDataset(); await Promise.resolve(); });

    expect(fetchDataset).toHaveBeenCalledWith("ds-doc-a");
    expect(store().dataset).toBeNull();
    expect(store().datasetSynced).toBeNull();
    expect(store().datasetKnownOnServer).toBe(false);
  });

  it("preserves the shared dataset and link when its startup fallback fails", async () => {
    localStorage.setItem("aval.eval.dataset-links", JSON.stringify({ "doc-a": "shared" }));
    const failure = { key: "eval.offline" } as const;
    const fetchDataset = vi.fn()
      .mockResolvedValueOnce({ notFound: true } satisfies DatasetReadOutcome)
      .mockResolvedValueOnce({ failure } satisfies DatasetReadOutcome);
    setup({ fetchDataset });

    await act(async () => { store().loadCurrentEvalDataset(); await Promise.resolve(); await Promise.resolve(); });

    expect(fetchDataset).toHaveBeenNthCalledWith(1, "shared");
    expect(fetchDataset).toHaveBeenNthCalledWith(2, "ds-doc-a");
    expect(store().dataset?.id).toBe("ds-doc-a");
    expect(store().datasetSynced?.id).toBe("ds-doc-a");
    expect(store().datasetKnownOnServer).toBe(true);
    expect(JSON.parse(localStorage.getItem("aval.eval.dataset-links")!)).toEqual({ "doc-a": "shared" });
    expect(store().caseSaveNotice).toEqual({ message: failure, tone: "danger" });
  });

  it("does not apply a stale document or panel response", async () => {
    const first = deferred<DatasetReadOutcome>();
    const fetchDataset = vi.fn(() => first.promise);
    setup({ fetchDataset });
    store().loadCurrentEvalDataset();
    setup({ spec: { id: "doc-b" } as any, dataset: dataset("keep") });
    first.resolve({ dataset: dataset("old") });
    await act(async () => { await Promise.resolve(); });
    expect(store().dataset?.id).toBe("keep");

    const panel = deferred<DatasetReadOutcome>();
    setup({ fetchDataset: vi.fn(() => panel.promise), dataset: dataset("keep") });
    store().loadCurrentEvalDataset();
    useEditor.setState({ evalPanelOpen: false });
    panel.resolve({ dataset: dataset("late") });
    await act(async () => { await Promise.resolve(); });
    expect(store().dataset?.id).toBe("keep");
  });

  it("keeps the picker visible with no dataset and uses boolean aria-pressed", async () => {
    const switchDataset = vi.fn();
    setup({ dataset: null, datasetSynced: null, datasetKnownOnServer: false, evalDatasetList: [{ id: "shared", name: "공유", case_count: 0 }], evalDatasetListState: "ready", loadEvalDatasetList: vi.fn(async () => {}), switchEvalDataset: switchDataset as any });
    render(<EvalDatasetPicker />);
    expect(screen.getByLabelText("시험 묶음 고르기")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "시험 묶음 고르기" }));
    expect(screen.getByRole("button", { name: /공유/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("renames successfully, reports failure, and guards concurrent operations", async () => {
    const renamed = dataset("ds-doc-a", "새 이름");
    const updateDataset = vi.fn(async (): Promise<DatasetOutcome> => ({ dataset: renamed }));
    setup({ updateDataset, evalDatasetList: [{ id: "ds-doc-a", name: "현재 묶음", case_count: 0 }] });
    expect(await store().renameEvalDataset(" 새 이름 ")).toBe(true);
    expect(store().dataset?.name).toBe("새 이름");
    expect(store().evalDatasetList[0]?.name).toBe("새 이름");

    setup({ updateDataset: vi.fn(async (): Promise<DatasetOutcome> => ({ failure: { key: "eval.save.failed", params: { reason: "거절" } } })) });
    expect(await store().renameEvalDataset("실패")).toBe(false);
    expect(store().dataset?.name).toBe("현재 묶음");
    expect(store().caseSaveNotice?.message.key).toBe("eval.save.failed");

    const calls = vi.fn(async (): Promise<DatasetOutcome> => ({ dataset: renamed }));
    setup({ updateDataset: calls, evalDatasetSwitching: true });
    expect(await store().renameEvalDataset("막힘")).toBe(false);
    setup({ updateDataset: calls, evalDatasetRenaming: true });
    expect(await store().renameEvalDataset("막힘")).toBe(false);
    expect(calls).not.toHaveBeenCalled();
  });
});
