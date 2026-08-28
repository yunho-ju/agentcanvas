// src/api/eval.ts를 fetch 레벨로 직접 고정한다 — spec-api.test.ts·run-api.test.ts와 같은 관례
// (독립 리뷰 M5). 서버가 어떤 봉투를 보내든 이 문이 읽는 법을 여기서 본다.
import { describe, expect, it } from "vitest";
import type { HttpResponse } from "../src/api/http";
import {
  createDatasetOnServer,
  fetchBatchFromServer,
  fetchBatchListingFromServer,
  fetchDatasetFromServer,
  fetchDatasetSummariesFromServer,
  startBatchOnServer,
  updateDatasetOnServer,
} from "../src/api/eval";
import type { EvalBatch } from "../src/generated/eval_batch";
import type { EvalDataset } from "../src/generated/eval_dataset";
import { translate } from "../src/i18n/messages";

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** 서버 대신 대답하는 사람 — spec-api.test.ts와 같은 문법. */
function server(...replies: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; body?: string }) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    const reply = replies[calls.length - 1] ?? replies.at(-1);
    return { status: reply?.status ?? 500, json: async () => reply?.body ?? {} } satisfies HttpResponse;
  };
  return { calls, fetch };
}

const dataset: EvalDataset = {
  id: "ds-doc-1",
  name: "문서",
  cases: [{ id: "c1", title: "인사", input: {}, expected_phrases: ["안녕"] }],
};

describe("fetchDatasetFromServer — 시험 묶음을 읽는다", () => {
  it("있으면 그대로 돌려준다", async () => {
    const { calls, fetch } = server({ status: 200, body: dataset });

    const outcome = await fetchDatasetFromServer("ds-doc-1", { baseUrl: "http://here", fetch });

    expect(calls).toEqual([{ url: "http://here/eval/datasets/ds-doc-1", method: "GET", body: undefined }]);
    expect(outcome.dataset).toEqual(dataset);
  });

  it("404면 notFound라고만 말한다 — 실패가 아니다", async () => {
    const { fetch } = server({ status: 404, body: { detail: "no dataset called 'ds-doc-1'" } });

    const outcome = await fetchDatasetFromServer("ds-doc-1", { fetch });

    expect(outcome.notFound).toBe(true);
    expect(outcome.failure).toBeUndefined();
  });

  it("서버에 닿지 못하면 쉬운 말로 돌려준다 — 던지지 않는다", async () => {
    const fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    const outcome = await fetchDatasetFromServer("ds-doc-1", { fetch });

    expect("failure" in outcome && outcome.failure).toBeDefined();
    expect(translate("ko", outcome.failure!)).not.toBe("");
  });
});

describe("fetchDatasetSummariesFromServer — 시험 묶음 목록", () => {
  it("요약 배열과 빈 목록을 읽는다", async () => {
    const { fetch } = server({ status: 200, body: [{ id: "ds-a", name: "공유", case_count: 2 }] });
    expect(await fetchDatasetSummariesFromServer({ fetch })).toEqual({ datasets: [{ id: "ds-a", name: "공유", case_count: 2 }] });
    expect(await fetchDatasetSummariesFromServer({ fetch: server({ status: 200, body: [] }).fetch })).toEqual({ datasets: [] });
  });
  it("잘못된 응답은 실패로 감싼다", async () => {
    const outcome = await fetchDatasetSummariesFromServer({ fetch: server({ status: 200, body: { nope: true } }).fetch });
    expect(outcome.failure).toBeDefined();
  });
});

describe("createDatasetOnServer · updateDatasetOnServer", () => {
  it("처음 만드는 묶음은 201로 받는다", async () => {
    const { calls, fetch } = server({ status: 201, body: dataset });

    const outcome = await createDatasetOnServer(dataset, { baseUrl: "http://here", fetch });

    expect(calls).toEqual([{ url: "http://here/eval/datasets", method: "POST", body: dataset }]);
    expect(outcome.dataset).toEqual(dataset);
  });

  it("이미 있는 묶음을 지으려 하면 409를 그대로 실패로 옮긴다", async () => {
    const { fetch } = server({ status: 409, body: { detail: "'ds-doc-1' is already saved" } });

    const outcome = await createDatasetOnServer(dataset, { fetch });

    expect(outcome.dataset).toBeUndefined();
    expect(translate("ko", outcome.failure!)).toContain("already saved");
  });

  it("있는 묶음은 PUT으로 고친다", async () => {
    const { calls, fetch } = server({ status: 200, body: dataset });

    const outcome = await updateDatasetOnServer(dataset, { baseUrl: "http://here", fetch });

    expect(calls).toEqual([
      { url: "http://here/eval/datasets/ds-doc-1", method: "PUT", body: dataset },
    ]);
    expect(outcome.dataset).toEqual(dataset);
  });

  it("없는 묶음을 고치려 하면 404를 실패로 옮긴다", async () => {
    const { fetch } = server({ status: 404, body: { detail: "no dataset called 'ds-doc-1'" } });

    const outcome = await updateDatasetOnServer(dataset, { fetch });

    expect(outcome.dataset).toBeUndefined();
  });
});

describe("startBatchOnServer — 배치를 열어 달라고 부탁한다", () => {
  it("202로 열리면 이름을 받는다", async () => {
    const { calls, fetch } = server({ status: 202, body: { batch_id: "batch-1" } });

    const outcome = await startBatchOnServer("ds-doc-1", "doc-1", "sha256:abc", false, {
      baseUrl: "http://here",
      fetch,
    });

    expect(calls).toEqual([
      {
        url: "http://here/eval/datasets/ds-doc-1/batches",
        method: "POST",
        body: { spec_id: "doc-1", spec_revision: "sha256:abc", use_judge: false },
      },
    ]);
    expect(outcome.batchId).toBe("batch-1");
  });

  it("심판까지 쓰겠다고 켠 실행은 그 선택을 실어 보낸다", async () => {
    const { calls, fetch } = server({ status: 202, body: { batch_id: "batch-2" } });

    await startBatchOnServer("ds-doc-1", "doc-1", "sha256:abc", true, {
      baseUrl: "http://here",
      fetch,
    });

    expect(calls[0].body).toEqual({
      spec_id: "doc-1",
      spec_revision: "sha256:abc",
      use_judge: true,
    });
  });

  it("없는 묶음·그래프면 404를 실패로 옮긴다", async () => {
    const { fetch } = server({ status: 404, body: { detail: "no dataset called 'ds-doc-1'" } });

    const outcome = await startBatchOnServer("ds-doc-1", "doc-1", "sha256:abc", false, { fetch });

    expect(outcome.batchId).toBeUndefined();
    expect(outcome.failure).toBeDefined();
  });

  it("오래된 판이면 409를 실패로 옮긴다", async () => {
    const { fetch } = server({ status: 409, body: { detail: "'doc-1' has moved on" } });

    const outcome = await startBatchOnServer("ds-doc-1", "doc-1", "sha256:abc", false, { fetch });

    expect(outcome.failure).toBeDefined();
  });
});

describe("fetchBatchFromServer — 배치의 지금 모습을 묻는다", () => {
  it("running 봉투를 그대로 옮긴다", async () => {
    const { fetch } = server({ status: 200, body: { status: "running" } });

    const outcome = await fetchBatchFromServer("batch-1", { fetch });

    expect(outcome).toEqual({ status: "running" });
  });

  it("completed 봉투는 배치를 함께 들고 온다", async () => {
    const batch: EvalBatch = {
      id: "batch-1",
      dataset_id: "ds-doc-1",
      spec_id: "doc-1",
      spec_revision: "sha256:abc",
      started_at: new Date().toISOString(),
      results: [],
    };
    const { fetch } = server({ status: 200, body: { status: "completed", batch } });

    const outcome = await fetchBatchFromServer("batch-1", { fetch });

    expect(outcome).toEqual({ status: "completed", batch });
  });

  it("failed 봉투는 서버의 속엣말(message)을 옮기지 않는다 — 상태만 본다", async () => {
    const { fetch } = server({
      status: 200,
      body: { status: "failed", message: "internal traceback: ..." },
    });

    const outcome = await fetchBatchFromServer("batch-1", { fetch });

    expect(outcome).toEqual({ status: "failed" });
  });

  it("서버에 닿지 못하면 쉬운 말로 돌려준다", async () => {
    const fetch = async () => {
      throw new TypeError("Failed to fetch");
    };

    const outcome = await fetchBatchFromServer("batch-1", { fetch });

    expect(outcome.failure).toBeDefined();
  });
});

describe("fetchBatchListingFromServer — 지난 시험 실행 목록", () => {
  it("목록 URL과 요약·has_more를 보존한다", async () => {
    const { calls, fetch } = server({ status: 200, body: { batches: [{ id: "b", started_at: "now", case_count: 2, passed_count: 1 }], has_more: true } });
    const outcome = await fetchBatchListingFromServer("ds-doc-1", { baseUrl: "http://here", fetch });
    expect(calls[0]?.url).toBe("http://here/eval/datasets/ds-doc-1/batches");
    expect(outcome).toEqual({ listing: { batches: [{ id: "b", started_at: "now", case_count: 2, passed_count: 1 }], has_more: true } });
  });

  it("잘못된 shape은 쉬운 실패로 옮긴다", async () => {
    const { fetch } = server({ status: 200, body: { batches: [{ id: "b" }], has_more: false } });
    const outcome = await fetchBatchListingFromServer("ds-doc-1", { fetch });
    expect("failure" in outcome && outcome.failure).toBeDefined();
  });
});
