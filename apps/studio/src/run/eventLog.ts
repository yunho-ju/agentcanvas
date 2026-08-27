// 실행이 남긴 이벤트를 쌓는 규칙 — 입력에서 출력만 나오는 순수 함수다.
// 끊겼다 이어 받으면 같은 이벤트가 또 오므로, 이미 들은 순번은 다시 세지 않는다(순번이 그 이벤트의 이름이다).
import type { RunEvent } from "../generated/run_event";

/** 쌓아 둔 이벤트에 새로 들은 것을 더한다 — 이미 들은 순번은 그대로 두고, 순번 순서로 앉힌다. */
export function mergedEvents(kept: RunEvent[], heard: RunEvent[]): RunEvent[] {
  const bySeq = new Map(kept.map((event) => [event.seq, event]));
  for (const event of heard) {
    if (!bySeq.has(event.seq)) bySeq.set(event.seq, event);
  }
  return [...bySeq.values()].sort((one, other) => one.seq - other.seq);
}
