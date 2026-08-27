/* eslint-disable */
/**
 * packages/contracts/json_schema/instruction_preset_def.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type Id = string;
export type En = string;
export type Ko = string;

/**
 * 골라 채우는 시작 글 하나 — 이름표(제목)와 채워질 본문이 전부다.
 */
export interface InstructionPresetDef {
  id: Id;
  text: LocalizedText;
  title: LocalizedText;
}
/**
 * 화면에 그대로 나가는 한 조각의 글. 한 언어만 채운 글은 계약이 아니다.
 */
export interface LocalizedText {
  en: En;
  ko: Ko;
}
