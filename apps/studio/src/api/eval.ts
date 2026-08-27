// 시험 묶음과 배치를 서버에 부탁하는 문. specs.ts·runs.ts와 같은 관례다 —
// 어디로·무엇으로는 밖에서 정하고(시험은 가짜를 꽂는다), 실패는 던지지 않고 쉬운 말로 돌려준다.
// 봉투 타입(Outcome)의 원천은 eval/ 순수 모듈이다 — 이 파일은 그 모양에 서버 답을 맞춰 옮길 뿐,
// 거꾸로 eval/이 이 파일을 들여다보지 않는다(의존 방향은 api → eval 한쪽으로만).
import type { BatchReadOutcome, BatchStartOutcome } from "../eval/batchPoller";
import { batchListingOf, type EvalBatchListing } from "../eval/batchHistory";
import { datasetSummariesOf, type DatasetListOutcome, type DatasetOutcome, type DatasetReadOutcome } from "../eval/dataset";
import type { EvalBatch } from "../generated/eval_batch";
import type { EvalDataset } from "../generated/eval_dataset";
import { msg } from "../i18n/messages";
import {
  type HttpResponse,
  type SendRequest,
  type ServerOptions,
  UNREADABLE,
  apiBaseUrl,
  bodyOf,
  reasonOf,
} from "./http";

export type { DatasetOutcome, DatasetReadOutcome } from "../eval/dataset";
export type { DatasetListOutcome } from "../eval/dataset";
export type { BatchStartOutcome } from "../eval/batchPoller";
export type { EvalBatchListing } from "../eval/batchHistory";

export type EvalApiOptions = ServerOptions;

const OK = 200;
const CREATED = 201;
const ACCEPTED = 202;
const CONFLICT = 409;
const NOT_FOUND = 404;

export async function fetchDatasetSummariesFromServer(options: EvalApiOptions = {}): Promise<DatasetListOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const answer = await ask(`${base}/eval/datasets`, options);
  if (answer === null) return { failure: msg("eval.dataset.offline") };
  if (answer.body === UNREADABLE || answer.response.status !== OK) return { failure: msg("eval.dataset.failed") };
  const datasets = datasetSummariesOf(answer.body);
  return datasets ? { datasets } : { failure: msg("eval.dataset.failed") };
}

async function ask(
  url: string,
  options: EvalApiOptions,
): Promise<{ response: HttpResponse; body: unknown } | null> {
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  try {
    const response = await send(url, { method: "GET", headers: {} });
    return { response, body: await bodyOf(response) };
  } catch {
    return null;
  }
}

function datasetOf(body: unknown): EvalDataset | null {
  const dataset = body as EvalDataset | null;
  return dataset && typeof dataset === "object" && typeof dataset.id === "string"
    ? dataset
    : null;
}

/** 이 문서의 시험 묶음을 읽는다 — 아직 한 번도 저장한 적이 없으면 없다(notFound)고 말한다. */
export async function fetchDatasetFromServer(
  id: string,
  options: EvalApiOptions = {},
): Promise<DatasetReadOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const answer = await ask(`${base}/eval/datasets/${encodeURIComponent(id)}`, options);
  if (answer === null) return { failure: msg("eval.offline") };
  if (answer.response.status === NOT_FOUND) return { notFound: true };
  if (answer.body === UNREADABLE || answer.response.status !== OK) {
    return { failure: msg("eval.strange") };
  }
  const dataset = datasetOf(answer.body);
  return dataset ? { dataset } : { failure: msg("eval.strange") };
}

async function sendDataset(
  method: "POST" | "PUT",
  url: string,
  dataset: EvalDataset,
  options: EvalApiOptions,
): Promise<DatasetOutcome> {
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  try {
    const answered = await send(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dataset),
    });
    const body = await bodyOf(answered);
    const expected = method === "POST" ? CREATED : OK;
    if (answered.status === expected) {
      const found = datasetOf(body);
      return found ? { dataset: found } : { failure: msg("eval.save.strange") };
    }
    if (body === UNREADABLE) return { failure: msg("eval.save.strange") };
    return {
      failure: msg("eval.save.failed", { reason: reasonOf(body) || String(answered.status) }),
    };
  } catch {
    return { failure: msg("eval.save.offline") };
  }
}

/** 처음 만드는 시험 묶음을 서버에 맡긴다 — 이미 있는 이름이면 409로 물린다(그때는 update를 쓴다). */
export function createDatasetOnServer(
  dataset: EvalDataset,
  options: EvalApiOptions = {},
): Promise<DatasetOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  return sendDataset("POST", `${base}/eval/datasets`, dataset, options);
}

/** 이미 있는 시험 묶음을 통째로 고쳐 맡긴다. */
export function updateDatasetOnServer(
  dataset: EvalDataset,
  options: EvalApiOptions = {},
): Promise<DatasetOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  return sendDataset(
    "PUT",
    `${base}/eval/datasets/${encodeURIComponent(dataset.id)}`,
    dataset,
    options,
  );
}

function batchIdOf(body: unknown): string | null {
  const envelope = body as { batch_id?: unknown };
  return typeof envelope?.batch_id === "string" ? envelope.batch_id : null;
}

/** 이 묶음을 그 문서의 그 판에 대고 한 번 돌려 달라고 부탁한다. */
export async function startBatchOnServer(
  datasetId: string,
  specId: string,
  specRevision: string,
  options: EvalApiOptions = {},
): Promise<BatchStartOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const url = `${base}/eval/datasets/${encodeURIComponent(datasetId)}/batches`;
  try {
    const answered = await send(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spec_id: specId, spec_revision: specRevision }),
    });
    const body = await bodyOf(answered);
    if (answered.status === ACCEPTED) {
      const batchId = batchIdOf(body);
      return batchId ? { batchId } : { failure: msg("eval.run.strange") };
    }
    if (answered.status === NOT_FOUND) return { failure: msg("eval.run.notSaved") };
    if (answered.status === CONFLICT) return { failure: msg("eval.run.moved") };
    if (body === UNREADABLE) return { failure: msg("eval.run.strange") };
    return {
      failure: msg("eval.run.failed", { reason: reasonOf(body) || String(answered.status) }),
    };
  } catch {
    return { failure: msg("eval.run.offline") };
  }
}

function batchOf(body: unknown): EvalBatch | null {
  const batch = body as EvalBatch | null;
  return batch && typeof batch === "object" && typeof batch.id === "string" ? batch : null;
}

/** 배치의 지금 모습을 한 번 묻는다 — 폴러가 이 부탁을 되풀이한다. */
export async function fetchBatchFromServer(
  batchId: string,
  options: EvalApiOptions = {},
): Promise<BatchReadOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const answer = await ask(`${base}/eval/batches/${encodeURIComponent(batchId)}`, options);
  if (answer === null) return { failure: msg("eval.poll.offline") };
  if (answer.body === UNREADABLE || answer.response.status !== OK) {
    return { failure: msg("eval.poll.strange") };
  }
  const envelope = answer.body as { status?: unknown; batch?: unknown };
  if (envelope.status === "running") return { status: "running" };
  if (envelope.status === "failed") return { status: "failed" };
  if (envelope.status === "completed") {
    const batch = batchOf(envelope.batch);
    return batch ? { status: "completed", batch } : { failure: msg("eval.poll.strange") };
  }
  return { failure: msg("eval.poll.strange") };
}

export async function fetchBatchListingFromServer(
  datasetId: string,
  options: EvalApiOptions = {},
): Promise<{ listing: EvalBatchListing } | { failure: ReturnType<typeof msg> }> {
  const base = options.baseUrl ?? apiBaseUrl();
  const answer = await ask(
    `${base}/eval/datasets/${encodeURIComponent(datasetId)}/batches`,
    options,
  );
  if (answer === null) return { failure: msg("eval.history.offline") };
  if (answer.body === UNREADABLE || answer.response.status !== OK) {
    return { failure: msg("eval.history.strange") };
  }
  const listing = batchListingOf(answer.body);
  return listing ? { listing } : { failure: msg("eval.history.strange") };
}
