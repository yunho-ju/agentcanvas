// 회차마다 답이 갈렸는가 — 무료로 얻는 안정성 관찰 (DESIGN §7 eval-case-card 주의 신호 한 줄).
// 판정이 아니다: 통과/실패를 바꾸지 않고, 서버에 물어보지도 않는다. 이미 받은 회차들에서 파생된다.
// 답은 글자 그대로 견준다 — 판정의 정규화(NFC·대소문자·공백)는 서버의 몫이고, 여기서 흉내 내지 않는다.
import type { EvalBatch } from "../generated/eval_batch";

/** 몇 번 돌렸고, 그중 서로 다른 답이 몇 가지였는가. */
export interface AnswerSpread {
  rounds: number;
  answers: number;
}

/** 답이 갈린 케이스만 말한다 — 한 번만 돌렸거나 모두 같은 답이면 할 말이 없다(undefined). */
export function answerSpread(caseId: string, batch: EvalBatch | null): AnswerSpread | undefined {
  const attempts = batch?.results.find((item) => item.case_id === caseId)?.attempts ?? [];
  if (attempts.length < 2) return undefined;
  const answers = new Set(attempts.map((attempt) => attempt.output_text)).size;
  if (answers < 2) return undefined;
  return { rounds: attempts.length, answers };
}
