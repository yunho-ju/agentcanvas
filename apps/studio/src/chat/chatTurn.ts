// 한 마디 주고받기의 규칙 — 무엇을 실어 보내고(G2), 온 것을 어떻게 읽는가(G1·G5·H2).
// 전부 순수 함수다: store는 사실(사람이 한 말·서버가 보낸 이벤트)만 쥐고, 뜻은 여기서 나온다.
import type { AgentSpec } from "../generated/agent_spec";
import type { RunEvent } from "../generated/run_event";
import type { Message } from "../i18n/messages";
import { msg } from "../i18n/messages";
import { eventSummary } from "../run/eventWords";
import { waitsForPerson } from "../run/nodeKinds";
import { turnedDown } from "../run/player";
import { spokenTexts } from "../run/spokenText";
import { CHAT_HISTORY_BINDING, CHAT_SAID_BINDING, chatBindings } from "./chatEntry";

/** 대화에 오간 한 마디 — 누가 무슨 말을 했는가 (결정 2). */
export interface ChatSaid {
  role: "user" | "assistant";
  text: string;
}

/**
 * 화면이 기억하는 한 마디 — 사람이 한 말과, 그 말이 연 실행이 남긴 사실들.
 * 답인지 실패인지는 여기 적지 않는다: 이벤트가 이미 말하고 있으므로 `chatTurnEnd`가 읽는다.
 */
export interface ChatTurnState {
  id: string;
  said: string;
  /** 이 말이 연 실행 — 아직 서버가 열어 주지 않았으면 없음 */
  runId: string | null;
  events: RunEvent[];
  /** 이 말이 실행 밖의 까닭으로 끝났다 — 서버가 물렸거나, 사람이 기다리기를 그만뒀거나 */
  halted: Message | null;
}

/** 이번 말에 실어 보낼 값 — 사람 말은 message 자리에, 지난 대화는 받는 판에만 history 자리에. */
export function chatTurnInput(
  spec: AgentSpec,
  said: string,
  history: ChatSaid[],
): Record<string, unknown> {
  const takes = chatBindings(spec);
  return {
    [CHAT_SAID_BINDING]: said,
    // 적지 않은 것을 적은 척 보내지 않는다 — 받지 않는 판에도, 아직 아무 말도 없을 때도 싣지 않는다.
    ...(takes.history && history.length > 0 ? { [CHAT_HISTORY_BINDING]: history } : {}),
  };
}

/** 지난 대화 — 답이 온 말들만, 오간 순서대로. 없던 답을 지어내지 않는다. */
export function chatHistory(spec: AgentSpec, turns: ChatTurnState[]): ChatSaid[] {
  return turns.flatMap((turn) => {
    const end = chatTurnEnd(spec, turn);
    if (end?.kind !== "answer") return [];
    return [
      { role: "user" as const, text: turn.said },
      { role: "assistant" as const, text: end.text },
    ];
  });
}

/** 이 말이 어떻게 끝났는가 — 아직 끝나지 않았으면 없음(null)이다. */
export type ChatTurnEnd =
  | { kind: "answer"; text: string }
  | { kind: "rejected" }
  | { kind: "failed"; why: Message }
  | { kind: "silent" };

/**
 * 사람이 밸브에서 아니오라고 답했는가 — **밸브 노드의 답만** 거절이다.
 * 도구 노드도 거절당하면 approved:false를 남기지만 그것은 error 포트로 갈렸다는 표시일 뿐,
 * 그 뒤에 온 말은 여전히 이 대화의 답이다 (engine routed_runtime `_gate_answers_in` 주석).
 */
function personTurnedItDown(spec: AgentSpec, events: RunEvent[]): boolean {
  const gates = new Set(
    spec.nodes.filter((node) => waitsForPerson(node)).map((node) => node.id),
  );
  return events.some(
    (event) => turnedDown(event) && event.node_id != null && gates.has(event.node_id),
  );
}

export function chatTurnEnd(spec: AgentSpec, turn: ChatTurnState): ChatTurnEnd | null {
  if (turn.halted) return { kind: "failed", why: turn.halted };
  const failed = turn.events.find((event) => event.event_type === "run.failed");
  // 실패의 갈래를 쉬운 말로 옮기는 사전은 실행 화면과 같은 것을 쓴다 (서버 원문 미노출).
  if (failed) return { kind: "failed", why: eventSummary(failed, turn.events) };
  if (!turn.events.some((event) => event.event_type === "run.completed")) return null;
  if (personTurnedItDown(spec, turn.events)) return { kind: "rejected" };
  // 답은 말하는 노드가 마지막으로 낸 말이다 — engine과 같은 규칙을 미러한 순수 함수가 고른다.
  const text = spokenTexts(spec, turn.events).at(-1);
  return text === undefined ? { kind: "silent" } : { kind: "answer", text };
}

/** 답 대신 끝난 말들 — 실패도 거절도 침묵도 대화 안에 남는다 (조용한 무시 금지). */
export function chatEndWords(end: Exclude<ChatTurnEnd, { kind: "answer" }>): Message {
  if (end.kind === "failed") return end.why;
  return msg(end.kind === "rejected" ? "chat.turn.rejected" : "chat.turn.silent");
}
