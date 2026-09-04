// 시도 하나가 무엇을 했는지 쉬운 말 한 줄로 (순수 함수). 문장은 messages.ts가 들고 있다.
// 말하는 것은 관찰된 사건뿐이다 — 아직 안 일어난 일을 앞질러 말하지 않는다.
import type { AgentSpec, LocalizedText } from "../generated/agent_spec";
import type { RunEvent } from "../generated/run_event";
import { type Message, msg } from "../i18n/messages";
import { toolNamed } from "../resources/resourceWords";
import type { NodeRunStatus } from "./player";
import type { TurnPart } from "./turns";

/** 시도가 더는 돌지 않는 결말들 — 그 카드는 시도가 아니라 결말을 말한다. */
const DONE: NodeRunStatus[] = ["completed", "failed", "rejected", "toolFailed"];

/**
 * 실행 중인 카드가 시도에 대해 말하는 것.
 * 사람 확인으로 멈춘 동안에도 말한다(멈춤은 끝이 아니다). 마무리 호출은 도구를 부르지
 * 않으므로 턴 수로 세지 않고, 최대 턴을 알 수 없으면 숫자를 지어내지 않는다.
 */
export function turnBadge(card: {
  status: NodeRunStatus | undefined;
  turn: number | undefined;
  closing: boolean | undefined;
  maxTurns: number | undefined;
}): Message | null {
  if (card.turn === undefined || (card.status && DONE.includes(card.status))) return null;
  if (card.closing) return msg("run.node.wrappingUp");
  return card.maxTurns === undefined
    ? null
    : msg("run.node.calling", { turn: card.turn + 1, max: card.maxTurns });
}

export interface TurnWords {
  heading: Message;
  /** 머리말이 말하지 않은 것 — 도구의 쉬운 설명, 이름으로 부르지 못했으면 원문 이름 */
  caption: (LocalizedText | string)[];
}

function heardBack(events: RunEvent[]): boolean {
  return events.some((event) => event.event_type === "llm.completed");
}

function isClosing(events: RunEvent[]): boolean {
  return events.some(
    (event) => event.event_type === "llm.requested" && event.payload.closing === true,
  );
}

/** 이 시도가 실제로 부른 도구들 — 모델이 시킨 것이 아니라 부탁이 나간 것만 센다. */
function toolsCalled(events: RunEvent[]): string[] {
  return events.flatMap((event) => {
    const name = event.payload.tool_name;
    return event.event_type === "tool.requested" && typeof name === "string" ? [name] : [];
  });
}

function describes(spec: AgentSpec, name: string): LocalizedText[] {
  const tool = toolNamed(spec.resources ?? [], name);
  return tool ? [tool.plain_description] : [];
}

function calledWords(spec: AgentSpec, n: number, tools: string[]): TurnWords {
  if (tools.length === 1) {
    return {
      heading: msg("run.turn.calledTool", { n, tool: tools[0] }),
      caption: describes(spec, tools[0]),
    };
  }
  if (tools.length === 2) {
    return {
      heading: msg("run.turn.calledTwoTools", { n, first: tools[0], second: tools[1] }),
      caption: tools.flatMap((name) => describes(spec, name)),
    };
  }
  return {
    heading: msg("run.turn.calledManyTools", { n, count: tools.length }),
    caption: tools,
  };
}

/** 이 자리의 머리말. 시도 밖의 사건과 이어진 뒷자리에는 머리말이 없다. */
export function turnWords(part: TurnPart, spec: AgentSpec): TurnWords | null {
  if (part.turn === null || !part.heads) return null;
  const n = part.turn + 1;
  if (!heardBack(part.whole)) {
    return { heading: msg("run.turn.asking", { n }), caption: [] };
  }
  // 마무리 호출에서 모델이 시킨 도구는 엔진이 부르지 않는다 — 부르지 않은 것을 적지 않는다.
  if (isClosing(part.whole)) return { heading: msg("run.turn.closing"), caption: [] };
  const tools = toolsCalled(part.whole);
  return tools.length === 0
    ? { heading: msg("run.turn.answered", { n }), caption: [] }
    : calledWords(spec, n, tools);
}
