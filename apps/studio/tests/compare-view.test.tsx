// 두 실행을 나란히 놓고 보는 화면 — 어디서부터 달라지는지 보고, 마음에 드는 쪽으로 이어 간다.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { EVENT_STEP_MS } from "../src/run/fakeRun";
import { useEditor } from "../src/store/editor";
import { runOnServer, settle } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function trial(n: number) {
  return {
    runId: `run_${n}`,
    startedAt: new Date(`2026-08-01T12:3${n}:00.000Z`),
  };
}

/** 사람 확인 앞에서 멈출 때까지 흘려보낸다. */
function playOn() {
  store().tickRun(EVENT_STEP_MS * 1000);
}

/** 사람 확인 앞에 멈춰 선 채로 남는 실행 하나. */
async function heldRun(n: number) {
  await act(async () => {
    await runOnServer(trial(n));
    playOn();
    store().stopRun();
  });
}

/** 확인까지 받아 끝까지 흐른 실행 하나. */
async function finishedRun(n: number) {
  await act(async () => {
    await runOnServer(trial(n));
    playOn();
    await store().approveGate();
    await settle();
    playOn();
    store().stopRun();
  });
}

function chooseBoth() {
  act(() => {
    store().toggleCompare("run_1");
    store().toggleCompare("run_2");
  });
}

/** 사람 확인 노드가 마지막인 그래프 — 승인하지 않으면 거기가 실행의 끝이다. */
function endingAtTheGate(): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.filter((node) => node.id !== "output"),
    edges: example.edges.filter(
      (edge) => edge.source.node !== "output" && edge.target.node !== "output",
    ),
  };
}

/** 노드 하나의 설정을 손본다 — 다음 실행은 다른 실행이 된다. */
function changeThePrompt(value: string) {
  act(() => {
    store().updateNodeConfig("triage", {
      ...example.nodes[1].config,
      prompt_ref: value,
    });
  });
}

function compareView() {
  return screen.queryByRole("region", { name: "두 실행 견주기" });
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("견주는 화면이 열리는 때", () => {
  it("실행이 하나뿐이면 견줄 수 없다고 말한다", async () => {
    await heldRun(1);
    render(<App />);

    const control = screen.getByRole("button", { name: "비교" });
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute("title", "견주려면 실행이 둘 이상이어야 해요");
    expect(compareView()).not.toBeInTheDocument();
  });

  it("하나만 골라 두었을 때는 아직 열리지 않는다", async () => {
    await heldRun(1);
    await heldRun(2);
    render(<App />);

    await userEvent.click(screen.getAllByRole("button", { name: "비교" })[0]);

    expect(store().compareSelection).toEqual(["run_1"]);
    expect(compareView()).not.toBeInTheDocument();
  });

  it("두 개를 고르면 열리고, 고른 자리를 카드가 말한다", async () => {
    await heldRun(1);
    await heldRun(2);
    render(<App />);

    await userEvent.click(screen.getAllByRole("button", { name: "비교" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "비교" }));

    expect(compareView()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "비교 1/2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "비교 2/2" })).toBeInTheDocument();
  });

  it("고른 것을 다시 누르면 견주기를 그만둔다", async () => {
    await heldRun(1);
    await heldRun(2);
    chooseBoth();
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "비교 1/2" }));

    expect(store().compareSelection).toEqual(["run_2"]);
    expect(compareView()).not.toBeInTheDocument();
  });

  it("카드 본체를 누르는 일은 예나 지금이나 다시 보기다", async () => {
    await heldRun(1);
    await heldRun(2);
    act(() => {
      store().toggleCompare("run_1");
    });
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /실행 2/ }));

    expect(store().activeRunId).toBe("run_2");
    expect(store().compareSelection).toEqual(["run_1"]);
  });

  it("어디에 손이 가 있든 Esc 한 번에 견주기가 닫히고 고른 것도 놓인다", async () => {
    await heldRun(1);
    await heldRun(2);
    render(<App />);
    await userEvent.click(screen.getAllByRole("button", { name: "비교" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "비교" }));

    await userEvent.keyboard("{Escape}");

    expect(store().compareSelection).toEqual([]);
    expect(compareView()).not.toBeInTheDocument();
  });
});

describe("어디서부터 달라지는가", () => {
  it("같은 그래프를 다시 실행했으면 똑같다고 말한다", async () => {
    await heldRun(1);
    await heldRun(2);
    chooseBoth();
    render(<App />);

    expect(screen.getByText("두 실행이 똑같아요")).toBeInTheDocument();
    expect(screen.queryByText("여기부터 달라져요")).not.toBeInTheDocument();
  });

  it("설정을 바꾼 뒤의 실행은 갈라지는 자리를 양쪽 모두 짚는다", async () => {
    await heldRun(1);
    changeThePrompt("prompt://triage@9");
    await heldRun(2);
    chooseBoth();
    render(<App />);

    expect(screen.getAllByText("여기부터 달라져요")).toHaveLength(2);
    expect(screen.queryByText("두 실행이 똑같아요")).not.toBeInTheDocument();
  });

  it("먼저 끝난 쪽만 끝났다고 말하고, 갈라지는 자리는 양쪽 모두 짚는다", async () => {
    await heldRun(1);
    await finishedRun(2);
    chooseBoth();
    render(<App />);

    expect(screen.getAllByText("여기서 끝났어요")).toHaveLength(1);
    expect(screen.getAllByText("여기부터 달라져요")).toHaveLength(2);
  });

  it("멈춘 자리가 마지막 노드여도 똑같다고 말하지 않는다", async () => {
    act(() => store().loadSpec(endingAtTheGate()));
    await heldRun(1);
    await finishedRun(2);
    chooseBoth();
    render(<App />);

    expect(screen.queryByText("두 실행이 똑같아요")).not.toBeInTheDocument();
    expect(screen.getAllByText("여기서 끝났어요")).toHaveLength(1);
    expect(screen.getAllByText("여기부터 달라져요")).toHaveLength(2);
  });

  it("각 단계를 쉬운 말 한 줄로 읽어 준다", async () => {
    await heldRun(1);
    await heldRun(2);
    chooseBoth();
    render(<App />);

    expect(screen.getAllByText("'triage' 노드가 마쳤다")).toHaveLength(2);
  });
});

describe("마음에 드는 쪽으로 이어 가기", () => {
  beforeEach(async () => {
    await heldRun(1);
    changeThePrompt("prompt://triage@9");
    await heldRun(2);
    chooseBoth();
  });

  it("고른 실행의 설정이 캔버스로 돌아오고 견주기는 끝난다", async () => {
    render(<App />);

    await userEvent.click(screen.getAllByRole("button", { name: "이쪽으로 계속" })[0]);

    expect(
      store().nodes.find((node) => node.id === "triage")?.data.spec.config?.prompt_ref,
    ).toBe("prompt://triage@2");
    expect(compareView()).not.toBeInTheDocument();
  });

  it("어느 실행으로 이어 가는 중인지 카드에 남긴다", async () => {
    render(<App />);

    await userEvent.click(screen.getAllByRole("button", { name: "이쪽으로 계속" })[0]);

    expect(screen.getByRole("button", { name: /실행 1.*채택/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^실행 2/ })).toBeInTheDocument();
  });

  it("닫기 버튼으로도 견주기를 그만둔다", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "견주기 닫기" }));

    expect(store().compareSelection).toEqual([]);
    expect(compareView()).not.toBeInTheDocument();
  });
});
