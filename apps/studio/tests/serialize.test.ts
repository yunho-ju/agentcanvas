import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { toFlow, toSpec } from "../src/graph/serialize";
import { validateSpec } from "../src/graph/validateSpec";
import { withToolBinding } from "./toolSpec";

const example = exampleSpec as unknown as AgentSpec;

describe("AgentSpec <-> canvas round trip", () => {
  it("returns the untouched example spec after load and export", () => {
    const exported = toSpec(example, toFlow(example));
    expect(exported).toEqual(example);
  });

  it("exports a spec that still passes the committed JSON Schema", () => {
    expect(validateSpec(toSpec(example, toFlow(example)))).toEqual([]);
  });

  it("keeps the revision the file came with — the studio never computes it", () => {
    const exported = toSpec(example, toFlow(example));
    expect(exported.revision).toBe(example.revision);
  });
});

describe("toFlow", () => {
  it("places every spec node at its stored position", () => {
    const flow = toFlow(example);
    expect(flow.nodes.map((node) => [node.id, node.position])).toEqual(
      example.nodes.map((node) => [node.id, node.position]),
    );
  });

  it("carries the resolved ports of each node so handles can be drawn", () => {
    const flow = toFlow(example);
    const input = flow.nodes.find((node) => node.id === "input");
    expect(Object.keys(input?.data.ports.outputs ?? {}).sort()).toEqual([
      "patient_context",
      "question",
    ]);
  });

  it("draws a tool node with the ports of the tool it runs", () => {
    const flow = toFlow(withToolBinding(example));
    const tool = flow.nodes.find((node) => node.id === "tool");
    expect(tool?.data.ports.outputs.result.schema).toEqual({ type: "string" });
  });

  it("draws the plain tool ports again once the connection is taken away", () => {
    const spec = withToolBinding(example);
    const flow = toFlow({ ...spec, resources: [] });
    const tool = flow.nodes.find((node) => node.id === "tool");
    expect(tool?.data.ports.outputs.result.schema).toEqual({});
  });

  it("maps spec edge ports onto flow handles", () => {
    const edge = toFlow(example).edges.find((item) => item.id === "input-triage");
    expect(edge).toMatchObject({
      source: "input",
      sourceHandle: "question",
      target: "triage",
      targetHandle: "input",
    });
  });
});

describe("toSpec", () => {
  it("writes back a node moved on the canvas", () => {
    const flow = toFlow(example);
    flow.nodes[0].position = { x: 11, y: 22 };
    const moved = toSpec(example, flow).nodes.find(
      (node) => node.id === flow.nodes[0].id,
    );
    expect(moved?.position).toEqual({ x: 11, y: 22 });
  });

  it("writes back an edge added on the canvas, with its kind", () => {
    const flow = toFlow(example);
    flow.edges.push({
      id: "input-output",
      source: "input",
      sourceHandle: "question",
      target: "output",
      targetHandle: "input",
      data: { kind: "data" },
    });
    const exported = toSpec(example, flow);
    expect(exported.edges.at(-1)).toEqual({
      id: "input-output",
      kind: "data",
      source: { node: "input", port: "question" },
      target: { node: "output", port: "input" },
    });
  });

  it("drops an edge removed from the canvas", () => {
    const flow = toFlow(example);
    flow.edges = flow.edges.filter((edge) => edge.id !== "agent-human");
    expect(toSpec(example, flow).edges.map((edge) => edge.id)).not.toContain(
      "agent-human",
    );
  });

  it("keeps an edge condition instead of inventing a null one", () => {
    const exported = toSpec(example, toFlow(example));
    expect(exported.edges.find((edge) => edge.id === "triage-agent")?.condition).toEqual({
      language: "cel",
      expression: "route == 'clinical'",
    });
    expect(
      Object.keys(exported.edges.find((edge) => edge.id === "input-triage") ?? {}),
    ).not.toContain("condition");
  });
});

describe("validateSpec", () => {
  it("reports the offending path when a required field is missing", () => {
    const { revision: _revision, ...broken } = example;
    const issues = validateSpec(broken);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(" ")).toContain("revision");
  });

  it("rejects a node position that is not a number", () => {
    const broken = {
      ...example,
      nodes: [{ ...example.nodes[0], position: { x: "left", y: 0 } }],
    };
    expect(validateSpec(broken).join(" ")).toContain("position");
  });
});
