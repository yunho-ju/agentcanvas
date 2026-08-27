// 케이스 카드 한 줄의 상태 — 통과/실패/도는 중/아직 (DESIGN §7 eval-case-card). 순수 함수.
import type { EvalBatch } from "../generated/eval_batch";

export type CaseCardState =
  | { kind: "none" }
  | { kind: "running" }
  | { kind: "passed" }
  | { kind: "failed"; passed: number; runs: number };

export function caseCardState(
  caseId: string,
  input: { running: boolean; batch: EvalBatch | null },
): CaseCardState {
  if (input.running) return { kind: "running" };
  const result = input.batch?.results.find((item) => item.case_id === caseId);
  if (!result) return { kind: "none" };
  if (result.passed) return { kind: "passed" };
  const passed = result.attempts.filter((attempt) => attempt.passed).length;
  return { kind: "failed", passed, runs: result.attempts.length };
}

/**
 * 이 케이스가 마지막으로 돈 회차의 실제 답 — 돌린 적이 없으면 없다(undefined).
 * 빈 문자열은 "돌았지만 답이 없었다"는 사실이다: 없음과 다르다(DESIGN §7 eval-case-card 갱신본).
 */
export function lastAttemptOutput(caseId: string, batch: EvalBatch | null): string | undefined {
  const result = batch?.results.find((item) => item.case_id === caseId);
  return result?.attempts.at(-1)?.output_text;
}
