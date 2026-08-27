// 흐름을 막고 다시 흘려보내는 두 가지 밸브 — 사람 확인(gate)과 손으로 꽂은 멈춤(breakpoint).
// 재생이 멈추는 것도 다시 흐르는 것도 이벤트의 사실에서 나온다.
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { translate } from "../src/i18n/messages";
import { firstDivergence, runSteps } from "../src/run/compareRuns";
import { EVENT_STEP_MS } from "../src/run/fakeRun";
import { useEditor } from "../src/store/editor";
import { gateSchemaRef } from "../src/store/gateSlice";
import { awaitingGate, currentSeq } from "../src/store/runSlice";
import { runOnServer, settle } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;
const trial = { runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") };
const GATE = "human-gate";

function store() {
  return useEditor.getState();
}

/** 재생이 저절로 멈출 때까지 흘려 보낸다. */
function playOn() {
  store().tickRun(EVENT_STEP_MS * 1000);
}

function seqOf(type: string, nodeId?: string): number {
  const found = store().runEvents.find(
    (event) => event.event_type === type && (!nodeId || event.node_id === nodeId),
  );
  if (!found) throw new Error(`the run has no ${type} event`);
  return found.seq;
}

/** store가 들고 있는 메시지를 화면이 읽을 한국어 한 줄로. */
function said(message: { key: string } | null): string {
  return message ? translate("ko", message as Parameters<typeof translate>[1]) : "";
}

/** 사람 확인 노드가 없는 그래프 — 밸브가 없으면 실행은 예전 그대로 흐른다. */
function withoutTheGate(): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.filter((node) => node.id !== GATE),
    edges: example.edges.filter(
      (edge) => edge.source.node !== GATE && edge.target.node !== GATE,
    ),
  };
}

beforeEach(() => {
  store().loadSpec(example);
});

describe("the run stops by itself at the human gate", () => {
  it("is not waiting for anyone before the flow gets there", async () => {
    await runOnServer(trial);

    expect(awaitingGate(store())).toBeNull();
  });

  it("holds at the gate node and says whose word it needs", async () => {
    await runOnServer(trial);

    playOn();

    expect(awaitingGate(store())).toBe(GATE);
    expect(store().isPlaying).toBe(false);
  });

  it("stands exactly on the moment the run was held", async () => {
    await runOnServer(trial);

    playOn();

    expect(currentSeq(store())).toBe(seqOf("run.paused"));
  });

  it("opens the card that asks the person to look", async () => {
    await runOnServer(trial);

    playOn();

    expect(store().gateCardOpen).toBe(true);
  });

  it("is waiting for nobody once the viewer winds back before the gate", async () => {
    await runOnServer(trial);
    playOn();

    store().scrubToSeq(seqOf("node.started", "triage"));

    expect(awaitingGate(store())).toBeNull();
  });

  it("plays straight to the end when the graph has no gate", async () => {
    store().loadSpec(withoutTheGate());
    await runOnServer(trial);

    playOn();

    expect(awaitingGate(store())).toBeNull();
    expect(store().runEvents.at(-1)?.event_type).toBe("run.completed");
  });
});

// 무엇을 물을지도 화면이 정하지 않는다 — 확인을 청한 그 사건에 적힌 이름 그대로다.
describe("the form the held gate is asking for", () => {
  it("is the one the gate node named", async () => {
    await runOnServer(trial);
    playOn();

    expect(gateSchemaRef(store())).toBe("schema://answer-review@1");
  });

  it("is nameless while nobody is being waited for", async () => {
    await runOnServer(trial);

    expect(gateSchemaRef(store())).toBe("");
  });

  it("is nameless when the pause never said which form it wants", async () => {
    await runOnServer(trial);
    playOn();
    const forgetful = {
      ...store(),
      runEvents: store().runEvents.filter(
        (event) => event.event_type !== "human.approval_requested",
      ),
    };

    expect(gateSchemaRef(forgetful)).toBe("");
  });
});

describe("approving the gate lets the run flow again", () => {
  beforeEach(async () => {
    await runOnServer(trial);
    playOn();
  });

  it("carries the run on to the end", async () => {
    await store().approveGate();
    await settle();
    playOn();

    expect(store().runEvents.at(-1)?.event_type).toBe("run.completed");
    expect(currentSeq(store())).toBe(store().runEvents.at(-1)?.seq);
  });

  it("starts flowing again the moment it is approved", async () => {
    await store().approveGate();
    await settle();

    expect(store().isPlaying).toBe(true);
    expect(awaitingGate(store())).toBeNull();
  });

  it("goes on from where it was held, not from the beginning", async () => {
    const held = currentSeq(store());

    await store().approveGate();
    await settle();

    expect(currentSeq(store())).toBe(held);
  });

  it("puts the card away", async () => {
    await store().approveGate();
    await settle();

    expect(store().gateCardOpen).toBe(false);
  });

  it("keeps it all as one run in the history", async () => {
    const runs = store().runHistory.length;

    await store().approveGate();
    await settle();

    expect(store().runHistory).toHaveLength(runs);
    expect(
      store().runHistory.find((item) => item.id === store().activeRunId)?.events,
    ).toEqual(store().runEvents);
  });

  // 사람이 적어 넣은 값은 답과 함께 실행에 실려 간다 (CP-4).
  it("carries what the person wrote into the run", async () => {
    await store().approveGate({ comment: "checked it myself" });
    await settle();

    const resumed = store().runEvents.find(
      (event) => event.event_type === "run.resumed",
    );
    expect(resumed?.payload.values).toEqual({ comment: "checked it myself" });
  });

  it("writes no values when the person answered with nothing to say", async () => {
    await store().approveGate();
    await settle();

    const resumed = store().runEvents.find(
      (event) => event.event_type === "run.resumed",
    );
    expect(resumed?.payload).not.toHaveProperty("values");
  });

  it("carries no values when the person turns the gate down", async () => {
    await store().rejectGate();
    await settle();

    const resumed = store().runEvents.find(
      (event) => event.event_type === "run.resumed",
    );
    expect(resumed?.payload).not.toHaveProperty("values");
  });

  it("leaves the run alone when nobody is being waited for", async () => {
    await store().approveGate();
    await settle();
    playOn();
    const finished = store().runEvents;

    await store().approveGate();
    await settle();

    expect(store().runEvents).toEqual(finished);
  });

  it("does not start over when the viewer presses play — it asks again instead", () => {
    store().setGateCardOpen(false);

    store().playRun();

    expect(currentSeq(store())).toBe(store().runEvents.at(-1)?.seq);
    expect(store().isPlaying).toBe(false);
    expect(store().gateCardOpen).toBe(true);
  });

  it("lets the person leave it held and look around instead", () => {
    store().setGateCardOpen(false);

    expect(store().gateCardOpen).toBe(false);
    expect(awaitingGate(store())).toBe(GATE);
  });
});

describe("turning the gate down ends the run there", () => {
  beforeEach(async () => {
    await runOnServer(trial);
    playOn();
  });

  it("closes the run instead of leaving it held", async () => {
    await store().rejectGate();
    await settle();

    expect(store().runEvents.at(-1)?.event_type).toBe("run.completed");
    expect(awaitingGate(store())).toBeNull();
  });

  it("never lets the nodes behind the valve work", async () => {
    await store().rejectGate();
    await settle();
    playOn();

    expect(
      store().runEvents.filter((event) => event.node_id === "output"),
    ).toEqual([]);
  });

  it("puts the card away", async () => {
    await store().rejectGate();
    await settle();

    expect(store().gateCardOpen).toBe(false);
  });

  it("keeps it all as one run in the history", async () => {
    const runs = store().runHistory.length;

    await store().rejectGate();
    await settle();

    expect(store().runHistory).toHaveLength(runs);
    expect(
      store().runHistory.find((item) => item.id === store().activeRunId)?.events,
    ).toEqual(store().runEvents);
  });

  it("leaves the run alone when nobody is being waited for", async () => {
    await store().rejectGate();
    await settle();
    const refused = store().runEvents;

    await store().rejectGate();
    await settle();

    expect(store().runEvents).toEqual(refused);
  });

  it("stays in the history to be watched again", async () => {
    await store().rejectGate();
    await settle();
    const refused = store().runEvents;
    store().stopRun();

    store().replayRun("run_example");

    expect(store().runEvents).toEqual(refused);
  });

  it("parts ways with an approved run right at the gate", async () => {
    await store().rejectGate();
    await settle();
    const refused = runSteps(store().runEvents);
    store().stopRun();
    await runOnServer({ ...trial, runId: "run_two" });
    playOn();
    await store().approveGate();
    await settle();
    const approved = runSteps(store().runEvents);

    expect(firstDivergence(refused, approved)).toBe(
      refused.findIndex((step) => step.nodeId === GATE),
    );
  });
});

// 거절은 되돌릴 수 없으므로 한 번 더 묻는다 — 그 물음이 열려 있다는 사실은 화면 바깥도 알아야 한다
// (Esc 체인이 무엇을 먼저 무를지 정하려면 알아야 하기 때문이다 — DESIGN §1).
describe("the question asked once more before turning the gate down", () => {
  it("is not being asked until somebody asks for it", () => {
    expect(store().confirmingReject).toBe(false);
  });

  it("opens when the person says they want to turn it down", async () => {
    await runOnServer(trial);
    playOn();

    store().askToReject();

    expect(store().confirmingReject).toBe(true);
  });

  it("closes again without answering anything", async () => {
    await runOnServer(trial);
    playOn();
    const held = store().runEvents;
    store().askToReject();

    store().cancelReject();

    expect(store().confirmingReject).toBe(false);
    expect(store().runEvents).toEqual(held);
    expect(awaitingGate(store())).toBe(GATE);
  });

  it("is over once the person means it", async () => {
    await runOnServer(trial);
    playOn();
    store().askToReject();

    await store().rejectGate();
    await settle();

    expect(store().confirmingReject).toBe(false);
  });

  it("folds away with the card the person put aside", async () => {
    await runOnServer(trial);
    playOn();
    store().askToReject();

    store().setGateCardOpen(false);

    expect(store().confirmingReject).toBe(false);
  });

  it("has nothing to ask when no valve is waiting", async () => {
    await runOnServer(trial);

    store().askToReject();

    expect(store().confirmingReject).toBe(false);
  });

  it("starts over with a new run", async () => {
    await runOnServer(trial);
    playOn();
    store().askToReject();
    store().stopRun();

    await runOnServer({ ...trial, runId: "run_two" });

    expect(store().confirmingReject).toBe(false);
    expect(store().gateCardOpen).toBe(false);
  });
});

describe("winding back over a valve that was already answered", () => {
  it("does not hold the run at it a second time", async () => {
    await runOnServer(trial);
    playOn();
    await store().approveGate();
    await settle();
    playOn();

    store().restartRun();
    store().playRun();
    playOn();

    expect(currentSeq(store())).toBe(store().runEvents.at(-1)?.seq);
    expect(store().gateCardOpen).toBe(false);
  });

  it("is waiting for nobody wherever the viewer stands", async () => {
    await runOnServer(trial);
    playOn();
    await store().approveGate();
    await settle();
    playOn();

    store().scrubToSeq(seqOf("run.paused"));

    expect(awaitingGate(store())).toBeNull();
  });

  it("does not hold it again after a refusal either", async () => {
    await runOnServer(trial);
    playOn();
    await store().rejectGate();
    await settle();

    store().restartRun();
    store().playRun();
    playOn();

    expect(currentSeq(store())).toBe(store().runEvents.at(-1)?.seq);
    expect(store().gateCardOpen).toBe(false);
  });
});

describe("stopping the run wherever the user wants", () => {
  beforeEach(async () => {
    await runOnServer(trial);
  });

  it("remembers nothing to stop at until someone asks", () => {
    expect(store().breakpoints).toEqual([]);
  });

  it("holds the run just before the node starts working", () => {
    store().toggleBreakpoint("triage");

    playOn();

    expect(currentSeq(store())).toBe(seqOf("node.started", "triage") - 1);
    expect(store().isPlaying).toBe(false);
  });

  it("says in plain words where it stopped", () => {
    store().toggleBreakpoint("triage");

    playOn();

    expect(said(store().notice)).toContain("triage");
  });

  it("carries on past the same spot when the viewer plays again", () => {
    store().toggleBreakpoint("triage");
    playOn();

    store().playRun();
    playOn();

    expect(currentSeq(store())).toBe(store().runEvents.at(-1)?.seq);
  });

  it("stops at each marked node in turn", () => {
    store().toggleBreakpoint("triage");
    store().toggleBreakpoint("clinical-agent");
    playOn();

    store().playRun();
    playOn();

    expect(currentSeq(store())).toBe(seqOf("node.started", "clinical-agent") - 1);
  });

  it("stops nowhere once the mark is taken off again", () => {
    store().toggleBreakpoint("triage");
    store().toggleBreakpoint("triage");

    playOn();

    expect(store().breakpoints).toEqual([]);
    expect(currentSeq(store())).toBe(store().runEvents.at(-1)?.seq);
  });

  it("forgets the marks when another graph is opened", () => {
    store().toggleBreakpoint("triage");

    store().loadSpec(example);

    expect(store().breakpoints).toEqual([]);
  });

  it("keeps the marks out of the graph the user saves", () => {
    store().toggleBreakpoint("triage");

    expect(JSON.stringify(store().exportSpec())).not.toContain("breakpoint");
  });
});
