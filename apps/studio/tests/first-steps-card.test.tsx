// 처음 온 사람의 네 걸음 카드 (DESIGN §7 first-steps-card).
// jsdom은 실제 소멸 타이밍과 시각 간격을 재지 못한다 — 여기서는 수명을 토큰 값으로 꽂아 두고
// "머문 뒤 스스로 물러난다"는 계약만 고정한다. 실제 시간·간격은 브라우저에서 눈으로 확인한다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { FirstStepsCard } from "../src/guide/FirstStepsCard";
import { readFirstStepsDismissed } from "../src/guide/firstStepsStore";
import { fakeRun, resumeFakeRun } from "../src/run/fakeRun";
import { runLengthMs } from "../src/run/player";
import { useEditor } from "../src/store/editor";
import { isRunning } from "../src/store/runSlice";
import { runOnServer, settle } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;
const LIFETIME_MS = 5000;

/** 밸브까지 갔다가 사람의 승인을 받고 끝까지 간 한 번의 실행. */
const wholeRun = resumeFakeRun(
  example,
  fakeRun(example, { runId: "run_guide", startedAt: new Date("2026-08-01T12:30:00.000Z") }),
  { approved: true },
);

function store() {
  return useEditor.getState();
}

function emptyCanvas() {
  useEditor.setState({
    spec: null,
    nodes: [],
    edges: [],
    runEvents: [],
    runOffsetMs: 0,
    runHistory: [],
    activeRunId: null,
    evalPanelOpen: false,
    chatOpen: false,
    optimizeMode: "closed",
    architectMode: "closed",
    firstStepsDismissed: false,
    firstStepsCelebrating: false,
  });
}

/** 다 만들어진 문서를 연 자리 — 만든 걸음들은 끝났고 실행만 남는다. */
function openFinishedDoc() {
  store().loadSpec(example);
}

/** 그 문서를 끝까지 실행해 본 자리 — 마지막 걸음까지 걸었다. */
function watchARunToTheEnd() {
  openFinishedDoc();
  useEditor.setState({ runEvents: wholeRun, runOffsetMs: runLengthMs(wholeRun) });
}

/** 끝까지 간 그 실행이 이력에도 한 줄 남은 자리 — 실행 보기를 닫아도 남는 사실이다. */
function keepTheFinishedRun() {
  useEditor.setState({
    runHistory: [
      {
        id: "run_guide",
        at: new Date("2026-08-01T12:30:00.000Z"),
        order: 1,
        events: wholeRun,
        specSnapshot: example,
      },
    ],
    activeRunId: "run_guide",
  });
}

function stepRow(container: HTMLElement, key: string): HTMLElement | null {
  return container.querySelector(`[data-step="${key}"]`);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.setProperty("--dur-hint", `${LIFETIME_MS}ms`);
  emptyCanvas();
});

afterEach(() => {
  document.documentElement.style.removeProperty("--dur-hint");
});

describe("빈 캔버스에서 처음 만나는 안내", () => {
  it("무엇을 할지 3초 안에 말한다 — 제목과 네 걸음", () => {
    const { container } = render(<FirstStepsCard />);

    expect(screen.getByText("첫 그래프, 네 걸음이면 돼요")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-step]")).toHaveLength(4);
  });

  it("지금 걸음만 방법을 함께 말한다", () => {
    render(<FirstStepsCard />);

    expect(screen.getByText("빈 곳을 두 번 눌러 보세요")).toBeInTheDocument();
    expect(screen.queryByText("오른쪽 위 '실행해 보기'를 눌러요")).not.toBeInTheDocument();
  });

  it("걸음의 상태를 색이 아닌 기호로도 말한다", () => {
    const { container } = render(<FirstStepsCard />);

    expect(stepRow(container, "place")).toHaveAttribute("data-state", "now");
    expect(stepRow(container, "link")).toHaveAttribute("data-state", "later");
    expect(stepRow(container, "link")).toHaveTextContent("2");
  });
});

describe("걸음은 그래프에서 파생된다", () => {
  it("노드를 놓으면 첫 걸음이 끝나고 지금 걸음이 다음으로 간다", () => {
    const { container, rerender } = render(<FirstStepsCard />);

    act(() => store().addNode("llm.agent", { x: 0, y: 0 }));
    rerender(<FirstStepsCard />);

    expect(stepRow(container, "place")).toHaveAttribute("data-state", "done");
    expect(stepRow(container, "place")).toHaveTextContent("✓");
    expect(stepRow(container, "link")).toHaveAttribute("data-state", "now");
  });

  // 만드는 걸음은 이미 끝난 문서다 — 남은 것은 실행을 한 번 보는 일이다 (DESIGN §7 정체).
  it("이미 다 만들어진 문서를 열면 만든 걸음은 접히고 실행만 남는다", () => {
    act(openFinishedDoc);

    const { container } = render(<FirstStepsCard />);

    for (const walked of ["place", "link", "fill"]) {
      expect(stepRow(container, walked)).toHaveAttribute("data-state", "done");
    }
    expect(stepRow(container, "run")).toHaveAttribute("data-state", "now");
    expect(screen.getByText("오른쪽 위 '실행해 보기'를 눌러요")).toBeInTheDocument();
    expect(screen.queryByText("첫 실행까지 해냈어요")).not.toBeInTheDocument();
  });

  // 완료는 이력에 남는다 — 실행 보기를 닫는 일(만들기로 돌아가기)이 걸은 걸음을 지우지 않는다.
  it("실행을 끝까지 보고 실행 보기를 닫아도 마지막 걸음은 걸은 채로 남는다", () => {
    act(() => {
      openFinishedDoc();
      keepTheFinishedRun();
      store().stopRun();
      // 아직 다 걷지 않은 걸음이 하나 있어야 카드가 걸음을 계속 보여 준다.
      useEditor.setState({ edges: [] });
    });

    const { container } = render(<FirstStepsCard />);

    expect(stepRow(container, "run")).toHaveAttribute("data-state", "done");
    expect(stepRow(container, "run")).toHaveTextContent("✓");
    expect(stepRow(container, "link")).toHaveAttribute("data-state", "now");
  });

  // 화면이 아직 그 끝을 보여 주지 않았다면 사람은 실행을 본 것이 아니다 — 도착한 이벤트는 본 것이 아니다.
  it("실행 보기가 열려 있는 동안 그 실행은 끝까지 재생해야 걸은 것이다", () => {
    act(() => {
      openFinishedDoc();
      keepTheFinishedRun();
      useEditor.setState({ runEvents: wholeRun, runOffsetMs: 0 });
    });

    const { container } = render(<FirstStepsCard />);

    expect(stepRow(container, "run")).toHaveAttribute("data-state", "now");
  });

  it("실행 보기에서 끝까지 재생하면 그 자리에서 바로 걸은 것이다", () => {
    act(() => {
      openFinishedDoc();
      keepTheFinishedRun();
      useEditor.setState({
        runEvents: wholeRun,
        runOffsetMs: runLengthMs(wholeRun),
        edges: [],
      });
    });

    const { container } = render(<FirstStepsCard />);

    expect(stepRow(container, "run")).toHaveAttribute("data-state", "done");
  });

  // 실행 보기를 닫는 길이 stopRun만 있는 것은 아니다 — 화면에 실행이 없으면 이력이 답한다.
  it("실행 보기가 닫혀 있으면 이력이 답한다 — 어느 기록을 마지막으로 보았든", () => {
    act(() => {
      openFinishedDoc();
      keepTheFinishedRun();
      // 실행 보기는 닫혔지만 마지막으로 본 실행의 이름은 남아 있는 자리.
      useEditor.setState({ runEvents: [], runOffsetMs: 0, edges: [] });
    });

    const { container } = render(<FirstStepsCard />);

    expect(stepRow(container, "run")).toHaveAttribute("data-state", "done");
  });

  // 축하는 걸음을 보여 주던 카드가 완주로 **전이**했을 때의 것이다.
  it("이미 다 걸은 자리에서 처음 서면 축하하지 않는다 — 걷는 것을 본 적이 없다", () => {
    act(watchARunToTheEnd);

    const { container } = render(<FirstStepsCard />);

    expect(container).toBeEmptyDOMElement();
    expect(store().firstStepsCelebrating).toBe(false);
  });
});

describe("다 걸었을 때", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("축하 한 줄로 바뀌고, 머문 뒤 스스로 물러난다", () => {
    const { container, rerender } = render(<FirstStepsCard />);

    act(watchARunToTheEnd);
    rerender(<FirstStepsCard />);

    expect(screen.getByText("첫 실행까지 해냈어요")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-step]")).toHaveLength(0);

    act(() => vi.advanceTimersByTime(LIFETIME_MS));
    rerender(<FirstStepsCard />);

    expect(container).toBeEmptyDOMElement();
  });

  it("다시 열어도 나타나지 않는다 — 이 브라우저가 기억한다", () => {
    const { rerender } = render(<FirstStepsCard />);

    act(watchARunToTheEnd);
    rerender(<FirstStepsCard />);
    act(() => vi.advanceTimersByTime(LIFETIME_MS));

    expect(store().firstStepsDismissed).toBe(true);
    expect(readFirstStepsDismissed()).toBe(true);
  });

  // 축하는 그 문서에서 걸은 걸음의 것이다 — 다음 문서 위에 남지 않는다.
  it("축하가 머무는 동안 다른 문서를 열면 그 자리에서 끝난다 — 다 걸었다는 기억은 남는다", () => {
    const { container, rerender } = render(<FirstStepsCard />);
    act(watchARunToTheEnd);
    rerender(<FirstStepsCard />);
    expect(screen.getByText("첫 실행까지 해냈어요")).toBeInTheDocument();

    act(() => store().loadSpec(example));
    rerender(<FirstStepsCard />);

    expect(screen.queryByText("첫 실행까지 해냈어요")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
    expect(readFirstStepsDismissed()).toBe(true);
  });
});

// 사람이 실제로 걷는 길 그대로 — 서버가 흘려보낸 실행이 끝까지 흐르고, 만들기로 돌아간다.
describe("서버에서 흘러온 실행을 보고 만들기로 돌아갈 때", () => {
  it("④는 걸린 채로 남는다 — 이력이 그 실행을 들고 있다", async () => {
    act(openFinishedDoc);
    await act(async () => {
      await runOnServer({ runId: "run_real", startedAt: new Date("2026-08-01T12:30:00.000Z") });
      // 이 그래프는 사람 확인 앞에서 멈춘다 — 그 자리까지 보고, 승인해야 실행이 끝까지 간다.
      store().tickRun(runLengthMs(store().runEvents));
      await store().approveGate();
      await settle();
    });
    expect(store().runHistory[0]?.events.at(-1)?.event_type).toBe("run.completed");

    // ModeSegment의 '만들기'가 하는 그대로: 실행 보기가 열려 있으면 닫는다.
    act(() => {
      if (isRunning(store())) store().stopRun();
      // 아직 걷지 않은 걸음이 하나 있어야 카드가 걸음을 계속 보여 준다.
      useEditor.setState({ edges: [] });
    });

    const { container } = render(<FirstStepsCard />);

    expect(stepRow(container, "run")).toHaveAttribute("data-state", "done");
  });
});

// 우측 스택의 자리는 하나다 — 모드 패널이 서면 안내는 한 줄로 물러난다 (DESIGN §7 first-steps-card).
describe("모드 패널이 열려 있을 때", () => {
  /** 시험 패널이 우측 스택에 선 자리 — 어느 모드 패널이든 사실은 하나다. */
  function openTestPanel() {
    useEditor.setState({ evalPanelOpen: true });
  }

  it("한 줄로 접히고 몇 걸음을 걸었는지 말한다", () => {
    act(() => {
      openFinishedDoc();
      openTestPanel();
    });

    const { container } = render(<FirstStepsCard />);

    const line = screen.getByRole("button", { name: "첫 그래프, 네 걸음이면 돼요 3/4" });
    expect(line).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelectorAll("[data-step]")).toHaveLength(0);
  });

  it("눌러서 다시 펼쳐 볼 수 있다", async () => {
    act(() => {
      openFinishedDoc();
      openTestPanel();
    });

    const { container } = render(<FirstStepsCard />);
    await userEvent.click(screen.getByRole("button", { name: "첫 그래프, 네 걸음이면 돼요 3/4" }));

    expect(container.querySelectorAll("[data-step]")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "첫 그래프, 네 걸음이면 돼요 3/4" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  // 펼침은 그 패널 앞에서의 일이다 — 다음 패널을 만나면 다시 한 줄에서 시작한다.
  it("한 패널에서 펼쳐 봤어도 다음 패널은 다시 접힌 채로 만난다", async () => {
    act(() => {
      openFinishedDoc();
      openTestPanel();
    });

    const { container } = render(<FirstStepsCard />);
    await userEvent.click(screen.getByRole("button", { name: "첫 그래프, 네 걸음이면 돼요 3/4" }));
    expect(container.querySelectorAll("[data-step]")).toHaveLength(4);

    act(() => useEditor.setState({ evalPanelOpen: false }));
    act(() => useEditor.setState({ chatOpen: true }));

    expect(container.querySelectorAll("[data-step]")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "첫 그래프, 네 걸음이면 돼요 3/4" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("고치기 패널 앞에서도 같은 한 줄이다 — 패널마다 다른 안내를 만들지 않는다", () => {
    act(() => {
      openFinishedDoc();
      useEditor.setState({ optimizeMode: "input" });
    });

    const { container } = render(<FirstStepsCard />);

    expect(screen.getByRole("button", { name: "첫 그래프, 네 걸음이면 돼요 3/4" })).toBeInTheDocument();
    expect(container.querySelectorAll("[data-step]")).toHaveLength(0);
  });

  it("패널이 없으면 접지 않는다 — 네 걸음을 그대로 보여 준다", () => {
    act(openFinishedDoc);

    const { container } = render(<FirstStepsCard />);

    expect(container.querySelectorAll("[data-step]")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /3\/4/ })).not.toBeInTheDocument();
  });
});

describe("숨기기", () => {
  it("누르면 즉시 물러나고 그 뜻을 기억한다", async () => {
    const { container } = render(<FirstStepsCard />);

    await userEvent.click(screen.getByRole("button", { name: "이제 안 봐도 돼요" }));

    expect(container).toBeEmptyDOMElement();
    expect(readFirstStepsDismissed()).toBe(true);
  });

  it("전에 접어 둔 사람에게는 다시 말을 걸지 않는다", () => {
    useEditor.setState({ firstStepsDismissed: true });

    const { container } = render(<FirstStepsCard />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("카드가 서는 자리", () => {
  it("우측 스택의 마지막에 선다 — 작업을 가로막는 한가운데가 아니다", () => {
    const { container } = render(<App />);

    const stack = container.querySelector(".layer-right__stack");
    expect(stack?.lastElementChild).toHaveClass("first-steps");
  });

  it("Esc는 이 카드의 것이 아니다 — 초점을 잡지 않는 상시 안내다", async () => {
    render(<App />);

    await userEvent.keyboard("{Escape}");

    expect(screen.getByText("첫 그래프, 네 걸음이면 돼요")).toBeInTheDocument();
    expect(store().firstStepsDismissed).toBe(false);
  });
});

describe("안내의 모습은 tokens.css가 정한다", () => {
  const app = readFileSync(join(process.cwd(), "src/app.css"), "utf-8");

  function block(selector: string): string {
    const at = app.indexOf(`${selector} {`);
    return at === -1 ? "" : app.slice(at, app.indexOf("}", at));
  }

  it("떠 있는 카드의 문법을 그대로 물려받는다", () => {
    render(<FirstStepsCard />);

    expect(screen.getByLabelText("첫 그래프, 네 걸음이면 돼요")).toHaveClass("layer");
    expect(block(".first-steps")).toContain("var(--panel-inspector)");
  });

  // 걸은 걸음은 ✓만 success로 서고 글은 가라앉는다 — 지금 걸음이 가장 또렷하다.
  it("걸음 셋은 서로 다른 색으로도 갈린다", () => {
    expect(block('.first-steps__step[data-state="done"] .first-steps__mark')).toContain(
      "var(--success-ink)",
    );
    expect(block('.first-steps__step[data-state="done"]')).toContain("var(--ink-soft)");
    expect(block('.first-steps__step[data-state="now"]')).toContain("var(--ink)");
    expect(block('.first-steps__step[data-state="later"]')).toContain("var(--ink-soft)");
  });

  // 기둥 전체의 자리 나눔은 right-stack.test.tsx가 본다 — 여기서는 이 카드의 몫만 고정한다.
  it("안내는 스택에서 자기 몫만 쓴다 — 모드 패널의 자리를 눌러 차지하지 않는다", () => {
    expect(block(".first-steps")).toContain("flex: 0 0 auto");
  });

  it("접힌 한 줄은 네 상태를 갖춘 손잡이다", () => {
    expect(block(".first-steps__collapsed:hover")).toContain("var(--surface-hover)");
    expect(block(".first-steps__collapsed:active")).toContain("var(--surface-active)");
    expect(block(".first-steps__collapsed:focus-visible")).toContain("var(--ring-focus)");
  });

  it("방법 줄은 캡션으로 물러나 있다 — 할 일이 먼저 읽힌다", () => {
    expect(block(".first-steps__how")).toContain("var(--text-caption)");
    expect(block(".first-steps__how")).toContain("var(--ink-soft)");
  });
});
