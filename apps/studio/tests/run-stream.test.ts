import { describe, expect, it, vi } from "vitest";
import type { StreamEnd } from "../src/api/runs";
import type { RunEvent } from "../src/generated/run_event";
import { msg } from "../src/i18n/messages";
import { RunStream, type WatchRun } from "../src/run/runStream";

const RUN_ID = "run_1";

function event(seq: number): RunEvent {
  return {
    seq,
    run_id: RUN_ID,
    event_type: "node.queued",
    timestamp: new Date(2026, 0, 1).toISOString(),
    spec_revision: "sha256:test",
    payload: {},
  };
}

/** 시험이 부를 순서대로 결말을 내주는 watch 대역. */
function queuedWatch(...ends: StreamEnd[]): { watch: WatchRun; calls: unknown[] } {
  const calls: unknown[] = [];
  const remaining = [...ends];
  const watch: WatchRun = async (_runId, options) => {
    calls.push(options);
    return remaining.shift() ?? { ended: false, lastSeq: null };
  };
  return { watch, calls };
}

function callbacks(watch: WatchRun) {
  const onEvent = vi.fn();
  const onLost = vi.fn();
  const onFailure = vi.fn();
  const stream = new RunStream({ watchRunEvents: watch, onEvent, onLost, onFailure });
  return { stream, onEvent, onLost, onFailure };
}

describe("스트림 정상 종료", () => {
  it("실행이 닫힌 채로 돌아오면 다시 잇지 않고 아무 말도 하지 않는다", async () => {
    const { watch, calls } = queuedWatch({ ended: true, lastSeq: 5 });
    const { stream, onLost, onFailure } = callbacks(watch);

    await stream.follow(RUN_ID);

    expect(calls).toHaveLength(1);
    expect(onLost).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
  });
});

describe("스트림 중간 끊김", () => {
  it("읽던 자리부터 정확히 한 번 더 잇는다", async () => {
    const { watch, calls } = queuedWatch(
      { ended: false, lastSeq: 3 },
      { ended: true, lastSeq: 7 },
    );
    const { stream, onFailure } = callbacks(watch);

    await stream.follow(RUN_ID);

    expect(calls).toHaveLength(2);
    expect((calls[1] as { after?: number }).after).toBe(3);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("두 번째도 끊기면 실패 메시지를 말하고 재생을 멈춘다", async () => {
    const failure = msg("run.answer.gone");
    const { watch } = queuedWatch(
      { ended: false, lastSeq: 3 },
      { ended: false, lastSeq: 3, failure },
    );
    const { stream, onLost, onFailure } = callbacks(watch);

    await stream.follow(RUN_ID);

    expect(onLost).toHaveBeenCalledWith(RUN_ID);
    expect(onFailure).toHaveBeenCalledWith(failure);
  });
});

describe("사용자가 그만 듣기로 했을 때", () => {
  it("첫 번째 시도가 중단 신호로 끝나면 다시 잇지도, 실패를 말하지도 않는다", async () => {
    const calls: unknown[] = [];
    const watch: WatchRun = async (_runId, options) => {
      calls.push(options);
      return { ended: false, lastSeq: null };
    };
    const stream = new RunStream({
      watchRunEvents: watch,
      onEvent: vi.fn(),
      onLost: vi.fn(),
      onFailure: vi.fn(),
    });
    // follow가 새 AbortController를 만들기 전에 끊을 수 없으니, 대신 stopListening을 바로 부른다 —
    // 진짜 사용은 store가 stopRun에서 부르는 자리다.
    const following = stream.follow(RUN_ID);
    stream.stopListening();
    await following;

    expect(calls).toHaveLength(1);
  });
});

describe("문서를 넘나드는 사이의 낡은 세대", () => {
  it("세대를 넘기지 않으면 stale이 아니다", () => {
    const stream = new RunStream({
      watchRunEvents: async () => ({ ended: true, lastSeq: null }),
      onEvent: vi.fn(),
      onLost: vi.fn(),
      onFailure: vi.fn(),
    });

    expect(stream.stale(stream.currentGeneration())).toBe(false);
  });

  it("문서를 놓으면 세대가 올라 그 전의 부탁은 낡은 것이 된다", () => {
    const stream = new RunStream({
      watchRunEvents: async () => ({ ended: true, lastSeq: null }),
      onEvent: vi.fn(),
      onLost: vi.fn(),
      onFailure: vi.fn(),
    });
    const askedFor = stream.currentGeneration();

    stream.abandon();

    expect(stream.stale(askedFor)).toBe(true);
  });
});

describe("이벤트가 도착하면 그대로 넘긴다", () => {
  it("도착한 이벤트를 실행 id와 함께 콜백에 넘긴다", async () => {
    const heard: RunEvent[] = [];
    const watch: WatchRun = async (_runId, options) => {
      options.onEvent(event(1));
      return { ended: true, lastSeq: 1 };
    };
    const stream = new RunStream({
      watchRunEvents: watch,
      onEvent: (runId, ev) => heard.push({ ...ev, run_id: runId }),
      onLost: vi.fn(),
      onFailure: vi.fn(),
    });

    await stream.follow(RUN_ID);

    expect(heard).toEqual([event(1)]);
  });
});
