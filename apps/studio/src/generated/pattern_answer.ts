/* eslint-disable */
/**
 * packages/contracts/json_schema/pattern_answer.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type Answer = "yes" | "no" | "skipped";
export type PatternId = string;

/**
 * 그 물음에 사람이 한 답 — 모른다("skipped")는 아니오와 다른 답이다.
 */
export interface PatternAnswer {
  answer: Answer;
  pattern_id: PatternId;
}
