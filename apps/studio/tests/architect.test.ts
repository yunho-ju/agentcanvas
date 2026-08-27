import { describe, expect, it } from "vitest";
import { makeArchitectSpec, reviewArchitectSpec } from "../src/architect/architect";

describe("local Architect preview", () => {
  it("creates a deterministic four-node draft and completes fake review", () => {
    const spec = makeArchitectSpec("triage incoming requests", "draft-fixed");
    expect(spec.nodes).toHaveLength(4);
    expect(spec.edges).toHaveLength(3);
    expect(spec.nodes[0].config?.bindings).toEqual({ request: "input.request" });
    expect(spec.state_schema).toEqual({ type: "object", properties: { answer: { type: "string" } } });
    expect(spec.nodes[1].config?.model_ref).toBe("model://default");
    expect(spec.nodes[2].config?.model_ref).toBe("model://default");
    expect(spec.nodes[3].config?.binding).toBe("state.answer");
    expect(spec.edges[1].kind).toBe("control");
    expect(spec.nodes[2].config?.instruction).toBe("triage incoming requests");
    expect(reviewArchitectSpec(spec)).toEqual({
      passed: true,
      schema: { passed: true, count: 0 },
      graph: { passed: true, count: 0 },
      dryRun: { passed: true, count: 1 },
    });
  });

  it.each([
    ["orphan edge", (spec: ReturnType<typeof makeArchitectSpec>) => ({ ...spec, edges: [{ ...spec.edges[0], target: { node: "missing", port: "input" } }, ...spec.edges.slice(1)] })],
    ["orphan node", (spec: ReturnType<typeof makeArchitectSpec>) => ({ ...spec, nodes: [...spec.nodes, { id: "orphan", type: "llm.agent", position: { x: 1, y: 1 } }] })],
    ["cycle", (spec: ReturnType<typeof makeArchitectSpec>) => ({ ...spec, edges: [...spec.edges, { id: "cycle", kind: "data" as const, source: { node: "core-output", port: "input" }, target: { node: "core-input", port: "request" } }] })],
  ])("rejects %s graph mutation", (_, mutate) => {
    const result = reviewArchitectSpec(mutate(makeArchitectSpec("request", "draft-fixed")));
    expect(result.graph.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
});
