import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import { toFlow } from "../src/graph/serialize";
import { fakeRun, resumeFakeRun } from "../src/run/fakeRun";
import { type EdgeFlowState, edgeFlowStates } from "../src/run/player";

const example = exampleSpec as unknown as AgentSpec;
// 예시 그래프는 사람 확인 밸브에서 한 번 멈춘다 — 여기서 보는 것은 승인까지 끝난 실행이다.
const options = {
  runId: "run_example",
  startedAt: new Date("2026-08-01T12:30:00.000Z"),
};
const events = resumeFakeRun(example, fakeRun(example, options), { approved: true });
const edges = toFlow(example).edges;

function seqOfFirst(type: string, nodeId?: string): number {
  const found = events.find(
    (event) => event.event_type === type && (!nodeId || event.node_id === nodeId),
  );
  if (!found) throw new Error(`no ${type} event for ${nodeId ?? "the run"}`);
  return found.seq;
}

function flowOf(seq: number, edgeId: string): EdgeFlowState {
  return edgeFlowStates(edges, events, seq)[edgeId];
}

const lastSeq = events.at(-1)?.seq ?? 0;

describe("which connections the run is pushing data through", () => {
  it("leaves a connection empty while the node before it is still working", () => {
    expect(flowOf(seqOfFirst("node.started", "input"), "input-triage")).toBe("idle");
  });

  it("fills the connection the moment the node before it finishes", () => {
    expect(flowOf(seqOfFirst("node.completed", "input"), "input-triage")).toBe("carrying");
  });

  it("keeps it filled until the node after it takes the data", () => {
    expect(flowOf(seqOfFirst("node.queued", "triage"), "input-triage")).toBe("carrying");
  });

  it("leaves a trace once the node after it starts working", () => {
    expect(flowOf(seqOfFirst("node.started", "triage"), "input-triage")).toBe("carried");
  });

  it("keeps the trace for the rest of the run", () => {
    expect(flowOf(lastSeq, "input-triage")).toBe("carried");
  });

  it("says nothing about connections the run has not reached", () => {
    expect(flowOf(seqOfFirst("node.completed", "input"), "human-output")).toBe("idle");
  });

  it("has data behind every connection when the run is over", () => {
    expect(edgeFlowStates(edges, events, lastSeq)).toEqual({
      "input-triage": "carried",
      "triage-agent": "carried",
      "agent-human": "carried",
      "human-output": "carried",
    });
  });

  it("pushes nothing through a connection whose node could not finish", () => {
    const started = events[seqOfFirst("node.started", "input")];
    const failed: RunEvent[] = [
      ...events.slice(0, started.seq + 1),
      { ...started, seq: 99, event_type: "node.failed", payload: {} },
    ];

    expect(edgeFlowStates(edges, failed, 99)["input-triage"]).toBe("idle");
  });

  // 거절도 답이다 — 값은 사람에게 건네졌고, 그 사람이 아니오라고 했다.
  it("settles the pipe into the gate once a person has turned it down", () => {
    const refused = resumeFakeRun(example, fakeRun(example, options), { approved: false });
    const ended = refused.at(-1)?.seq ?? 0;

    expect(edgeFlowStates(edges, refused, ended)).toEqual({
      "input-triage": "carried",
      "triage-agent": "carried",
      "agent-human": "carried",
      "human-output": "idle",
    });
  });

  it("empties the connections again when the viewer rewinds", () => {
    const before = seqOfFirst("node.started", "input");
    const seqs = events.map((event) => event.seq);
    // 끝까지 갔다가 그 순간으로 되감아 온 길
    const wandered = [...seqs, ...[...seqs].reverse().filter((seq) => seq >= before)];

    const afterWandering = wandered.reduce(
      (_, seq) => edgeFlowStates(edges, events, seq),
      {} as Record<string, EdgeFlowState>,
    );

    expect(afterWandering).toEqual(edgeFlowStates(edges, events, before));
    expect(afterWandering["input-triage"]).toBe("idle");
  });
});
