/* eslint-disable */
/**
 * packages/contracts/json_schema/node_type.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type En = string;
export type Ko = string;
export type Id = string;
export type Inputs = PortSpec[];
export type Outputs = PortSpec[];
export type Runtime = string;
export type Type = string;
export type Version = string;

export interface NodeType {
  config_schema: ConfigSchema;
  display_name: LocalizedText;
  plain_description: LocalizedText;
  ports: Ports;
  runtime: Runtime;
  type: Type;
  version: Version;
}
export interface ConfigSchema {
  [k: string]: unknown;
}
/**
 * 화면에 그대로 나가는 한 조각의 글. 한 언어만 채운 글은 계약이 아니다.
 */
export interface LocalizedText {
  en: En;
  ko: Ko;
}
export interface Ports {
  inputs?: Inputs;
  outputs?: Outputs;
}
export interface PortSpec {
  id: Id;
  plain_description?: LocalizedText | null;
  schema: Schema;
}
export interface Schema {
  [k: string]: unknown;
}
