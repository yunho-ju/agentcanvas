// 되돌리기·다시하기는 언제나 보이는 자리에 있다 (디자인 언어 §1.3).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { HistoryControls } from "../src/shell/HistoryControls";
import { useEditor } from "../src/store/editor";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

beforeEach(() => {
  useEditor.setState({
    spec: null,
    nodes: [],
    edges: [],
    runEvents: [],
    runHistory: [],
    activeRunId: null,
  });
});

describe("taking edits back", () => {
  it("has nothing to take back on a freshly opened file", () => {
    useEditor.getState().loadSpec(example);
    render(<HistoryControls />);

    expect(screen.getByRole("button", { name: "되돌리기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다시하기" })).toBeDisabled();
  });

  it("takes the last edit back", async () => {
    useEditor.getState().loadSpec(example);
    useEditor.getState().addNode("llm.agent", { x: 0, y: 0 });
    render(<HistoryControls />);

    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));

    expect(useEditor.getState().nodes).toHaveLength(example.nodes.length);
  });

  it("puts it back again", async () => {
    useEditor.getState().loadSpec(example);
    useEditor.getState().addNode("llm.agent", { x: 0, y: 0 });
    useEditor.getState().undo();
    render(<HistoryControls />);

    await userEvent.click(screen.getByRole("button", { name: "다시하기" }));

    expect(useEditor.getState().nodes).toHaveLength(example.nodes.length + 1);
  });

  it("says in plain words what would be taken back", () => {
    useEditor.getState().loadSpec(example);
    useEditor.getState().addNode("llm.agent", { x: 0, y: 0 });
    render(<HistoryControls />);

    expect(screen.getByRole("button", { name: "되돌리기" })).toHaveAttribute(
      "title",
      "되돌리기: 노드 추가",
    );
  });

  it("puts the editing buttons out of reach while a run is on screen", async () => {
    useEditor.getState().loadSpec(example);
    useEditor.getState().addNode("llm.agent", { x: 0, y: 0 });
    // 설정이 빈 노드가 있으면 실행이 시작되지 않는다 — 여기서 볼 것은 그다음 잠금이다.
    useEditor.getState().updateNodeConfig(useEditor.getState().nodes.at(-1)?.id ?? "", {
      model_ref: "model://default",
      prompt_ref: "prompt://new@1",
    });
    await runOnServer({ runId: "run_1", startedAt: new Date() });
    render(<HistoryControls />);

    expect(screen.getByRole("button", { name: "되돌리기" })).toBeDisabled();
  });
});
