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

/** 화면이 말하는 그 회차 — 몇 번째였는지, 몇 번 중 몇 번째였는지, 그때 나온 답. */
export interface AttemptInQuestion {
  /** 1부터 세는 회차 번호 */
  round: number;
  /** 이 케이스를 돌린 전체 횟수 */
  rounds: number;
  /** 빈 문자열은 "돌았지만 답이 없었다"는 사실이다: 없음과 다르다(DESIGN §7 eval-case-card). */
  output: string;
}

/**
 * 이 케이스에서 화면이 말할 회차 — 실패한 회차가 있으면 그중 가장 최근, 없으면 마지막 회차다.
 * 집계로 실패한 케이스(여러 번 중 몇 번만 통과)에서 마지막 회차를 보여 주면
 * "통과한 답 옆에 빠진 말이 없다"는 모순이 된다 — 실패의 까닭은 실패한 그 회차에 있다.
 * 돌린 적이 없으면 없다(undefined).
 */
export function attemptInQuestion(
  caseId: string,
  batch: EvalBatch | null,
): AttemptInQuestion | undefined {
  const attempts = batch?.results.find((item) => item.case_id === caseId)?.attempts ?? [];
  let index = attempts.length - 1;
  for (let at = attempts.length - 1; at >= 0; at -= 1) {
    if (!attempts[at].passed) {
      index = at;
      break;
    }
  }
  if (index < 0) return undefined;
  return { round: index + 1, rounds: attempts.length, output: attempts[index].output_text };
}
