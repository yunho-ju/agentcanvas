// 요약 pill의 판정 — 결론이 숫자보다 먼저다 (DESIGN §7 eval-summary-pill). 순수 함수.
import type { EvalBatch } from "../generated/eval_batch";

export type PillVerdict = "none" | "running" | "allPassed" | "someFailed";

export interface EvalSummary {
  verdict: PillVerdict;
  /** 마지막으로 돈 배치의 케이스 수(running·none일 때는 지금 묶음의 케이스 수) */
  total: number;
  passed: number;
  failed: number;
}

/**
 * 4상태(§9 3중 표기) — 실행 중 > 완결된 배치의 결과 > 아직 안 돌림, 순서로 가린다.
 * running 동안의 부분 진행 개수는 서버가 주지 않는다(all-or-nothing) — 그래서 이 상태는
 * 개수를 들고 있지 않는다: 없는 값을 지어내지 않는다(§9 조용한 무시·거짓 정밀도 금지).
 */
export function summaryOf(input: {
  caseCount: number;
  running: boolean;
  batch: EvalBatch | null;
}): EvalSummary {
  const { caseCount, running, batch } = input;
  if (running) return { verdict: "running", total: caseCount, passed: 0, failed: 0 };
  if (batch === null) return { verdict: "none", total: caseCount, passed: 0, failed: 0 };
  const passed = batch.results.filter((result) => result.passed).length;
  const total = batch.results.length;
  const failed = total - passed;
  return { verdict: failed === 0 ? "allPassed" : "someFailed", total, passed, failed };
}
