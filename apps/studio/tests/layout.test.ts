import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { arrangedPositions } from "../src/graph/layout";
import { type FlowGraph, toFlow } from "../src/graph/serialize";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function placedAt(graph: FlowGraph): Record<string, { x: number; y: number }> {
  return Object.fromEntries(
    arrangedPositions(graph).map((placed) => [placed.id, placed.position]),
  );
}

function edgeBetween(id: string, source: string, target: string) {
  return {
    id,
    source,
    sourceHandle: "out",
    target,
    targetHandle: "in",
    data: { kind: "data" as const },
  };
}

describe("tidying the canvas left to right", () => {
  it("puts each node one step to the right of the one that feeds it", () => {
    const at = placedAt(toFlow(example));
    const order = ["input", "triage", "clinical-agent", "human-gate", "output"];

    for (const [before, after] of order.slice(1).map((id, i) => [order[i], id])) {
      expect(at[after].x).toBeGreaterThan(at[before].x);
    }
  });

  it("gives every node a place", () => {
    expect(arrangedPositions(toFlow(example))).toHaveLength(example.nodes.length);
  });

  it("puts nodes that share a step side by side, never on top of each other", () => {
    const graph = toFlow(example);
    const twin = { ...graph.nodes[1], id: "triage-twin" };
    const at = placedAt({
      ...graph,
      nodes: [...graph.nodes, twin],
      edges: [...graph.edges, edgeBetween("input-twin", "input", "triage-twin")],
    });

    expect(at["triage-twin"].x).toBe(at.triage.x);
    expect(at["triage-twin"].y).not.toBe(at.triage.y);
  });

  it("lays the same graph out the same way every time", () => {
    expect(arrangedPositions(toFlow(example))).toEqual(arrangedPositions(toFlow(example)));
  });

  it("finishes even when the graph loops back on itself", () => {
    const graph = toFlow(example);
    const looped = {
      ...graph,
      edges: [...graph.edges, edgeBetween("output-triage", "output", "triage")],
    };

    expect(arrangedPositions(looped).map((placed) => placed.id).sort()).toEqual(
      example.nodes.map((node) => node.id).sort(),
    );
  });

  it("still finds a place for a node that nothing feeds", () => {
    const graph = toFlow(example);
    const alone = { ...graph.nodes[2], id: "alone" };

    expect(
      placedAt({ ...graph, nodes: [...graph.nodes, alone] }).alone,
    ).toBeDefined();
  });

  // 아무와도 이어지지 않은 노드는 흐름의 첫 단계가 아니다 — 세로로 쌓지 않는다 (UXQ-5 / F7).
  it("lays nodes that are linked to nothing in one row, not in a stack", () => {
    const graph = toFlow(example);
    const loose = [0, 1, 2].map((index) => ({ ...graph.nodes[index], id: `loose-${index}` }));
    const at = placedAt({ nodes: loose, edges: [] });

    expect(at["loose-1"].x).toBeGreaterThan(at["loose-0"].x);
    expect(at["loose-2"].x).toBeGreaterThan(at["loose-1"].x);
    expect(at["loose-1"].y).toBe(at["loose-0"].y);
    expect(at["loose-2"].y).toBe(at["loose-0"].y);
  });

  it("puts them after the last step of the graph they share the canvas with", () => {
    const graph = toFlow(example);
    const alone = { ...graph.nodes[2], id: "alone" };
    const at = placedAt({ ...graph, nodes: [...graph.nodes, alone] });
    const linked = graph.nodes.map((node) => at[node.id].x);

    expect(at.alone.x).toBeGreaterThan(Math.max(...linked));
    expect(at.alone.y).toBe(at.input.y);
  });

  it("has nothing to place on an empty canvas", () => {
    expect(arrangedPositions({ nodes: [], edges: [] })).toEqual([]);
  });
});

describe("tidying from the document menu", () => {
  function store() {
    return useEditor.getState();
  }

  beforeEach(() => {
    store().loadSpec(example);
  });

  it("moves every node to its tidy place", () => {
    store().arrangeNodes();

    expect(
      Object.fromEntries(store().nodes.map((node) => [node.id, node.position])),
    ).toEqual(placedAt(toFlow(example)));
  });

  it("is one step to take back, however many nodes moved", () => {
    store().arrangeNodes();

    expect(store().undoStack).toHaveLength(1);
    store().undo();
    expect(store().nodes.map((node) => node.position)).toEqual(
      example.nodes.map((node) => node.position),
    );
  });

  it("is not worth taking back when everything is already in place", () => {
    store().arrangeNodes();
    store().arrangeNodes();

    expect(store().undoStack).toHaveLength(1);
  });
});
