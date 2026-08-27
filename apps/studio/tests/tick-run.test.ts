import { describe, expect, it } from "vitest";
import type { RunEvent } from "../src/generated/run_event";
import { advanceTick } from "../src/run/player";

const START = new Date("2026-08-01T00:00:00.000Z").getTime();

function eventAt(
  seq: number,
  offsetMs: number,
  event_type: RunEvent["event_type"],
  node_id?: string,
): RunEvent {
  return {
    seq,
    run_id: "run_1",
    event_type,
    timestamp: new Date(START + offsetMs).toISOString(),
    spec_revision: "sha256:test",
    ...(node_id ? { node_id } : {}),
    payload: {},
  };
}

/** 밸브 앞에 멈춰 서서 아직 아무도 답하지 않은 실행 (150ms 만에 멈춘다). */
const awaitingGateEvents: RunEvent[] = [
  eventAt(0, 0, "node.queued", "a"),
  eventAt(1, 100, "node.started", "a"),
  eventAt(2, 150, "run.paused", "gate"),
];

/** 두 노드를 거쳐 310ms 만에 끝까지 도는 실행. */
const finishedEvents: RunEvent[] = [
  eventAt(0, 0, "node.queued", "a"),
  eventAt(1, 100, "node.started", "a"),
  eventAt(2, 200, "node.completed", "a"),
  eventAt(3, 210, "node.queued", "b"),
  eventAt(4, 250, "node.started", "b"),
  eventAt(5, 300, "node.completed", "b"),
  eventAt(6, 310, "run.completed"),
];

/** 200ms까지 온 것은 들었지만, 실행이 아직 닫혔다고는 듣지 못한 실행. */
const stillOpenEvents: RunEvent[] = finishedEvents.slice(0, 3);

describe("advanceTick: 속도 곱과 clamp", () => {
  it("속도를 곱한 만큼 나아간다", () => {
    const result = advanceTick(finishedEvents, [], 0, 100, 2);

    expect(result).toEqual({ kind: "advance", atMs: 200, keepPlaying: true });
  });

  it("실행 길이를 넘어서지 않는다", () => {
    const result = advanceTick(finishedEvents, [], 0, 1000, 1);

    expect(result.atMs).toBe(310);
  });
});

describe("advanceTick: 밸브 앞에서 멈춘다", () => {
  it("사람 확인 밸브를 만나면 그 자리에서 halt를 낸다", () => {
    const result = advanceTick(awaitingGateEvents, [], 0, 1000, 1);

    expect(result).toEqual({ kind: "halt", seq: 2, reason: "gate", nodeId: "gate", atMs: 150 });
  });
});

describe("advanceTick: 손으로 꽂은 멈춤에서 멈춘다", () => {
  it("표시해 둔 노드 앞에서 halt를 낸다", () => {
    const result = advanceTick(finishedEvents, ["b"], 0, 1000, 1);

    expect(result).toEqual({
      kind: "halt",
      seq: 3,
      reason: "breakpoint",
      nodeId: "b",
      atMs: 210,
    });
  });
});

describe("advanceTick: 끝에 닿았을 때 실행이 닫혔는가", () => {
  it("실행이 닫히는 데까지 다 봤으면 재생을 그친다", () => {
    const result = advanceTick(finishedEvents, [], 0, 1000, 1);

    expect(result).toEqual({ kind: "advance", atMs: 310, keepPlaying: false });
  });

  it("아직 닫히지 않았으면 도착을 기다리며 재생을 이어 둔다", () => {
    const result = advanceTick(stillOpenEvents, [], 0, 1000, 1);

    expect(result).toEqual({ kind: "advance", atMs: 200, keepPlaying: true });
  });
});
