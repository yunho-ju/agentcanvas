// 시험 상태의 정체(identity)는 문서 하나에 하나다 (독립 리뷰 blocker B1·B2).
// B1: 문서를 바꾸면 시험 상태 전체가 새 문서 것으로 바뀌고, 옛 문서의 폴링은 멎는다.
// B2: 아직 저장한 적 없는 '새 초안'에서도 케이스 저장이 실제로 된다.
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";
import { serveEval } from "./fakeEvalServer";
import { serveSaves } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function specWithId(id: string): AgentSpec {
  return { ...example, id };
}

beforeEach(() => {
  useEditor.setState({
    spec: null,
    savedSpec: null,
    isDraft: false,
    nodes: [],
    edges: [],
    evalPanelOpen: false,
    dataset: null,
    datasetSynced: null,
    datasetKnownOnServer: false,
    caseDraft: null,
    lastDeletedCase: null,
    batchId: null,
    batchStatus: "idle",
    batch: null,
    caseSaveNotice: null,
    evalAdvanced: false,
    evalBatchHistory: null,
    evalBatchHistoryLoading: false,
    evalBatchHistoryFailure: null,
    evalSelectedHistoryId: null,
  });
  serveSaves();
});

describe("B1 — 문서를 바꾸면 시험 상태가 따라오지 않고 새 문서 것으로 바뀐다", () => {
  it("A 문서의 dataset·배치·되돌리기 줄이 B로 넘어가지 않는다", async () => {
    const server = serveEval();
    store().loadSpec(specWithId("doc-a"));
    store().enterEvalMode();
    await Promise.resolve();

    // A 문서에 케이스를 둘 만들고 하나를 지운다 — dataset과 되돌리기 줄이 A의 것으로 선다.
    // (배치를 돌리려면 남는 케이스가 하나는 있어야 한다.)
    store().startNewCase();
    store().setCaseDraft({ title: "A케이스", expectedText: "말" });
    await store().saveCaseDraft();
    store().startNewCase();
    store().setCaseDraft({ title: "지울 케이스", expectedText: "말" });
    await store().saveCaseDraft();
    const toDelete = store().dataset?.cases?.find((c) => c.title === "지울 케이스")?.id as string;
    await store().deleteCase(toDelete);
    expect(store().lastDeletedCase?.case.title).toBe("지울 케이스");

    // A를 저장하고 배치를 돌린다 — 도는 중이다.
    await store().saveSpec();
    await store().runAllCases();
    expect(store().batchStatus).toBe("running");
    expect(store().batchId).not.toBeNull();

    // B 문서로 건너간다.
    server.datasets.set("ds-doc-b", {
      id: "ds-doc-b",
      name: "B문서",
      cases: [{ id: "b1", title: "B케이스", input: {}, expected_phrases: ["ok"] }],
    });
    store().loadSpec(specWithId("doc-b"));
    await Promise.resolve();

    // 시험 상태 전체가 리셋되고, 열려 있던 패널은 B의 dataset을 다시 읽는다.
    expect(store().batchStatus).toBe("idle");
    expect(store().batchId).toBeNull();
    expect(store().batch).toBeNull();
    expect(store().lastDeletedCase).toBeNull();
    expect(store().dataset?.id).toBe("ds-doc-b");
    expect(store().dataset?.cases?.[0]?.title).toBe("B케이스");

    // 옛 배치는 더 이상 묻지 않는다 — 걸어 둔 타이머가 없다(폴링이 멎었다).
    const pollsBefore = server.polls;
    await server.flushPoll();
    expect(server.polls).toBe(pollsBefore);
  });
});

describe("B1 — 모드를 나가면 폴링이 멎는다", () => {
  it("실행 중에 시험 모드를 나가도 배경에서 계속 묻지 않는다", async () => {
    const server = serveEval();
    store().loadSpec(specWithId("doc-a"));
    store().enterEvalMode();
    await Promise.resolve();
    store().startNewCase();
    store().setCaseDraft({ title: "케이스", expectedText: "말" });
    await store().saveCaseDraft();
    await store().saveSpec();
    await store().runAllCases();
    expect(store().batchStatus).toBe("running");

    store().leaveEvalMode();

    const pollsBefore = server.polls;
    await server.flushPoll();
    expect(server.polls).toBe(pollsBefore);
  });
});

describe("EVAL-4A — Advanced history 재조회 경계", () => {
  it("Advanced인 채 모드를 다시 열면 목록을 자동으로 다시 읽는다", async () => {
    const server = serveEval();
    server.datasets.set("ds-doc-a", { id: "ds-doc-a", name: "A", cases: [] });
    store().loadSpec(specWithId("doc-a"));
    store().enterEvalMode();
    await Promise.resolve();
    const fetchListing = vi.fn(async () => ({ listing: { batches: [], has_more: false } }));
    useEditor.setState({ fetchEvalBatchListing: fetchListing, evalAdvanced: true });
    store().leaveEvalMode();
    store().enterEvalMode();
    await Promise.resolve();
    expect(fetchListing).toHaveBeenCalledWith("ds-doc-a");
  });

  it("dataset GET이 늦게 끝나도 그 뒤 켠 Advanced가 목록을 읽는다", async () => {
    let resolveDataset: ((value: { dataset: NonNullable<ReturnType<typeof store>["dataset"]> }) => void) | undefined;
    const dataset = { id: "ds-doc-a", name: "A", cases: [] };
    const fetchDataset = vi.fn(() => new Promise<any>((resolve) => { resolveDataset = resolve; }));
    const fetchListing = vi.fn(async () => ({ listing: { batches: [], has_more: false } }));
    useEditor.setState({ fetchDataset, fetchEvalBatchListing: fetchListing });
    store().loadSpec(specWithId("doc-a"));
    store().enterEvalMode();
    act(() => store().setEvalAdvanced(true));
    resolveDataset?.({ dataset });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchListing).toHaveBeenCalledWith("ds-doc-a");
  });
});

describe("EVAL-4B-1 — Advanced off cleanup", () => {
  it("Advanced를 끄면 detail과 비교 상태를 함께 닫는다", () => {
    useEditor.setState({ evalAdvanced: true, evalSelectedHistoryId: "detail", evalCompareSelection: ["a", "b"], evalCompareBatches: [{} as any, {} as any], evalCompareStatus: "loading" });
    store().setEvalAdvanced(false);
    expect(store().evalAdvanced).toBe(false);
    expect(store().evalSelectedHistoryId).toBeNull();
    expect(store().evalCompareSelection).toEqual([]);
    expect(store().evalCompareBatches).toEqual([null, null]);
    expect(store().evalCompareStatus).toBe("idle");
  });

  it("비교는 FIFO로 최근 두 개만 남기고, 선택을 풀면 늦은 응답을 버린다", async () => {
    const resolvers = new Map<string, (value: any) => void>();
    useEditor.setState({
      evalPanelOpen: true,
      dataset: { id: "d", name: "시험", cases: [] },
      fetchBatch: vi.fn((id: string): Promise<any> => new Promise((resolve) => resolvers.set(id, resolve))),
    });
    const summary = (id: string) => ({ id, started_at: id, case_count: 0, passed_count: 0 });
    store().toggleEvalBatchCompare(summary("a"));
    store().toggleEvalBatchCompare(summary("b"));
    store().toggleEvalBatchCompare(summary("c"));
    expect(store().evalCompareSelection).toEqual(["b", "c"]);
    store().toggleEvalBatchCompare(summary("b"));
    expect(store().evalCompareSelection).toEqual(["c"]);
    resolvers.get("a")?.({ status: "completed", batch: {} });
    resolvers.get("b")?.({ status: "completed", batch: {} });
    resolvers.get("c")?.({ status: "completed", batch: {} });
    await Promise.resolve();
    await Promise.resolve();
    expect(store().evalCompareStatus).toBe("idle");
    expect(store().evalCompareBatches).toEqual([null, null]);
  });
});

describe("B2 — '새 초안'에서도 케이스 저장이 실제로 된다", () => {
  it("문서를 한 번도 저장한 적 없어도(spec null) 케이스를 저장하면 서버에 남는다", async () => {
    const server = serveEval();
    expect(store().spec).toBeNull();

    store().enterEvalMode(); // spec이 없어도 패널만 열릴 뿐 죽지 않는다
    store().startNewCase();
    store().setCaseDraft({ title: "첫 시험", expectedText: "안녕" });
    await store().saveCaseDraft();

    expect(store().spec).not.toBeNull();
    expect(store().dataset?.cases?.some((c) => c.title === "첫 시험")).toBe(true);
    expect(server.datasets.size).toBe(1);
  });

  // 독립 리뷰 2라운드 major — 승격은 graphSlice의 한 문(ensureDoc)을 통해야 화면 결과가 같다.
  it("승격은 노드를 놓을 때와 같은 화면 결과다 — isDraft가 켜져 상태바 뱃지가 뜬다", async () => {
    serveEval();
    expect(store().isDraft).toBe(false);

    store().enterEvalMode();
    store().startNewCase();
    store().setCaseDraft({ title: "첫 시험", expectedText: "안녕" });
    await store().saveCaseDraft();

    expect(store().isDraft).toBe(true);
  });
});
