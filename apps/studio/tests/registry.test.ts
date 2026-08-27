import { describe, expect, it } from "vitest";
import type { Node1 as SpecNode } from "../src/generated/agent_spec";
import { LOCALES } from "../src/i18n/locale";
import { nodeTypes, resolvePorts } from "../src/registry/registry";

function node(type: string, config: Record<string, unknown> = {}): SpecNode {
  return { id: "n", type, position: { x: 0, y: 0 }, config };
}

describe("node registry data", () => {
  it("comes from the committed node_registry.json, keyed by node type", () => {
    expect(Object.keys(nodeTypes).length).toBeGreaterThan(0);
    for (const [key, entry] of Object.entries(nodeTypes)) {
      expect(entry.type).toBe(key);
    }
  });

  it("gives every node type a display name and a plain description, in both languages", () => {
    for (const entry of Object.values(nodeTypes)) {
      for (const locale of LOCALES) {
        expect(entry.display_name[locale].trim()).not.toBe("");
        expect(entry.plain_description[locale].trim()).not.toBe("");
      }
    }
  });
});

// Python `resolve_ports` 테스트의 미러 — 두 구현이 같은 판정을 내리는지 고정한다.
describe("resolvePorts mirrors the Python contract", () => {
  it("derives core.input output ports from config.bindings", () => {
    const resolved = resolvePorts(
      node("core.input", {
        bindings: {
          question: "input.question",
          patient_context: "input.patient_context",
        },
      }),
      nodeTypes["core.input"],
    );
    expect(Object.keys(resolved.outputs).sort()).toEqual([
      "patient_context",
      "question",
    ]);
    expect(resolved.inputs).toEqual({});
  });

  it("gives core.input no output ports without bindings", () => {
    const resolved = resolvePorts(node("core.input"), nodeTypes["core.input"]);
    expect(resolved.outputs).toEqual({});
  });

  it("gives core.output the single fixed input port", () => {
    const resolved = resolvePorts(
      node("core.output", { binding: "state.answer" }),
      nodeTypes["core.output"],
    );
    expect(Object.keys(resolved.inputs)).toEqual(["input"]);
    expect(resolved.outputs).toEqual({});
  });

  it("uses static registry ports only for other node types", () => {
    const resolved = resolvePorts(
      node("llm.agent", { bindings: { ignored: "input.x" } }),
      nodeTypes["llm.agent"],
    );
    expect(Object.keys(resolved.inputs)).toEqual(["messages"]);
    expect(Object.keys(resolved.outputs).sort()).toEqual([
      "response",
      "tool_calls",
    ]);
  });

  it("exposes the registry port schema", () => {
    const resolved = resolvePorts(node("llm.agent"), nodeTypes["llm.agent"]);
    expect(resolved.outputs.response.schema).toEqual({ type: "string" });
  });

  it("takes the dynamic port schema from the agent input_schema", () => {
    const resolved = resolvePorts(
      node("core.input", { bindings: { question: "input.question" } }),
      nodeTypes["core.input"],
      { type: "object", properties: { question: { type: "string" } } },
    );
    expect(resolved.outputs.question.schema).toEqual({ type: "string" });
  });

  it("leaves the dynamic port schema unspecified when the property is missing", () => {
    const resolved = resolvePorts(
      node("core.input", { bindings: { question: "input.question" } }),
      nodeTypes["core.input"],
      { type: "object", properties: {} },
    );
    expect(resolved.outputs.question.schema).toEqual({});
  });

  it.each([
    { bindings: 5 },
    { bindings: "question" },
    { bindings: ["question"] },
    { bindings: { "": "input.question" } },
    { bindings: { question: 5 } },
    {},
  ])("never throws and adds no ports for broken bindings %j", (config) => {
    const resolved = resolvePorts(
      node("core.input", config as Record<string, unknown>),
      nodeTypes["core.input"],
    );
    expect(resolved.outputs).toEqual({});
  });
});
