/* eslint-disable */
/**
 * packages/contracts/json_schema/skipped_pattern.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type PatternId = string;
export type En = string;
export type Ko = string;

/**
 * 예라고 했는데 넣지 못한 모양 — 무엇이 모자랐는지 사람이 읽는 말로 말한다.
 */
export interface SkippedPattern {
  pattern_id: PatternId;
  why: LocalizedText;
}
/**
 * 화면에 그대로 나가는 한 조각의 글. 한 언어만 채운 글은 계약이 아니다.
 */
export interface LocalizedText {
  en: En;
  ko: Ko;
}
