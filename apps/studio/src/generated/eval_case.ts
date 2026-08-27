/* eslint-disable */
/**
 * packages/contracts/json_schema/eval_case.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

/**
 * @minItems 1
 */
export type ExpectedPhrases = [string, ...string[]];
export type Id = string;
export type PassesNeeded = number;
export type RunsPerCase = number;
export type Title = string;

/**
 * 돌려보고 답을 확인할 입력 하나 — 무엇을 넣고, 무슨 말이 들어있어야 통과인가.
 *
 * passes_needed는 runs_per_case를 넘을 수 없다 — 돌리기로 한 횟수보다 더 많은 통과를 요구할 수 없다.
 */
export interface EvalCase {
  expected_phrases: ExpectedPhrases;
  id: Id;
  input: Input;
  passes_needed?: PassesNeeded;
  runs_per_case?: RunsPerCase;
  title: Title;
}
export interface Input {
  [k: string]: unknown;
}
