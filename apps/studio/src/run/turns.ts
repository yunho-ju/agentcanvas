// 도구를 부르며 답을 다듬은 실행을 시도(turn) 단위로 읽는다 (순수 함수).
// 묶음의 정체는 (노드, turn)이다 — 사람 확인으로 끊겼다 이어져도 한 시도다.
import type { RunEvent } from "../generated/run_event";

export interface TurnPart {
  /** 몇 번째 시도인가 (0부터). 시도 밖의 사건은 없음이다 */
  turn: number | null;
  nodeId: string | null;
  /** 목록에서 이 자리에 잇따라 오는 사건들 */
  events: RunEvent[];
  /** 이 시도 전부 — 끊겼다 이어진 뒷부분까지. 머리말은 이것을 보고 말한다 */
  whole: RunEvent[];
  /** 이 시도의 첫 자리인가 — 머리말은 여기 한 번만 선다 */
  heads: boolean;
}

function idOf(event: RunEvent): string | null {
  return event.turn === null || event.turn === undefined
    ? null
    : `${event.node_id ?? ""} ${event.turn}`;
}

/**
 * 시도마다 그 시도의 사건을 모으고, 목록에 놓이는 차례대로 자리를 나눈다.
 * 시도 번호가 없는 사건은 저마다 한 자리다 — 묶이기 전과 같은 한 줄로 남는다.
 */
export function groupTurns(events: RunEvent[]): TurnPart[] {
  const whole = new Map<string, RunEvent[]>();
  for (const event of events) {
    const id = idOf(event);
    if (id === null) continue;
    whole.set(id, [...(whole.get(id) ?? []), event]);
  }

  const parts: TurnPart[] = [];
  const led = new Set<string>();
  let openId: string | null = null;
  for (const event of events) {
    const id = idOf(event);
    const last = parts.at(-1);
    if (id !== null && id === openId && last) {
      last.events.push(event);
      continue;
    }
    openId = id;
    parts.push({
      turn: event.turn ?? null,
      nodeId: event.node_id ?? null,
      events: [event],
      whole: id === null ? [event] : (whole.get(id) ?? []),
      heads: id !== null && !led.has(id),
    });
    if (id !== null) led.add(id);
  }
  return parts;
}
