// 실행 이벤트를 사용자가 읽을 한 문장으로 옮긴다. 여기 문장에는 기술 용어를 쓰지 않는다
// (event_type 원문은 화면에서 보조로 따로 보여준다).
// 문장 자체는 messages.ts가 들고 있다 — 여기서는 어느 문장에 무엇을 채울지만 정한다.
import { type Message, type MessageKey, msg } from "../i18n/messages";
import type { EventType, RunEvent } from "../generated/run_event";
import { turnedDown } from "./player";

function nodeName(event: RunEvent): Message | string {
  return event.node_id ?? msg("event.node.unnamed");
}

function textOf(event: RunEvent, key: string, fallback: MessageKey): Message | string {
  const value = event.payload[key];
  return typeof value === "string" ? value : msg(fallback);
}

/** 이름 하나만 채우면 되는 문장 — 이벤트 대부분이 이 모양이다. */
function aboutNode(key: MessageKey): (event: RunEvent) => Message {
  return (event) => msg(key, { node: nodeName(event) });
}

/**
 * 실행이 끝까지 가지 못한 갈래 — 서버가 실패 사건에 실어 보내는 것 전부다.
 * (엔진의 ModelTrouble + 실행이 뜻밖의 일로 어그러진 자리. 정합은 서버 쪽 시험이 지킨다.)
 */
export const FAILURE_REASONS = [
  "runtime_error",
  "unknown_model",
  "missing_secret",
  "provider_error",
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

/**
 * 실행이 왜 끝까지 가지 못했는지 갈래대로 말한다 — 갈래를 모르면 일반 문구로 말한다
 * (새 갈래가 생겨도 화면이 깨지지 않는다). 서버가 함께 보낸 원문은 쓰지 않는다.
 */
function runFailed(event: RunEvent): Message {
  const reason = event.payload.reason;
  const known = FAILURE_REASONS.find((candidate) => candidate === reason);
  return msg(known ? (`event.run.failed.${known}` as MessageKey) : "event.run.failed");
}

/** 이벤트마다 쉬운 한 문장 — 새 이벤트는 여기 한 줄을 더한다. */
const SENTENCE: Record<EventType, (event: RunEvent) => Message> = {
  "run.started": () => msg("event.run.started"),
  "node.queued": aboutNode("event.node.queued"),
  "node.started": aboutNode("event.node.started"),
  "prompt.compiled": aboutNode("event.prompt.compiled"),
  "llm.requested": aboutNode("event.llm.requested"),
  "llm.completed": aboutNode("event.llm.completed"),
  "decision.recorded": aboutNode("event.decision.recorded"),
  "tool.policy_checked": aboutNode("event.tool.policyChecked"),
  "tool.requested": aboutNode("event.tool.requested"),
  "tool.completed": aboutNode("event.tool.completed"),
  // 이름 뒤에 조사가 붙지 않는 말투를 쓴다 — 노드 이름마다 '이/가'를 고를 수 없기 때문이다.
  "state.patch": (event) =>
    msg("event.state.patch", {
      from: textOf(event, "from", "event.state.from"),
      to: textOf(event, "to", "event.state.to"),
    }),
  "checkpoint.created": () => msg("event.checkpoint.created"),
  "human.approval_requested": aboutNode("event.human.approvalRequested"),
  "run.paused": () => msg("event.run.paused"),
  // 사람의 답은 흐름을 다시 열기도 하고 여기서 마치기도 한다 — 같은 사건이 두 가지를 말한다.
  "run.resumed": (event) =>
    turnedDown(event) ? msg("event.run.rejected") : msg("event.run.resumed"),
  // 끝맺음도 한 가지 사건으로 오지만, 사람이 거절해 끝난 자리는 그렇게 말해야 한다.
  "node.completed": (event) =>
    turnedDown(event)
      ? msg("event.node.rejected")
      : msg("event.node.completed", { node: nodeName(event) }),
  "node.failed": aboutNode("event.node.failed"),
  "run.completed": () => msg("event.run.completed"),
  "run.failed": runFailed,
};

export function eventSummary(event: RunEvent): Message {
  return SENTENCE[event.event_type](event);
}

/** 한 줄에 담을 수 있는 길이 — 넘치면 잘라서 뒤에 …를 붙인다. */
const LINE_LIMIT = 80;

function shortened(value: unknown): string {
  const text = JSON.stringify(value) ?? "";
  return text.length > LINE_LIMIT ? `${text.slice(0, LINE_LIMIT)}…` : text;
}

/**
 * 이벤트가 무엇을 들고 왔는지 있는 그대로 보여준다 — 쉬운 말 요약 옆에 붙는 보조 표기다.
 * payload는 계약이 자유롭게 열어 둔 자리이므로 원문 이름을 그대로 쓴다.
 */
export function payloadLines(event: RunEvent): string[] {
  return Object.entries(event.payload).map(([key, value]) => `${key}: ${shortened(value)}`);
}
