// 상단 중앙의 모드 세그먼트 — 지금 만들고 있는지 보고 있는지가 한눈에 보이고, 오가는 길도 여기다.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { ModeSegment } from "../src/shell/ModeSegment";
import { useEditor } from "../src/store/editor";
import { isRunning } from "../src/store/runSlice";
import { runOnServer, serveRuns, serveSaves, settle } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function mode(name: string) {
  return screen.getByRole("button", { name });
}

beforeEach(() => {
  useEditor.setState({
    spec: null,
    nodes: [],
    edges: [],
    runEvents: [],
    runHistory: [],
    activeRunId: null,
  });
  store().loadSpec(example);
  serveSaves();
});

const trial = { runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") };

/** 입력 노드가 없는 문서 — 실행이 물을 것이 없다. */
const askingNothing = {
  ...example,
  input_schema: {},
  nodes: example.nodes.filter((node) => node.type !== "core.input"),
  edges: example.edges.filter(
    (edge) => edge.source.node !== "input" && edge.target.node !== "input",
  ),
} as AgentSpec;

/** 서버가 열어 준 실행 하나를 화면에 올린다. */
async function showRun() {
  await act(async () => {
    await runOnServer(trial);
  });
}

describe("만들기와 실행 사이", () => {
  it("아무것도 실행하지 않았으면 만드는 중이다", () => {
    render(<ModeSegment />);

    expect(mode("만들기")).toHaveAttribute("aria-pressed", "true");
    expect(mode("실행")).toHaveAttribute("aria-pressed", "false");
  });

  it("물을 것이 없는 문서라면 실행을 고르는 순간 서버가 한 번 돌려 준다", async () => {
    store().loadSpec(askingNothing);
    const server = serveRuns(trial);
    render(<ModeSegment />);

    await userEvent.click(mode("실행"));
    await act(() => settle());

    expect(server.starts).toBe(1);
    expect(isRunning(store())).toBe(true);
  });

  // 실행으로 드는 문은 둘(실행 버튼·이 탭)이지만 묻는 말은 하나다 (DESIGN §7 run-input-card).
  it("물을 것이 있으면 먼저 그 값을 묻는다 — 실행 버튼과 같은 자리에서", async () => {
    const server = serveRuns(trial);
    render(<ModeSegment />);

    await userEvent.click(mode("실행"));
    await act(() => settle());

    expect(store().runInputOpen).toBe(true);
    expect(server.starts).toBe(0);
    expect(isRunning(store())).toBe(false);
  });

  // 눌러도 아무 일이 없는 자리를 열어 두지 않는다 — 실행 버튼과 같은 대우다.
  it("서버의 대답을 기다리는 사이에는 고를 수 없고 그 까닭을 말한다", async () => {
    store().loadSpec(askingNothing);
    useEditor.setState({ sendRunStart: () => new Promise(() => {}) });
    render(<ModeSegment />);

    await userEvent.click(mode("실행"));
    await act(() => settle());

    expect(mode("실행")).toBeDisabled();
    expect(mode("실행")).toHaveAttribute("title", "실행을 여는 중이에요");
  });

  // 저장 왕복 중에는 카드를 열지 않는다 (DESIGN §7 run-input-card) — 실행 버튼과 같은 잠금이다.
  it("저장이 오가는 동안에는 고를 수 없고 그 까닭을 말한다", () => {
    act(() => useEditor.setState({ saving: true }));
    render(<ModeSegment />);

    expect(mode("실행")).toBeDisabled();
    expect(mode("실행")).toHaveAttribute("title", expect.stringContaining("저장"));
  });

  it("실행 중에는 실행 쪽이 눌려 있다", async () => {
    render(<ModeSegment />);

    await showRun();

    expect(mode("실행")).toHaveAttribute("aria-pressed", "true");
    expect(mode("만들기")).toHaveAttribute("aria-pressed", "false");
  });

  it("만들기를 고르면 실행 보기를 닫고 편집으로 돌아온다", async () => {
    render(<ModeSegment />);
    await showRun();

    await userEvent.click(mode("만들기"));

    expect(isRunning(store())).toBe(false);
  });

  it("이미 보고 있는 실행을 다시 고른다고 새로 돌리지 않는다", async () => {
    render(<ModeSegment />);
    await showRun();
    const before = store().runHistory.length;

    await userEvent.click(mode("실행"));

    expect(store().runHistory).toHaveLength(before);
  });

  it("아직 열린 그래프가 없으면 실행을 고를 수 없고 그 이유를 말한다", () => {
    act(() => useEditor.setState({ spec: null, nodes: [], edges: [] }));
    render(<ModeSegment />);

    expect(mode("실행")).toBeDisabled();
    expect(mode("실행")).toHaveAttribute("title", expect.stringContaining("그래프"));
  });

  // 시험 패널은 여기서만 열고 닫는다 (DESIGN §7 eval-panel) — E1.
  it("시험을 고르면 패널이 눌린 채로 열리고, 다시 고르면 닫힌다", async () => {
    render(<ModeSegment />);

    await userEvent.click(mode("시험"));
    expect(mode("시험")).toHaveAttribute("aria-pressed", "true");
    expect(store().evalPanelOpen).toBe(true);

    await userEvent.click(mode("시험"));
    expect(mode("시험")).toHaveAttribute("aria-pressed", "false");
    expect(store().evalPanelOpen).toBe(false);
  });

  it("만들기를 고르면 시험 패널도 함께 닫힌다", async () => {
    render(<ModeSegment />);
    await userEvent.click(mode("시험"));

    await userEvent.click(mode("만들기"));

    expect(store().evalPanelOpen).toBe(false);
  });

  it("실행을 고르면 시험 패널도 함께 닫힌다", async () => {
    store().loadSpec(askingNothing);
    serveRuns(trial);
    render(<ModeSegment />);
    await userEvent.click(mode("시험"));

    await userEvent.click(mode("실행"));
    await act(() => settle());

    expect(store().evalPanelOpen).toBe(false);
  });
});
