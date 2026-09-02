import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { Palette } from "../src/canvas/Palette";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { NodeType } from "../src/generated/node_type";
import { NODE_SIZE } from "../src/graph/placement";
import { localized } from "../src/i18n/locale";
import { getLocale } from "../src/i18n/localeStore";
import { nodeTypes } from "../src/registry/registry";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function words(nodeType: NodeType) {
  const locale = getLocale();
  return {
    name: localized(nodeType.display_name, locale),
    description: localized(nodeType.plain_description, locale),
  };
}

function paletteButton(nodeType: NodeType) {
  const { name, description } = words(nodeType);
  return screen.getByRole("button", { name: `${name} ${description}` });
}

describe("Palette", () => {
  it("lists every node type of the registry with its display name and plain description", () => {
    render(<Palette />);
    for (const nodeType of Object.values(nodeTypes)) {
      expect(paletteButton(nodeType)).toBeInTheDocument();
    }
  });

  it("repeats the plain description as a tooltip", () => {
    render(<Palette />);
    for (const nodeType of Object.values(nodeTypes)) {
      expect(paletteButton(nodeType)).toHaveAttribute(
        "title",
        words(nodeType).description,
      );
    }
  });

  // 팔레트의 항목과 캔버스의 카드는 같은 얼굴이어야 한다 — 놓기 전에 무엇인지 알아본다.
  it("wears the same type chip the card on the canvas wears", () => {
    render(<Palette />);

    const chip = paletteButton(nodeTypes["llm.router"]).querySelector(".node-card__chip");
    expect(chip).toHaveAttribute("data-chip", "router");
  });

  it("adds the clicked node type to the canvas", async () => {
    useEditor.getState().loadSpec(example);
    render(<Palette />);

    await userEvent.click(paletteButton(nodeTypes["tool.mcp"]));

    expect(useEditor.getState().nodes.at(-1)?.data.spec.type).toBe("tool.mcp");
  });

  // 노드를 놓는 입구는 여럿이고, 초대는 어느 입구로 들어와도 선다 (DESIGN §7 첫 연결 초대).
  it("invites the first link here too — this is where a beginner starts", async () => {
    useEditor.getState().loadSpec({ ...example, nodes: [], edges: [] });
    render(<Palette />);

    await userEvent.click(paletteButton(nodeTypes["llm.agent"]));

    const hint = useEditor.getState().connectionHint;
    expect(hint?.message.key).toBe("hint.firstLink");
    expect(hint?.port).toEqual({
      nodeId: useEditor.getState().nodes.at(-1)?.id,
      portId: "response",
      side: "source",
    });
  });
});

// 놓인 카드가 서로를 가리면 첫 화면이 무엇인지 알 수 없다 (UXQ-5 / F8, DESIGN §7 palette 배치).
describe("팔레트가 놓는 자리", () => {
  function boxes() {
    return useEditor.getState().nodes.map((node) => ({
      left: node.position.x,
      right: node.position.x + NODE_SIZE.width,
      top: node.position.y,
      bottom: node.position.y + NODE_SIZE.height,
    }));
  }

  function overlap(one: ReturnType<typeof boxes>[number], other: typeof one): number {
    const wide = Math.min(one.right, other.right) - Math.max(one.left, other.left);
    const tall = Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top);
    return Math.max(0, wide) * Math.max(0, tall);
  }

  it("세 번 눌러도 어떤 두 카드도 서로를 가리지 않는다", async () => {
    useEditor.getState().loadSpec({ ...example, nodes: [], edges: [] });
    render(<Palette />);

    await userEvent.click(paletteButton(nodeTypes["core.input"]));
    await userEvent.click(paletteButton(nodeTypes["llm.agent"]));
    await userEvent.click(paletteButton(nodeTypes["core.output"]));

    const placed = boxes();
    expect(placed).toHaveLength(3);
    for (const [index, one] of placed.entries()) {
      for (const other of placed.slice(index + 1)) {
        expect(overlap(one, other)).toBe(0);
      }
    }
  });

  it("고른 카드가 있으면 그 오른쪽 같은 줄에 놓는다", async () => {
    useEditor.getState().loadSpec(example);
    useEditor.getState().select("node", "output");
    const chosen = useEditor.getState().nodes.find((node) => node.id === "output");
    render(<Palette />);

    await userEvent.click(paletteButton(nodeTypes["llm.agent"]));

    const placed = useEditor.getState().nodes.at(-1);
    expect(placed?.position.y).toBe(chosen?.position.y);
    expect(placed?.position.x).toBeGreaterThan(chosen?.position.x ?? 0);
  });
});

// 만든 도구는 팔레트에서 한 번에 끌어 쓴다 — 연결·도구를 두 번 고르게 하지 않는다 (P2c).
describe("이 문서의 도구", () => {
  function store() {
    return useEditor.getState();
  }

  function toolChip(name: string) {
    return screen.getByRole("button", { name: new RegExp(`^${name}`) });
  }

  it("문서가 든 도구마다 칩 하나가 서고, 쉬운 설명을 함께 말한다", () => {
    store().loadSpec(example);
    render(<Palette />);

    expect(screen.getByText("이 문서의 도구")).toBeInTheDocument();
    expect(toolChip("search_article")).toHaveAttribute(
      "title",
      expect.stringContaining("진료 지침"),
    );
    expect(toolChip("get_article")).toBeInTheDocument();
  });

  it("칩을 누르면 그 연결·도구가 채워진 도구 노드가 놓이고 포트가 그 모양이 된다", async () => {
    store().loadSpec(example);
    render(<Palette />);

    await userEvent.click(toolChip("get_article"));

    const placed = store().nodes.at(-1);
    expect(placed?.data.spec.config).toMatchObject({
      resource_ref: "clinical-reference",
      tool_name: "get_article",
    });
    // P1c 동적 포트 — 놓이는 순간 그 도구의 모양이다.
    expect(placed?.data.ports.outputs.result.schema).toMatchObject({
      properties: { body: { type: "string", title: "Text of the article" } },
    });
  });

  it("칩을 잇달아 눌러도 도구 카드가 서로를 가리지 않는다", async () => {
    store().loadSpec({ ...example, nodes: [], edges: [] });
    render(<Palette />);

    await userEvent.click(toolChip("search_article"));
    await userEvent.click(toolChip("get_article"));

    const [first, second] = store().nodes.map((node) => node.position);
    expect(second.x - first.x).toBeGreaterThanOrEqual(NODE_SIZE.width);
  });

  it("칩 추가 1회 = 되돌리기 한 걸음", async () => {
    store().loadSpec(example);
    render(<Palette />);
    const before = store().nodes.length;

    await userEvent.click(toolChip("search_article"));
    store().undo();

    expect(store().nodes).toHaveLength(before);
  });

  it("도구가 없는 문서에는 섹션 자체가 없다 — 빈 제목을 세우지 않는다", () => {
    store().loadSpec({ ...example, resources: [] });
    render(<Palette />);

    expect(screen.queryByText("이 문서의 도구")).not.toBeInTheDocument();
  });

  it("실행을 보는 동안에는 칩도 잠기고 까닭을 말한다", async () => {
    store().loadSpec(example);
    useEditor.setState({ activeRunId: "run_1", runEvents: [{ seq: 1 } as never] });
    render(<Palette />);

    expect(toolChip("search_article")).toBeDisabled();
    expect(toolChip("search_article")).toHaveAttribute(
      "title",
      expect.stringContaining("실행"),
    );
    useEditor.setState({ activeRunId: null, runEvents: [] });
  });
});
