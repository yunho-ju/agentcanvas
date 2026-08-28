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
  | AddNodeOperation
  | RemoveNodeOperation
  | ReplaceNodeConfigOperation
  | AddEdgeOperation
  | RemoveEdgeOperation
  | AddResourceOperation
  | ReplaceResourceOperation
  | RemoveResourceOperation;
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
export type Op5 = "add_resource";
export type AllowedTools = string[];
export type ApprovalPolicy = string;
export type Id2 = string;
export type Kind = string;
export type ServerRef = string;
export type Call = HttpCall | McpCall;
export type Auth = string | null;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Transport = "http";
export type UrlTemplate = string;
export type RemoteName = string;
export type Transport1 = "mcp";
export type Name = string;
export type En = string;
export type Ko = string;
export type ResultHandling = FullResult | SectionsResult | DigestResult | RetrieveResult;
export type Mode = "full";
export type Mode1 = "sections";
export type SectionParam = string;
export type MaxChars = number;
export type Mode2 = "digest";
export type ModelRef = string;
export type By = "section" | "chars";
export type Size = number;
export type Mode3 = "retrieve";
export type QueryParam = string;
export type TopK = number;
export type TimeoutMs = number;
export type Tools = ToolDef[];
export type Op6 = "replace_resource";
export type Op7 = "remove_resource";
export type ResourceId = string;
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
export interface AddResourceOperation {
  op: Op5;
  resource: ResourceBinding;
}
export interface ResourceBinding {
  allowed_tools?: AllowedTools;
  approval_policy: ApprovalPolicy;
  id: Id2;
  kind: Kind;
  server_ref: ServerRef;
  tools?: Tools;
}
/**
 * 바인딩 하나가 들고 다니는 도구 한 개.
 */
export interface ToolDef {
  call: Call;
  input_schema: InputSchema;
  name: Name;
  output_schema: OutputSchema;
  plain_description: LocalizedText;
  result_handling?: ResultHandling;
  timeout_ms: TimeoutMs;
}
/**
 * 우리가 감싼 HTTP API를 부르는 방법.
 */
export interface HttpCall {
  auth?: Auth;
  method: HttpMethod;
  transport: Transport;
  url_template: UrlTemplate;
}
/**
 * MCP 서버가 아는 이름으로 도구를 부르는 방법.
 */
export interface McpCall {
  remote_name: RemoteName;
  transport: Transport1;
}
export interface InputSchema {
  [k: string]: unknown;
}
export interface OutputSchema {
  [k: string]: unknown;
}
/**
 * 화면에 그대로 나가는 한 조각의 글. 한 언어만 채운 글은 계약이 아니다.
 */
export interface LocalizedText {
  en: En;
  ko: Ko;
}
/**
 * 받은 것을 그대로 싣는다 — 작은 응답의 기본값.
 */
export interface FullResult {
  mode: Mode;
}
/**
 * 부르는 쪽이 필요한 섹션만 골라 받는다.
 */
export interface SectionsResult {
  mode: Mode1;
  section_param: SectionParam;
}
/**
 * 받은 전체를 모델로 줄여 싣는다 — 요약 모델은 본 실행과 분리한다.
 */
export interface DigestResult {
  max_chars: MaxChars;
  mode: Mode2;
  model_ref: ModelRef;
}
/**
 * 질의로 관련 조각만 골라 싣는다.
 */
export interface RetrieveResult {
  chunk: ChunkRule;
  mode: Mode3;
  query_param: QueryParam;
  top_k: TopK;
}
/**
 * 긴 글을 어떤 단위로 얼마씩 자를지.
 */
export interface ChunkRule {
  by: By;
  size: Size;
}
/**
 * 같은 id의 바인딩을 통째로 갈아 끼운다 — 도구 목록까지 새 것이 된다.
 */
export interface ReplaceResourceOperation {
  op: Op6;
  resource: ResourceBinding;
}
export interface RemoveResourceOperation {
  op: Op7;
  resource_id: ResourceId;
}
