/* eslint-disable */
/**
 * packages/contracts/json_schema/schema_def.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type Ref = string;
export type En = string;
export type Ko = string;

/**
 * ref 하나가 가리키는 값의 형식 — 폼은 이 `schema`를 그린다.
 */
export interface SchemaDef {
  ref: Ref;
  schema: Schema;
  title: LocalizedText;
}
export interface Schema {
  [k: string]: unknown;
}
/**
 * 화면에 그대로 나가는 한 조각의 글. 한 언어만 채운 글은 계약이 아니다.
 */
export interface LocalizedText {
  en: En;
  ko: Ko;
}
