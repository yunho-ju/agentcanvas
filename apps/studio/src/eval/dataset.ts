// 시험 묶음(dataset)에 케이스 하나를 넣고 빼는 일 — 전부 순수 함수다.
// 서버는 묶음 전체를 받는다(v1은 케이스 단위 API가 없다): 화면은 여기서 통째로 지어 보낸다.
// 봉투 타입(Outcome)도 여기가 원천이다 — api/는 이 모양에 맞춰 서버 답을 옮길 뿐(단방향 eval ← api 금지).
import type { EvalCase } from "../generated/eval_case";
import type { EvalDataset } from "../generated/eval_dataset";
import type { Message } from "../i18n/messages";

export interface EvalDatasetSummary {
  id: string;
  name: string;
  case_count: number;
}

export type DatasetListOutcome =
  | { datasets: EvalDatasetSummary[]; failure?: undefined }
  | { datasets?: undefined; failure: Message };

export function datasetSummariesOf(body: unknown): EvalDatasetSummary[] | null {
  const items = Array.isArray(body) ? body : (body as { datasets?: unknown } | null)?.datasets;
  if (!Array.isArray(items)) return null;
  const summaries: EvalDatasetSummary[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const value = item as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.name !== "string" || typeof value.case_count !== "number") return null;
    summaries.push({ id: value.id, name: value.name, case_count: value.case_count });
  }
  return summaries;
}

const LINK_KEY = "aval.eval.dataset-links";

function links(storage: Storage | undefined = globalThis.localStorage): Record<string, string> {
  try {
    const value = storage?.getItem(LINK_KEY);
    if (!value) return {};
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

export function datasetIdForSpec(specId: string, storage: Storage | undefined = globalThis.localStorage): string | null {
  try {
    const value = storage?.getItem(LINK_KEY);
    if (!value) return null;
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as Record<string, unknown>)[specId] === "string"
      ? (parsed as Record<string, string>)[specId]
      : null;
  } catch {
    return null;
  }
}

export function setDatasetIdForSpec(specId: string, datasetId: string | null, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    const next = links(storage);
    if (datasetId) next[specId] = datasetId;
    else delete next[specId];
    storage?.setItem(LINK_KEY, JSON.stringify(next));
  } catch {
    // Private browsing and malformed storage are intentionally treated as no link.
  }
}

/** 묶음을 열거나 고친 결말 — 서버가 받아 준 묶음이거나, 받지 못한 까닭이다. */
export type DatasetOutcome =
  | { dataset: EvalDataset; failure?: undefined }
  | { dataset?: undefined; failure: Message };

/** 묶음을 읽어 본 결말 — 있으면 묶음, 없으면(404) notFound, 그 밖은 까닭. */
export type DatasetReadOutcome =
  | { dataset: EvalDataset; notFound?: undefined; failure?: undefined }
  | { dataset?: undefined; notFound: true; failure?: undefined }
  | { dataset?: undefined; notFound?: undefined; failure: Message };

/** 새로 여는 묶음 — 문서 이름을 그대로 물려받는다 (DESIGN §7 eval-panel). */
export function newDataset(id: string, name: string): EvalDataset {
  return { id, name, cases: [] };
}

/** 이 케이스를 넣는다 — 같은 id가 있으면 그 자리에서 바꾸고, 없으면 뒤에 붙인다. */
export function withCase(dataset: EvalDataset, evalCase: EvalCase): EvalDataset {
  const cases = dataset.cases ?? [];
  const at = cases.findIndex((existing) => existing.id === evalCase.id);
  return {
    ...dataset,
    cases: at === -1 ? [...cases, evalCase] : cases.map((c, i) => (i === at ? evalCase : c)),
  };
}

/** 이 케이스를 뺀 묶음과, 빼낸 케이스가 있던 자리 — 복원은 그 자리를 그대로 되돌려 준다. */
export function withoutCase(
  dataset: EvalDataset,
  caseId: string,
): { dataset: EvalDataset; removed: EvalCase; index: number } | null {
  const cases = dataset.cases ?? [];
  const index = cases.findIndex((existing) => existing.id === caseId);
  if (index === -1) return null;
  return {
    dataset: { ...dataset, cases: cases.filter((existing) => existing.id !== caseId) },
    removed: cases[index],
    index,
  };
}

/** 뺐던 케이스를 그 자리에 되돌린다. */
export function withCaseAt(dataset: EvalDataset, evalCase: EvalCase, index: number): EvalDataset {
  const cases = [...(dataset.cases ?? [])];
  cases.splice(Math.min(index, cases.length), 0, evalCase);
  return { ...dataset, cases };
}

/** 이 케이스들의 지금 쓰이고 있는 id들 — 새 id를 지을 때 겹치지 않게 본다. */
export function caseIds(dataset: EvalDataset | null): string[] {
  return dataset?.cases?.map((c) => c.id) ?? [];
}

/** 묶음을 읽어 본 뒤 store에 그대로 앉힐 조각 — 세 갈래(있음·없음·못 읽음)를 한 판정으로 모은다. */
export interface DatasetLoadPatch {
  datasetKnownOnServer: boolean;
  dataset: EvalDataset | null;
  datasetSynced: EvalDataset | null;
  caseSaveNotice?: { message: Message; tone: "danger" };
}

/** 서버가 방금 받아 준 묶음 — 이 자리부터는 dataset과 datasetSynced가 같은 것을 가리킨다. */
export function datasetSyncedPatch(
  dataset: EvalDataset,
): Pick<DatasetLoadPatch, "datasetKnownOnServer" | "dataset" | "datasetSynced"> {
  return { datasetKnownOnServer: true, dataset, datasetSynced: dataset };
}

export function datasetLoadPatch(outcome: DatasetReadOutcome): DatasetLoadPatch {
  if (outcome.dataset) return datasetSyncedPatch(outcome.dataset);
  if (outcome.notFound) {
    return { datasetKnownOnServer: false, dataset: null, datasetSynced: null };
  }
  return {
    datasetKnownOnServer: false,
    dataset: null,
    datasetSynced: null,
    caseSaveNotice: { message: outcome.failure, tone: "danger" },
  };
}
