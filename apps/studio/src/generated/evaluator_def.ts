/* eslint-disable */
/**
 * packages/contracts/json_schema/evaluator_def.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type En = string;
export type Ko = string;
export type Name = string;
export type Version = string;

/**
 * 판정기 하나 — 이름과 버전, 그리고 무엇을 확인하는지 쉬운 말로 설명과 예시.
 */
export interface EvaluatorDef {
  example: LocalizedText;
  name: Name;
  plain_description: LocalizedText;
  version: Version;
}
/**
 * 화면에 그대로 나가는 한 조각의 글. 한 언어만 채운 글은 계약이 아니다.
 */
export interface LocalizedText {
  en: En;
  ko: Ko;
}
