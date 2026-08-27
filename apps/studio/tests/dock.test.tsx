// 좌측 아이콘 독 — 도구는 캔버스를 나눠 갖지 않고, 부를 때만 옆으로 펼쳐진다.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function dockButton(name: string) {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("독의 도구는 부를 때만 열린다", () => {
  it("처음 화면에는 캔버스만 있고 펼쳐진 패널은 없다", () => {
    render(<App />);

    expect(screen.queryByRole("region", { name: "노드 추가" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "보관함" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "노드 목록" })).not.toBeInTheDocument();
  });

  it.each([["노드 추가"], ["보관함"], ["노드 목록"]])(
    "%s 아이콘을 누르면 그 패널이 독 옆에 펼쳐진다",
    async (name) => {
      render(<App />);

      await userEvent.click(dockButton(name));

      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    },
  );

  it("한 번에 하나만 펼친다", async () => {
    render(<App />);

    await userEvent.click(dockButton("노드 추가"));
    await userEvent.click(dockButton("보관함"));

    expect(screen.getByRole("region", { name: "보관함" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "노드 추가" })).not.toBeInTheDocument();
  });

  it("같은 아이콘을 다시 누르면 닫힌다", async () => {
    render(<App />);

    await userEvent.click(dockButton("노드 추가"));
    await userEvent.click(dockButton("노드 추가"));

    expect(screen.queryByRole("region", { name: "노드 추가" })).not.toBeInTheDocument();
  });

  it("무엇이 열려 있는지 읽는 기계에도 말해 준다", async () => {
    render(<App />);
    expect(dockButton("보관함")).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(dockButton("보관함"));

    expect(dockButton("보관함")).toHaveAttribute("aria-expanded", "true");
  });

  it("아이콘마다 무엇을 하는 자리인지 설명을 달고 있다", () => {
    render(<App />);

    expect(dockButton("노드 추가")).toHaveAttribute(
      "title",
      expect.stringContaining("노드 추가"),
    );
  });

  it("펼친 패널 안에서 도구를 그대로 쓴다", async () => {
    render(<App />);

    await userEvent.click(dockButton("노드 추가"));
    await userEvent.click(screen.getByRole("button", { name: /AI 에이전트/ }));

    expect(store().nodes.at(-1)?.data.spec.type).toBe("llm.agent");
  });
});
