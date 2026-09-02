// 상단 중앙의 모드 세그먼트 — 지금 만들고 있는지 보고 있는지가 한눈에 보이고, 오가는 길도 여기다.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { ModeSegment } from "../src/shell/ModeSegment";
import { useEditor } from "../src/store/editor";
import { isRunning } from "../src/store/runSlice";
import { runOnServer, serveRuns, serveSaves, settle } from "./fakeRunServer";
import { viewportWidth } from "./viewportWidth";

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

// DESIGN §7 mode-segment — 눌린 자리는 언제나 하나다 (F15).
describe("눌려 있는 모드는 하나뿐이다", () => {
  function pressed() {
    return screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.textContent);
  }

  it("실행을 보는 중에 시험을 열면 눌린 것은 시험 하나다", async () => {
    render(<ModeSegment />);
    await showRun();

    await userEvent.click(mode("시험"));

    expect(pressed()).toEqual(["시험"]);
  });

  it("실행을 보는 중에 고치기를 열어도 마찬가지다", async () => {
    render(<ModeSegment />);
    await showRun();

    await userEvent.click(mode("고치기"));

    expect(pressed()).toEqual(["고치기"]);
  });
});

// DESIGN §1 상단 레이어 / §7 mode-segment — 1100px 아래에서는 이름 대신 아이콘만 남는다.
describe("자리가 좁으면 이름 대신 아이콘만 남는다", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("아이콘만 남아도 각 모드는 제 이름으로 불린다", () => {
    viewportWidth(1024);

    render(<ModeSegment />);

    for (const name of ["만들기", "실행", "시험", "고치기", "대화"]) {
      expect(mode(name)).toBeInTheDocument();
    }
  });

  it("이름이 글자로는 안 보인다 — 그림만 남는다", () => {
    viewportWidth(1024);

    render(<ModeSegment />);

    expect(mode("만들기")).not.toHaveTextContent("만들기");
    expect(mode("만들기").textContent?.trim()).toBe("");
  });

  // 문자 글리프는 획이 가늘어 무엇인지 읽히지 않는다 (DESIGN §7 mode-segment 아이콘 전용).
  it("모드마다 그려진 아이콘 하나가 선다 — 읽어 주지는 않는다", () => {
    viewportWidth(1024);

    render(<ModeSegment />);

    for (const name of ["만들기", "실행", "시험", "고치기", "대화"]) {
      const drawn = mode(name).querySelectorAll("svg[aria-hidden='true']");
      expect(drawn).toHaveLength(1);
      expect(drawn[0].getAttribute("stroke")).toBe("currentColor");
    }
  });

  it("이름이 보이는 폭에서는 아이콘을 함께 두지 않는다", () => {
    viewportWidth(1440);

    render(<ModeSegment />);

    expect(mode("만들기").querySelector("svg")).toBeNull();
  });

  it("이름과 하는 일을 title로 함께 말한다 — 누르기 전에 알 수 있다", () => {
    viewportWidth(1024);

    render(<ModeSegment />);

    expect(mode("시험")).toHaveAttribute(
      "title",
      "시험 — 케이스를 모아 두고 한 번에 돌려 본다",
    );
  });

  it("쓸 수 없는 자리는 좁아져도 그 까닭을 그대로 말한다", () => {
    viewportWidth(1024);
    act(() => useEditor.setState({ spec: null, nodes: [], edges: [] }));

    render(<ModeSegment />);

    expect(mode("실행")).toBeDisabled();
    expect(mode("실행")).toHaveAttribute("title", expect.stringContaining("그래프"));
  });

  it("넓은 화면에서는 이름이 그대로 글자로 보인다", () => {
    viewportWidth(1440);

    render(<ModeSegment />);

    expect(mode("만들기")).toHaveTextContent("만들기");
  });
});
