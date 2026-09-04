/* eslint-disable */
/**
 * packages/contracts/json_schema/pattern_def.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type En = string;
export type Ko = string;
export type Detects = string;
export type Id = string;
export type Needs = ("tool_calling" | "human_gate" | "router")[];
export type TemplateOp =
  AddNodeTemplateOp | ReplaceNodeConfigTemplateOp | RequireToolsTemplateOp | AddEdgeTemplateOp | RemoveEdgeTemplateOp;
export type NodeAnchor = string;
export type Op = "add_node";
export type Type = string;
export type Op1 = "replace_node_config";
export type Op2 = "requires_tools";
export type EdgeKind = "data" | "control" | "approval";
export type Op3 = "add_edge";
export type Port = string;
export type Op4 = "remove_edge";
export type PatchTemplate = TemplateOp[];

/**
 * 카탈로그의 한 항목 — 물음과 근거와 대가, 그리고 그것을 문서에 놓는 방법.
 */
export interface PatternDef {
  applies_when: LocalizedText;
  cost: LocalizedText;
  detects: Detects;
  id: Id;
  needs: Needs;
  question: LocalizedText;
  template: PatchTemplate;
}
/**
 * 화면에 그대로 나가는 한 조각의 글. 한 언어만 채운 글은 계약이 아니다.
 */
export interface LocalizedText {
  en: En;
  ko: Ko;
}
export interface AddNodeTemplateOp {
  config?: Config;
  node: NodeAnchor;
  op: Op;
  type: Type;
}
export interface Config {
  [k: string]: unknown;
}
/**
 * 앵커가 가리키는 노드의 설정에 이 값들을 얹는다.
 *
 * `agent.patch/v1`의 replace_node_config는 설정을 통째로 갈아 끼우므로, 앵커를 채우는
 * 쪽이 문서의 설정 위에 이 값을 얹어 온전한 작업을 만든다 (모델 이름을 잃지 않는다).
 */
export interface ReplaceNodeConfigTemplateOp {
  config: Config1;
  node: NodeAnchor;
  op: Op1;
}
export interface Config1 {
  [k: string]: unknown;
}
/**
 * 이 앵커의 노드가 쓸 도구를 이미 고른 문서에서만 템플릿이 채워진다.
 *
 * 작업이 아니라 조건이다: 도구가 없는 에이전트의 턴만 늘리면 쓰지 못하는 칸을 켜 두게 되고,
 * 사람은 무엇이 모자란지 듣지 못한다.
 */
export interface RequireToolsTemplateOp {
  node: NodeAnchor;
  op: Op2;
}
export interface AddEdgeTemplateOp {
  kind: EdgeKind;
  op: Op3;
  source: TemplateEndpoint;
  target: TemplateEndpoint;
}
export interface TemplateEndpoint {
  node: NodeAnchor;
  port: Port;
}
/**
 * 두 앵커 사이의 연결을 걷어낸다 — 연결의 id는 문서마다 다르므로 양 끝으로 적는다.
 */
export interface RemoveEdgeTemplateOp {
  op: Op4;
  source: NodeAnchor;
  target: NodeAnchor;
}
