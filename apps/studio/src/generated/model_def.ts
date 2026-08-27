/* eslint-disable */
/**
 * packages/contracts/json_schema/model_def.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type BaseUrl = string | null;
export type ModelId = string;
export type Provider = "anthropic" | "openai_compatible";
export type Ref = string;
export type En = string;
export type Ko = string;

/**
 * ref 하나가 가리키는 모델 — 형식이 아니라 이름이라 schema를 들고 다니지 않는다.
 *
 * 이 목록은 git에 커밋되고 화면으로 그대로 나가는 공개 데이터다: 열쇠는 여기 적지 않는다
 * (열쇠는 서버만 아는 `secret://` 이름으로 따로 산다).
 */
export interface ModelDef {
  base_url?: BaseUrl;
  model_id: ModelId;
  provider: Provider;
  ref: Ref;
  title: LocalizedText;
}
/**
 * 화면에 그대로 나가는 한 조각의 글. 한 언어만 채운 글은 계약이 아니다.
 */
export interface LocalizedText {
  en: En;
  ko: Ko;
}
