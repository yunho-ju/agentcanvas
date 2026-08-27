/* eslint-disable */
/**
 * packages/contracts/json_schema/agent_spec_patch.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type BaseRevision = string;
/**
 * @minItems 1
 * @maxItems 32
 */
export type Operations = [PatchOperation, ...PatchOperation[]];
export type PatchOperation =
  AddNodeOperation | RemoveNodeOperation | ReplaceNodeConfigOperation | AddEdgeOperation | RemoveEdgeOperation;
export type Id = string;
export type X = number;
export type Y = number;
export type Type = string;
export type Op = "add_node";
export type NodeId = string;
export type Op1 = "remove_node";
export type NodeId1 = string;
export type Op2 = "replace_node_config";
export type Expression = string;
export type Language = "cel";
export type Id1 = string;
export type EdgeKind = "data" | "control" | "approval";
export type Node1 = string;
export type Port = string;
export type Op3 = "add_edge";
export type EdgeId = string;
export type Op4 = "remove_edge";
export type SchemaVersion = "agent.patch/v1";

/**
 * AgentSpec을 안전하게 바꾸기 위한 순서 있는 작업 목록.
 */
export interface AgentSpecPatch {
  base_revision: BaseRevision;
  operations: Operations;
  schema_version: SchemaVersion;
}
export interface AddNodeOperation {
  node: Node;
  op: Op;
}
export interface Node {
  config?: Config;
  id: Id;
  position: Position;
  type: Type;
}
export interface Config {
  [k: string]: unknown;
}
export interface Position {
  x: X;
  y: Y;
}
export interface RemoveNodeOperation {
  node_id: NodeId;
  op: Op1;
}
export interface ReplaceNodeConfigOperation {
  config: Config1;
  node_id: NodeId1;
  op: Op2;
}
export interface Config1 {
  [k: string]: unknown;
}
export interface AddEdgeOperation {
  edge: Edge;
  op: Op3;
}
export interface Edge {
  condition?: EdgeCondition | null;
  id: Id1;
  kind: EdgeKind;
  source: EdgeEndpoint;
  target: EdgeEndpoint;
}
export interface EdgeCondition {
  expression: Expression;
  language: Language;
}
export interface EdgeEndpoint {
  node: Node1;
  port: Port;
}
export interface RemoveEdgeOperation {
  edge_id: EdgeId;
  op: Op4;
}
