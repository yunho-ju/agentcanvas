// 하단 실행 히스토리 스트립 — 해 본 실행이 사라지지 않고 다시 열린다.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { RunHistoryStrip } from "../src/run/RunHistoryStrip";
import { useEditor } from "../src/store/editor";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

async function runOnce(n: number) {
  await runOnServer({
    runId: `run_${n}`,
    startedAt: new Date(`2026-08-01T12:3${n}:00.000Z`),
  });
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("지난 실행들이 앉는 자리", () => {
  it("해 본 실행이 없으면 자리 자체가 없다", () => {
    render(<RunHistoryStrip />);

    expect(screen.queryByRole("region", { name: "지난 실행" })).not.toBeInTheDocument();
  });

  it("실행을 두 번 하면 카드가 두 장이다", async () => {
    await runOnce(1);
    store().stopRun();
    await runOnce(2);
    render(<RunHistoryStrip />);

    expect(screen.getAllByRole("button", { name: /^실행 \d/ })).toHaveLength(2);
  });

  it("몇 번째 실행인지·몇 단계였는지·얼마나 걸렸는지를 카드에 적는다", async () => {
    await runOnce(1);
    render(<RunHistoryStrip />);

    const steps = store().runHistory[0].events.length;
    expect(
      screen.getByRole("button", { name: new RegExp(`실행 1 · ${steps}단계 · [\\d.]+초`) }),
    ).toBeInTheDocument();
  });

  it("카드를 고르면 그 실행을 처음부터 다시 보여준다", async () => {
    await runOnce(1);
    const first = store().runHistory[0];
    store().stopRun();
    render(<RunHistoryStrip />);

    await userEvent.click(screen.getByRole("button", { name: /실행 1/ }));

    expect(store().runEvents).toEqual(first.events);
    expect(store().activeRunId).toBe("run_1");
  });

  it("지금 보고 있는 기록을 표시한다", async () => {
    await runOnce(1);
    store().stopRun();
    await runOnce(2);
    render(<RunHistoryStrip />);

    expect(screen.getByRole("button", { name: /실행 2/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByRole("button", { name: /실행 1/ })).toHaveAttribute(
      "aria-current",
      "false",
    );
  });

  it("그래프를 고쳐도 지난 실행은 그대로 남는다", async () => {
    await runOnce(1);
    store().stopRun();
    store().addNode("llm.agent", { x: 0, y: 0 });
    render(<RunHistoryStrip />);

    expect(screen.getByRole("button", { name: /실행 1/ })).toBeInTheDocument();
  });
});
