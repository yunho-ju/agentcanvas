// 팔레트의 '이 모양으로 놓기' (DESIGN §7 palette) — 한 줄 = 짧은 이름 + 대가.
// 누르면 카드와 선이 한 번에 놓이고, 못 놓으면 그 자리에서 까닭을 말한다.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import catalog from "../../../examples/pattern-anchors/catalog.json";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { ConnectionHint } from "../src/canvas/ConnectionHint";
import { Palette } from "../src/canvas/Palette";
import { InspectorFocusProvider } from "../src/inspector/inspectorFocus";
import type { AgentSpec, Node1 as SpecNode } from "../src/generated/agent_spec";
import type { PatchTemplate } from "../src/generated/pattern_def";
import type { PatternChoice } from "../src/registry/patternCatalog";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;
const templates = catalog as unknown as Record<string, PatchTemplate>;

const NAMES: Record<string, string> = {
  react: "도구를 쓰며 답 다듬기",
  human_gate: "사람이 확인하고 넘어가기",
  router: "갈래 나누기",
};

function shape(id: string, template: PatchTemplate = templates[id]): PatternChoice {
  return {
    id,
    shortName: { ko: NAMES[id] ?? id, en: id },
    cost: { ko: `${id}의 대가`, en: `what ${id} costs` },
    needs: [],
    template,
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

function open(nodes: SpecNode[], edges: AgentSpec["edges"], patterns: PatternChoice[]) {
  store().loadSpec({ ...example, nodes, edges });
  useEditor.setState({ serverPatterns: patterns, connectionHint: null });
}

/** 안내는 읽을 만큼 머물다 스스로 물러난다 — 시계를 세워 두어야 그 말이 화면에 남아 있다. */
function pressWhileTheClockStands(row: HTMLElement) {
  vi.useFakeTimers();
  fireEvent.click(row);
}

function shapeRow(id: string) {
  return screen.getByRole("button", { name: new RegExp(`^${NAMES[id]}`) });
}

beforeEach(() => {
  useEditor.setState({ serverPatterns: null, connectionHint: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("팔레트의 모양 목록", () => {
  it("서버가 셋을 주면 세 줄이 서고, 줄마다 대가를 함께 말한다", () => {
    open([INPUT, AGENT, OUTPUT], ANSWER_FLOW, ["react", "human_gate", "router"].map((id) => shape(id)));
    render(<Palette />);

    expect(screen.getByText("이 모양으로 놓기")).toBeInTheDocument();
    for (const id of ["react", "human_gate", "router"]) {
      expect(shapeRow(id)).toBeInTheDocument();
      expect(screen.getByText(`${id}의 대가`)).toBeInTheDocument();
    }
  });

  it("모양을 못 들었으면 이 구역 자체가 없다", () => {
    open([INPUT, AGENT, OUTPUT], ANSWER_FLOW, []);
    useEditor.setState({ serverPatterns: null });
    render(<Palette />);

    expect(screen.queryByText("이 모양으로 놓기")).not.toBeInTheDocument();
  });

  // 이 화면이 그릴 줄 모르는 단계를 놓는 모양은 반만 놓이게 하느니 서지 않는다.
  it("이 화면이 모르는 단계를 놓는 모양은 목록에 서지 않는다", () => {
    open([INPUT, AGENT, OUTPUT], ANSWER_FLOW, [
      shape("human_gate", [
        { op: "add_node", node: "{new:gate}", type: "control.telepathy", config: {} },
      ]),
    ]);
    render(<Palette />);

    expect(screen.queryByText("이 모양으로 놓기")).not.toBeInTheDocument();
  });

  it("누르면 카드와 선이 늘고, 되돌리기 한 번에 원래대로 돌아온다", async () => {
    open([INPUT, AGENT, OUTPUT], ANSWER_FLOW, [shape("human_gate")]);
    render(<Palette />);

    await userEvent.click(shapeRow("human_gate"));

    expect(store().nodes).toHaveLength(4);
    expect(store().edges).toHaveLength(2);

    store().undo();

    expect(store().nodes).toHaveLength(3);
    expect(store().edges.map((edge) => edge.id)).toEqual(["agent-output"]);
  });

  it("어느 단계에 놓을지 애매하면 놓지 않고 그 자리에서 말한다", () => {
    const twice = step("agent-2", "llm.agent", 400, { model_ref: "model://default" });
    open([INPUT, AGENT, twice, OUTPUT], ANSWER_FLOW, [shape("human_gate")]);
    render(
      <>
        <Palette />
        <ConnectionHint />
      </>,
    );

    pressWhileTheClockStands(shapeRow("human_gate"));

    expect(store().nodes).toHaveLength(4);
    expect(screen.getByRole("alert")).toHaveTextContent("어느 단계에 놓을지 골라 주세요");
  });

  it("도구를 고르지 않은 에이전트에는 도구를 쓰는 모양을 놓지 않고 까닭을 말한다", () => {
    const bare = step("agent", "llm.agent", 400, { model_ref: "model://default" });
    open([INPUT, bare, OUTPUT], ANSWER_FLOW, [shape("react")]);
    render(
      <>
        <Palette />
        <ConnectionHint />
      </>,
    );

    pressWhileTheClockStands(shapeRow("react"));

    expect(screen.getByRole("alert")).toHaveTextContent("먼저 이 단계가 쓸 도구를 골라 주세요");
  });

  // 바뀐 칸이 화면에 없으면 아무 일도 안 한 것처럼 보인다 — 고친 자리로 데려간다
  // (저장 알림의 '보러 가기'와 같은 걸음).
  it("놓고 나면 그 단계의 설정으로 데려간다", async () => {
    open([INPUT, AGENT, OUTPUT], ANSWER_FLOW, [shape("react")]);
    const takeMeThere = vi.fn();
    render(
      <InspectorFocusProvider value={takeMeThere}>
        <Palette />
      </InspectorFocusProvider>,
    );

    await userEvent.click(shapeRow("react"));

    expect(takeMeThere).toHaveBeenCalled();
  });

  it("놓지 못했으면 데려가지 않는다 — 볼 것이 없는 자리로 보내지 않는다", () => {
    const bare = step("agent", "llm.agent", 400, { model_ref: "model://default" });
    open([INPUT, bare, OUTPUT], ANSWER_FLOW, [shape("react")]);
    const takeMeThere = vi.fn();
    render(
      <InspectorFocusProvider value={takeMeThere}>
        <Palette />
      </InspectorFocusProvider>,
    );

    pressWhileTheClockStands(shapeRow("react"));

    expect(takeMeThere).not.toHaveBeenCalled();
  });

  it("실행을 보는 동안에는 모양 줄도 잠기고 까닭을 말한다", () => {
    open([INPUT, AGENT, OUTPUT], ANSWER_FLOW, [shape("human_gate")]);
    useEditor.setState({ activeRunId: "run_1", runEvents: [{ seq: 1 } as never] });
    render(<Palette />);

    expect(shapeRow("human_gate")).toBeDisabled();
    expect(shapeRow("human_gate")).toHaveAttribute(
      "title",
      expect.stringContaining("실행"),
    );
    useEditor.setState({ activeRunId: null, runEvents: [] });
  });
});
