// 카드는 상태를 말하고 inspector는 값을 말한다 (디자인 언어 §1.5·§2.3).
// 상시 보이는 것은 타입 칩·이름·뱃지뿐이고, 설명과 포트 이름은 사라진 것이 아니라 자리를 옮겼다.
import { Position, ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { useEffect } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { NodeCard } from "../src/canvas/NodeCard";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { AgentNodeData } from "../src/graph/serialize";
import { nodeTypes, resolvePorts } from "../src/registry/registry";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

/** registry가 요구하는 값이 모두 채워진 config — 이 카드에는 손볼 곳이 없다. */
const FILLED_AGENT = { model_ref: "model://default", prompt_ref: "prompt://a@1" };

function dataFor(type: string, config: Record<string, unknown> = {}): AgentNodeData {
  const nodeType = nodeTypes[type];
  const spec = { id: "n", type, position: { x: 0, y: 0 }, config };
  return { spec, nodeType, ports: resolvePorts(spec, nodeType) };
}

function renderCard(data: AgentNodeData, id = "n") {
  return render(
    <ReactFlowProvider>
      <NodeCard id={id} data={data} />
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  useEditor.getState().loadSpec(example);
});

describe("카드가 언제나 말하는 것", () => {
  it("registry의 이름을 카드의 얼굴로 쓴다", () => {
    renderCard(dataFor("llm.agent", FILLED_AGENT));
    expect(screen.getByText("AI 에이전트")).toBeInTheDocument();
  });

  it("타입마다 다른 칩으로 종류를 알아보게 한다", () => {
    const chips = Object.keys(nodeTypes).map((type) => {
      const { container, unmount } = renderCard(dataFor(type, FILLED_AGENT));
      const chip = container.querySelector(".node-card__chip");
      const kind = chip?.getAttribute("data-chip");
      unmount();
      return kind;
    });

    expect(new Set(chips).size).toBe(Object.keys(nodeTypes).length);
    expect(chips).not.toContain(null);
  });

  it("칩의 기호는 그린 도형이다 — 글자나 이모지가 아니다", () => {
    const { container } = renderCard(dataFor("llm.agent", FILLED_AGENT));
    const chip = container.querySelector(".node-card__chip");

    expect(chip?.querySelector("svg")).toBeInTheDocument();
    expect(chip?.textContent).toBe("");
    expect(chip).toHaveAttribute("aria-hidden", "true");
  });

  it("설명 문구를 카드 표면에 늘어놓지 않는다", () => {
    renderCard(dataFor("llm.agent", FILLED_AGENT));

    expect(screen.getByText("모델이 도구를 써 가며 답을 만든다.")).toHaveAttribute(
      "role",
      "tooltip",
    );
  });

  it("registry가 모르는 노드는 적힌 종류를 그대로 보여준다", () => {
    renderCard({
      spec: { id: "n", type: "custom.unknown", position: { x: 0, y: 0 }, config: {} },
      nodeType: undefined,
      ports: { inputs: {}, outputs: {} },
    });
    expect(screen.getByText("custom.unknown")).toBeInTheDocument();
  });
});

describe("설명 툴팁 — hover만으로 닿는 정보는 두지 않는다", () => {
  it("카드가 자기 설명을 가리킨다", () => {
    const { container } = renderCard(dataFor("llm.agent", FILLED_AGENT));
    const card = container.querySelector(".node-card");
    const tooltip = screen.getByRole("tooltip");

    expect(card).toHaveAttribute("aria-describedby", tooltip.id);
    expect(tooltip).toHaveTextContent("모델이 도구를 써 가며 답을 만든다.");
  });

  it("키보드로도 그 설명에 닿는다 — 카드가 초점을 받는다", () => {
    const { container } = renderCard(dataFor("llm.agent", FILLED_AGENT));
    expect(container.querySelector(".node-card")).toHaveAttribute("tabindex", "0");
  });

  it("spec에 적힌 이름은 툴팁에서 확인한다", () => {
    renderCard(dataFor("llm.agent", FILLED_AGENT));
    expect(screen.getByRole("tooltip")).toHaveTextContent("n");
  });
});

describe("설정이 필요한 노드는 hover 없이 손을 든다", () => {
  it("필수 값이 비면 상시 뱃지를 단다", () => {
    renderCard(dataFor("llm.agent"));
    expect(screen.getByRole("button", { name: /설정 필요/ })).toBeInTheDocument();
  });

  it("다 채운 노드는 뱃지를 달지 않는다", () => {
    renderCard(dataFor("llm.agent", FILLED_AGENT));
    expect(screen.queryByRole("button", { name: /설정 필요/ })).not.toBeInTheDocument();
  });

  it("무엇이 비었는지 툴팁에서 말한다", () => {
    renderCard(dataFor("tool.mcp", { resource_ref: "clinical-reference" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("실행할 도구 이름");
  });

  it("뱃지를 누르면 그 노드가 골라진다 — 값을 고칠 자리로 데려간다", async () => {
    renderCard(dataFor("llm.agent"), "triage");

    await userEvent.click(screen.getByRole("button", { name: /설정 필요/ }));

    expect(useEditor.getState().nodes.find((node) => node.selected)?.id).toBe("triage");
  });
});

describe("포트 — 평소에는 점, 필요할 때 이름", () => {
  it("이어 붙일 자리마다 손잡이가 있다", () => {
    const { container } = renderCard(
      dataFor("core.input", { bindings: { question: "input.question" } }),
    );
    expect(container.querySelectorAll(".react-flow__handle")).toHaveLength(1);
  });

  it("이름은 지운 것이 아니라 감춘 것이다", () => {
    renderCard(dataFor("llm.agent", FILLED_AGENT));
    for (const label of ["messages", "response", "tool_calls"]) {
      expect(screen.getByText(label)).toHaveClass("node-card__port-label");
    }
  });

  it("포트도 자기 설명을 들고 있다", () => {
    renderCard(dataFor("llm.agent", FILLED_AGENT));
    expect(screen.getByText("response").closest("li")).toHaveAttribute(
      "title",
      "모델이 만든 답",
    );
  });

  it("아무도 연결을 끌고 있지 않을 때는 모든 포트가 조용하다", () => {
    const { container } = renderCard(dataFor("llm.agent", FILLED_AGENT));
    const states = [...container.querySelectorAll(".node-card__port")].map((port) =>
      port.getAttribute("data-link"),
    );
    expect(states).toEqual(["idle", "idle", "idle"]);
  });
});

// 연결을 끄는 동안 이을 수 있는 포트만 밝아진다 (C6) — 판정은 계약(checkConnection)이 한다.
describe("연결을 끄는 동안 포트가 서로를 알아본다", () => {
  /** 캔버스 라이브러리에게 "지금 이 포트를 끌고 있다"고 알린 화면. */
  function Dragging({ from }: { from: { nodeId: string; id: string } }) {
    const flow = useStoreApi();
    useEffect(() => {
      flow.setState({
        connection: {
          inProgress: true,
          isValid: null,
          from: { x: 0, y: 0 },
          fromHandle: { nodeId: from.nodeId, id: from.id, type: "source" },
          fromPosition: Position.Right,
          fromNode: null,
          to: { x: 0, y: 0 },
          toHandle: null,
          toPosition: Position.Left,
          toNode: null,
        },
      } as unknown as Parameters<typeof flow.setState>[0]);
    }, [flow, from]);
    return null;
  }

  function linkStates(nodeId: string, from: { nodeId: string; id: string }) {
    const spec = useEditor.getState().nodes.find((node) => node.id === nodeId);
    const { container } = render(
      <ReactFlowProvider>
        <Dragging from={from} />
        <NodeCard id={nodeId} data={spec?.data as AgentNodeData} />
      </ReactFlowProvider>,
    );
    return Object.fromEntries(
      [...container.querySelectorAll(".node-card__port")].map((port) => [
        port.querySelector(".node-card__port-label")?.textContent,
        port.getAttribute("data-link"),
      ]),
    );
  }

  it("이을 수 있는 자리는 밝아지고, 타입이 다른 자리는 물러난다", () => {
    // triage.passthrough(무엇이든)는 messages를 받을 수 있지만, route(글자)는 그러지 못한다.
    expect(linkStates("clinical-agent", { nodeId: "triage", id: "passthrough" })).toEqual({
      messages: "compatible",
      response: "incompatible",
      tool_calls: "incompatible",
    });
    expect(linkStates("clinical-agent", { nodeId: "triage", id: "route" })).toEqual({
      messages: "incompatible",
      response: "incompatible",
      tool_calls: "incompatible",
    });
  });

  it("흐름이 되돌아오는 자리도 물러난다", () => {
    // human-gate는 triage에서 흘러온 뒤다 — 거기로 되돌리면 제자리를 돈다.
    expect(linkStates("triage", { nodeId: "human-gate", id: "rejected" })).toEqual({
      input: "incompatible",
      route: "incompatible",
      passthrough: "incompatible",
    });
  });
});

describe("실행을 보는 동안", () => {
  it("편집 중에는 상태 바가 없다", () => {
    const { container } = renderCard(dataFor("llm.agent", FILLED_AGENT));
    expect(container.querySelector(".node-card__rail")).toBeNull();
  });

  it("상태를 카드 왼쪽 바에 표시한다", () => {
    const { container } = renderCard({
      ...dataFor("llm.agent", FILLED_AGENT),
      runStatus: "running",
    });
    expect(container.querySelector(".node-card__rail")).toHaveAttribute(
      "data-status",
      "running",
    );
  });

  it("같은 상태를 바·기호·글 세 가지로 말한다", () => {
    const { container } = renderCard({
      ...dataFor("llm.agent", FILLED_AGENT),
      runStatus: "completed",
    });

    expect(container.querySelector(".node-card__rail")).toHaveAttribute(
      "data-status",
      "completed",
    );
    expect(container.querySelector(".node-card__mark")).toHaveTextContent("✓");
    expect(screen.getByText(/마쳤다/)).toBeInTheDocument();
  });

  it("마친 노드는 걸린 시간 하나만 덧붙인다", () => {
    renderCard({
      ...dataFor("llm.agent", FILLED_AGENT),
      runStatus: "completed",
      runElapsedMs: 1600,
    });
    expect(screen.getByText("1.6초")).toBeInTheDocument();
  });

  it("일하는 중인 노드는 숫자를 지어내지 않는다", () => {
    const { container } = renderCard({
      ...dataFor("llm.agent", FILLED_AGENT),
      runStatus: "running",
    });
    expect(container.querySelector(".node-card__elapsed")).toBeNull();
  });

  it("끝내지 못했을 때만 이유 한 줄을 더한다", () => {
    renderCard({
      ...dataFor("llm.agent", FILLED_AGENT),
      runStatus: "failed",
      runError: "모델을 부를 수 없었다",
    });
    expect(screen.getByText("모델을 부를 수 없었다")).toBeInTheDocument();
  });

  it("실행 중에는 설정 뱃지 대신 상태를 말한다", () => {
    renderCard({ ...dataFor("llm.agent"), runStatus: "running" });

    expect(screen.queryByRole("button", { name: /설정 필요/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
