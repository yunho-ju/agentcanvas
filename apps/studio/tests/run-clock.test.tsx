import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { EVENT_STEP_MS } from "../src/run/fakeRun";
import { useEditor } from "../src/store/editor";
import { currentSeq } from "../src/store/runSlice";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;
const trial = { runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") };

function store() {
  return useEditor.getState();
}

let frames: FrameRequestCallback[] = [];

/** 화면이 한 장 그려졌다고 알린다 — 진짜 시계 대신 테스트가 시간을 준다. */
function drawFrame(atMs: number) {
  const next = frames.pop();
  frames = [];
  if (next) act(() => next(atMs));
}

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  store().loadSpec(example);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the clock that plays a run", () => {
  it("carries the run forward on its own", async () => {
    render(<App />);
    await act(async () => {
      await runOnServer(trial);
    });

    drawFrame(0);
    drawFrame(EVENT_STEP_MS * 2);

    expect(currentSeq(store())).toBe(2);
  });

  it("leaves the run where it is while it is paused", async () => {
    render(<App />);
    await act(async () => {
      await runOnServer(trial);
    });
    drawFrame(0);
    act(() => store().pauseRun());

    drawFrame(EVENT_STEP_MS * 2);

    expect(currentSeq(store())).toBe(0);
  });

  // 화면을 그리는 다른 일들도 프레임을 부탁한다 — 여기서 볼 것은 "재생이 나아갔는가"다.
  it("does not tick when there is no run to play", () => {
    render(<App />);

    drawFrame(0);
    drawFrame(EVENT_STEP_MS * 2);

    expect(currentSeq(store())).toBe(0);
    expect(store().isPlaying).toBe(false);
  });

  // 다른 화면 일(포트 재측정 등)의 프레임 요청은 유한하다 — 시계가 돌고 있다면
  // 매 프레임 재장전되어 큐가 마르지 않는다. 유휴 화면은 몇 장 안에 조용해져야 한다.
  it("stops asking for frames when there is nothing to play", () => {
    render(<App />);

    for (let round = 0; round < 5 && frames.length > 0; round += 1) {
      const queued = frames;
      frames = [];
      act(() => {
        for (const callback of queued) callback(round);
      });
    }

    expect(frames).toHaveLength(0);
  });
});
