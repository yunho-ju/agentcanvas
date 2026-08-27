// 실험 루프의 첫 조각 — 실행은 지나가고 마는 것이 아니라 기록으로 남는다.
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function trial(n: number) {
  return {
    runId: `run_${n}`,
    startedAt: new Date(`2026-08-01T12:3${n}:00.000Z`),
  };
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("실행 기록이 쌓이는 자리", () => {
  it("아무것도 실행하지 않았으면 기록도 없다", () => {
    expect(store().runHistory).toEqual([]);
  });

  it("실행할 때마다 기록이 하나씩 쌓인다", async () => {
    await runOnServer(trial(1));
    store().stopRun();
    await runOnServer(trial(2));

    expect(store().runHistory).toHaveLength(2);
  });

  it("몇 번째 실행인지 쉬운 말로 붙여 둔다", async () => {
    await runOnServer(trial(1));
    store().stopRun();
    await runOnServer(trial(2));

    expect(store().runHistory.map((record) => record.order)).toEqual([1, 2]);
  });

  it("그때 무슨 일이 있었는지와 그때의 그래프를 함께 남긴다", async () => {
    await runOnServer(trial(1));

    const record = store().runHistory[0];
    expect(record.id).toBe("run_1");
    expect(record.at).toEqual(trial(1).startedAt);
    expect(record.events).toEqual(store().runEvents);
    expect(record.specSnapshot.nodes.map((node) => node.id)).toEqual(
      example.nodes.map((node) => node.id),
    );
  });

  it("실행이 시작되지 못하면 기록도 남지 않는다", async () => {
    store().addNode("llm.agent", { x: 0, y: 0 });

    await runOnServer(trial(1));

    expect(store().runHistory).toEqual([]);
  });

  it("다른 파일을 열면 지난 실행은 그 그래프의 것이 아니다", async () => {
    await runOnServer(trial(1));

    store().loadSpec({ ...example, id: "another-agent" });

    expect(store().runHistory).toEqual([]);
    expect(store().runEvents).toEqual([]);
    expect(store().activeRunId).toBeNull();
  });

  it("그 뒤에 그래프를 고쳐도 기록은 그대로다", async () => {
    await runOnServer(trial(1));
    const before = store().runHistory[0];

    store().stopRun();
    store().addNode("llm.agent", { x: 0, y: 0 });

    expect(store().runHistory[0]).toEqual(before);
  });
});

describe("남은 기록을 다시 트는 일", () => {
  it("고른 기록의 사건들을 처음부터 다시 보여준다", async () => {
    await runOnServer(trial(1));
    const first = store().runHistory[0];
    store().stopRun();

    store().replayRun(first.id);

    expect(store().runEvents).toEqual(first.events);
    expect(store().runOffsetMs).toBe(0);
    expect(store().isPlaying).toBe(true);
  });

  it("지금 어느 기록을 보고 있는지 알려 준다", async () => {
    await runOnServer(trial(1));
    expect(store().activeRunId).toBe("run_1");

    store().stopRun();
    expect(store().activeRunId).toBeNull();

    store().replayRun("run_1");
    expect(store().activeRunId).toBe("run_1");
  });

  it("없는 기록을 고르면 보던 것을 잃지 않는다", async () => {
    await runOnServer(trial(1));

    store().replayRun("run_없음");

    expect(store().activeRunId).toBe("run_1");
    expect(store().runEvents).toEqual(store().runHistory[0].events);
  });

  it("실행 보기를 닫아도 기록은 남는다", async () => {
    await runOnServer(trial(1));

    store().stopRun();

    expect(store().runEvents).toEqual([]);
    expect(store().runHistory).toHaveLength(1);
  });
});
