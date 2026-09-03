// 카드가 상시 달고 있는 "설정 필요" 뱃지의 판정 규칙 (디자인 언어 §1.5 놓침 방지 ①).
// 문제는 숨기지 않는다 — 무엇이 비었는지 필드 이름과 함께 돌려준다.
import { describe, expect, it } from "vitest";
import type { Node1 as SpecNode } from "../src/generated/agent_spec";
import { nodeSetupIssues, nodesNeedingSetup } from "../src/graph/nodeSetupIssues";
import type { Locale } from "../src/i18n/locale";
import { translate } from "../src/i18n/messages";
import type { FlowNode } from "../src/graph/serialize";
import { nodeTypes, resolvePorts } from "../src/registry/registry";

function node(type: string, config: Record<string, unknown> = {}): SpecNode {
  return { id: "n", type, position: { x: 0, y: 0 }, config };
}

function issuesOf(type: string, config: Record<string, unknown> = {}) {
  // 문서가 가진 skill은 이 판정의 재료다 — 여기 규칙들은 skill 없는 문서에서의 이야기다.
  return nodeSetupIssues(node(type, config), nodeTypes[type], []);
}

function messagesOf(type: string, config: Record<string, unknown> = {}, locale: Locale = "ko") {
  return issuesOf(type, config).map((issue) => translate(locale, issue.message));
}

function fieldsOf(type: string, config: Record<string, unknown> = {}) {
  return issuesOf(type, config).map((issue) => issue.field);
}

/** registry가 각 타입에 요구하는 값을 모두 채운 config. */
const FILLED: Record<string, Record<string, unknown>> = {
  "core.input": { bindings: { question: "input.question" } },
  "core.output": { binding: "state.answer" },
  "llm.agent": { model_ref: "model://default", prompt_ref: "prompt://a@1" },
  "llm.router": { model_ref: "model://default", prompt_ref: "prompt://r@1" },
  "tool.mcp": { resource_ref: "clinical-reference", tool_name: "lookup" },
  "control.human_gate": { approval_schema_ref: "schema://review@1" },
};

describe("설정이 끝난 노드는 아무 말도 하지 않는다", () => {
  it.each(Object.keys(FILLED))("%s", (type) => {
    expect(issuesOf(type, FILLED[type])).toEqual([]);
  });
});

describe("필수 값이 비면 그 자리를 짚어 말한다", () => {
  it.each([
    ["core.input", ["bindings"]],
    ["core.output", ["binding"]],
    ["llm.agent", ["model_ref"]],
    ["llm.router", ["model_ref"]],
    ["tool.mcp", ["resource_ref", "tool_name"]],
    ["control.human_gate", ["approval_schema_ref"]],
  ])("갓 놓은 %s는 비어 있는 필수 값을 모두 알린다", (type, fields) => {
    expect(fieldsOf(type)).toEqual(fields);
  });

  it("절반만 채운 노드는 남은 값만 알린다", () => {
    expect(fieldsOf("tool.mcp", { resource_ref: "mcp://files@1" })).toEqual(["tool_name"]);
  });

  it("공백만 적은 값은 채운 것이 아니다", () => {
    expect(fieldsOf("core.output", { binding: "   " })).toEqual(["binding"]);
  });

  it("빈 묶음은 채운 것이 아니다", () => {
    expect(fieldsOf("core.input", { bindings: {} })).toEqual(["bindings"]);
  });

  it("필수가 아닌 값은 비어 있어도 말하지 않는다", () => {
    expect(fieldsOf("llm.agent", FILLED["llm.agent"])).toEqual([]);
  });

  it("설정 항목의 이름을 쉬운 말 문장에 담는다", () => {
    expect(messagesOf("tool.mcp", { resource_ref: "clinical-reference" })[0]).toContain(
      "실행할 도구 이름",
    );
  });

  it("영어로 읽는 사람에게는 항목 이름도 영어로 말한다", () => {
    expect(
      messagesOf("tool.mcp", { resource_ref: "clinical-reference" }, "en")[0],
    ).toBe("Name of the tool to run: still empty");
  });
});

// Python `config_issues`(packages/contracts)의 broken bindings 케이스 미러 —
// 두 구현이 같은 config를 같게 판정한다.
describe("망가진 bindings는 값이 있어도 문제다", () => {
  it.each([{ bindings: 5 }, { bindings: "question" }, { bindings: ["question"] }])(
    "이름과 위치의 묶음이 아닌 %j",
    (config) => {
      expect(fieldsOf("core.input", config as Record<string, unknown>)).toEqual([
        "bindings",
      ]);
    },
  );

  it("이름이 비어 있는 항목을 짚는다", () => {
    const [issue] = issuesOf("core.input", { bindings: { "": "input.question" } });
    expect(issue.field).toBe("bindings");
    expect(translate("ko", issue.message)).toContain("이름");
  });

  it("위치가 글자가 아닌 항목을 이름과 함께 짚는다", () => {
    const [issue] = issuesOf("core.input", { bindings: { question: 5 } });
    expect(translate("ko", issue.message)).toContain("question");
  });

  it("다른 타입의 bindings는 보지 않는다", () => {
    expect(
      nodeSetupIssues(
        node("llm.agent", { ...FILLED["llm.agent"], bindings: 5 }),
        nodeTypes["llm.agent"],
        [],
      ),
    ).toEqual([]);
  });
});

describe("registry가 모르는 노드", () => {
  it("설정을 판정할 수 없다는 사실을 숨기지 않는다", () => {
    expect(nodeSetupIssues(node("custom.unknown"), undefined, [])).toHaveLength(1);
  });
});

describe("캔버스 전체에서 확인이 필요한 노드", () => {
  function flowNode(id: string, type: string, config: Record<string, unknown>): FlowNode {
    const spec = { id, type, position: { x: 0, y: 0 }, config };
    return {
      id,
      type: "agentNode",
      position: spec.position,
      data: { spec, nodeType: nodeTypes[type], ports: resolvePorts(spec, nodeTypes[type]) },
    };
  }

  it("놓은 순서 그대로 문제 있는 노드만 골라낸다", () => {
    const nodes = [
      flowNode("ok", "core.output", FILLED["core.output"]),
      flowNode("empty", "llm.agent", {}),
      flowNode("half", "tool.mcp", { resource_ref: "x" }),
    ];

    expect(nodesNeedingSetup(nodes, []).map((node) => node.id)).toEqual(["empty", "half"]);
  });

  it("다 채운 캔버스에서는 아무도 손들지 않는다", () => {
    expect(nodesNeedingSetup([flowNode("ok", "core.output", FILLED["core.output"])], [])).toEqual(
      [],
    );
  });
});
