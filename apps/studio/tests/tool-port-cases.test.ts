// 도구 노드의 포트 — Python `resolve_ports`와 같은 포트를 내놓아야 한다.
// 같은 케이스 파일을 packages/contracts/tests/test_tool_port_cases.py도 읽는다
// (examples/tool-ports/README.md).
import { describe, expect, it } from "vitest";
import cases from "../../../examples/tool-ports/cases.json";
import type { Node1 as SpecNode, Resources } from "../src/generated/agent_spec";
import { type JsonSchema, nodeTypes, resolvePorts } from "../src/registry/registry";

interface ToolPortCase {
  name: string;
  node_type: string;
  config: Record<string, unknown>;
  resources: Resources;
  expected: {
    inputs: Record<string, JsonSchema>;
    outputs: Record<string, JsonSchema>;
  };
}

const CASES = cases as unknown as ToolPortCase[];

const STATIC_PORTS = {
  inputs: { input: { type: "object" } },
  outputs: { result: {}, error: { type: "object" } },
};

function nodeOf(one: ToolPortCase): SpecNode {
  return { id: "tool", type: one.node_type, position: { x: 0, y: 0 }, config: one.config };
}

function schemasOf(one: ToolPortCase) {
  const resolved = resolvePorts(
    nodeOf(one),
    nodeTypes[one.node_type],
    undefined,
    one.resources,
  );
  const schemas = (ports: Record<string, { schema: unknown }>) =>
    Object.fromEntries(Object.entries(ports).map(([id, port]) => [id, port.schema]));
  return { inputs: schemas(resolved.inputs), outputs: schemas(resolved.outputs) };
}

describe("도구 노드의 포트 — 서버와 같은 해석", () => {
  it.each(CASES)("$name", (one) => {
    expect(schemasOf(one)).toEqual(one.expected);
  });

  it("케이스는 도구를 입은 포트와 정적 포트를 모두 담는다", () => {
    const answers = CASES.map(
      (one) => JSON.stringify(one.expected) === JSON.stringify(STATIC_PORTS),
    );
    expect(new Set(answers)).toEqual(new Set([true, false]));
  });
});
