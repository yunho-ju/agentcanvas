import type { EvalBatch } from "../generated/eval_batch";

export interface EvalBatchSummary {
  id: string;
  started_at: string;
  case_count: number;
  passed_count: number;
}

export interface EvalBatchListing {
  batches: EvalBatchSummary[];
  has_more: boolean;
}

export function batchListingOf(body: unknown): EvalBatchListing | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { batches?: unknown; has_more?: unknown };
  if (!Array.isArray(value.batches) || typeof value.has_more !== "boolean") return null;
  const batches = value.batches.filter(isSummary);
  return batches.length === value.batches.length ? { batches, has_more: value.has_more } : null;
}

function isSummary(value: unknown): value is EvalBatchSummary {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EvalBatchSummary>;
  return (
    typeof item.id === "string" &&
    typeof item.started_at === "string" &&
    Number.isInteger(item.case_count) &&
    Number.isInteger(item.passed_count)
  );
}

export function attemptsForCase(batch: EvalBatch | null, caseId: string) {
  return batch?.results.find((result) => result.case_id === caseId)?.attempts ?? [];
}
