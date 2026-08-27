/* eslint-disable */
/**
 * packages/contracts/json_schema/run_event.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type EventType =
  | "run.started"
  | "node.queued"
  | "node.started"
  | "prompt.compiled"
  | "llm.requested"
  | "llm.completed"
  | "decision.recorded"
  | "tool.policy_checked"
  | "tool.requested"
  | "tool.completed"
  | "state.patch"
  | "checkpoint.created"
  | "human.approval_requested"
  | "run.paused"
  | "run.resumed"
  | "node.completed"
  | "node.failed"
  | "run.completed"
  | "run.failed";
export type NodeId = string | null;
export type RunId = string;
export type Seq = number;
export type SpecRevision = string;
export type Timestamp = string;

export interface RunEvent {
  event_type: EventType;
  node_id?: NodeId;
  payload: Payload;
  run_id: RunId;
  seq: Seq;
  spec_revision: SpecRevision;
  timestamp: Timestamp;
}
export interface Payload {
  [k: string]: unknown;
}
