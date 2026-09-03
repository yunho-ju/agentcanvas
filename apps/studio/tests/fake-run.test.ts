import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { EventType, RunEvent } from "../src/generated/run_event";
import { fakeRun, resumeFakeRun } from "../src/run/fakeRun";
import { validateRunEvent } from "../src/run/validateRunEvent";

const example = exampleSpec as unknown as AgentSpec;

const options = { runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") };

function run(spec: AgentSpec = example): RunEvent[] {
  return fakeRun(spec, options);
}

/**
 * 처음부터 끝까지 흐른 실행 — 예시 그래프는 사람 확인 밸브에서 한 번 멈추므로
 * 끝을 이야기하려면 승인까지 마친 실행을 본다. 밸브 자체의 이야기는 gate-run 테스트가 맡는다.
 */
function wholeRun(spec: AgentSpec = example): RunEvent[] {
  return resumeFakeRun(spec, run(spec), { approved: true });
}

function typesOf(events: RunEvent[], nodeId: string): EventType[] {
  return events.filter((event) => event.node_id === nodeId).map((e) => e.event_type);
}

function emptySpec(): AgentSpec {
  return { ...example, nodes: [], edges: [] };
}

describe("running an agent for real is not needed to see it move", () => {
  it("visits the nodes in the order the data flows through them", () => {
    const started = wholeRun()
      .filter((event) => event.event_type === "node.started")
      .map((event) => event.node_id);

    expect(started).toEqual([
      "input",
      "triage",
      "clinical-agent",
      "human-gate",
      "output",
    ]);
  });

  it("wraps the whole run between a start and an end", () => {
    const events = wholeRun();

    expect(events[0]?.event_type).toBe("run.started");
    expect(events.at(-1)?.event_type).toBe("run.completed");
  });

  it("takes a node from waiting to working to done", () => {
    expect(typesOf(wholeRun(), "output")).toEqual([
      "node.queued",
      "node.started",
      "node.completed",
    ]);
  });

  it("shows the prompt and the model call for a node that asks a model", () => {
    expect(typesOf(run(), "triage")).toEqual([
      "node.queued",
      "node.started",
      "prompt.compiled",
      "llm.requested",
      "llm.completed",
      "node.completed",
    ]);
  });

  it("writes down a state change only where the graph really keeps state", () => {
    const patches = run().filter((event) => event.event_type === "state.patch");

    // 'triage-agent'만 state_schema가 아는 이름(messages)으로 값을 넘긴다.
    expect(patches.map((event) => event.payload.edge_id)).toEqual(["triage-agent"]);
  });

  it("writes the value under a name the state schema knows", () => {
    const patch = run().find((event) => event.event_type === "state.patch");

    expect(patch?.payload.patch).toEqual([
      { op: "replace", path: "/messages", value: "result of triage.passthrough" },
    ]);
  });

  it("has no state to change when the graph keeps none", () => {
    const stateless = { ...example, state_schema: { type: "object", properties: {} } };

    expect(run(stateless).some((event) => event.event_type === "state.patch")).toBe(false);
  });

  it("still has a beginning and an end when there is nothing to run", () => {
    expect(run(emptySpec()).map((event) => event.event_type)).toEqual([
      "run.started",
      "run.completed",
    ]);
  });
});

describe("the events a fake run produces", () => {
  it("all pass the run event contract", () => {
    expect(run().flatMap((event) => validateRunEvent(event))).toEqual([]);
  });

  it("would be refused if the moment they happened were not a moment", () => {
    expect(validateRunEvent({ ...run()[0], timestamp: "not a date" })).not.toEqual([]);
  });

  it("count up without ever going back", () => {
    const seqs = run().map((event) => event.seq);

    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("carry the revision of the spec that was run", () => {
    expect(new Set(run().map((event) => event.spec_revision))).toEqual(
      new Set([example.revision]),
    );
  });

  it("carry the run they belong to", () => {
    expect(new Set(run().map((event) => event.run_id))).toEqual(new Set(["run_example"]));
  });

  it("start at the moment the caller says the run started", () => {
    expect(run()[0]?.timestamp).toBe("2026-08-01T12:30:00.000Z");
  });

  it("never move backwards in time", () => {
    const times = run().map((event) => Date.parse(event.timestamp));

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("are the same every time the same spec is run", () => {
    expect(run()).toEqual(run());
  });
});

// 가짜 실행도 무엇을 입고 물었는지 말한다 — 화면이 두 실행기를 다르게 그리지 않게
// (파이썬 `agentcanvas_engine.fake_runtime`와 같은 규칙).
describe("입은 skill을 흉내 실행도 그대로 적는다", () => {
  function skill(name: string) {
    return {
      ref: `skill://${name}@1`,
      name,
      description: `Use when ${name} is what the answer needs.`,
      body: `Do what ${name} asks.\n`,
    };
  }

  function specWearing(held: string[], worn: string[]): AgentSpec {
    return {
      ...example,
      skills: held.map(skill),
      nodes: example.nodes.map((node) =>
        // skill을 입을 수 있는 단계는 llm.agent다 (registry의 x-skill-ref 자리).
        node.id === "clinical-agent"
          ? { ...node, config: { ...node.config, skill_refs: worn } }
          : node,
      ),
    } as AgentSpec;
  }

  function refsAskedFor(spec: AgentSpec): unknown[] {
    return run(spec)
      .filter(
        (event) =>
          event.event_type === "llm.requested" && event.node_id === "clinical-agent",
      )
      .map((event) => event.payload.skill_refs);
  }

  it("입은 skill의 이름표가 그 걸음의 사건에 남는다", () => {
    const refs = refsAskedFor(specWearing(["plain-answer"], ["skill://plain-answer@1"]));

    expect(refs[0]).toEqual(["skill://plain-answer@1"]);
  });

  it("문서에 없는 이름표는 따르지 않은 것이라 적히지 않는다", () => {
    const refs = refsAskedFor(specWearing([], ["skill://nowhere@1"]));

    expect(refs[0]).toBeUndefined();
  });

  it("두 벌을 입으면 입은 차례 그대로 적힌다", () => {
    const refs = refsAskedFor(
      specWearing(
        ["plain-answer", "cite-sources"],
        ["skill://cite-sources@1", "skill://plain-answer@1"],
      ),
    );

    expect(refs[0]).toEqual(["skill://cite-sources@1", "skill://plain-answer@1"]);
  });

  it("같은 이름표를 두 번 적어도 한 번만 적힌다", () => {
    const refs = refsAskedFor(
      specWearing(
        ["plain-answer"],
        ["skill://plain-answer@1", "skill://plain-answer@1"],
      ),
    );

    expect(refs[0]).toEqual(["skill://plain-answer@1"]);
  });

  it("아무것도 입지 않은 실행의 기록은 예전 그대로다", () => {
    const asked = run(example).filter((event) => event.event_type === "llm.requested");

    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((event) => !("skill_refs" in event.payload))).toBe(true);
  });
});
