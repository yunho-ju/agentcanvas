import { Position, ReactFlowProvider } from "@xyflow/react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { Canvas } from "../src/canvas/Canvas";
import { NodeCard } from "../src/canvas/NodeCard";
import { PipeEdge, flowEdgeTypes } from "../src/canvas/PipeEdge";
import { useEditor } from "../src/store/editor";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { AgentNodeData } from "../src/graph/serialize";
import { toFlow } from "../src/graph/serialize";
import type { EdgeFlowState, NodeRunStatus } from "../src/run/player";
import { markedForRun } from "../src/run/runMarks";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function dataFor(runStatus?: NodeRunStatus): AgentNodeData {
  const spec = { id: "triage", type: "llm.router", position: { x: 0, y: 0 }, config: {} };
  return { spec, ports: { inputs: {}, outputs: {} }, ...(runStatus ? { runStatus } : {}) };
}

function renderCard(data: AgentNodeData) {
  return render(
    <ReactFlowProvider>
      <NodeCard id="triage" data={data} />
    </ReactFlowProvider>,
  );
}

describe("marking the canvas with what the run is doing", () => {
  const facts = {
    input: { status: "completed" as NodeRunStatus, elapsedMs: 1600 },
    triage: { status: "running" as NodeRunStatus },
  };
  const flows: Record<string, EdgeFlowState> = {
    "input-triage": "carried",
    "triage-agent": "carrying",
    "agent-human": "idle",
  };
  const marked = markedForRun(toFlow(example), facts, flows);

  function edge(id: string) {
    return marked.edges.find((candidate) => candidate.id === id);
  }

  it("tells every node what it is doing right now", () => {
    expect(marked.nodes.find((node) => node.id === "triage")?.data.runStatus).toBe(
      "running",
    );
  });

  it("leaves the nodes the run has not reached waiting their turn", () => {
    expect(marked.nodes.find((node) => node.id === "output")?.data.runStatus).toBe("idle");
  });

  it("gives the canvas a class for each state so colour is not the only signal", () => {
    expect(marked.nodes.find((node) => node.id === "input")?.className).toContain(
      "completed",
    );
  });

  it("leaves the connections joined exactly where they were", () => {
    expect(marked.edges.map(({ id, source, target }) => ({ id, source, target }))).toEqual(
      toFlow(example).edges.map(({ id, source, target }) => ({ id, source, target })),
    );
  });

  it("tells the connection carrying data right now that it is a pipe", () => {
    expect(edge("triage-agent")?.data.flowState).toBe("carrying");
    expect(edge("triage-agent")?.className).toContain("carrying");
  });

  it("leaves a trace on the connection the data has already crossed", () => {
    expect(edge("input-triage")?.className).toContain("carried");
  });

  it("leaves the connections the run has not reached as thin as ever", () => {
    expect(edge("agent-human")?.data.flowState).toBe("idle");
    expect(edge("human-output")?.data.flowState).toBe("idle");
  });

  it("hands every connection to the edge that can draw a pipe", () => {
    expect(marked.edges.map((item) => item.type)).toEqual(["flow", "flow", "flow", "flow"]);
  });

  it("calls that edge by the name the canvas knows it by", () => {
    const unknown = marked.edges.filter((item) => !(String(item.type) in flowEdgeTypes));
    expect(unknown).toEqual([]);
  });

  it("hands the card the one number it may show", () => {
    expect(marked.nodes.find((node) => node.id === "input")?.data.runElapsedMs).toBe(1600);
  });
});

describe("the canvas while the run plays", () => {
  async function startedRun() {
    useEditor.getState().loadSpec(example);
    await runOnServer({
      runId: "run_example",
      startedAt: new Date("2026-08-01T12:30:00Z"),
    });
    return useEditor.getState();
  }

  it("shows what each node is doing at the moment on screen", async () => {
    const editor = await startedRun();
    const started = editor.runEvents.find(
      (event) => event.event_type === "node.started" && event.node_id === "triage",
    );
    act(() => editor.scrubToSeq(started?.seq ?? 0));

    render(<Canvas />);

    expect(screen.getAllByText("일하는 중")).toHaveLength(1);
    expect(screen.getAllByText("마쳤다")).toHaveLength(1);
  });

  it("does not let the user drag the graph around while it plays", async () => {
    await startedRun();

    const { container } = render(<Canvas />);

    expect(container.querySelector(".react-flow__node")).not.toHaveClass("draggable");
  });

  it("lets the drops keep up with the speed the viewer chose", async () => {
    const editor = await startedRun();
    act(() => editor.setRunSpeed(4));

    const { container } = render(<Canvas />);

    expect(container.querySelector(".canvas")).toHaveStyle({ "--run-speed": "4" });
  });

  it("hands the graph back to the user when the run is closed", async () => {
    const editor = await startedRun();
    act(() => editor.stopRun());

    const { container } = render(<Canvas />);

    expect(container.querySelector(".react-flow__node")).toHaveClass("draggable");
  });

  it("says nothing about a run while the user is editing", async () => {
    const editor = await startedRun();
    act(() => editor.stopRun());

    render(<Canvas />);

    expect(screen.queryByText("일하는 중")).not.toBeInTheDocument();
  });
});

// 흐르는 관은 데이터의 사실이다 — 지나는 중인 연결에만, 지나는 동안에만 방울이 흐른다.
describe("a connection while the data crosses it", () => {
  function renderPipe(flowState: EdgeFlowState) {
    return render(
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
            data={{ kind: "data", flowState }}
          />
        </svg>
      </ReactFlowProvider>,
    );
  }

  it("sends a handful of drops down the pipe while it carries data", () => {
    const { container } = renderPipe("carrying");

    const drops = container.querySelectorAll(".pipe-edge__drop");
    expect(drops.length).toBeGreaterThanOrEqual(3);
    expect(drops.length).toBeLessThanOrEqual(5);
  });

  it("does not space the drops out like a machine", () => {
    const { container } = renderPipe("carrying");

    const spacings = [...container.querySelectorAll(".pipe-edge__drop")].map((drop) =>
      drop.getAttribute("style"),
    );
    expect(new Set(spacings).size).toBe(spacings.length);
  });

  it("sends the drops along the very line the connection draws", () => {
    const { container } = renderPipe("carrying");

    const path = container.querySelector(".react-flow__edge-path")?.getAttribute("d");
    const drop = container.querySelector(".pipe-edge__drop")?.getAttribute("style");
    expect(path).toBeTruthy();
    expect(drop).toContain(`path("${path}")`);
  });

  // 모션을 끈 사용자에게도 관은 어느 쪽으로 흐르는지 말해야 한다 (디자인 언어 reduced-motion).
  it("shades the pipe from where the data came to where it goes", () => {
    const { container } = renderPipe("carrying");

    const gradient = container.querySelector("linearGradient");
    expect(gradient).toHaveAttribute("x1", "0");
    expect(gradient).toHaveAttribute("x2", "200");
    expect(container.querySelector(".react-flow__edge-path")?.getAttribute("style")).toContain(
      `url(#${gradient?.id})`,
    );
  });

  it("shades nothing on a connection no data is crossing", () => {
    const { container } = renderPipe("carried");

    expect(container.querySelector("linearGradient")).toBeNull();
    expect(
      container.querySelector(".react-flow__edge-path")?.getAttribute("style") ?? "",
    ).not.toContain("url(");
  });

  it("sends no drops down a connection the data has not reached", () => {
    const { container } = renderPipe("idle");

    expect(container.querySelector(".pipe-edge__drop")).toBeNull();
  });

  it("sends no more drops down a connection the data has already crossed", () => {
    const { container } = renderPipe("carried");

    expect(container.querySelector(".pipe-edge__drop")).toBeNull();
  });
});

describe("a node card while the run plays", () => {
  it("says in words what the node is doing", () => {
    renderCard(dataFor("running"));

    expect(screen.getByText("일하는 중")).toBeInTheDocument();
  });

  it("marks the state with a shape as well as a colour", () => {
    renderCard(dataFor("completed"));

    expect(screen.getByRole("status")).toHaveTextContent("✓");
  });

  it("says nothing about a run when there is none", () => {
    renderCard(dataFor());

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// 도구가 답을 못 가져온 노드는 마친 노드와 다르게 보인다 (API_TOOLS P3a — 거짓 초록불 금지).
describe("도구가 답을 못 가져온 노드의 카드", () => {
  it("마친 노드와 다른 말과 다른 기호를 단다", () => {
    renderCard(dataFor("toolFailed"));

    expect(screen.getByText("도구가 답을 못 가져왔다")).toBeInTheDocument();
    expect(screen.queryByText("마쳤다")).not.toBeInTheDocument();
  });

  it("캔버스도 마친 노드와 다른 자리로 칠한다", () => {
    const graph = toFlow(example);
    const marked = markedForRun(
      graph,
      { triage: { status: "toolFailed" }, input: { status: "completed" } },
      {},
    );

    const troubled = marked.nodes.find((node) => node.id === "triage");
    const done = marked.nodes.find((node) => node.id === "input");
    expect(troubled?.className).toBe("run--toolFailed");
    expect(done?.className).toBe("run--completed");
  });
});
