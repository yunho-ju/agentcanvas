import { describe, expect, it } from "vitest";
import { reviewArchitectSpec } from "../src/architect/architect";
import { makeArchitectSpec, withAHumanGate } from "./architect-fixtures";
import { chatBindings } from "../src/chat/chatEntry";

describe("local Architect preview", () => {
  it("creates a deterministic four-node draft and completes fake review", () => {
    const spec = makeArchitectSpec("triage incoming requests", "draft-fixed");
    expect(spec.nodes).toHaveLength(4);
    expect(spec.edges).toHaveLength(3);
    expect(spec.nodes[0].config?.bindings).toEqual({ message: "input.message" });
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
      toFill: 0,
    });
  });

  it("counts one setting once even when it is wrong in more than one way", () => {
    const spec = makeArchitectSpec("request", "draft-fixed");
    const broken = {
      ...spec,
      nodes: spec.nodes.map((node) =>
        node.id === "core-input" ? { ...node, config: { bindings: { first: 1, second: 2 } } } : node,
      ),
    };

    expect(reviewArchitectSpec(broken).toFill).toBe(1);
  });

  it.each([
    ["orphan edge", (spec: ReturnType<typeof makeArchitectSpec>) => ({ ...spec, edges: [{ ...spec.edges[0], target: { node: "missing", port: "input" } }, ...spec.edges.slice(1)] })],
    ["orphan node", (spec: ReturnType<typeof makeArchitectSpec>) => ({ ...spec, nodes: [...spec.nodes, { id: "orphan", type: "llm.agent", position: { x: 1, y: 1 } }] })],
    ["cycle", (spec: ReturnType<typeof makeArchitectSpec>) => ({ ...spec, edges: [...spec.edges, { id: "cycle", kind: "data" as const, source: { node: "core-output", port: "input" }, target: { node: "core-input", port: "message" } }] })],
  ])("rejects %s graph mutation", (_, mutate) => {
    const result = reviewArchitectSpec(mutate(makeArchitectSpec("request", "draft-fixed")));
    expect(result.graph.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("walks a draft that stops for a person all the way to the end", () => {
    // 이 검사가 묻는 것은 구조의 사실이지 사람이 승인할지가 아니다 (DESIGN §7).
    const gated = withAHumanGate(makeArchitectSpec("answer questions", "draft-gated"));

    expect(reviewArchitectSpec(gated).dryRun).toEqual({ passed: true, count: 1 });
    expect(reviewArchitectSpec(gated).passed).toBe(true);
  });

  it("keeps walking through every stop, not only the first", () => {
    const twice = withAHumanGate(
      withAHumanGate(makeArchitectSpec("answer questions", "draft-gated"), "first-gate"),
      "second-gate",
    );

    expect(reviewArchitectSpec(twice).dryRun.passed).toBe(true);
  });

  it("still fails the walk when the graph never reaches the end", () => {
    const spec = makeArchitectSpec("answer questions", "draft-gated");
    const cut = { ...spec, nodes: spec.nodes.filter((node) => node.id !== "llm-agent") };

    expect(reviewArchitectSpec(cut).passed).toBe(false);
  });

  it("makes a draft that can be talked to once it is published", () => {
    // 초안의 입력 이름이 곧 대화의 자리다 — 이름이 다르면 게시해도 Talk 문이 열리지 않는다 (F3).
    expect(chatBindings(makeArchitectSpec("answer questions", "draft-fixed")).said).toBe(true);
  });
});
