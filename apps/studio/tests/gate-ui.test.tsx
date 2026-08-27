// 밸브가 잠기는 것을 사람이 눈으로 본다: 노드는 손을 들고, 관 속의 물방울은 그 앞에 고이고,
// 승인 카드가 옆에 선다. 승인하는 순간 다시 흐른다 — 모두 RunEvent에서 파생된 사실이다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Position, ReactFlowProvider } from "@xyflow/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import { NodeCard } from "../src/canvas/NodeCard";
import { PipeEdge } from "../src/canvas/PipeEdge";
import type { AgentSpec } from "../src/generated/agent_spec";
import { type AgentNodeData, toFlow } from "../src/graph/serialize";
import { setLocale } from "../src/i18n/localeStore";
import { Inspector } from "../src/inspector/Inspector";
import { EVENT_STEP_MS } from "../src/run/fakeRun";
import type { NodeRunFact } from "../src/run/player";
import { markedForRun } from "../src/run/runMarks";
import { useEditor } from "../src/store/editor";
import { awaitingGate, isRunning } from "../src/store/runSlice";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;
const trial = { runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") };
const GATE = "human-gate";

const app = readFileSync(join(process.cwd(), "src/app.css"), "utf-8");

function store() {
  return useEditor.getState();
}

/** 밸브 앞에 멈춰 설 때까지 실행을 흘려 보낸다. */
async function heldAtTheGate() {
  await act(async () => {
    await runOnServer(trial);
    store().tickRun(EVENT_STEP_MS * 1000);
  });
}

function cardData(runStatus: NodeRunFact["status"]): AgentNodeData {
  const spec = { id: GATE, type: "control.human_gate", position: { x: 0, y: 0 }, config: {} };
  return { spec, ports: { inputs: {}, outputs: {} }, runStatus };
}

/** 실제 사람 확인 노드의 포트 그대로 — 받는 자리 하나와 내보내는 자리 둘. */
function gateWithPorts(): AgentNodeData {
  const flow = toFlow(example).nodes.find((node) => node.id === GATE);
  if (!flow) throw new Error("the example graph has no gate node");
  return { ...flow.data, runStatus: "waiting" };
}

/** 선택자 하나에 딸린 선언 블록. */
function cssBlock(selector: string): string {
  const at = app.indexOf(`${selector} {`);
  return at === -1 ? "" : app.slice(at, app.indexOf("}", at));
}

function renderCard(data: AgentNodeData) {
  return render(
    <ReactFlowProvider>
      <NodeCard id={GATE} data={data} />
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  // 앞선 테스트가 영어로 읽고 갔을 수 있다 — 화면의 언어는 테스트마다 처음으로 돌아간다.
  act(() => setLocale("ko"));
  store().loadSpec(example);
});

describe("the node that is holding the flow", () => {
  it("says in plain words that it is waiting for a person", () => {
    renderCard(cardData("waiting"));

    expect(screen.getByRole("status")).toHaveTextContent("확인을 기다려요");
  });

  it("marks the wait with a shape as well as a colour", () => {
    renderCard(cardData("waiting"));

    expect(screen.getByRole("status")).toHaveTextContent("✋");
  });

  it("says the same thing to a reader of English", () => {
    renderCard(cardData("waiting"));

    act(() => setLocale("en"));

    expect(screen.getByRole("status")).toHaveTextContent("Waiting for you to check");
  });

  it("wears the waiting state on the canvas so colour is not the only signal", () => {
    const facts: Record<string, NodeRunFact> = { [GATE]: { status: "waiting" } };
    const marked = markedForRun(toFlow(example), facts, {});

    expect(marked.nodes.find((node) => node.id === GATE)?.className).toContain("waiting");
  });

  it("is drawn in the amber of something that needs a look", () => {
    const at = app.indexOf(".react-flow__node.run--waiting .node-card {");
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, app.indexOf("}", at))).toContain("var(--warn)");
  });
});

describe("the pipe in front of a closed valve", () => {
  const facts: Record<string, NodeRunFact> = {
    "clinical-agent": { status: "completed" },
    [GATE]: { status: "waiting" },
  };
  const marked = markedForRun(toFlow(example), facts, {
    "agent-human": "carrying",
    "human-output": "idle",
  });

  function edge(id: string) {
    return marked.edges.find((candidate) => candidate.id === id);
  }

  it("is still carrying — the data has not been taken over yet", () => {
    expect(edge("agent-human")?.data.flowState).toBe("carrying");
  });

  it("tells the canvas the flow is held there", () => {
    expect(edge("agent-human")?.data.held).toBe(true);
    expect(edge("agent-human")?.className).toContain("held");
  });

  it("holds nothing on the pipes that are not waiting on a person", () => {
    expect(edge("human-output")?.data.held).toBeUndefined();
  });

  it("stops the drops where they are instead of letting them flow", () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <PipeEdge
            id="agent-human"
            source="clinical-agent"
            target={GATE}
            sourceX={0}
            sourceY={0}
            targetX={200}
            targetY={0}
            sourcePosition={Position.Right}
            targetPosition={Position.Left}
            data={{ kind: "approval", flowState: "carrying", held: true }}
          />
        </svg>
      </ReactFlowProvider>,
    );

    const drops = [...container.querySelectorAll(".pipe-edge__drop")];
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.every((drop) => drop.classList.contains("pipe-edge__drop--held"))).toBe(
      true,
    );
  });

  it("keeps the drops flowing where nothing holds them", () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg>
          <PipeEdge
            id="input-triage"
            source="input"
            target="triage"
            sourceX={0}
            sourceY={0}
            targetX={200}
            targetY={0}
            sourcePosition={Position.Right}
            targetPosition={Position.Left}
            data={{ kind: "data", flowState: "carrying" }}
          />
        </svg>
      </ReactFlowProvider>,
    );

    expect(container.querySelector(".pipe-edge__drop--held")).toBeNull();
  });

  it("pauses the drop animation rather than deleting the drops", () => {
    const at = app.indexOf(".pipe-edge__drop--held {");
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, app.indexOf("}", at))).toContain("animation-play-state: paused");
  });
});

describe("the card that asks a person to check", () => {
  /** 카드는 기다리는 노드의 카드 안에 선다 — 캔버스 위에서는 그 노드 옆자리다. */
  function renderGate() {
    return renderCard(cardData("waiting"));
  }

  it("stays away while the run is still flowing", async () => {
    await act(async () => {
      await runOnServer(trial);
    });

    renderGate();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("stands up beside the gate node the moment the flow is held", async () => {
    await heldAtTheGate();

    renderGate();

    expect(screen.getByRole("dialog")).toHaveTextContent("여기서 멈춰 있어요");
  });

  it("names the node it is asking about, for a screen reader too", async () => {
    await heldAtTheGate();

    renderGate();

    expect(screen.getByRole("dialog")).toHaveAccessibleName(
      "'human-gate' 노드에서 사람의 확인을 기다린다",
    );
  });

  it("says why the run is not going on", async () => {
    await heldAtTheGate();

    renderGate();

    expect(screen.getByRole("dialog")).toHaveTextContent("사람이 확인해야 다음으로 가요");
  });

  it("puts the hand of a keyboard user on the approving button", async () => {
    await heldAtTheGate();

    renderGate();

    expect(screen.getByRole("button", { name: "승인하고 계속" })).toHaveFocus();
  });

  it("lets the flow go again when the person approves", async () => {
    await heldAtTheGate();
    renderGate();

    await userEvent.click(screen.getByRole("button", { name: "승인하고 계속" }));

    expect(awaitingGate(store())).toBeNull();
    expect(store().isPlaying).toBe(true);
  });

  // 답은 서버가 받는다 — 오가는 사이에 버튼을 열어 두면 눌러도 아무 일이 없는 버튼이 된다.
  it("says the answer is on its way while the server has not taken it yet", async () => {
    await heldAtTheGate();
    act(() => {
      useEditor.setState({ sendRunAnswer: () => new Promise(() => {}) });
    });
    renderGate();

    await userEvent.click(screen.getByRole("button", { name: "승인하고 계속" }));

    const approve = screen.getByRole("button", { name: "승인하고 계속" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("title", "답을 보내는 중이에요");
    expect(screen.getByRole("button", { name: "거절하기" })).toBeDisabled();
  });

  it("steps aside without letting the flow go when the person wants to look around", async () => {
    await heldAtTheGate();
    renderGate();

    await userEvent.click(screen.getByRole("button", { name: "멈춘 채 두기" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(awaitingGate(store())).toBe(GATE);
  });

  it("leaves a way back to the question it asked", async () => {
    await heldAtTheGate();
    renderGate();
    await userEvent.click(screen.getByRole("button", { name: "멈춘 채 두기" }));

    await userEvent.click(screen.getByRole("button", { name: "확인하러 가기" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("says the same thing to a reader of English", async () => {
    await heldAtTheGate();
    renderGate();

    act(() => setLocale("en"));

    expect(screen.getByRole("dialog")).toHaveTextContent("The run is holding here");
    expect(
      screen.getByRole("button", { name: "Approve and keep going" }),
    ).toBeInTheDocument();
  });

  // 카드는 노드 아래에 딱 붙어 선다 — 오른쪽은 포트 이름의 자리라 서로 가린다.
  it("stands under the node card, not beside it", () => {
    const card = cssBlock(".gate-card");

    expect(card).toContain("top: calc(100% + var(--space-2))");
    expect(card).toContain("left: 0");
    expect(card).not.toContain("left: calc(100%");
  });

  it("is exactly as wide as the node it belongs to", () => {
    expect(cssBlock(".gate-card")).toContain("min-width: var(--node-width)");
  });

  it("stays above the node's own tooltip so nothing covers the question", () => {
    const above = Number(/z-index: (\d+)/.exec(cssBlock(".gate-card"))?.[1]);
    const tooltip = Number(/z-index: (\d+)/.exec(cssBlock(".node-card__tooltip"))?.[1]);

    expect(above).toBeGreaterThan(tooltip);
  });

  it("comes back in the same place it left", () => {
    const reopen = cssBlock(".gate-card__reopen");

    expect(reopen).toContain("top: calc(100% + var(--space-2))");
    expect(reopen).toContain("left: 0");
  });

  it("lines the two answers up side by side, the same height", () => {
    const actions = cssBlock(".gate-card__actions");

    expect(actions).toContain("display: flex");
    expect(actions).toContain("align-items: stretch");
  });

  it("puts the three answers in the order a person reads them", async () => {
    await heldAtTheGate();
    renderGate();

    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual(["승인하고 계속", "거절하기", "멈춘 채 두기"]);
  });

  it("makes the approving answer the one the eye lands on", () => {
    expect(cssBlock(".gate-card__approve")).toContain("background: var(--accent)");
    expect(cssBlock(".gate-card__leave")).toContain("background: var(--surface)");
  });

  // 툴팁도 노드 아래에 뜬다 — 둘이 같은 자리를 쓰면 글자가 포개진다.
  it("lives inside the very card whose tooltip shares that spot", async () => {
    await heldAtTheGate();
    const { container } = renderGate();

    expect(container.querySelector(".node-card > .gate-card")).not.toBeNull();
    expect(container.querySelector(".node-card > .node-card__tooltip")).not.toBeNull();
  });

  it("hushes that tooltip while it is standing there", () => {
    const suppressed = ".node-card:has(.gate-card, .gate-card__reopen) .node-card__tooltip";

    expect(cssBlock(suppressed)).toContain("opacity: 0");
  });

  it("hushes it even while the node is hovered or holds the focus", () => {
    const revealed = app.indexOf(".node-card:hover .node-card__tooltip");
    const hushed = app.indexOf(".node-card:has(.gate-card, .gate-card__reopen)");

    expect(hushed).toBeGreaterThan(revealed);
  });

  it("keeps telling a screen reader what the node is, all the same", async () => {
    await heldAtTheGate();
    renderGate();

    const card = screen.getByRole("dialog").closest(".node-card");
    expect(card).toHaveAttribute("aria-describedby", `node-tip-${GATE}`);
    expect(document.getElementById(`node-tip-${GATE}`)).toBeInTheDocument();
  });

  it("gives its buttons every state a hand and a keyboard can reach", () => {
    for (const base of [
      ".gate-card__approve",
      ".gate-card__leave",
      ".gate-card__reopen",
    ]) {
      const missing = [":hover", ":active", ":focus-visible"].filter(
        (state) => !app.includes(`${base}${state}`),
      );
      expect(missing).toEqual([]);
    }
  });
});

// 거절은 되돌릴 수 없는 답이다 — 한 번 더 묻되, 새 창을 띄우지 않고 카드 안에서 묻는다.
describe("turning the gate down", () => {
  function renderGate() {
    return renderCard(cardData("waiting"));
  }

  async function askToReject() {
    await heldAtTheGate();
    renderGate();
    await userEvent.click(screen.getByRole("button", { name: "거절하기" }));
  }

  it("asks once more, inside the same card", async () => {
    await askToReject();

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent("거절하면 흐름이 여기서 끝나요");
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["정말 거절하기", "돌아가기"]);
  });

  it("has not answered anything yet", async () => {
    await heldAtTheGate();
    const held = store().runEvents;
    renderGate();

    await userEvent.click(screen.getByRole("button", { name: "거절하기" }));

    expect(store().runEvents).toEqual(held);
    expect(awaitingGate(store())).toBe(GATE);
  });

  it("puts the hand of a keyboard user on the safe answer", async () => {
    await askToReject();

    expect(screen.getByRole("button", { name: "돌아가기" })).toHaveFocus();
  });

  it("goes back to the question when the person changes their mind", async () => {
    await askToReject();

    await userEvent.click(screen.getByRole("button", { name: "돌아가기" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("사람이 확인해야 다음으로 가요");
    expect(awaitingGate(store())).toBe(GATE);
  });

  // Esc로 무르는 일은 카드가 혼자 하지 않는다 — 화면 전체의 물러나는 순서(DESIGN §1)가 맡는다.
  // 그래서 아래 시험은 앱을 통째로 세워 놓고 본다.
  // Esc는 실행 보기를 닫는 키이기도 하다 — 카드가 다시 묻는 동안에는 그 키가 이 물음의 것이다.
  // 캔버스 위의 노드는 크기를 재기 전이라 역할로 찾을 수 없어 자리로 찾고, 누르는 일은
  // 클릭 하나만 보낸다 (마우스를 끄는 시늉은 캔버스의 확대·축소 장치가 가로챈다).
  it("takes Escape away from the run view while it is asking again", async () => {
    const { container } = render(<App />);
    await heldAtTheGate();
    const reject = container.querySelector<HTMLButtonElement>(".gate-card__reject");
    if (!reject) throw new Error("the held gate card has no way to turn it down");
    fireEvent.click(reject);
    const held = store().runEvents;

    // 손은 카드가 옮겨 준 '돌아가기' 위에 있다 — 키는 거기서 출발한다.
    expect(container.querySelector(".gate-card__back")).toHaveFocus();
    await userEvent.keyboard("{Escape}");

    expect(container.querySelector(".gate-card__approve")).toBeInTheDocument();
    expect(store().runEvents).toEqual(held);
    expect(isRunning(store())).toBe(true);
  });

  it("ends the run right there once the person means it", async () => {
    await askToReject();

    await userEvent.click(screen.getByRole("button", { name: "정말 거절하기" }));

    expect(awaitingGate(store())).toBeNull();
    expect(store().runEvents.at(-1)?.event_type).toBe("run.completed");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says the same thing to a reader of English", async () => {
    await askToReject();

    act(() => setLocale("en"));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Turning it down ends the run here",
    );
    expect(screen.getByRole("button", { name: "Yes, turn it down" })).toBeInTheDocument();
  });

  it("wears the colour of something you cannot undo, not of the main answer", () => {
    expect(cssBlock(".gate-card__reject")).toContain("var(--danger)");
    expect(cssBlock(".gate-card__reject")).not.toContain("background: var(--accent)");
    expect(cssBlock(".gate-card__confirm")).toContain("var(--danger-soft)");
    expect(cssBlock(".gate-card__confirm")).toContain("var(--danger-ink)");
  });

  it("gives the new buttons every state a hand and a keyboard can reach", () => {
    for (const base of [".gate-card__reject", ".gate-card__confirm", ".gate-card__back"]) {
      const missing = [":hover", ":active", ":focus-visible"].filter(
        (state) => !app.includes(`${base}${state}`),
      );
      expect(missing).toEqual([]);
    }
  });

  // 네 번째 상태는 화면 전체가 함께 쓰는 규칙에서 온다 — 여기서 다시 적지 않는다.
  it("wears the same 'cannot press' look as every other button", () => {
    expect(cssBlock("button:disabled")).toContain("cursor: not-allowed");
    expect(cssBlock("button:disabled")).toContain("opacity");
  });
});

// 거절은 실패가 아니다 — 붉은색을 입히지 않는다 (DESIGN.md §7).
describe("the node after it was turned down", () => {
  it("says in plain words that a person turned it down", () => {
    renderCard(cardData("rejected"));

    expect(screen.getByRole("status")).toHaveTextContent("거절했어요");
    expect(screen.getByRole("status")).toHaveTextContent("✋");
  });

  it("wears the amber of an answer, not the red of a failure", () => {
    expect(cssBlock(".node-card__status--rejected")).toContain("var(--warn-soft)");
    expect(cssBlock(".node-card__status--rejected")).toContain("var(--warn-ink)");
    expect(cssBlock('.node-card__rail[data-status="rejected"]')).toContain("var(--warn)");
    expect(cssBlock(".react-flow__node.run--rejected .node-card")).toContain("var(--warn)");
    expect(cssBlock(".react-flow__node.run--rejected .node-card")).not.toContain(
      "var(--danger)",
    );
  });

  it("asks nothing more of the person — the question is answered", async () => {
    await heldAtTheGate();

    renderCard(cardData("rejected"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// 아직 일어나지 않은 출력의 이름은 물러난다 — 그 자리는 지금 답을 기다리는 카드의 것이다.
describe("the port names of a node that is waiting", () => {
  it("keeps showing what the node is being given", async () => {
    await heldAtTheGate();

    renderCard(gateWithPorts());

    expect(screen.getByText("review")).toBeInTheDocument();
  });

  it("still keeps every port where it was — nothing is taken off the graph", async () => {
    await heldAtTheGate();

    renderCard(gateWithPorts());

    expect(screen.getByText("approved")).toBeInTheDocument();
  });

  it("holds back the names of the answers it has not given yet", () => {
    expect(
      cssBlock(
        ".react-flow__node.run--waiting .node-card__ports--outputs .node-card__port-label",
      ),
    ).toContain("opacity: 0");
  });

  it("holds them back even while the node is the one selected", () => {
    const hiding = app.indexOf(
      ".react-flow__node.run--waiting .node-card__ports--outputs .node-card__port-label",
    );
    const showing = app.indexOf(".react-flow__node.selected .node-card__port-label");

    expect(hiding).toBeGreaterThan(showing);
  });
});

describe("marking a node to stop at", () => {
  function selectTriage() {
    act(() => store().select("node", "triage"));
  }

  it("offers the mark on the node the user is looking at", () => {
    selectTriage();

    render(<Inspector panelRef={{ current: null }} />);

    expect(screen.getByRole("button", { name: "여기서 멈추기" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("remembers the node once the user asks to stop there", async () => {
    selectTriage();
    render(<Inspector panelRef={{ current: null }} />);

    await userEvent.click(screen.getByRole("button", { name: "여기서 멈추기" }));

    expect(store().breakpoints).toEqual(["triage"]);
    expect(screen.getByRole("button", { name: "여기서 멈추기" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("takes the mark off again when the user asks twice", async () => {
    selectTriage();
    render(<Inspector panelRef={{ current: null }} />);

    await userEvent.click(screen.getByRole("button", { name: "여기서 멈추기" }));
    await userEvent.click(screen.getByRole("button", { name: "여기서 멈추기" }));

    expect(store().breakpoints).toEqual([]);
  });

  it("shows the mark on the node card itself", () => {
    act(() => store().toggleBreakpoint(GATE));

    renderCard(cardData("waiting"));

    expect(screen.getByTitle("여기서 멈추기로 해 둔 노드")).toBeInTheDocument();
  });

  it("shows nothing on a node nobody marked", () => {
    renderCard(cardData("waiting"));

    expect(screen.queryByTitle("여기서 멈추기로 해 둔 노드")).not.toBeInTheDocument();
  });
});
