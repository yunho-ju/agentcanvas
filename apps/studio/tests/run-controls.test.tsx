// 우상단 실행 버튼과 검증 pill — 실행 직전에 확인할 것이 있으면 여기서 먼저 말한다.
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { RunControls } from "../src/shell/RunControls";
import { msg } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";
import { isRunning } from "../src/store/runSlice";
import { serveRuns, serveSaves, settle } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

beforeEach(() => {
  useEditor.setState({
    // 실행은 저장부터 한다 — 시험에서는 꺼져 있는 서버를 꽂아 둔다 (진짜 서버를 부르지 않는다).
    sendSpec: async () => ({ failure: msg("save.offline") }),
    savedSpec: null,
    feedbackNotice: null,
    saving: false,
    spec: null,
    nodes: [],
    edges: [],
    connectionHint: null,
    runEvents: [],
    runHistory: [],
    activeRunId: null,
    startingRun: false,
    evalPanelOpen: false,
  });
});

// 놓침 방지 ② — 확인이 필요한 노드는 캔버스를 보지 않아도 실행 버튼 옆에서 센다 (디자인 언어 §1.5).
/**
 * 실행을 누른다 — 이 그래프는 실행에 넣을 값을 묻는다(DESIGN §7 run-input-card).
 * 카드가 서면 필수 값을 적고 넘긴다.
 */
async function tryARun() {
  await userEvent.click(screen.getByRole("button", { name: /실행해 보기/ }));
  const confirm = screen.queryByRole("button", { name: "이 값으로 실행" });
  if (!confirm) return;
  await userEvent.type(screen.getByLabelText(/^question/), "무엇을 볼까");
  await userEvent.click(confirm);
}

describe("counting the nodes that still need a look", () => {
  function addWaitingNodes(count: number) {
    useEditor.getState().loadSpec(example);
    for (let i = 0; i < count; i += 1) {
      useEditor.getState().addNode("llm.agent", { x: i, y: 0 });
    }
  }

  it("says nothing when every node is ready", () => {
    useEditor.getState().loadSpec(example);
    render(<RunControls />);

    expect(screen.queryByRole("button", { name: /확인이 필요해요/ })).not.toBeInTheDocument();
  });

  it("counts them in plain words", () => {
    addWaitingNodes(2);
    render(<RunControls />);

    expect(
      screen.getByRole("button", { name: "노드 2개에 확인이 필요해요" }),
    ).toBeInTheDocument();
  });

  it("takes the user to the first of them", async () => {
    addWaitingNodes(2);
    const first = useEditor.getState().nodes.at(-2)?.id;
    render(<RunControls />);

    await userEvent.click(screen.getByRole("button", { name: /확인이 필요해요/ }));

    expect(useEditor.getState().nodes.find((node) => node.selected)?.id).toBe(first);
  });

  it("tells the run button to guide instead of running", () => {
    addWaitingNodes(1);
    render(<RunControls />);

    expect(screen.getByRole("button", { name: "실행해 보기" })).toHaveAttribute(
      "title",
      expect.stringContaining("확인이 필요"),
    );
  });
});

describe("trying the agent out", () => {
  it("eval 패널을 먼저 닫고 기존 실행 경로를 정확히 한 번 부른다", async () => {
    const leaveEvalMode = vi.fn();
    const requestRun = vi.fn(async () => undefined);
    const originalLeaveEvalMode = useEditor.getState().leaveEvalMode;
    const originalRequestRun = useEditor.getState().requestRun;
    useEditor.getState().loadSpec(example);
    useEditor.setState({ evalPanelOpen: true, leaveEvalMode, requestRun });
    render(<RunControls />);

    await userEvent.click(screen.getByRole("button", { name: "실행해 보기" }));

    expect(leaveEvalMode).toHaveBeenCalledTimes(1);
    expect(requestRun).toHaveBeenCalledTimes(1);
    act(() => useEditor.setState({ leaveEvalMode: originalLeaveEvalMode, requestRun: originalRequestRun, evalPanelOpen: false }));
  });

  it("has nothing to try out before a spec is open", () => {
    render(<RunControls />);

    expect(screen.getByRole("button", { name: "실행해 보기" })).toBeDisabled();
  });

  it("has the server run the open graph", async () => {
    useEditor.getState().loadSpec(example);
    serveSaves();
    serveRuns({ runId: "run_1", startedAt: new Date("2026-08-01T12:30:00.000Z") });
    render(<RunControls />);

    await tryARun();

    await waitFor(() => expect(isRunning(useEditor.getState())).toBe(true));
  });

  it("cannot be pressed again while a run is on screen", async () => {
    useEditor.getState().loadSpec(example);
    serveSaves();
    serveRuns({ runId: "run_1", startedAt: new Date("2026-08-01T12:30:00.000Z") });
    render(<RunControls />);

    await tryARun();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "실행해 보기" })).toBeDisabled(),
    );
  });

  // 부탁해 둔 실행의 대답을 기다리는 사이에도 버튼은 눌리지 않는다 — 눌러도 아무 일이 없는
  // 버튼을 열어 두지 않는다 (DESIGN §1 모든 행동에 곧바로 보이는 피드백).
  it("says it is opening the run while the server has not answered yet", async () => {
    useEditor.getState().loadSpec(example);
    serveSaves();
    useEditor.setState({
      sendRunStart: () => new Promise(() => {}),
    });
    render(<RunControls />);

    await tryARun();
    await settle();

    const run = screen.getByRole("button", { name: "실행해 보기" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute("title", "실행을 여는 중이에요");
  });
});

describe("저장이 오가는 동안의 실행 버튼", () => {
  it("다시 누를 수 없고, 그 까닭을 말한다", () => {
    useEditor.getState().loadSpec(example);
    useEditor.setState({ saving: true });
    render(<RunControls />);

    const run = screen.getByRole("button", { name: "실행해 보기" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute("title", "저장하는 중이에요");
  });
});
