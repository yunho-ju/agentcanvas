// 연결이 안 되는 이유를 손이 있는 자리에서 말하는 안내 (DESIGN §7 connection-hint).
// 스스로 사라지고, 쌓이지 않고, 다음 행동을 가로막지 않는다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import { ConnectionHint, FRAMES_TO_LOOK } from "../src/canvas/ConnectionHint";
import type { AgentSpec } from "../src/generated/agent_spec";
import { msg } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";

const LIFETIME_MS = 5000;

/** 아직 아무것도 놓지 않은 문서 — 첫 연결 초대가 뜨는 자리다. */
const blankGraph = {
  ...(exampleSpec as unknown as AgentSpec),
  nodes: [],
  edges: [],
};

function store() {
  return useEditor.getState();
}

function refusal() {
  store().showConnectionHint({
    message: msg("connection.typeMismatch", {
      source: "route",
      sourceWord: msg("type.text"),
      target: "messages",
      targetWord: msg("type.list"),
    }),
    tone: "danger",
    at: { x: 120, y: 240 },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.style.setProperty("--dur-hint", `${LIFETIME_MS}ms`);
  store().clearConnectionHint();
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.style.removeProperty("--dur-hint");
});

describe("연결이 안 될 때의 안내", () => {
  it("말할 것이 없으면 아무것도 세우지 않는다", () => {
    const { container } = render(<ConnectionHint />);
    expect(container).toBeEmptyDOMElement();
  });

  it("이유를 그 자리에서 말한다 — 화면 반대편이 아니다", () => {
    act(refusal);
    const { container } = render(<ConnectionHint />);

    expect(screen.getByRole("alert")).toHaveTextContent("route");
    expect(container.querySelector(".connection-hint")).toHaveStyle({ left: "120px" });
  });

  it("색만으로 말하지 않는다 — 거절은 ✕, 안내는 !", () => {
    act(refusal);
    const { rerender, container } = render(<ConnectionHint />);
    expect(container.querySelector('[data-tone="danger"]')).toHaveTextContent("✕");

    act(() =>
      store().showConnectionHint({
        message: msg("connection.refused"),
        tone: "warn",
        at: { x: 10, y: 20 },
      }),
    );
    rerender(<ConnectionHint />);

    expect(container.querySelector('[data-tone="warn"]')).toHaveTextContent("!");
  });

  it("스스로 사라진다 — 사용자가 치울 것을 남기지 않는다", () => {
    act(refusal);
    render(<ConnectionHint />);

    act(() => vi.advanceTimersByTime(LIFETIME_MS));

    expect(store().connectionHint).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("치우는 버튼을 두지 않는다", () => {
    act(refusal);
    render(<ConnectionHint />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("새 안내가 오면 갈아탄다 — 쌓이지 않는다", () => {
    act(refusal);
    const { rerender } = render(<ConnectionHint />);

    act(() =>
      store().showConnectionHint({
        message: msg("connection.duplicate", { source: "route", target: "input" }),
        tone: "danger",
        at: { x: 10, y: 20 },
      }),
    );
    rerender(<ConnectionHint />);

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("이미 이어 두었어요");
  });

  it("갈아탄 안내는 제 수명을 처음부터 산다", () => {
    act(refusal);
    const { rerender } = render(<ConnectionHint />);

    act(() => vi.advanceTimersByTime(LIFETIME_MS - 1));
    act(() =>
      store().showConnectionHint({
        message: msg("connection.duplicate", { source: "route", target: "input" }),
        tone: "danger",
        at: { x: 10, y: 20 },
      }),
    );
    rerender(<ConnectionHint />);
    act(() => vi.advanceTimersByTime(LIFETIME_MS - 1));

    expect(store().connectionHint).not.toBeNull();
  });

  it("연결에 성공하면 즉시 사라진다", () => {
    act(refusal);
    render(<ConnectionHint />);

    act(() => store().clearConnectionHint());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// 어떤 말은 손이 있던 점이 아니라 그 포트를 가리킨다 — 그 점을 찾는 일은 화면의 몫이다 (DESIGN §7).
describe("포트를 가리키는 안내", () => {
  const PORT = { nodeId: "agent", portId: "response", side: "source" as const };

  /** 안내가 사는 캔버스 표면. 화면에서 재는 자리는 브라우저 대신 여기서 정해 준다. */
  function canvasSurface() {
    const surface = document.createElement("div");
    surface.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 1000, height: 600 }) as DOMRect;
    Object.defineProperty(surface, "clientWidth", { value: 1000 });
    Object.defineProperty(surface, "clientHeight", { value: 600 });
    document.body.append(surface);
    return surface;
  }

  /** 그 표면 위에 그려진 포트 하나 (캔버스 라이브러리가 손잡이에 붙이는 표식 그대로). */
  function drawPort(surface: HTMLElement, at: { left: number; top: number }) {
    const handle = document.createElement("div");
    handle.className = "react-flow__handle source";
    handle.dataset.nodeid = PORT.nodeId;
    handle.dataset.handleid = PORT.portId;
    handle.getBoundingClientRect = () =>
      ({ ...at, width: 8, height: 8 }) as unknown as DOMRect;
    surface.append(handle);
  }

  function invite() {
    store().showConnectionHint({
      message: msg("hint.firstLink"),
      tone: "warn",
      at: { x: 5, y: 5 },
      port: PORT,
    });
  }

  /** 화면이 한 프레임씩 그리는 일을 시험이 직접 넘긴다 — 기다림에 운을 걸지 않는다. */
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames[id - 1] = () => {};
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function nextFrames(count: number) {
    for (let i = 0; i < count; i += 1) {
      const queued = frames;
      frames = [];
      act(() => {
        for (const callback of queued) callback(0);
      });
    }
  }

  function cardIn(surface: HTMLElement) {
    return surface.querySelector(".connection-hint");
  }

  it("이미 그려진 포트라면 그 곁에 곧바로 선다", () => {
    const surface = canvasSurface();
    render(<ConnectionHint />, { container: surface });
    drawPort(surface, { left: 500, top: 300 });

    act(invite);

    // 표면 안의 좌표(404, 254)를 가운데 두고 그 아래에 선다 — 잰 크기가 없으면 그 점 그대로.
    expect(cardIn(surface)).toHaveStyle({ left: "404px" });
  });

  // 실제 순서: 노드를 놓는 그 전이에서 말이 먼저 서고, 캔버스는 그다음 프레임에 손잡이를 붙인다.
  it("말이 먼저 서고 손잡이가 나중에 붙어도 그 포트 곁으로 옮겨 선다", () => {
    const surface = canvasSurface();
    render(<ConnectionHint />, { container: surface });

    act(invite);
    expect(cardIn(surface)).toHaveStyle({ left: "5px" });
    drawPort(surface, { left: 500, top: 300 });
    nextFrames(1);

    expect(cardIn(surface)).toHaveStyle({ left: "404px" });
  });

  it("끝내 그려지지 않으면 손이 있던 자리에서 말한다 — 입을 다물지 않는다", () => {
    const surface = canvasSurface();
    render(<ConnectionHint />, { container: surface });

    act(invite);
    nextFrames(FRAMES_TO_LOOK + 1);

    expect(screen.getByRole("alert")).toHaveTextContent("가장자리 점을 끌어");
    expect(cardIn(surface)).toHaveStyle({ left: "5px" });
  });

  it("몇 프레임만 기다린다 — 화면을 붙들고 늘어지지 않는다", () => {
    const surface = canvasSurface();
    render(<ConnectionHint />, { container: surface });

    act(invite);
    nextFrames(FRAMES_TO_LOOK + 1);
    drawPort(surface, { left: 500, top: 300 });
    nextFrames(1);

    expect(cardIn(surface)).toHaveStyle({ left: "5px" });
  });

  it("말이 갈아타면 앞의 말이 찾던 자리는 그만 찾는다", () => {
    const surface = canvasSurface();
    render(<ConnectionHint />, { container: surface });

    act(invite);
    act(() =>
      store().showConnectionHint({
        message: msg("connection.refused"),
        tone: "danger",
        at: { x: 70, y: 80 },
      }),
    );
    drawPort(surface, { left: 500, top: 300 });
    nextFrames(3);

    expect(cardIn(surface)).toHaveStyle({ left: "70px" });
  });
});

describe("안내가 서는 곳", () => {
  it("캔버스 위에 걸려 있다 — 손이 있는 자리에서 말하기 위해서다", () => {
    render(<App />);

    act(refusal);

    expect(screen.getByRole("alert")).toHaveTextContent("route");
  });

  // 초대가 실제로 뜨는 길 그대로: 노드를 놓는 그 전이에서 말이 서고, 손잡이는 그 뒤 커밋에 붙는다.
  // jsdom은 어느 자리도 재지 못해 좌표는 모두 0이다 — 그래서 "놓은 자리에 머물지 않았다",
  // 곧 그려진 손잡이에서 자리를 얻었다는 사실만 여기서 확인한다 (실제 좌표는 브라우저 실증).
  it("노드를 놓는 실제 경로에서 그려진 포트를 찾아낸다", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      frames.push(callback),
    );
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { container } = render(<App />);

    act(() => {
      store().loadSpec({ ...blankGraph });
      store().openPicker({ at: { x: 10, y: 20 }, screen: { x: 33, y: 44 }, from: null });
      store().addPickedNode("llm.agent");
    });
    act(() => {
      for (const callback of frames.splice(0)) callback(0);
    });

    expect(store().connectionHint?.port?.portId).toBe("response");
    expect(container.querySelector(".react-flow__handle.source")).toBeInTheDocument();
    expect(container.querySelector(".connection-hint")).not.toHaveStyle({ left: "33px" });
    vi.unstubAllGlobals();
  });
});

describe("안내의 모습은 tokens.css가 정한다", () => {
  const app = readFileSync(join(process.cwd(), "src/app.css"), "utf-8");

  function block(selector: string): string {
    const at = app.indexOf(`${selector} {`);
    return at === -1 ? "" : app.slice(at, app.indexOf("}", at));
  }

  it("떠 있는 것의 문법을 따른다 — glass·hairline·shadow·radius", () => {
    const base = block(".connection-hint");
    expect(base).toContain("var(--surface-glass)");
    expect(base).toContain("var(--shadow-float)");
    expect(base).toContain("var(--radius-control)");
    expect(base).toContain("var(--node-width)");
  });

  it("다음 행동을 가로막지 않는다", () => {
    expect(block(".connection-hint")).toContain("pointer-events: none");
  });

  // 안내의 자리(left·top)는 우리가 잰 표면(.canvas) 기준이다 — 표면이 자리의 기준이어야 한다.
  it("자리의 기준은 우리가 재는 그 표면이다", () => {
    expect(block(".canvas")).toContain("position: relative");
  });

  it("두 톤은 색과 글자색이 다르다", () => {
    expect(block('.connection-hint[data-tone="danger"]')).toContain("var(--danger)");
    expect(block('.connection-hint[data-tone="warn"]')).toContain("var(--warn)");
  });

  it("등장은 즉각적이고, 모션을 줄인 화면에서는 페이드 없이 그냥 뜬다", () => {
    expect(block(".connection-hint")).toContain("var(--dur-tap)");
    expect(app).toMatch(
      /prefers-reduced-motion: reduce\)\s*{\s*\.connection-hint\s*{\s*animation: none;/,
    );
  });
});
