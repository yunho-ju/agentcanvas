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
export type Call = HttpCall | McpCall;
export type Auth = string | null;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Transport = "http";
export type UrlTemplate = string;
export type RemoteName = string;
export type Transport1 = "mcp";
export type Name1 = string;
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
  tools?: Tools;
}
/**
 * 바인딩 하나가 들고 다니는 도구 한 개.
 */
export interface ToolDef {
  call: Call;
  input_schema: InputSchema1;
  name: Name1;
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
export interface InputSchema1 {
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
export interface StateSchema {
  [k: string]: unknown;
}
