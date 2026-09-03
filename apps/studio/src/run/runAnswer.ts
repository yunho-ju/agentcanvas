// 끝난 실행이 사람에게 돌려준 답 (순수 함수).
import type { AgentSpec } from "../generated/agent_spec";
import type { RunEvent } from "../generated/run_event";
import { RUN_CLOSED } from "./player";
import { spokenTexts } from "./spokenText";

/**
 * 이 실행의 답 — 말하는 노드가 마지막으로 낸 말이다 (chat-panel과 같은 규칙).
 * 아직 닫히지 않았거나 말한 것이 없으면(빈 말도 말한 것이 아니다) 없음이다:
 * 없는 답을 지어내지 않고, 빈 말풍선도 세우지 않는다.
 */
export function runAnswer(spec: AgentSpec, events: RunEvent[]): string | null {
  if (!events.some((event) => RUN_CLOSED.includes(event.event_type))) return null;
  const text = spokenTexts(spec, events).at(-1);
  return text === undefined || text.trim() === "" ? null : text;
}
