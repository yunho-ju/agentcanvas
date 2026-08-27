import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { Palette } from "../src/canvas/Palette";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { NodeType } from "../src/generated/node_type";
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
