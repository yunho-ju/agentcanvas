// 피커에서 고른 노드는 놓이는 동시에 이어진다 — 그리고 그 둘은 되돌리기 한 걸음이다 (브리프 B4).
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { msg, translate } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

const fromResponse = {
  at: { x: 900, y: 500 },
  screen: { x: 120, y: 90 },
  from: { nodeId: "clinical-agent", portId: "response", side: "source" as const },
};

beforeEach(() => {
  useEditor.getState().loadSpec(example);
});

describe("피커 열고 닫기", () => {
  it("아무 일도 없을 때는 떠 있지 않다", () => {
    expect(store().picker).toBeNull();
  });

  it("연결을 끌다 빈 자리에 놓으면 그 자리에서 열린다", () => {
    store().openPicker(fromResponse);

    expect(store().picker?.at).toEqual({ x: 900, y: 500 });
    expect(store().picker?.from?.portId).toBe("response");
  });

  // 안내가 "빈 곳에 놓으면 골라 드릴게요"라고 했고, 그 일이 일어났다 (DESIGN §7).
  it("피커가 열리면 갈 곳이 없다던 안내는 물러난다", () => {
    store().showConnectionHint({
      message: msg("connection.nowhere", { port: "response" }),
      tone: "warn",
      at: { x: 10, y: 20 },
    });

    store().openPicker(fromResponse);

    expect(store().connectionHint).toBeNull();
  });

  it("그만두면 아무것도 남기지 않는다", () => {
    store().openPicker(fromResponse);
    store().closePicker();

    expect(store().picker).toBeNull();
    expect(store().nodes).toHaveLength(example.nodes.length);
  });
});

describe("피커에서 고른 노드", () => {
  it("고른 자리에 그 종류의 노드를 놓는다", () => {
    store().openPicker(fromResponse);
    store().addPickedNode("core.output", "input");

    expect(store().nodes.at(-1)?.data.spec.type).toBe("core.output");
    expect(store().nodes.at(-1)?.position).toEqual({ x: 900, y: 500 });
  });

  it("끌고 온 포트에서 새 노드로 연결을 잇는다", () => {
    store().openPicker(fromResponse);
    store().addPickedNode("core.output", "input");

    const added = store().nodes.at(-1);
    expect(store().exportSpec().edges.at(-1)).toMatchObject({
      kind: "data",
      source: { node: "clinical-agent", port: "response" },
      target: { node: added?.id, port: "input" },
    });
  });

  it("받는 포트에서 끌고 왔다면 새 노드가 보내는 쪽이 된다", () => {
    store().openPicker({
      ...fromResponse,
      from: { nodeId: "clinical-agent", portId: "messages", side: "target" },
    });
    store().addPickedNode("llm.agent", "tool_calls");

    const added = store().nodes.at(-1);
    expect(store().exportSpec().edges.at(-1)).toMatchObject({
      source: { node: added?.id, port: "tool_calls" },
      target: { node: "clinical-agent", port: "messages" },
    });
  });

  it("노드와 연결이 되돌리기 한 걸음에 함께 사라진다", () => {
    store().openPicker(fromResponse);
    store().addPickedNode("core.output", "input");

    store().undo();

    expect(store().nodes).toHaveLength(example.nodes.length);
    expect(store().edges).toHaveLength(example.edges.length);
  });

  it("다시하기 한 걸음에 노드와 연결이 함께 돌아온다", () => {
    store().openPicker(fromResponse);
    store().addPickedNode("core.output", "input");
    store().undo();

    store().redo();

    expect(store().nodes).toHaveLength(example.nodes.length + 1);
    expect(store().edges).toHaveLength(example.edges.length + 1);
  });

  it("고르고 나면 피커는 물러난다", () => {
    store().openPicker(fromResponse);
    store().addPickedNode("core.output", "input");

    expect(store().picker).toBeNull();
  });

  it("끌고 온 포트 없이 열었다면 노드만 놓는다", () => {
    store().openPicker({ at: { x: 10, y: 20 }, screen: { x: 1, y: 2 }, from: null });
    store().addPickedNode("llm.agent");

    expect(store().nodes.at(-1)?.position).toEqual({ x: 10, y: 20 });
    expect(store().edges).toHaveLength(example.edges.length);
  });

  it("떠 있지 않은 피커에서는 아무것도 놓지 않는다", () => {
    store().addPickedNode("llm.agent");

    expect(store().nodes).toHaveLength(example.nodes.length);
  });
});

// 아직 아무것도 이어 보지 않은 사람에게 다음 걸음을 건넨다 (DESIGN §7 첫 연결 초대).
describe("첫 연결 초대", () => {
  const droppedAt = { at: { x: 10, y: 20 }, screen: { x: 33, y: 44 }, from: null };

  function onBlankGraph() {
    store().loadSpec({ ...example, nodes: [], edges: [] });
  }

  function place(type: string) {
    store().openPicker(droppedAt);
    store().addPickedNode(type);
  }

  it("이어 본 적 없는 그래프에 노드를 놓으면 이어 보라고 초대한다", () => {
    onBlankGraph();

    place("llm.agent");

    expect(translate("ko", store().connectionHint!.message)).toBe(
      "가장자리 점을 끌어 다음 단계를 이어요 — 이을 수 있는 것만 보여 드려요",
    );
    expect(translate("en", store().connectionHint!.message)).toBe(
      "Drag a dot on the edge to link the next step — only what fits will show",
    );
  });

  it("거절이 아니라 안내다", () => {
    onBlankGraph();

    place("llm.agent");

    expect(store().connectionHint?.tone).toBe("warn");
  });

  // 자리는 좌표가 아니라 **그 포트**로 가리킨다 — 화면 좌표는 화면이 잰다 (DESIGN §7).
  it("그 노드의 첫 출력 포트를 가리킨다", () => {
    onBlankGraph();

    place("llm.agent");

    expect(store().connectionHint?.port).toEqual({
      nodeId: store().nodes.at(-1)?.id,
      portId: "response",
      side: "source",
    });
  });

  it("이미 이어 본 그래프에서는 말하지 않는다", () => {
    place("llm.agent");

    expect(store().connectionHint).toBeNull();
  });

  // 입구는 여럿이다: 피커로 놓든 팔레트로 놓든 같은 규칙이 말한다.
  it("팔레트로 놓아도 같은 말을 같은 규칙으로 건넨다", () => {
    onBlankGraph();

    store().addNode("llm.agent", { x: 120, y: 120 });

    expect(translate("ko", store().connectionHint!.message)).toContain(
      "가장자리 점을 끌어",
    );
    expect(store().connectionHint?.port?.nodeId).toBe(store().nodes.at(-1)?.id);
  });

  it("팔레트로 놓아도 이미 이어 본 그래프에서는 말하지 않는다", () => {
    store().addNode("llm.agent", { x: 120, y: 120 });

    expect(store().connectionHint).toBeNull();
  });

  it("팔레트로 놓아도 끌 점이 없는 노드에게는 끌어 보라고 하지 않는다", () => {
    onBlankGraph();

    store().addNode("core.output", { x: 120, y: 120 });

    expect(store().connectionHint).toBeNull();
  });

  it("끌 점이 없는 노드에게는 끌어 보라고 하지 않는다", () => {
    onBlankGraph();

    place("core.output");

    expect(store().connectionHint).toBeNull();
  });

  it("첫 연결이 생기면 초대는 제 할 일을 다 했다", () => {
    store().loadSpec({ ...example, edges: [] });

    place("llm.agent");
    store().connect(
      { source: "input", sourceHandle: "question", target: "triage", targetHandle: "input" },
      { x: 1, y: 2 },
    );

    expect(store().edges).toHaveLength(1);
    expect(store().connectionHint).toBeNull();
  });
});
