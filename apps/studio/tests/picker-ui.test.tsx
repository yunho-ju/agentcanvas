// 포트에서 끌어다 놓은 자리에 뜨는 노드 피커 (브리프 B4).
// 검색 한 칸과 목록 하나 — 키보드만으로도 끝까지 갈 수 있어야 한다.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { NodePicker } from "../src/canvas/NodePicker";
import type { AgentSpec } from "../src/generated/agent_spec";
import { translate } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function openFromResponse() {
  store().openPicker({
    at: { x: 900, y: 500 },
    screen: { x: 120, y: 90 },
    from: { nodeId: "clinical-agent", portId: "response", side: "source" },
  });
}

function optionNames(): string[] {
  return screen.getAllByRole("option").map((option) => option.textContent ?? "");
}

const ko = (key: string) => translate("ko", { key } as Parameters<typeof translate>[1]);

beforeEach(() => {
  useEditor.getState().loadSpec(example);
  useEditor.getState().closePicker();
});

describe("노드 피커", () => {
  it("부르지 않았으면 화면에 없다", () => {
    render(<NodePicker />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("열리자마자 검색 칸에 손이 가 있다", () => {
    openFromResponse();
    render(<NodePicker />);

    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("끌고 온 포트에 이을 수 있는 종류만 보여준다", () => {
    openFromResponse();
    render(<NodePicker />);

    expect(optionNames().join(" ")).toContain("출력");
    expect(optionNames().join(" ")).not.toContain("AI 에이전트");
  });

  it("이름을 치면 목록이 좁아진다", async () => {
    openFromResponse();
    render(<NodePicker />);

    await userEvent.type(screen.getByRole("combobox"), "사람");

    expect(optionNames()).toHaveLength(1);
    expect(optionNames()[0]).toContain("사람 확인");
  });

  it("맞는 것이 하나도 없으면 그렇다고 말한다", async () => {
    openFromResponse();
    render(<NodePicker />);

    await userEvent.type(screen.getByRole("combobox"), "없는이름");

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(ko("picker.empty"))).toBeInTheDocument();
  });

  it("고르면 노드가 놓이고 연결까지 이어진다", async () => {
    openFromResponse();
    render(<NodePicker />);

    await userEvent.click(screen.getAllByRole("option")[0]);

    expect(store().nodes).toHaveLength(example.nodes.length + 1);
    expect(store().edges).toHaveLength(example.edges.length + 1);
  });

  it("키보드만으로도 고를 수 있다", async () => {
    openFromResponse();
    render(<NodePicker />);

    await userEvent.keyboard("{ArrowDown}{Enter}");

    expect(store().nodes).toHaveLength(example.nodes.length + 1);
    expect(store().picker).toBeNull();
  });

  it("지금 어디를 짚고 있는지 보인다", async () => {
    openFromResponse();
    render(<NodePicker />);

    await userEvent.keyboard("{ArrowDown}");

    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-activedescendant",
      screen.getAllByRole("option")[1].id,
    );
  });

  it("맨 위에서 위로 올라가면 맨 아래로 돈다", async () => {
    openFromResponse();
    render(<NodePicker />);

    await userEvent.keyboard("{ArrowUp}");

    const options = screen.getAllByRole("option");
    expect(options.at(-1)).toHaveAttribute("aria-selected", "true");
  });

  // Esc로 물러나는 일은 피커 혼자 하지 않는다 — 화면 전체의 물러나는 순서(DESIGN §1)가 맡고,
  // 그 시험은 앱을 통째로 세우는 floating-layout에 있다.

  it("바깥을 누르면 물러난다", async () => {
    openFromResponse();
    render(<NodePicker />);

    await userEvent.click(document.body);

    expect(store().picker).toBeNull();
    expect(store().nodes).toHaveLength(example.nodes.length);
  });

  it("연결 없이 열면 모든 종류를 보여준다", () => {
    store().openPicker({ at: { x: 0, y: 0 }, screen: { x: 0, y: 0 }, from: null });
    render(<NodePicker />);

    expect(optionNames().join(" ")).toContain("AI 에이전트");
  });
});
