import { describe, expect, it } from "vitest";
import type { ResourceBinding, Node1 as SpecNode } from "../src/generated/agent_spec";
import type { NodeType } from "../src/generated/node_type";
import { LOCALES } from "../src/i18n/locale";
import { nodeTypes, resolvePorts } from "../src/registry/registry";

function node(type: string, config: Record<string, unknown> = {}): SpecNode {
  return { id: "n", type, position: { x: 0, y: 0 }, config };
}

const TOOL_NODE_CONFIG = { resource_ref: "reference", tool_name: "lookup" };

function bindingCarryingLookup(outputSchema: Record<string, unknown>): ResourceBinding {
  return {
    id: "reference",
    kind: "mcp.toolset",
    server_ref: "mcp://reference",
    approval_policy: "read_only_auto",
    tools: [
      {
        name: "lookup",
        plain_description: { ko: "찾아본다.", en: "Looks it up." },
        input_schema: { type: "object", properties: {} },
        output_schema: outputSchema,
        timeout_ms: 5000,
        call: { transport: "mcp", remote_name: "lookup" },
      },
    ],
  };
}

/** 도구 마커만 붙인 가상의 노드 타입 — 마커에 무엇을 적어도 되는지 보려고 만든다. */
function nodeTypeWithToolMarker(plan: Record<string, unknown>): NodeType {
  return {
    type: "custom.echo",
    version: "1.0",
    runtime: "langgraph.python",
    display_name: { ko: "그대로 내보내기", en: "Echo" },
    plain_description: {
      ko: "들어온 값을 그대로 내보낸다.",
      en: "Sends whatever comes in straight back out.",
    },
    ports: { inputs: [], outputs: [{ id: "result", schema: {} }] },
    config_schema: {
      type: "object",
      properties: {
        resource_ref: { type: "string", "x-binding-ref": true },
        tool_name: { type: "string" },
      },
      "x-tool-ports": plan,
    },
  };
}

/** bindings로도 포트가 생기고 도구도 입는, 두 마커가 겹친 가상의 노드 타입. */
function nodeTypeWearingBothMarkers(): NodeType {
  const marked = nodeTypeWithToolMarker({
    tool_name_field: "tool_name",
    input_port: "input",
    output_port: "result",
  });
  return {
    ...marked,
    type: "core.input",
    config_schema: {
      ...marked.config_schema,
      properties: {
        ...(marked.config_schema.properties as Record<string, unknown>),
        bindings: { type: "object" },
      },
    },
  };
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

  it("wears the tool without gaining or losing a port", () => {
    // 도구 마커는 있던 포트의 schema만 갈아입힌다 — 포트 이름만 쓰는 자리(landingPorts)가
    // 바인딩을 몰라도 안전한 이유다.
    const toolNode = node("tool.mcp", TOOL_NODE_CONFIG);
    const staticPorts = resolvePorts(toolNode, nodeTypes["tool.mcp"]);
    const dressed = resolvePorts(toolNode, nodeTypes["tool.mcp"], undefined, [
      bindingCarryingLookup({ type: "string" }),
    ]);
    expect([Object.keys(dressed.inputs), Object.keys(dressed.outputs)]).toEqual([
      Object.keys(staticPorts.inputs),
      Object.keys(staticPorts.outputs),
    ]);
    expect(dressed.outputs.result.schema).toEqual({ type: "string" });
  });

  it("lets the tool dress a port the bindings already made", () => {
    // 두 동적 해석이 같은 포트를 맡으면 도구가 나중에 입힌다 — Python과 같은 차례.
    const resolved = resolvePorts(
      node("core.input", { ...TOOL_NODE_CONFIG, bindings: { result: "input.result" } }),
      nodeTypeWearingBothMarkers(),
      { type: "object", properties: { result: { type: "number" } } },
      [bindingCarryingLookup({ type: "string" })],
    );
    expect(resolved.outputs.result.schema).toEqual({ type: "string" });
  });

  it.each([
    { tool_name_field: ["tool_name"], output_port: "result" },
    { tool_name_field: { tool_name: true }, output_port: "result" },
    { output_port: "result" },
  ])("never throws and wears nothing for a broken tool marker %j", (plan) => {
    const resolved = resolvePorts(
      node("custom.echo", TOOL_NODE_CONFIG),
      nodeTypeWithToolMarker(plan),
      undefined,
      [bindingCarryingLookup({ type: "string" })],
    );
    expect(resolved.outputs.result.schema).toEqual({});
  });
});
