import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { buildRunRecord, inputFromRunStarted, ranGraph } from "../src/run/runRecord";
import type { RunEvent } from "../src/generated/run_event";

const example = exampleSpec as unknown as AgentSpec;

describe("assembling what a run left behind", () => {
  it("takes the id and the server's timestamp as its own", () => {
    const record = buildRunRecord(
      { id: "run_1", created_at: "2026-08-01T12:30:00.000Z" },
      1,
      example,
    );

    expect(record.id).toBe("run_1");
    expect(record.at.toISOString()).toBe("2026-08-01T12:30:00.000Z");
  });

  it("numbers the run by the order handed to it", () => {
    const record = buildRunRecord(
      { id: "run_2", created_at: "2026-08-01T12:30:00.000Z" },
      3,
      example,
    );

    expect(record.order).toBe(3);
  });

  it("starts with no events — they arrive later from the stream", () => {
    const record = buildRunRecord(
      { id: "run_3", created_at: "2026-08-01T12:30:00.000Z" },
      1,
      example,
    );

    expect(record.events).toEqual([]);
  });
});

describe("which graph the run actually ran", () => {
  it("keeps the saved graph when its revision matches the run's", () => {
    const saved: AgentSpec = { ...example, revision: "sha256:matching" };
    const exported = () => ({ ...example, revision: "sha256:other" });

    expect(ranGraph(saved, "sha256:matching", exported)).toBe(saved);
  });

  it("falls back to the canvas when the saved revision has moved on", () => {
    const saved: AgentSpec = { ...example, revision: "sha256:old" };
    const exported: AgentSpec = { ...example, revision: "sha256:new" };

    expect(ranGraph(saved, "sha256:new", () => exported)).toBe(exported);
  });

  it("falls back to the canvas when nothing has been saved yet", () => {
    const exported: AgentSpec = { ...example, revision: "sha256:new" };

    expect(ranGraph(null, "sha256:new", () => exported)).toBe(exported);
  });
});

describe("input copied from the first run.started event", () => {
  const event = (event_type: RunEvent["event_type"], input?: unknown): RunEvent =>
    ({ event_type, payload: input === undefined ? {} : { input }, run_id: "r", seq: 1, spec_revision: "s", timestamp: "t" }) as RunEvent;

  it("copies a valid object, including nested values", () => {
    const input = { question: "hi", options: { count: 2 }, tags: ["a"] };
    const result = inputFromRunStarted([event("run.started", input)]);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.options).not.toBe(input.options);
  });

  it.each([undefined, [], "text", 3, null])("uses empty input for invalid input %p", (input) => {
    expect(inputFromRunStarted([event("run.started", input)])).toEqual({});
  });

  it("uses the first run.started input", () => {
    expect(inputFromRunStarted([event("run.started", { first: true }), event("run.started", { second: true })])).toEqual({ first: true });
  });
});
