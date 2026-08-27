// 플로팅 작업대의 규칙 — 캔버스 위의 것들은 부를 때 뜨고, Esc 한 번에 정해진 순서로 물러난다.
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { EVENT_STEP_MS } from "../src/run/fakeRun";
import { selectedNode, useEditor } from "../src/store/editor";
import { awaitingGate, isRunning } from "../src/store/runSlice";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function focusCanvas() {
  screen.getByRole("application", { name: /캔버스/ }).focus();
}

function settingsPanel() {
  return screen.queryByRole("complementary", { name: "설정" });
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("설정 카드는 고른 것이 있을 때만 뜬다", () => {
  it("아무것도 고르지 않았으면 캔버스만 남는다", () => {
    render(<App />);

    expect(settingsPanel()).not.toBeInTheDocument();
  });

  it("노드를 고르면 그 자리에 설정이 뜬다", () => {
    render(<App />);

    act(() => store().select("node", "clinical-agent"));

    expect(settingsPanel()).toBeInTheDocument();
  });

  it("연결을 고를 때도 뜬다", () => {
    render(<App />);

    act(() => store().select("edge", "input-triage"));

    expect(settingsPanel()).toBeInTheDocument();
  });

  it("닫기 버튼으로 접으면 고른 것도 함께 놓아준다", async () => {
    render(<App />);
    act(() => store().select("node", "clinical-agent"));

    await userEvent.click(screen.getByRole("button", { name: "설정 닫기" }));

    expect(settingsPanel()).not.toBeInTheDocument();
    expect(selectedNode(store())).toBeUndefined();
  });
});

describe("캔버스 위의 도구들이 앉는 구석", () => {
  it("미니맵은 우하단으로 물러난다 — 위쪽은 문서·모드·실행의 자리다", () => {
    const { container } = render(<App />);

    const minimap = container.querySelector(".canvas__minimap");
    expect(minimap).toHaveClass("bottom");
    expect(minimap).toHaveClass("right");
  });
});

// DESIGN §1 Esc 체인 — 한 번의 Esc는 한 가지 일만 하고, 손이 어디에 있든 순서는 같다.
describe("Esc가 물러나는 순서", () => {
  const trial = { runId: "run_1", startedAt: new Date("2026-08-01T12:31:00.000Z") };

  /** 사람 확인 밸브 앞에 멈춰 설 때까지 흘려 보낸다 — 카드가 열린 채로 선다. */
  async function heldAtTheGate() {
    await act(async () => {
      await runOnServer(trial);
      store().tickRun(EVENT_STEP_MS * 1000);
    });
  }

  /** 사람 확인 노드가 없는 그래프 — 실행이 끝까지 흐르고 아무도 기다리지 않는다. */
  function withoutTheGate(): AgentSpec {
    return {
      ...example,
      nodes: example.nodes.filter((node) => node.id !== "human-gate"),
      edges: example.edges.filter(
        (edge) => edge.source.node !== "human-gate" && edge.target.node !== "human-gate",
      ),
    };
  }

  function openTray() {
    return userEvent.click(screen.getByRole("button", { name: "보관함" }));
  }

  function trayPanel() {
    return screen.queryByRole("region", { name: "보관함" });
  }

  function comparing() {
    return screen.queryByRole("region", { name: "두 실행 견주기" });
  }

  /** 캔버스 위의 카드는 크기를 재기 전이라 역할로 찾을 수 없다 — 자리로 찾는다. */
  function gateCard(container: HTMLElement, part: string) {
    return container.querySelector(`.gate-card__${part}`);
  }

  /** 포트에서 끌어다 놓은 자리에 노드 피커를 연다 — 검색 칸이 손을 받아 간다. */
  function openPicker() {
    act(() =>
      store().openPicker({
        at: { x: 900, y: 500 },
        screen: { x: 120, y: 90 },
        from: { nodeId: "clinical-agent", portId: "response", side: "source" },
      }),
    );
  }

  // DESIGN §1 예외 ①: 노드 피커가 열려 있으면 Esc는 체인보다 먼저 피커의 것이다.
  it("피커가 열려 있으면 검색 칸에 손이 있어도 피커부터 닫는다", async () => {
    render(<App />);
    act(() => store().select("node", "triage"));
    openPicker();

    await userEvent.keyboard("{Escape}");

    expect(store().picker).toBeNull();
    expect(store().nodes).toHaveLength(example.nodes.length);
    expect(selectedNode(store())?.id).toBe("triage");
  });

  it("피커를 열어 두고 손이 밖으로 나가도 닫히는 것은 피커다", async () => {
    render(<App />);
    act(() => store().select("node", "triage"));
    await act(async () => {
      await runOnServer(trial);
    });
    openPicker();
    focusCanvas();

    await userEvent.keyboard("{Escape}");

    expect(store().picker).toBeNull();
    expect(isRunning(store())).toBe(true);
    expect(selectedNode(store())?.id).toBe("triage");
  });

  // DESIGN §1 예외 ②: 글자를 치는 중이면 Esc는 그 입력 상자의 것이다 (체인 미적용).
  it("문서 이름을 고치는 중의 Esc는 이름 칸의 것이다", async () => {
    render(<App />);
    await act(async () => {
      await runOnServer(trial);
    });
    await userEvent.click(screen.getByRole("button", { name: /이름 바꾸기/ }));
    const field = screen.getByRole("textbox", { name: "문서 이름" });
    await userEvent.type(field, "다른 이름");

    await userEvent.keyboard("{Escape}");

    expect(store().spec?.name ?? null).toBeNull();
    expect(isRunning(store())).toBe(true);
    expect(screen.getByRole("button", { name: /이름 바꾸기/ })).toBeInTheDocument();
  });

  it("설정 값을 치는 중에는 Esc가 뒤를 무르지 않는다", async () => {
    render(<App />);
    act(() => store().select("node", "triage"));
    const field = screen.getAllByRole("textbox")[0];
    field.focus();
    expect(field).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    expect(selectedNode(store())?.id).toBe("triage");
    expect(settingsPanel()).toBeInTheDocument();
  });

  it("가장 먼저 답을 기다리는 물음을 무른다 — 열린 패널과 고른 것은 그대로다", async () => {
    render(<App />);
    await openTray();
    act(() => {
      store().select("node", "triage");
      store().requestDetach("triage");
    });

    await userEvent.keyboard("{Escape}");

    expect(store().pendingDetach).toBeNull();
    expect(trayPanel()).toBeInTheDocument();
    expect(selectedNode(store())?.id).toBe("triage");
  });

  it("E1 다시 묻는 물음이 열려 있으면 그것만 무른다", async () => {
    const { container } = render(<App />);
    await openTray();
    await heldAtTheGate();
    fireEvent.click(container.querySelector(".gate-card__reject") as HTMLElement);

    await userEvent.keyboard("{Escape}");

    expect(store().confirmingReject).toBe(false);
    expect(gateCard(container, "approve")).toBeInTheDocument();
    expect(trayPanel()).toBeInTheDocument();
    expect(isRunning(store())).toBe(true);
  });

  it("E2 열린 확인 카드는 답을 강요하지 않고 물러난다", async () => {
    const { container } = render(<App />);
    await heldAtTheGate();
    focusCanvas();

    await userEvent.keyboard("{Escape}");

    expect(store().gateCardOpen).toBe(false);
    expect(gateCard(container, "reopen")).toBeInTheDocument();
    expect(isRunning(store())).toBe(true);
    expect(awaitingGate(store())).toBe("human-gate");
  });

  // 패널 안에 손이 가 있어도 순서는 같다 — 닫히는 것은 그 패널이다.
  it("E3 카드를 접어 둔 뒤에는 패널이 그다음이다", async () => {
    render(<App />);
    act(() => store().select("node", "triage"));
    await heldAtTheGate();
    act(() => store().setGateCardOpen(false));
    // 손은 패널을 연 그 버튼 위에 있다 — 그래도 닫히는 것은 그 패널이다.
    await openTray();

    await userEvent.keyboard("{Escape}");

    expect(trayPanel()).not.toBeInTheDocument();
    expect(awaitingGate(store())).toBe("human-gate");
    expect(isRunning(store())).toBe(true);
    expect(selectedNode(store())?.id).toBe("triage");
  });

  it("E4 패널까지 접혔으면 견주던 화면이 그다음이다", async () => {
    act(() => store().loadSpec(withoutTheGate()));
    await act(async () => {
      await runOnServer(trial);
      store().stopRun();
      await runOnServer({ ...trial, runId: "run_2" });
      store().stopRun();
      store().toggleCompare("run_1");
      store().toggleCompare("run_2");
    });
    render(<App />);
    act(() => store().select("node", "triage"));
    focusCanvas();

    await userEvent.keyboard("{Escape}");

    expect(comparing()).not.toBeInTheDocument();
    expect(store().compareSelection).toEqual([]);
    expect(store().runHistory).toHaveLength(2);
    expect(selectedNode(store())?.id).toBe("triage");
  });

  it("E5 견줄 것도 없으면 실행 보기를 닫는다", async () => {
    act(() => store().loadSpec(withoutTheGate()));
    render(<App />);
    await act(async () => {
      await runOnServer(trial);
    });
    act(() => store().select("node", "triage"));
    focusCanvas();

    await userEvent.keyboard("{Escape}");

    expect(isRunning(store())).toBe(false);
    expect(selectedNode(store())?.id).toBe("triage");
  });

  it("E6 마지막에 남는 것은 고른 것을 놓는 일이다 — 설정 카드도 함께 접힌다", async () => {
    render(<App />);
    act(() => store().select("node", "triage"));
    focusCanvas();

    await userEvent.keyboard("{Escape}");

    expect(selectedNode(store())).toBeUndefined();
    expect(settingsPanel()).not.toBeInTheDocument();
  });

  it("E7 누를 때마다 한 걸음씩 내려간다", async () => {
    render(<App />);
    await openTray();
    act(() => store().select("node", "triage"));
    await heldAtTheGate();
    focusCanvas();

    await userEvent.keyboard("{Escape}");
    expect(store().gateCardOpen).toBe(false);
    expect(trayPanel()).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(trayPanel()).not.toBeInTheDocument();
    expect(isRunning(store())).toBe(true);

    await userEvent.keyboard("{Escape}");
    expect(isRunning(store())).toBe(false);
    expect(selectedNode(store())?.id).toBe("triage");

    await userEvent.keyboard("{Escape}");
    expect(selectedNode(store())).toBeUndefined();
  });

  it("E8 손이 어디에 있든 순서는 같다", async () => {
    act(() => store().loadSpec(withoutTheGate()));
    render(<App />);
    await act(async () => {
      await runOnServer(trial);
    });
    screen.getByRole("button", { name: "잠시 멈추기" }).focus();

    await userEvent.keyboard("{Escape}");

    expect(isRunning(store())).toBe(false);
  });
});
