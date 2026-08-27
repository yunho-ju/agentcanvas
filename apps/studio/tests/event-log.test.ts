// 실행이 남긴 이벤트를 쌓는 규칙 — 순수 함수다. 끊겼다 이어 받으면 같은 이벤트가 또 오기 때문에
// "이미 들은 순번은 다시 세지 않는다"가 여기서 지켜진다.
import { describe, expect, it } from "vitest";
import type { RunEvent } from "../src/generated/run_event";
import { mergedEvents } from "../src/run/eventLog";

function eventAt(seq: number): RunEvent {
  return {
    seq,
    run_id: "run_one",
    event_type: "node.queued",
    timestamp: "2026-08-01T12:30:00Z",
    spec_revision: `sha256:${"a".repeat(64)}`,
    payload: {},
  };
}

const seqsOf = (events: RunEvent[]) => events.map((event) => event.seq);

describe("이벤트를 쌓는 일", () => {
  it("들은 적 없는 이벤트는 뒤에 쌓인다", () => {
    expect(seqsOf(mergedEvents([eventAt(0)], [eventAt(1), eventAt(2)]))).toEqual([0, 1, 2]);
  });

  it("이미 들은 순번은 다시 쌓지 않는다", () => {
    expect(seqsOf(mergedEvents([eventAt(0), eventAt(1)], [eventAt(1)]))).toEqual([0, 1]);
  });

  it("먼저 들은 것을 나중에 온 같은 순번이 바꿔치지 않는다", () => {
    const first = { ...eventAt(1), event_type: "node.started" as const };

    expect(mergedEvents([first], [eventAt(1)])).toEqual([first]);
  });

  it("늦게 온 이벤트도 순번 순서로 앉는다", () => {
    expect(seqsOf(mergedEvents([eventAt(0)], [eventAt(3), eventAt(2)]))).toEqual([0, 2, 3]);
  });

  it("한 번에 온 것 안의 중복도 한 번만 쌓는다", () => {
    expect(seqsOf(mergedEvents([], [eventAt(1), eventAt(1)]))).toEqual([1]);
  });

  it("아무것도 오지 않았으면 쌓아 둔 것을 그대로 둔다", () => {
    const kept = [eventAt(0)];

    expect(mergedEvents(kept, [])).toEqual(kept);
  });
});
