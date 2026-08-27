// src/eval/ 순수 모듈의 경계 값 — eval-panel.test.tsx가 화면으로 보여주지 않는 갈래들.
import { describe, expect, it, vi } from "vitest";
import { BatchPoller, type BatchReadOutcome, batchUpdatePatch } from "../src/eval/batchPoller";
import {
  caseFromDraft,
  draftFromCase,
  draftIsSavable,
  draftMatchesCase,
  emptyCaseDraft,
  passesExceedRuns,
} from "../src/eval/caseForm";
import { caseCardState } from "../src/eval/caseState";
import { datasetIdForSpec, datasetSummariesOf, newDataset, setDatasetIdForSpec, withCaseAt, withoutCase } from "../src/eval/dataset";
import { datasetIdFor } from "../src/eval/datasetId";
import { summaryOf } from "../src/eval/summary";
import { attemptsForCase, batchListingOf } from "../src/eval/batchHistory";
import { compareEvalBatches } from "../src/eval/compareEvalBatches";
import type { EvalBatch } from "../src/generated/eval_batch";

describe("datasetIdFor — 문서 하나에 시험 묶음 하나", () => {
  it("같은 spec_id는 언제나 같은 이름표를 준다", () => {
    expect(datasetIdFor("doc-1")).toBe(datasetIdFor("doc-1"));
    expect(datasetIdFor("doc-1")).not.toBe(datasetIdFor("doc-2"));
  });
});

describe("dataset sharing helpers", () => {
  it("accepts summary arrays and safely ignores malformed items", () => {
    expect(datasetSummariesOf([{ id: "d", name: "D", case_count: 1 }])).toEqual([{ id: "d", name: "D", case_count: 1 }]);
    expect(datasetSummariesOf([{ id: "d" }])).toBeNull();
  });
  it("persists and clears a per-spec link", () => {
    const storage = new Map<string, string>();
    const fake = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } as unknown as Storage;
    setDatasetIdForSpec("doc", "shared", fake);
    expect(datasetIdForSpec("doc", fake)).toBe("shared");
    setDatasetIdForSpec("doc", null, fake);
    expect(datasetIdForSpec("doc", fake)).toBeNull();
  });
});

describe("batchListingOf · attemptsForCase — 전문가 투영의 계약 경계", () => {
  it("정상 목록과 has_more 경계를 보존하고 잘못된 shape은 버린다", () => {
    expect(batchListingOf({ batches: [], has_more: true })).toEqual({ batches: [], has_more: true });
    expect(batchListingOf({ batches: [{ id: "b", started_at: "now", case_count: 1, passed_count: 1 }], has_more: false })).toEqual({
      batches: [{ id: "b", started_at: "now", case_count: 1, passed_count: 1 }], has_more: false,
    });
    expect(batchListingOf({ batches: [{ id: "b" }], has_more: false })).toBeNull();
  });

  it("회차 순서와 빈 output을 그대로 보존한다", () => {
    const batch = { results: [{ case_id: "c", evaluator: "e", evaluator_version: "v", passed: false, attempts: [
      { run_id: "r1", passed: false, output_text: "" }, { run_id: "r2", passed: true, output_text: "답" },
    ] }], id: "b", dataset_id: "d", spec_id: "s", spec_revision: "r", started_at: "now" } as EvalBatch;
    expect(attemptsForCase(batch, "c").map((attempt) => attempt.run_id)).toEqual(["r1", "r2"]);
    expect(attemptsForCase(batch, "c")[0]?.output_text).toBe("");
  });
});

describe("passesExceedRuns — 통과 수는 횟수를 넘을 수 없다", () => {
  it("같으면 넘은 것이 아니다(경계값)", () => {
    expect(passesExceedRuns(3, 3)).toBe(false);
  });

  it("하나라도 많으면 넘은 것이다", () => {
    expect(passesExceedRuns(4, 3)).toBe(true);
  });
});

describe("draftIsSavable · caseFromDraft", () => {
  it("제목도 문구도 없는 빈 초안은 저장할 수 없다", () => {
    const draft = emptyCaseDraft();
    expect(draftIsSavable(draft)).toBe(false);
    expect(caseFromDraft(draft, [])).toBeNull();
  });

  it("id가 없으면 겹치지 않는 새 id를 짓는다", () => {
    const draft = { ...emptyCaseDraft(), title: "인사", expectedText: "안녕" };
    const made = caseFromDraft(draft, ["case"]);
    expect(made?.id).toBe("case-2");
  });

  // 독립 리뷰 M2 — 계약(ge=1)과 같은 판정: 0이나 음수 횟수는 저장할 수 없다.
  it("횟수가 1보다 작으면(0·음수) 저장할 수 없다", () => {
    const base = { ...emptyCaseDraft(), title: "인사", expectedText: "안녕" };
    expect(draftIsSavable({ ...base, runsPerCase: 0 })).toBe(false);
    expect(draftIsSavable({ ...base, passesNeeded: -1 })).toBe(false);
  });
});

describe("draftMatchesCase — 초안이 저장된 그 케이스와 내용까지 같은가", () => {
  it("고쳐 쓴 초안은 저장된 케이스와 다르다고 본다", () => {
    const saved = caseFromDraft(
      { ...emptyCaseDraft(), title: "인사", expectedText: "안녕" },
      [],
    )!;
    const draft = draftFromCase(saved);
    expect(draftMatchesCase(draft, saved)).toBe(true);
    expect(draftMatchesCase({ ...draft, title: "인사!" }, saved)).toBe(false);
  });
});

describe("dataset — 넣고 빼기", () => {
  it("뺀 자리 그대로 되돌린다", () => {
    const base = newDataset("ds-1", "문서");
    const withTwo = {
      ...base,
      cases: [
        { id: "a", title: "A", input: {}, expected_phrases: ["x"] as [string] },
        { id: "b", title: "B", input: {}, expected_phrases: ["y"] as [string] },
      ],
    };
    const removal = withoutCase(withTwo, "a");
    expect(removal?.dataset.cases?.map((c) => c.id)).toEqual(["b"]);
    const restored = withCaseAt(removal!.dataset, removal!.removed, removal!.index);
    expect(restored.cases?.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("compareEvalBatches — 시험 결과만 비교", () => {
  const datasetCases = [
    { id: "a", title: "첫째", input: {}, expected_phrases: ["x"] as [string] },
    { id: "b", title: "둘째", input: {}, expected_phrases: ["y"] as [string] },
  ];
  const batch = (id: string, passed: boolean, output = "답"): EvalBatch => ({ id, dataset_id: "d", spec_id: "s", spec_revision: "v", started_at: id, results: [{ case_id: "a", evaluator: "e", evaluator_version: id, passed, attempts: [{ run_id: id, passed, output_text: output }] }] });

  it("ignores batch metadata, keeps dataset order, and finds the first difference", () => {
    const result = compareEvalBatches(datasetCases, batch("left", true), batch("right", true));
    expect(result.firstDivergence).toBeNull();
    expect(result.cases.map((item) => item.caseId)).toEqual(["a", "b"]);
    expect(result.cases[0]?.same).toBe(true);
    expect(result.cases[1]?.missing).toBe("both");
  });

  it("detects passed and output differences without exposing run IDs", () => {
    const result = compareEvalBatches(datasetCases.slice(0, 1), batch("left", true, "one"), batch("right", false, "two"));
    expect(result.firstDivergence).toBe(0);
    expect(result.cases[0]?.same).toBe(false);
    expect(JSON.stringify(result)).not.toContain("run_id");
  });
});

describe("caseCardState — 케이스 한 줄의 상태", () => {
  it("배치가 없으면 아직 상태다", () => {
    expect(caseCardState("a", { running: false, batch: null })).toEqual({ kind: "none" });
  });

  it("도는 중이면 결과와 무관하게 running이다", () => {
    expect(caseCardState("a", { running: true, batch: null })).toEqual({ kind: "running" });
  });
});

describe("summaryOf — pill 4상태", () => {
  const batch = (results: EvalBatch["results"]): EvalBatch => ({
    id: "b",
    dataset_id: "d",
    spec_id: "s",
    spec_revision: "r",
    started_at: new Date().toISOString(),
    results,
  });

  it("실패한 결과가 하나라도 있으면 someFailed다", () => {
    const summary = summaryOf({
      caseCount: 2,
      running: false,
      batch: batch([
        { case_id: "a", evaluator: "e", evaluator_version: "v1", passed: true, attempts: [] },
        { case_id: "b", evaluator: "e", evaluator_version: "v1", passed: false, attempts: [] },
      ]),
    });
    expect(summary).toEqual({ verdict: "someFailed", total: 2, passed: 1, failed: 1 });
  });
});

// 독립 리뷰 2라운드 minor 3 — 서버 이상 응답과 연결 실패는 다른 일이다. 문구도 달라야 한다.
describe("batchUpdatePatch — 못 닿은 까닭마다 다른 문구", () => {
  it("연결 실패는 eval.poll.offline을 그대로 옮긴다", () => {
    const patch = batchUpdatePatch({ failure: { key: "eval.poll.offline" } });
    expect(patch.caseSaveNotice?.message).toEqual({ key: "eval.poll.offline" });
  });

  it("서버의 이상한 응답은 eval.poll.strange를 그대로 옮긴다 — offline으로 뭉개지 않는다", () => {
    const patch = batchUpdatePatch({ failure: { key: "eval.poll.strange" } });
    expect(patch.caseSaveNotice?.message).toEqual({ key: "eval.poll.strange" });
  });
});

describe("BatchPoller — 되풀이해 묻는 정책", () => {
  it("완결되면 스스로 멈추고 더 묻지 않는다", async () => {
    let calls = 0;
    const fetchBatch = vi.fn(async (): Promise<BatchReadOutcome> => {
      calls += 1;
      return { status: "completed", batch: {} as EvalBatch };
    });
    const timers: (() => void)[] = [];
    const poller = new BatchPoller({
      fetchBatch,
      onUpdate: () => {},
      setTimer: (tick) => {
        timers.push(tick);
        return {};
      },
      clearTimer: () => {},
    });

    poller.start("b1");
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toBe(1);
    expect(timers).toHaveLength(0);
  });

  // 독립 리뷰 M6 — "running도 failed도 status !== running으로 뭉뚱그리면" 여기서 걸린다.
  it("failed에서도 스스로 멈추고 더 묻지 않는다", async () => {
    let calls = 0;
    const fetchBatch = vi.fn(async (): Promise<BatchReadOutcome> => {
      calls += 1;
      return { status: "failed" };
    });
    const timers: (() => void)[] = [];
    const poller = new BatchPoller({
      fetchBatch,
      onUpdate: () => {},
      setTimer: (tick) => {
        timers.push(tick);
        return {};
      },
      clearTimer: () => {},
    });

    poller.start("b1");
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toBe(1);
    expect(timers).toHaveLength(0);
  });

  // 네트워크가 한 번 안 닿았다고 배치가 죽었다고 확정하지 않는다 — 되풀이는 그친다.
  it("서버에 못 닿아도(failure) 멈추지 않고 다음 걸음을 다시 잡는다", async () => {
    let calls = 0;
    const fetchBatch = vi.fn(async (): Promise<BatchReadOutcome> => {
      calls += 1;
      return { failure: { key: "eval.poll.offline" } };
    });
    const timers: (() => void)[] = [];
    const poller = new BatchPoller({
      fetchBatch,
      onUpdate: () => {},
      setTimer: (tick) => {
        timers.push(tick);
        return {};
      },
      clearTimer: () => {},
    });

    poller.start("b1");
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toBe(1);
    expect(timers).toHaveLength(1);
  });

  it("그만 듣기로 하면 이미 나간 부탁의 답은 버린다", async () => {
    const pending: { resolve: ((outcome: BatchReadOutcome) => void) | null } = { resolve: null };
    const fetchBatch = vi.fn(
      () =>
        new Promise<BatchReadOutcome>((resolve) => {
          pending.resolve = resolve;
        }),
    );
    const onUpdate = vi.fn();
    const poller = new BatchPoller({
      fetchBatch,
      onUpdate,
      setTimer: () => ({}),
      clearTimer: () => {},
    });

    poller.start("b1");
    poller.stop();
    pending.resolve?.({ status: "completed", batch: {} as EvalBatch });
    await Promise.resolve();
    await Promise.resolve();

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
