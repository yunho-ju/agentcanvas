import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { EVENT_STEP_MS } from "../src/run/fakeRun";
import { currentSeq, isRunning, runNodeStates } from "../src/store/runSlice";
import { useEditor } from "../src/store/editor";
import { translate } from "../src/i18n/messages";
import { runOnServer, settle } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

const trial = { runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") };

function store() {
  return useEditor.getState();
}

function seqOf(type: string, nodeId?: string): number {
  const found = store().runEvents.find(
    (event) => event.event_type === type && (!nodeId || event.node_id === nodeId),
  );
  if (!found) throw new Error(`the run has no ${type} event`);
  return found.seq;
}

/**
 * 실행을 끝까지 흘려 보낸다 — 예시 그래프는 사람 확인 밸브에서 한 번 멈추므로
 * 승인해 주어야 나머지가 흐른다. 밸브 자체의 이야기는 gate-store 테스트가 맡는다.
 */
async function playToTheEnd() {
  store().tickRun(EVENT_STEP_MS * 1000);
  await store().approveGate();
  await settle();
  store().tickRun(EVENT_STEP_MS * 1000);
}

function graphShape(): string {
  return JSON.stringify({ nodes: store().nodes, edges: store().edges });
}

beforeEach(() => {
  store().loadSpec(example);
});

/** store가 들고 있는 메시지를 화면이 읽을 한국어 한 줄로. */
function said(message: { key: string } | null): string {
  return message ? translate("ko", message as Parameters<typeof translate>[1]) : "";
}

describe("trying the agent out without a real model", () => {
  it("fills the timeline with the events of a fake run", async () => {
    await runOnServer(trial);

    expect(store().runEvents.length).toBeGreaterThan(0);
    expect(isRunning(store())).toBe(true);
  });

  it("starts at the very beginning and plays by itself", async () => {
    await runOnServer(trial);

    expect(currentSeq(store())).toBe(0);
    expect(store().isPlaying).toBe(true);
  });

  it("has nothing to try out when no agent is open", async () => {
    useEditor.setState({ spec: null, nodes: [], edges: [] });

    await runOnServer(trial);

    expect(store().runEvents).toEqual([]);
    expect(isRunning(store())).toBe(false);
  });

  // 놓침 방지 ④ — 실행 전 검증으로 애초에 에러를 예방한다 (디자인 언어 §1.5).
  it("does not start while a node is still waiting for its settings", async () => {
    store().addNode("llm.agent", { x: 0, y: 0 });

    await runOnServer(trial);

    expect(isRunning(store())).toBe(false);
  });

  it("says in plain words how many nodes need a look before it can run", async () => {
    store().addNode("llm.agent", { x: 0, y: 0 });

    await runOnServer(trial);

    expect(said(store().notice)).toContain("1개");
  });

  it("takes the user to the first node that needs a look", async () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    const waiting = store().nodes.at(-1)?.id;

    await runOnServer(trial);

    expect(store().nodes.find((node) => node.selected)?.id).toBe(waiting);
  });

  it("runs once the settings are filled in", async () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    const added = store().nodes.at(-1)?.id ?? "";
    store().updateNodeConfig(added, {
      model_ref: "model://default",
      prompt_ref: "prompt://new@1",
    });

    await runOnServer(trial);

    expect(isRunning(store())).toBe(true);
  });

  it("closes the run when another file is opened", async () => {
    await runOnServer(trial);
    store().loadSpec(example);

    expect(isRunning(store())).toBe(false);
  });

  it("goes back to editing when the user closes the run", async () => {
    await runOnServer(trial);
    store().stopRun();

    expect(isRunning(store())).toBe(false);
    expect(store().runEvents).toEqual([]);
  });
});

describe("time passing during a run", () => {
  beforeEach(async () => {
    await runOnServer(trial);
  });

  it("moves on to the next event when its moment comes", () => {
    store().tickRun(EVENT_STEP_MS);

    expect(currentSeq(store())).toBe(1);
  });

  it("goes twice as far at twice the speed", () => {
    store().setRunSpeed(2);
    store().tickRun(EVENT_STEP_MS);

    expect(currentSeq(store())).toBe(2);
  });

  it("stands still while paused", () => {
    store().pauseRun();
    store().tickRun(EVENT_STEP_MS * 3);

    expect(currentSeq(store())).toBe(0);
  });

  it("carries on from where it was paused", () => {
    store().tickRun(EVENT_STEP_MS);
    store().pauseRun();
    store().playRun();
    store().tickRun(EVENT_STEP_MS);

    expect(currentSeq(store())).toBe(2);
  });

  it("stops by itself at the end of the run", () => {
    store().tickRun(EVENT_STEP_MS * 1000);

    expect(currentSeq(store())).toBe(store().runEvents.at(-1)?.seq);
    expect(store().isPlaying).toBe(false);
  });

  it("plays again from the beginning once the run is over", async () => {
    await playToTheEnd();
    store().playRun();

    expect(currentSeq(store())).toBe(0);
    expect(store().isPlaying).toBe(true);
  });
});

describe("what the canvas shows while the run plays", () => {
  beforeEach(async () => {
    await runOnServer(trial);
  });

  it("has nobody working at the very start", () => {
    expect(runNodeStates(store())).toEqual({});
  });

  it("shows the node that is working right now", () => {
    store().scrubToSeq(seqOf("node.started", "triage"));

    expect(runNodeStates(store()).triage).toBe("running");
  });

  it("winds back to an earlier moment when the user drags backwards", async () => {
    await playToTheEnd();
    store().scrubToSeq(seqOf("node.completed", "output"));
    store().scrubToSeq(seqOf("node.started", "triage"));

    expect(runNodeStates(store()).output).toBeUndefined();
    expect(runNodeStates(store()).input).toBe("completed");
  });
});

describe("moving through the run by hand", () => {
  beforeEach(async () => {
    await runOnServer(trial);
  });

  it("steps one event forward", () => {
    store().stepRun(1);

    expect(currentSeq(store())).toBe(1);
  });

  it("steps one event back", () => {
    store().scrubToSeq(3);
    store().stepRun(-1);

    expect(currentSeq(store())).toBe(2);
  });

  it("stops playing as soon as the user takes over", () => {
    store().stepRun(1);

    expect(store().isPlaying).toBe(false);
  });

  it("goes back to the first moment when asked to start over", () => {
    store().scrubToSeq(5);
    store().restartRun();

    expect(currentSeq(store())).toBe(0);
  });

  it("selects the node an event belongs to when the user picks it", () => {
    const seq = seqOf("node.started", "clinical-agent");

    store().goToEvent(seq);

    expect(currentSeq(store())).toBe(seq);
    expect(store().nodes.filter((node) => node.selected).map((node) => node.id)).toEqual([
      "clinical-agent",
    ]);
  });

  it("leaves the selection alone for an event that belongs to no node", () => {
    store().goToEvent(seqOf("state.patch"));

    expect(store().nodes.filter((node) => node.selected)).toEqual([]);
  });
});

describe("the graph cannot be edited while a run is on screen", () => {
  beforeEach(async () => {
    await runOnServer(trial);
  });

  it("refuses to add a node", () => {
    const before = graphShape();

    store().addNode("llm.agent", { x: 0, y: 0 });

    expect(graphShape()).toBe(before);
  });

  it("refuses to change a setting", () => {
    const before = graphShape();

    store().updateNodeConfig("triage", { model_ref: "model://other" });

    expect(graphShape()).toBe(before);
  });

  it("refuses to take a node out", () => {
    const before = graphShape();

    store().requestDetach("triage");

    expect(store().pendingDetach).toBeNull();
    expect(graphShape()).toBe(before);
  });

  it("refuses to undo the edits made before the run", async () => {
    store().stopRun();
    store().addNode("llm.agent", { x: 0, y: 0 });
    // 설정이 빈 노드로는 실행이 시작되지 않는다 — 이 이야기의 주제는 그다음이다.
    store().updateNodeConfig(store().nodes.at(-1)?.id ?? "", {
      model_ref: "model://default",
      prompt_ref: "prompt://new@1",
    });
    await runOnServer(trial);
    const before = graphShape();

    store().undo();

    expect(graphShape()).toBe(before);
  });

  it("leaves the graph exactly as it was once the run is over", () => {
    const before = graphShape();

    store().tickRun(EVENT_STEP_MS * 1000);
    store().stopRun();

    expect(graphShape()).toBe(before);
  });
});
