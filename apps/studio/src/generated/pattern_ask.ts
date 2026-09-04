/* eslint-disable */
/**
 * packages/contracts/json_schema/pattern_ask.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type En = string;
export type Ko = string;
export type PatternId = string;

/**
 * 사람에게 던지는 물음 하나 — 무엇을 묻는가와 그 대가.
 */
export interface PatternAsk {
  cost: LocalizedText;
  pattern_id: PatternId;
  question: LocalizedText;
}
/**
 * 화면에 그대로 나가는 한 조각의 글. 한 언어만 채운 글은 계약이 아니다.
 */
export interface LocalizedText {
  en: En;
  ko: Ko;
}
