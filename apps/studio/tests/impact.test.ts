import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import expectedUnreachable from "../../../examples/basic-agent/detach_reachability.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { analyzeConfigChange, analyzeDetach } from "../src/graph/impact";
import { type FlowGraph, toFlow } from "../src/graph/serialize";

const example = exampleSpec as unknown as AgentSpec;

function graph(): FlowGraph {
  return toFlow(example);
}

function ids(items: { id: string }[]): string[] {
  return items.map((item) => item.id);
}

describe("taking a node out", () => {
  it("counts the connections that would be cut", () => {
    expect(ids(analyzeDetach(graph(), "triage").brokenEdges)).toEqual([
      "input-triage",
      "triage-agent",
    ]);
  });

  it("names the nodes the data would no longer reach", () => {
    expect(ids(analyzeDetach(graph(), "triage").unreachableNodes)).toEqual([
      "clinical-agent",
      "human-gate",
      "output",
    ]);
  });

  it("leaves the rest of the graph alone when the last node goes", () => {
    const impact = analyzeDetach(graph(), "output");
    expect(ids(impact.brokenEdges)).toEqual(["human-output"]);
    expect(impact.unreachableNodes).toEqual([]);
  });

  it("breaks nothing when the node hangs on its own", () => {
    const alone = graph();
    const spare = { ...alone.nodes[1], id: "spare" };
    const impact = analyzeDetach({ ...alone, nodes: [...alone.nodes, spare] }, "spare");
    expect(impact.brokenEdges).toEqual([]);
    expect(impact.unreachableNodes).toEqual([]);
  });

  it("does not blame a node for what was already out of reach", () => {
    const before = graph();
    const orphan = { ...before.nodes[4], id: "orphan" };
    const impact = analyzeDetach({ ...before, nodes: [...before.nodes, orphan] }, "output");
    expect(ids(impact.unreachableNodes)).toEqual([]);
  });

  it("breaks nothing for a node that is not on the canvas", () => {
    const impact = analyzeDetach(graph(), "ghost");
    expect(impact.brokenEdges).toEqual([]);
    expect(impact.unreachableNodes).toEqual([]);
  });
});

describe("taking a value out of a node's settings", () => {
  it("counts the connection that hung off the port that disappears", () => {
    const impact = analyzeConfigChange(graph(), "input", {}, example.input_schema);
    expect(ids(impact.brokenEdges)).toEqual(["input-triage"]);
  });

  it("names the nodes that are left without data", () => {
    const impact = analyzeConfigChange(graph(), "input", {}, example.input_schema);
    expect(ids(impact.unreachableNodes)).toEqual([
      "triage",
      "clinical-agent",
      "human-gate",
      "output",
    ]);
  });

  it("breaks nothing when the ports stay as they are", () => {
    const impact = analyzeConfigChange(
      graph(),
      "clinical-agent",
      { model_ref: "model://fast" },
      example.input_schema,
    );
    expect(impact.brokenEdges).toEqual([]);
    expect(impact.unreachableNodes).toEqual([]);
  });
});

// 도달성 판정은 engine validator(graph.unreachable_node)의 규칙이다.
// 같은 예시 spec, 같은 기대값을 파이썬 쪽 test_detach_reachability.py 가 함께 읽는다.
describe("the same reachability rule as the engine", () => {
  it.each(Object.entries(expectedUnreachable as Record<string, string[]>))(
    "agrees on what is out of reach once %s is gone",
    (nodeId, unreachable) => {
      expect(ids(analyzeDetach(graph(), nodeId).unreachableNodes)).toEqual(unreachable);
    },
  );
});
