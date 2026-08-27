import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

beforeEach(() => {
  useEditor.setState({ spec: null, nodes: [], edges: [], connectionHint: null });
});

describe("App", () => {
  it("draws every loaded node as a card with its registry display name", () => {
    useEditor.getState().loadSpec(example);
    render(<App />);

    const canvas = within(screen.getByRole("main"));
    expect(canvas.getByText("갈림길 판단")).toBeInTheDocument();
    expect(canvas.getByText("AI 에이전트")).toBeInTheDocument();
  });

  // 팔레트는 캔버스를 나눠 갖지 않고 독에서 부를 때 펼쳐진다.
  it("offers the palette from the dock", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "노드 추가" }));

    expect(screen.getByRole("heading", { name: "노드 추가" })).toBeInTheDocument();
  });

  it("surfaces a refused connection to the user", () => {
    useEditor.getState().loadSpec(example);
    render(<App />);

    act(() => {
      useEditor.getState().connect(
        {
          source: "triage",
          sourceHandle: "route",
          target: "clinical-agent",
          targetHandle: "messages",
        },
        { x: 120, y: 240 },
      );
    });

    expect(screen.getByRole("alert")).toHaveTextContent("route");
  });

  // 카드→inspector 딱 두 단계 (디자인 언어 §1.5) — 세는 자리에서 고치는 자리까지 한 번에.
  it("hands the focus to the settings panel from the count of waiting nodes", async () => {
    useEditor.getState().loadSpec(example);
    act(() => useEditor.getState().addNode("llm.agent", { x: 0, y: 0 }));
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /확인이 필요해요/ }));

    const panel = screen.getByRole("complementary", { name: "설정" });
    expect(panel.contains(document.activeElement)).toBe(true);
  });
});
