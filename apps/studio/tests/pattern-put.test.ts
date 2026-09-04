// 팔레트에서 고른 모양을 이 문서에 놓는 일 — 카드와 선이 한 번에 놓이고 되돌리기 한 걸음이다.
// 놓을 수 없으면 아무 일도 없이 지나가지 않는다: 왜 못 놓는지 그 자리에서 말한다 (DESIGN §7).
import { beforeEach, describe, expect, it } from "vitest";
import catalog from "../../../examples/pattern-anchors/catalog.json";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec, Node1 as SpecNode } from "../src/generated/agent_spec";
import type { PatchTemplate } from "../src/generated/pattern_def";
import { type Message, translate } from "../src/i18n/messages";
import type { PatternChoice } from "../src/registry/patternCatalog";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;
const templates = catalog as unknown as Record<string, PatchTemplate>;

function shape(id: string): PatternChoice {
  return {
    id,
    shortName: { ko: "모양", en: "shape" },
    cost: { ko: "대가", en: "cost" },
    needs: [],
    template: templates[id],
  };
}

function step(
  id: string,
  type: string,
  x: number,
  config: Record<string, unknown> = {},
): SpecNode {
  return { id, type, position: { x, y: 0 }, config } as unknown as SpecNode;
}

const INPUT = step("input", "core.input", 0, {
  bindings: { question: "input.question" },
});
const AGENT = step("agent", "llm.agent", 400, {
  model_ref: "model://default",
  toolset_refs: ["clinical-reference"],
});
const OUTPUT = step("output", "core.output", 800, { binding: "state.answer" });

function doc(nodes: SpecNode[], edges: AgentSpec["edges"] = []): AgentSpec {
  return { ...example, nodes, edges };
}

const ANSWER_FLOW: AgentSpec["edges"] = [
  {
    id: "agent-output",
    kind: "data",
    source: { node: "agent", port: "response" },
    target: { node: "output", port: "input" },
  },
];

function store() {
  return useEditor.getState();
}

function put(spec: AgentSpec, patternId: string, selected?: string) {
  store().loadSpec(spec);
  useEditor.setState({ serverPatterns: [shape(patternId)] });
  if (selected) store().select("node", selected);
  store().putPattern(patternId);
}

beforeEach(() => {
  useEditor.setState({ serverPatterns: null, connectionHint: null });
});

describe("putPattern — 모양을 이 문서에 놓기", () => {
  it("사람이 확인하고 넘어가는 모양은 카드와 선을 한 번에 놓는다", () => {
    put(doc([INPUT, AGENT, OUTPUT], ANSWER_FLOW), "human_gate");

    const gate = store().nodes.find((node) => node.data.spec.type === "control.human_gate");
    expect(gate).toBeDefined();
    expect(store().edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["agent", gate?.id],
      [gate?.id, "output"],
    ]);
  });

  // 놓았는데 화면 밖이면 놓은 줄도 모른다 (DESIGN §7 palette 배치).
  it("새로 놓인 카드는 보여 달라고 남긴다", () => {
    put(doc([INPUT, AGENT, OUTPUT], ANSWER_FLOW), "human_gate");

    const gate = store().nodes.find((node) => node.data.spec.type === "control.human_gate");
    expect(store().viewRequest).toEqual({ kind: "reveal", nodes: [gate?.id] });
  });

  it("놓은 모양은 되돌리기 한 걸음이다", () => {
    const spec = doc([INPUT, AGENT, OUTPUT], ANSWER_FLOW);
    put(spec, "human_gate");

    store().undo();

    expect(store().nodes.map((node) => node.id)).toEqual(["input", "agent", "output"]);
    expect(store().edges.map((edge) => edge.id)).toEqual(["agent-output"]);
  });

  it("갈래 나누는 모양은 값이 오는 줄까지 이어 놓는다", () => {
    put(doc([INPUT, AGENT, OUTPUT], ANSWER_FLOW), "router");

    const router = store().nodes.at(-1);
    expect(router?.data.spec.type).toBe("llm.router");
    expect(store().edges.slice(1).map((edge) => [edge.source, edge.sourceHandle])).toEqual([
      ["input", "question"],
      [router?.id, "route"],
    ]);
  });

  it("어느 단계에 놓을지 애매하면 놓지 않고 그 자리에서 말한다", () => {
    const twice = step("agent-2", "llm.agent", 400, { model_ref: "model://default" });
    put(doc([INPUT, AGENT, twice, OUTPUT], ANSWER_FLOW), "human_gate");

    expect(store().nodes).toHaveLength(4);
    expect(store().connectionHint?.message.key).toBe("pattern.cannot.ambiguous");
  });

  it("붙을 단계가 아직 없으면 그 까닭을 말한다", () => {
    put(doc([INPUT, AGENT]), "human_gate");

    expect(store().nodes).toHaveLength(2);
    expect(store().connectionHint?.message.key).toBe("pattern.cannot.missing");
  });

  it("도구를 아직 고르지 않은 단계에는 도구를 쓰는 모양을 놓지 않는다", () => {
    const bare = step("agent", "llm.agent", 400, { model_ref: "model://default" });
    put(doc([INPUT, bare, OUTPUT]), "react");

    expect(store().connectionHint?.message.key).toBe("pattern.cannot.needsTools");
  });

  // 목록이 거른 모양이 다른 문으로 들어와도 반만 놓이지 않는다 (팔레트만 이 문의 손님이 아니다).
  it("이 화면이 그릴 줄 모르는 모양은 문서에 손대지 않는다", () => {
    store().loadSpec(doc([INPUT, AGENT, OUTPUT], ANSWER_FLOW));
    useEditor.setState({
      serverPatterns: [
        {
          ...shape("human_gate"),
          template: [
            { op: "add_node", node: "{new:x}", type: "control.telepathy", config: {} },
          ],
        },
      ],
    });

    store().putPattern("human_gate");

    expect(store().nodes).toHaveLength(3);
    expect(store().edges.map((edge) => edge.id)).toEqual(["agent-output"]);
  });

  // 고를 것이 있느냐 없느냐로 사람이 할 일이 다르다 — 고르기와 만들기는 같은 말을 쓸 수 없다.
  it("문서에 도구가 붙은 연결이 하나도 없으면 만드는 길을 가리킨다", () => {
    const bare = step("agent", "llm.agent", 400, { model_ref: "model://default" });
    store().loadSpec({ ...doc([INPUT, bare, OUTPUT]), resources: [] });
    useEditor.setState({ serverPatterns: [shape("react")] });
    store().putPattern("react");

    expect(store().connectionHint?.message.key).toBe("pattern.cannot.noToolsAnywhere");
  });

  it("도구를 든 단계에는 그 모양이 그대로 놓인다 — 이미 적어 둔 설정은 잃지 않는다", () => {
    put(doc([INPUT, AGENT, OUTPUT], ANSWER_FLOW), "react");

    expect(store().nodes[1].data.spec.config).toEqual({
      model_ref: "model://default",
      toolset_refs: ["clinical-reference"],
      max_turns: 3,
    });
    expect(store().connectionHint).toBeNull();
  });

  // 카드도 선도 늘지 않는 모양은 바뀐 칸이 화면에 없으면 아무 일도 안 한 것처럼 보인다
  // (DESIGN §7 palette — 조용히 아무 일도 일어나지 않는 길을 만들지 않는다).
  it("설정만 바꾸는 모양은 그 단계를 골라 두고 무엇이 바뀌었는지 말한다", () => {
    put(doc([INPUT, AGENT, OUTPUT], ANSWER_FLOW), "react");

    expect(store().nodes.find((node) => node.selected)?.id).toBe("agent");
    expect(store().notice?.key).toBe("edit.pattern.notice");
    expect(translate("ko", store().notice as Message)).toContain("최대 주고받기 횟수");
  });

  it("새 카드를 놓는 모양은 그 새 카드를 골라 둔다 — 다음에 채울 칸이 거기 있다", () => {
    put(doc([INPUT, AGENT, OUTPUT], ANSWER_FLOW), "human_gate");

    const gate = store().nodes.find((node) => node.data.spec.type === "control.human_gate");
    expect(store().nodes.find((node) => node.selected)?.id).toBe(gate?.id);
  });

  // 반만 놓인 모양은 조용한 실패다 — 이을 값이 없으면 놓기 전에 말한다.
  it("이어 줄 값이 아직 없는 단계에는 놓지 않고 말한다", () => {
    const empty = step("input", "core.input", 0);
    put(doc([empty, AGENT, OUTPUT], ANSWER_FLOW), "router");

    expect(store().nodes).toHaveLength(3);
    expect(store().connectionHint?.message.key).toBe("pattern.cannot.unknownPort");
  });
});
