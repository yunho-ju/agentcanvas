import type { EvalBatch, EvalCaseResult } from "../generated/eval_batch";
import type { EvalCase } from "../generated/eval_case";

export interface EvalCompareResult {
  passed: boolean;
  attempts: { passed: boolean; output_text: string }[];
}

export interface EvalCompareCase {
  caseId: string;
  left: EvalCompareResult | null;
  right: EvalCompareResult | null;
  same: boolean;
  missing: "left" | "right" | "both" | null;
}

export interface EvalBatchComparison {
  cases: EvalCompareCase[];
  firstDivergence: number | null;
}

function projection(result: EvalCaseResult | null): EvalCompareResult | null {
  return result === null ? null : { passed: result.passed, attempts: result.attempts.map(({ passed, output_text }) => ({ passed, output_text })) };
}

function resultSame(left: EvalCompareResult | null, right: EvalCompareResult | null): boolean {
  if (left === null || right === null) return left === right;
  if (left.passed !== right.passed || left.attempts.length !== right.attempts.length) return false;
  return left.attempts.every((attempt, index) => {
    const other = right.attempts[index];
    return other !== undefined && attempt.passed === other.passed && attempt.output_text === other.output_text;
  });
}

/** Compares only user-visible case outcomes, in the dataset's order. */
export function compareEvalBatches(
  datasetCases: EvalCase[],
  left: EvalBatch,
  right: EvalBatch,
): EvalBatchComparison {
  const cases = datasetCases.map((evalCase) => {
    const leftResult = left.results.find((result) => result.case_id === evalCase.id) ?? null;
    const rightResult = right.results.find((result) => result.case_id === evalCase.id) ?? null;
    const missing: EvalCompareCase["missing"] = leftResult === null && rightResult === null ? "both" : leftResult === null ? "left" : rightResult === null ? "right" : null;
    const leftProjection = projection(leftResult);
    const rightProjection = projection(rightResult);
    return { caseId: evalCase.id, left: leftProjection, right: rightProjection, same: resultSame(leftProjection, rightProjection), missing };
  });
  const firstDivergence = cases.findIndex((item) => !item.same);
  return { cases, firstDivergence: firstDivergence === -1 ? null : firstDivergence };
}
