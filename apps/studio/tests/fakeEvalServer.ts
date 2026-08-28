// 시험을 위한 서버 대역 — 진짜 서버와 같은 약속으로 dataset을 저장하고 배치를 돌린다.
// 시계는 손으로 쥔다: flushPoll을 부를 때까지 폴링은 한 걸음도 나아가지 않는다.
import type { DatasetOutcome, DatasetReadOutcome, BatchStartOutcome } from "../src/api/eval";
import type { BatchReadOutcome } from "../src/eval/batchPoller";
import type { EvalBatch } from "../src/generated/eval_batch";
import type { EvalDataset } from "../src/generated/eval_dataset";
import type { Message } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";
import { settle } from "./fakeRunServer";

interface BatchState {
  status: "running" | "completed" | "failed";
  batch?: EvalBatch;
}

/** 배치를 열어 달라고 온 부탁 하나 — 무엇을, 어느 층까지 딛어 돌려 달라고 했는가. */
export interface BatchAsked {
  datasetId: string;
  specId: string;
  specRevision: string;
  useJudge: boolean;
}

export interface EvalServerDouble {
  datasets: Map<string, EvalDataset>;
  /** 배치를 열어 달라고 온 부탁들 — 무엇을 실어 보냈는지는 시험이 직접 읽어 확인한다 */
  startedWith: BatchAsked[];
  /** 배치 진행을 물어본 횟수 — 폴링이 멎었는지는 이 숫자가 더는 늘지 않는 것으로 본다 */
  polls: number;
  /** 이 배치가 완결됐다고 해 둔다 — 다음 flushPoll에서 화면에 닿는다 */
  completeBatch: (batchId: string, batch: EvalBatch) => void;
  /** 이 배치가 배경에서 죽었다고 해 둔다 */
  failBatch: (batchId: string) => void;
  /** 다음 배치 시작 부탁을 이 까닭으로 물린다 */
  refuseBatchStart: (failure: Message) => void;
  /** 다음 저장 부탁을 이 까닭으로 물린다(1회) */
  refuseSave: (failure: Message) => void;
  /** 걸어 둔 폴링 타이머를 손으로 흘려보낸다 — 부른 만큼만 한 걸음씩 나아간다 */
  flushPoll: () => Promise<void>;
}

/** 대역을 store에 꽂는다 — 시험 저장·배치 실행은 이 대역이 받는다. */
export function serveEval(): EvalServerDouble {
  const datasets = new Map<string, EvalDataset>();
  const batches = new Map<string, BatchState>();
  const timers: { handle: object; cb: () => void }[] = [];
  let starts = 0;
  let polls = 0;
  let batchRefusal: Message | null = null;
  let saveRefusal: Message | null = null;

  const fetchDataset = async (id: string): Promise<DatasetReadOutcome> => {
    const found = datasets.get(id);
    return found ? { dataset: found } : { notFound: true };
  };

  const createDataset = async (dataset: EvalDataset): Promise<DatasetOutcome> => {
    if (saveRefusal) {
      const failure = saveRefusal;
      saveRefusal = null;
      return { failure };
    }
    if (datasets.has(dataset.id)) {
      return { failure: { key: "eval.save.failed", params: { reason: "already saved" } } };
    }
    datasets.set(dataset.id, dataset);
    return { dataset };
  };

  const updateDataset = async (dataset: EvalDataset): Promise<DatasetOutcome> => {
    if (saveRefusal) {
      const failure = saveRefusal;
      saveRefusal = null;
      return { failure };
    }
    if (!datasets.has(dataset.id)) {
      return { failure: { key: "eval.save.failed", params: { reason: "unknown" } } };
    }
    datasets.set(dataset.id, dataset);
    return { dataset };
  };

  const startedWith: BatchAsked[] = [];

  const startBatch = async (
    datasetId: string,
    specId: string,
    specRevision: string,
    useJudge = false,
  ): Promise<BatchStartOutcome> => {
    starts += 1;
    startedWith.push({ datasetId, specId, specRevision, useJudge });
    if (batchRefusal) {
      const failure = batchRefusal;
      batchRefusal = null;
      return { failure };
    }
    const batchId = `batch-${starts}`;
    batches.set(batchId, { status: "running" });
    return { batchId };
  };

  const fetchBatch = async (batchId: string): Promise<BatchReadOutcome> => {
    polls += 1;
    const entry = batches.get(batchId);
    if (!entry) return { failure: { key: "eval.poll.strange" } };
    if (entry.status === "running") return { status: "running" };
    if (entry.status === "failed") return { status: "failed" };
    return { status: "completed", batch: entry.batch as EvalBatch };
  };

  const setPollTimer = (cb: () => void): object => {
    const handle = {};
    timers.push({ handle, cb });
    return handle;
  };

  const clearPollTimer = (handle: unknown): void => {
    const at = timers.findIndex((timer) => timer.handle === handle);
    if (at !== -1) timers.splice(at, 1);
  };

  useEditor.setState({
    fetchDataset,
    createDataset,
    updateDataset,
    startBatch,
    fetchBatch,
    setPollTimer,
    clearPollTimer,
  });

  return {
    datasets,
    startedWith,
    get polls() {
      return polls;
    },
    completeBatch: (batchId, batch) => batches.set(batchId, { status: "completed", batch }),
    failBatch: (batchId) => batches.set(batchId, { status: "failed" }),
    refuseBatchStart: (failure) => {
      batchRefusal = failure;
    },
    refuseSave: (failure) => {
      saveRefusal = failure;
    },
    flushPoll: async () => {
      const due = timers.splice(0, timers.length);
      for (const timer of due) timer.cb();
      await settle();
    },
  };
}
