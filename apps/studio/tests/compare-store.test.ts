// 두 실행을 골라 견주고, 마음에 드는 쪽으로 그래프를 이어 간다.
// 고르는 일은 기억만 하고, 채택은 되돌릴 수 있는 한 걸음의 편집이다.
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

/** 실행 한 번을 끝까지 해 보고 편집으로 돌아온다. */
async function runOnce(n: number) {
  await runOnServer(trial(n));
  store().stopRun();
}

function nodeIds(): string[] {
  return store().nodes.map((node) => node.id);
}

function promptOf(id: string): unknown {
  return store()
    .nodes.find((node) => node.id === id)
    ?.data.spec.config?.prompt_ref;
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("견줄 두 실행을 고르는 일", () => {
  beforeEach(async () => {
    await runOnce(1);
    await runOnce(2);
    await runOnce(3);
  });

  it("아무것도 고르지 않은 채로 시작한다", () => {
    expect(store().compareSelection).toEqual([]);
  });

  it("고른 순서대로 두 개까지 기억한다", () => {
    store().toggleCompare("run_1");
    store().toggleCompare("run_2");

    expect(store().compareSelection).toEqual(["run_1", "run_2"]);
  });

  it("세 번째를 고르면 가장 먼저 고른 것이 물러난다", () => {
    store().toggleCompare("run_1");
    store().toggleCompare("run_2");

    store().toggleCompare("run_3");

    expect(store().compareSelection).toEqual(["run_2", "run_3"]);
  });

  it("고른 것을 다시 누르면 놓는다", () => {
    store().toggleCompare("run_1");
    store().toggleCompare("run_2");

    store().toggleCompare("run_1");

    expect(store().compareSelection).toEqual(["run_2"]);
  });

  it("한꺼번에 다 놓을 수 있다", () => {
    store().toggleCompare("run_1");
    store().toggleCompare("run_2");

    store().clearCompare();

    expect(store().compareSelection).toEqual([]);
  });

  it("다른 그래프를 열면 고르던 것도 채택한 것도 이 그래프의 것이 아니다", () => {
    store().toggleCompare("run_1");
    store().adoptRun("run_2");

    store().loadSpec(example);

    expect(store().compareSelection).toEqual([]);
    expect(store().adoptedRunId).toBeNull();
  });

  it("고르는 일은 지금 보고 있는 실행을 건드리지 않는다", () => {
    store().replayRun("run_1");

    store().toggleCompare("run_2");

    expect(store().activeRunId).toBe("run_1");
    expect(store().runEvents).toEqual(store().runHistory[0].events);
  });
});

describe("마음에 드는 쪽으로 이어 가는 일", () => {
  beforeEach(async () => {
    await runOnce(1);
    store().updateNodeConfig("triage", {
      ...example.nodes[1].config,
      prompt_ref: "prompt://triage@9",
    });
    await runOnce(2);
  });

  it("고른 실행이 돌던 설정이 캔버스로 돌아온다", () => {
    expect(promptOf("triage")).toBe("prompt://triage@9");

    store().adoptRun("run_1");

    expect(promptOf("triage")).toBe("prompt://triage@2");
  });

  it("그때 있던 노드들이 그대로 돌아온다", () => {
    store().onNodesChange([{ type: "remove", id: "output" }]);
    expect(nodeIds()).not.toContain("output");

    store().adoptRun("run_1");

    expect(nodeIds()).toEqual(example.nodes.map((node) => node.id));
  });

  it("어느 실행을 채택했는지 남긴다", () => {
    store().adoptRun("run_1");

    expect(store().adoptedRunId).toBe("run_1");
  });

  it("채택하고 나면 견주던 일은 끝난다", () => {
    store().toggleCompare("run_1");
    store().toggleCompare("run_2");

    store().adoptRun("run_1");

    expect(store().compareSelection).toEqual([]);
  });

  it("한 번 되돌리면 채택하기 직전으로 돌아간다", () => {
    store().adoptRun("run_1");

    store().undo();

    expect(promptOf("triage")).toBe("prompt://triage@9");
  });

  it("보고 있던 실행을 닫고 그래프를 다시 고칠 수 있게 한다", () => {
    store().replayRun("run_2");

    store().adoptRun("run_1");

    expect(store().runEvents).toEqual([]);
    expect(promptOf("triage")).toBe("prompt://triage@2");
  });

  it("다른 파일을 연 뒤에는 옛 실행을 채택할 수 없다 — 남의 노드가 섞이지 않는다", () => {
    const another: AgentSpec = {
      ...example,
      id: "another-agent",
      nodes: example.nodes.filter((node) => node.id === "input"),
      edges: [],
    };

    store().loadSpec(another);
    store().adoptRun("run_1");

    expect(nodeIds()).toEqual(["input"]);
    expect(store().adoptedRunId).toBeNull();
  });

  it("없는 기록을 채택하면 아무 일도 일어나지 않는다", () => {
    store().adoptRun("run_없음");

    expect(promptOf("triage")).toBe("prompt://triage@9");
    expect(store().adoptedRunId).toBeNull();
  });

  it("지금 그대로인 설정을 채택하는 것은 편집이 아니다", () => {
    const steps = store().undoStack.length;

    store().adoptRun("run_2");

    expect(store().undoStack).toHaveLength(steps);
    expect(store().adoptedRunId).toBe("run_2");
  });
});
