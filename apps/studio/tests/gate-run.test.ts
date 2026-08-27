// 흐름을 막는 밸브 — '사람 확인' 노드에 닿으면 실행은 거기서 끊기고, 승인해야 다시 흐른다.
// 정지도 재개도 화면의 사정이 아니라 RunEvent의 사실이다 (설계 §11 interrupt/resume).
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { EventType, RunEvent } from "../src/generated/run_event";
import { fakeRun, resumeFakeRun } from "../src/run/fakeRun";
import { validateRunEvent } from "../src/run/validateRunEvent";

const example = exampleSpec as unknown as AgentSpec;

const options = { runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") };

const GATE = "human-gate";

function heldRun(): RunEvent[] {
  return fakeRun(example, options);
}

function approvedRun(): RunEvent[] {
  return resumeFakeRun(example, heldRun(), { approved: true });
}

function typesOf(events: RunEvent[], nodeId: string): EventType[] {
  return events.filter((event) => event.node_id === nodeId).map((event) => event.event_type);
}

/** 사람 확인 노드가 없는 그래프 — 밸브가 없으면 실행은 예전 그대로 끝까지 흐른다. */
function withoutTheGate(): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.filter((node) => node.id !== GATE),
    edges: example.edges.filter(
      (edge) => edge.source.node !== GATE && edge.target.node !== GATE,
    ),
  };
}

function rejectedRun(): RunEvent[] {
  return resumeFakeRun(example, heldRun(), { approved: false });
}

const SECOND_GATE = "second-gate";

/** 사람 확인 노드가 둘 잇따라 선 그래프 — 하나를 지나도 다음이 또 기다린다. */
function withTwoGates(): AgentSpec {
  const gate = example.nodes.find((node) => node.id === GATE);
  if (!gate) throw new Error("the example graph has no gate node");
  return {
    ...example,
    nodes: [...example.nodes, { ...gate, id: SECOND_GATE }],
    edges: [
      ...example.edges.filter((edge) => edge.id !== "human-output"),
      {
        id: "human-second",
        kind: "approval",
        source: { node: GATE, port: "approved" },
        target: { node: SECOND_GATE, port: "review" },
      },
      {
        id: "second-output",
        kind: "approval",
        source: { node: SECOND_GATE, port: "approved" },
        target: { node: "output", port: "input" },
      },
    ],
  };
}

describe("a run that reaches a human gate", () => {
  it("stops right there and asks for a person", () => {
    expect(typesOf(heldRun(), GATE)).toEqual([
      "node.queued",
      "node.started",
      "human.approval_requested",
      "run.paused",
    ]);
  });

  it("ends held at the valve instead of finishing", () => {
    const events = heldRun();

    expect(events.at(-1)?.event_type).toBe("run.paused");
    expect(events.some((event) => event.event_type === "run.completed")).toBe(false);
  });

  it("says which node the run is held at", () => {
    expect(heldRun().at(-1)?.node_id).toBe(GATE);
  });

  it("leaves the nodes behind the valve untouched until someone approves", () => {
    expect(typesOf(heldRun(), "output")).toEqual([]);
  });

  it("runs to the end as before when the graph has no gate", () => {
    const events = fakeRun(withoutTheGate(), options);

    expect(events.at(-1)?.event_type).toBe("run.completed");
    expect(events.some((event) => event.event_type === "run.paused")).toBe(false);
  });
});

describe("approving the gate lets the run flow again", () => {
  it("picks up where it stopped and finishes", () => {
    const events = approvedRun();

    expect(events[heldRun().length]?.event_type).toBe("run.resumed");
    expect(events.at(-1)?.event_type).toBe("run.completed");
  });

  it("finishes the gate node itself once the person has answered", () => {
    expect(typesOf(approvedRun(), GATE)).toEqual([
      "node.queued",
      "node.started",
      "human.approval_requested",
      "run.paused",
      "run.resumed",
      "node.completed",
    ]);
  });

  it("carries the whole run through every node in the order the data flows", () => {
    const started = approvedRun()
      .filter((event) => event.event_type === "node.started")
      .map((event) => event.node_id);

    expect(started).toEqual(["input", "triage", "clinical-agent", GATE, "output"]);
  });

  it("keeps everything that already happened exactly as it was", () => {
    const held = heldRun();

    expect(approvedRun().slice(0, held.length)).toEqual(held);
  });

  it("writes down what the person decided", () => {
    const resumed = approvedRun().find((event) => event.event_type === "run.resumed");

    expect(resumed?.payload.approved).toBe(true);
  });

  // 사람이 폼에 적어 넣은 값은 답과 함께 실행에 남는다 — 승인만 있고 말은 사라지는 일이 없다.
  it("carries the values the person filled in on the resuming event", () => {
    const resumed = resumeFakeRun(example, heldRun(), {
      approved: true,
      values: { comment: "looks right to me" },
    }).find((event) => event.event_type === "run.resumed");

    expect(resumed?.payload.values).toEqual({ comment: "looks right to me" });
    expect(resumed?.payload.approved).toBe(true);
  });

  it("writes no values at all when the person filled nothing in", () => {
    const resumed = approvedRun().find((event) => event.event_type === "run.resumed");

    expect(resumed?.payload).not.toHaveProperty("values");
  });

  it("has nothing to resume when the run is not held at a valve", () => {
    const finished = approvedRun();

    expect(resumeFakeRun(example, finished, { approved: true })).toEqual(finished);
  });
});

describe("turning the gate down ends the run right there", () => {
  it("writes down that the person said no", () => {
    const resumed = rejectedRun().find((event) => event.event_type === "run.resumed");

    expect(resumed?.payload.approved).toBe(false);
  });

  it("finishes the gate node itself — being turned down is not a failure", () => {
    expect(typesOf(rejectedRun(), GATE)).toEqual([
      "node.queued",
      "node.started",
      "human.approval_requested",
      "run.paused",
      "run.resumed",
      "node.completed",
    ]);
  });

  it("says on that finish that a person turned it down", () => {
    const finished = rejectedRun()
      .filter((event) => event.node_id === GATE && event.event_type === "node.completed")
      .at(-1);

    expect(finished?.payload.approved).toBe(false);
  });

  it("closes the run properly instead of leaving it hanging", () => {
    expect(rejectedRun().at(-1)?.event_type).toBe("run.completed");
  });

  it("never lets the nodes behind the valve work", () => {
    expect(typesOf(rejectedRun(), "output")).toEqual([]);
    expect(
      rejectedRun()
        .filter((event) => event.event_type === "node.started")
        .map((event) => event.node_id),
    ).toEqual(["input", "triage", "clinical-agent", GATE]);
  });

  it("keeps everything that already happened exactly as it was", () => {
    const held = heldRun();

    expect(rejectedRun().slice(0, held.length)).toEqual(held);
  });

  it("has nothing to turn down when the run is not held at a valve", () => {
    const finished = approvedRun();

    expect(resumeFakeRun(example, finished, { approved: false })).toEqual(finished);
  });

  it("makes events that keep every promise of the contract", () => {
    const events = rejectedRun();
    const seqs = events.map((event) => event.seq);
    const times = events.map((event) => Date.parse(event.timestamp));

    expect(events.flatMap((event) => validateRunEvent(event))).toEqual([]);
    expect(seqs).toEqual(seqs.map((_, index) => index));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(rejectedRun()).toEqual(events);
  });
});

describe("a graph with two gates one after the other", () => {
  const twoGates = withTwoGates();

  function heldAtFirst(): RunEvent[] {
    return fakeRun(twoGates, options);
  }

  function heldAtSecond(): RunEvent[] {
    return resumeFakeRun(twoGates, heldAtFirst(), { approved: true });
  }

  it("holds at the first gate and leaves the second one alone", () => {
    const events = heldAtFirst();

    expect(events.at(-1)?.event_type).toBe("run.paused");
    expect(events.at(-1)?.node_id).toBe(GATE);
    expect(typesOf(events, SECOND_GATE)).toEqual([]);
  });

  it("holds again at the second gate once the first is approved", () => {
    const events = heldAtSecond();

    expect(events.at(-1)?.event_type).toBe("run.paused");
    expect(events.at(-1)?.node_id).toBe(SECOND_GATE);
    expect(events.some((event) => event.event_type === "run.completed")).toBe(false);
  });

  it("can be turned down at the second gate", () => {
    const events = resumeFakeRun(twoGates, heldAtSecond(), { approved: false });

    expect(typesOf(events, SECOND_GATE).at(-1)).toBe("node.completed");
    expect(events.at(-1)?.event_type).toBe("run.completed");
    expect(typesOf(events, "output")).toEqual([]);
  });

  it("runs to the end when both gates are approved", () => {
    const events = resumeFakeRun(twoGates, heldAtSecond(), { approved: true });

    expect(events.at(-1)?.event_type).toBe("run.completed");
    expect(typesOf(events, "output")).toContain("node.completed");
  });

  it("makes events that keep every promise of the contract", () => {
    const events = resumeFakeRun(twoGates, heldAtSecond(), { approved: true });
    const seqs = events.map((event) => event.seq);

    expect(events.flatMap((event) => validateRunEvent(event))).toEqual([]);
    expect(seqs).toEqual(seqs.map((_, index) => index));
  });
});

describe("the events of a run held and then let go", () => {
  it("all pass the run event contract", () => {
    expect(approvedRun().flatMap((event) => validateRunEvent(event))).toEqual([]);
  });

  it("count up without ever going back or skipping", () => {
    const seqs = approvedRun().map((event) => event.seq);

    expect(seqs).toEqual(seqs.map((_, index) => index));
  });

  it("belong to the one run all the way through", () => {
    expect(new Set(approvedRun().map((event) => event.run_id))).toEqual(
      new Set(["run_example"]),
    );
  });

  it("carry the revision of the spec that was run", () => {
    expect(new Set(approvedRun().map((event) => event.spec_revision))).toEqual(
      new Set([example.revision]),
    );
  });

  it("never move backwards in time", () => {
    const times = approvedRun().map((event) => Date.parse(event.timestamp));

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("are the same every time the same run is approved", () => {
    expect(approvedRun()).toEqual(approvedRun());
  });
});
