import { describe, expect, it } from "vitest";
import type { AgentSpec } from "../src/generated/agent_spec";
import { checkConnection, type ConnectionCheck } from "../src/graph/connection";
import type { Locale } from "../src/i18n/locale";
import { translate } from "../src/i18n/messages";
import { nodeTypes } from "../src/registry/registry";

function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    schema_version: "agent.spec/v1",
    id: "s",
    version: 1,
    revision: `sha256:${"0".repeat(64)}`,
    status: "draft",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
    },
    state_schema: { type: "object", properties: {} },
    nodes: [
      {
        id: "input",
        type: "core.input",
        position: { x: 0, y: 0 },
        config: { bindings: { question: "input.question" } },
      },
      {
        id: "router",
        type: "llm.router",
        position: { x: 200, y: 0 },
        config: { model_ref: "model://d", prompt_ref: "prompt://p" },
      },
      {
        id: "agent",
        type: "llm.agent",
        position: { x: 400, y: 0 },
        config: { model_ref: "model://d", prompt_ref: "prompt://p" },
      },
      {
        id: "output",
        type: "core.output",
        position: { x: 600, y: 0 },
        config: { binding: "state.answer" },
      },
    ],
    edges: [],
    ...overrides,
  };
}

function reason(result: ConnectionCheck, locale: Locale = "ko"): string {
  return result.reason ? translate(locale, result.reason) : "";
}

describe("checkConnection", () => {
  it("allows a connection when both port schemas declare the same type", () => {
    const result = checkConnection(
      spec(),
      { node: "input", port: "question" },
      { node: "router", port: "input" },
    );
    expect(result.ok).toBe(true);
  });

  it("allows a connection when one side leaves the schema unspecified", () => {
    const result = checkConnection(
      spec(),
      { node: "router", port: "passthrough" },
      { node: "output", port: "input" },
    );
    expect(result.ok).toBe(true);
  });

  // Python `_schemas_compatible`는 type 값을 그대로 비교한다 — union type도 예외가 아니다.
  it("refuses a union type against a plain type, like the Python validator does", () => {
    const withUnion = spec({
      input_schema: {
        type: "object",
        properties: { question: { type: ["string", "null"] } },
      },
    });
    const result = checkConnection(
      withUnion,
      { node: "input", port: "question" },
      { node: "agent", port: "messages" },
    );
    expect(result.ok).toBe(false);
  });

  it("allows two ports that declare the very same union type", () => {
    // 기본 registry에는 union type 입력 포트가 없다 — Python `validate_graph(spec, registry)`처럼
    // registry를 넣어 같은 union끼리의 판정을 확인한다.
    const union = ["string", "null"];
    const registry = {
      ...nodeTypes,
      "custom.union_sink": {
        type: "custom.union_sink",
        version: "1.0",
        runtime: "langgraph.python",
        display_name: { ko: "유니온 받기", en: "Union sink" },
        plain_description: {
          ko: "문자열이거나 비어 있는 값을 받는다.",
          en: "Takes a value that is either text or nothing.",
        },
        ports: { inputs: [{ id: "input", schema: { type: union } }], outputs: [] },
        config_schema: { type: "object", properties: {} },
      },
    };
    const withUnion = spec({
      input_schema: { type: "object", properties: { question: { type: union } } },
      nodes: [
        ...spec().nodes,
        {
          id: "sink",
          type: "custom.union_sink",
          position: { x: 800, y: 0 },
          config: {},
        },
      ],
    });

    const result = checkConnection(
      withUnion,
      { node: "input", port: "question" },
      { node: "sink", port: "input" },
      registry,
    );
    expect(result.ok).toBe(true);
  });

  // 종류는 쉬운 말로 말한다 — 자료형 원문은 화면에 쓰지 않는다 (DESIGN §7).
  it("refuses a connection whose port types disagree, naming both kinds in plain words", () => {
    const result = checkConnection(
      spec(),
      { node: "router", port: "route" },
      { node: "agent", port: "messages" },
    );
    expect(result.ok).toBe(false);
    expect(reason(result)).toContain("글자");
    expect(reason(result)).toContain("목록");
  });

  it("refuses a source port the node does not have", () => {
    const result = checkConnection(
      spec(),
      { node: "input", port: "nope" },
      { node: "router", port: "input" },
    );
    expect(result.ok).toBe(false);
    expect(reason(result)).toContain("nope");
  });

  it("refuses a target port the node does not have", () => {
    const result = checkConnection(
      spec(),
      { node: "router", port: "route" },
      { node: "output", port: "nope" },
    );
    expect(result.ok).toBe(false);
    expect(reason(result)).toContain("nope");
  });

  it("refuses an endpoint on an unknown node", () => {
    const result = checkConnection(
      spec(),
      { node: "ghost", port: "route" },
      { node: "output", port: "input" },
    );
    expect(result.ok).toBe(false);
    // 내부 이름표('ghost')는 화면에 쓰지 않는다 — 무엇을 하면 되는지만 말한다.
    expect(reason(result)).not.toContain("ghost");
    expect(reason(result)).toContain("노드를 다시 놓고");
  });

  it("gives the reason in english when the screen reads english", () => {
    const result = checkConnection(
      spec(),
      { node: "ghost", port: "route" },
      { node: "output", port: "input" },
    );
    expect(reason(result, "en")).toContain("put it back and join again");
  });

  it("refuses a dynamic input port that config.bindings does not declare", () => {
    const result = checkConnection(
      spec(),
      { node: "input", port: "patient_context" },
      { node: "router", port: "input" },
    );
    expect(result.ok).toBe(false);
  });
});
