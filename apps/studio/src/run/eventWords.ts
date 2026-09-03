// 실행 이벤트를 사용자가 읽을 한 문장으로 옮긴다. 여기 문장에는 기술 용어를 쓰지 않는다
// (event_type 원문은 화면에서 보조로 따로 보여준다).
// 문장 자체는 messages.ts가 들고 있다 — 여기서는 어느 문장에 무엇을 채울지만 정한다.
import { type Message, type MessageKey, msg } from "../i18n/messages";
import type { EventType, RunEvent } from "../generated/run_event";
import { nameInSkillRef } from "../graph/skillMarkdown";
import { toolFellShortIn, turnedDown } from "./player";

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
  // 도구를 부르지 못한 갈래 중 사람이 문서를 고쳐야 하는 것들 (engine ToolTrouble).
  "unknown_binding",
  "unknown_tool",
  "no_adapter",
  "not_allowed",
  "missing_input",
  // 못 실을 방식(아직 준비 안 된 전략) — 조용히 Full로 떨어지지 않고 그 사실만 말한다.
  "unsupported_strategy",
  // 요약 모델이 도구 응답을 줄이지 못했다 (digest 전략) — 조용히 Full로 떨어지지 않는다.
  "digest_failed",
] as const;

/**
 * 이번 호출이 어그러진 갈래 — 실행을 끝내지 않고 도구가 낸 것으로 흐른다.
 * 목록은 그 사실을 tool.completed 줄에서 말한다.
 */
export const TOOL_TROUBLES = ["timeout", "http_error", "bad_output"] as const;

export type ToolTrouble = (typeof TOOL_TROUBLES)[number];

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

function textIn(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function numberIn(event: RunEvent, key: string): number | undefined {
  const value = event.payload[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * 이번 호출이 어그러진 갈래 — 우리가 아는 갈래가 아니면 없다(지어내지 않는다).
 * 갈래를 좁히는 자리는 이 하나다: 실행 줄도 대화의 고칠 자리도 여기를 거친다.
 */
export function toolTroubleIn(event: RunEvent): ToolTrouble | null {
  const reason = textIn(event.payload.error, "reason");
  return TOOL_TROUBLES.find((candidate) => candidate === reason) ?? null;
}

/** 그 갈래를 쉬운 말로 — 모르는 갈래는 일반 문구다(사전은 이 한 벌뿐이다). */
export function toolTroubleWords(trouble: ToolTrouble | null): Message {
  return msg(
    trouble === null ? "event.tool.trouble" : (`event.tool.trouble.${trouble}` as MessageKey),
  );
}

/** 그 도구의 이름 — 적혀 있지 않은 옛 사건은 이름 없이 말한다. */
function toolName(event: RunEvent): Message | string {
  return textIn(event.payload, "tool_name") ?? msg("event.tool.unnamed");
}

/** 도구를 써도 되는지 확인한 걸음 — 허락하지 않는 도구였으면 그 사실을 말한다. */
function policyChecked(event: RunEvent): Message {
  const allowed = event.payload.allowed !== false;
  return msg(allowed ? "event.tool.policyChecked" : "event.tool.notAllowed", {
    node: nodeName(event),
    tool: toolName(event),
  });
}

/**
 * 도구가 끝난 걸음 — 받아 왔으면 얼마를 실었는지, 어그러졌으면 그 갈래를 쉬운 말로 말한다.
 * 서버가 함께 보낸 원문은 화면의 글이 아니다(DESIGN §7): 갈래만 보고 우리 말로 옮긴다.
 */
function toolCompleted(event: RunEvent): Message {
  if (event.payload.ok !== false) {
    return msg("event.tool.completed", {
      node: nodeName(event),
      tool: toolName(event),
      original: numberIn(event, "original_chars") ?? 0,
      loaded: numberIn(event, "loaded_chars") ?? 0,
    });
  }
  return msg("event.tool.failed", {
    node: nodeName(event),
    tool: toolName(event),
    why: toolTroubleWords(toolTroubleIn(event)),
  });
}

/**
 * 이벤트마다 쉬운 한 문장 — 새 이벤트는 여기 한 줄을 더한다.
 * 대개는 그 사건 하나만 보면 되지만, 실행의 끝맺음만은 그 실행 전체를 보고 말한다
 * (도구가 답을 못 가져온 실행을 "모두 마쳤다"고 말하지 않기 위해서다).
 */
const SENTENCE: Record<EventType, (event: RunEvent, run: RunEvent[]) => Message> = {
  "run.started": () => msg("event.run.started"),
  "node.queued": aboutNode("event.node.queued"),
  "node.started": aboutNode("event.node.started"),
  "prompt.compiled": aboutNode("event.prompt.compiled"),
  "llm.requested": aboutNode("event.llm.requested"),
  "llm.completed": aboutNode("event.llm.completed"),
  "decision.recorded": aboutNode("event.decision.recorded"),
  "tool.policy_checked": policyChecked,
  "tool.requested": (event) =>
    msg("event.tool.requested", { node: nodeName(event), tool: toolName(event) }),
  "tool.completed": toolCompleted,
  // 이름 뒤에 조사가 붙지 않는 말투를 쓴다 — 노드 이름마다 '이/가'를 고를 수 없기 때문이다.
  "state.patch": (event) =>
    msg("event.state.patch", {
      from: textOf(event, "from", "event.state.from"),
      to: textOf(event, "to", "event.state.to"),
    }),
  "checkpoint.created": () => msg("event.checkpoint.created"),
  // 도구를 부르기 전 사람 확인은 무엇을 승인하는지(도구 이름) 말한다 — 밸브 승인과 다른 말이다.
  "human.approval_requested": (event) =>
    textIn(event.payload, "tool_name") !== undefined
      ? msg("event.human.toolApprovalRequested", {
          node: nodeName(event),
          tool: toolName(event),
        })
      : msg("event.human.approvalRequested", { node: nodeName(event) }),
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
  "run.completed": (_event, run) =>
    msg(toolFellShortIn(run) ? "event.run.completed.toolFailed" : "event.run.completed"),
  "run.failed": runFailed,
};

/**
 * 사건 하나를 사람이 읽을 한 문장으로. 실행 전체(`run`)를 함께 건네면 끝맺음 줄이
 * 그 실행에서 일어난 일까지 보고 말한다 — 건네지 않으면 그 사건만 보고 말한다.
 */
export function eventSummary(event: RunEvent, run: RunEvent[] = []): Message {
  return SENTENCE[event.event_type](event, run);
}

/** 그 걸음이 따른 skill이 적히는 payload의 자리 (파이썬 `FOLLOWED_SKILLS`와 같은 이름). */
const FOLLOWED_SKILLS = "skill_refs";

/**
 * 이 걸음이 따른 skill을 사람이 읽을 한 줄로 — 따른 것이 없으면 할 말도 없다.
 * 이름표(skill://이름@판)가 아니라 사람이 부르는 이름으로 말한다: 판 번호는 여기서 읽을 것이 아니다.
 */
export function skillsFollowed(event: RunEvent): Message | null {
  const refs = event.payload[FOLLOWED_SKILLS];
  if (!Array.isArray(refs)) return null;
  const names = refs
    .filter((ref): ref is string => typeof ref === "string")
    .map((ref) => nameInSkillRef(ref) ?? ref);
  return names.length === 0 ? null : msg("event.skillsFollowed", { skills: names.join(", ") });
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
 * 다만 이미 쉬운 말 한 줄로 말한 것은 여기서 또 말하지 않는다 (같은 사실을 두 번 읽히지 않는다).
 */
export function payloadLines(event: RunEvent): string[] {
  const saidInPlainWords = skillsFollowed(event) === null ? [] : [FOLLOWED_SKILLS];
  return Object.entries(event.payload)
    .filter(([key]) => !saidInPlainWords.includes(key))
    .map(([key, value]) => `${key}: ${shortened(value)}`);
}
