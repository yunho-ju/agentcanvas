/* eslint-disable */
/**
 * packages/contracts/json_schema/agent_spec.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type Expression = string;
export type Language = "cel";
export type Id = string;
export type EdgeKind = "data" | "control" | "approval";
export type Node = string;
export type Port = string;
export type Edges = Edge[];
export type Checkpointer = string;
export type MaxRuntimeMs = number;
export type MaxToolCalls = number;
export type MaxTotalTokens = number;
export type ReplayPolicy = string;
export type Id1 = string;
export type Name = string | null;
export type Id2 = string;
export type X = number;
export type Y = number;
export type Type = string;
export type Nodes = Node1[];
export type AllowedTools = string[];
export type ApprovalPolicy = string;
export type Id3 = string;
export type Kind = string;
export type ServerRef = string;
export type Resources = ResourceBinding[];
export type Revision = string;
export type SchemaVersion = "agent.spec/v1";
export type AgentStatus = "draft" | "validated" | "approved" | "published" | "deprecated";
export type Version = number;

export interface AgentSpec {
  edges: Edges;
  execution?: ExecutionConfig | null;
  id: Id1;
  input_schema: InputSchema;
  name?: Name;
  nodes: Nodes;
  resources?: Resources;
  revision: Revision;
  schema_version: SchemaVersion;
  state_schema: StateSchema;
  status: AgentStatus;
  version: Version;
}
export interface Edge {
  condition?: EdgeCondition | null;
  id: Id;
  kind: EdgeKind;
  source: EdgeEndpoint;
  target: EdgeEndpoint;
}
export interface EdgeCondition {
  expression: Expression;
  language: Language;
}
export interface EdgeEndpoint {
  node: Node;
  port: Port;
}
export interface ExecutionConfig {
  checkpointer: Checkpointer;
  limits: ExecutionLimits;
  replay_policy: ReplayPolicy;
}
export interface ExecutionLimits {
  max_runtime_ms: MaxRuntimeMs;
  max_tool_calls: MaxToolCalls;
  max_total_tokens: MaxTotalTokens;
}
export interface InputSchema {
  [k: string]: unknown;
}
export interface Node1 {
  config?: Config;
  id: Id2;
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
export interface ResourceBinding {
  allowed_tools?: AllowedTools;
  approval_policy: ApprovalPolicy;
  id: Id3;
  kind: Kind;
  server_ref: ServerRef;
}
export interface StateSchema {
  [k: string]: unknown;
}
