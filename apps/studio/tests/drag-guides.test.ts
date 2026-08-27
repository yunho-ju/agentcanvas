// 노드를 끄는 동안에만 안내선이 서고, 줄이 맞는 자리에 노드가 붙는다 (브리프 A3).
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

/** 예제의 노드는 모두 y=240 한 줄에 서 있다 — 그 줄에 다가가며 끈다. */
function dragTriage(to: { x: number; y: number }, dragging = true) {
  store().onNodesChange([{ id: "triage", type: "position", position: to, dragging }]);
}

function triage() {
  return store().nodes.find((node) => node.id === "triage");
}

beforeEach(() => {
  useEditor.getState().loadSpec(example);
});

describe("끄는 동안의 정렬 안내", () => {
  it("아무것도 끌지 않는 동안에는 안내선이 없다", () => {
    expect(store().alignmentGuides).toEqual([]);
  });

  it("다른 노드와 줄이 맞으면 그 줄에 붙이고 안내선을 세운다", () => {
    dragTriage({ x: 400, y: 243 });

    expect(triage()?.position).toEqual({ x: 400, y: 240 });
    expect(store().alignmentGuides).toContainEqual({ axis: "y", at: 240 });
  });

  it("줄에서 멀면 손을 따라가고 안내선도 없다", () => {
    dragTriage({ x: 400, y: 300 });

    expect(triage()?.position).toEqual({ x: 400, y: 300 });
    expect(store().alignmentGuides).toEqual([]);
  });

  it("손을 놓으면 안내선이 사라진다", () => {
    dragTriage({ x: 400, y: 243 });
    dragTriage({ x: 400, y: 240 }, false);

    expect(store().alignmentGuides).toEqual([]);
  });

  it("여러 노드를 함께 끌 때는 줄을 맞추지 않는다", () => {
    // 무엇을 기준으로 붙일지 정할 수 없다 — 손이 가는 대로 둔다.
    store().onNodesChange([
      { id: "triage", type: "position", position: { x: 400, y: 243 }, dragging: true },
      { id: "output", type: "position", position: { x: 1320, y: 243 }, dragging: true },
    ]);

    expect(triage()?.position).toEqual({ x: 400, y: 243 });
    expect(store().alignmentGuides).toEqual([]);
  });

  it("붙은 자리 하나만 되돌리기 한 걸음이 된다", () => {
    const before = triage()?.position;
    dragTriage({ x: 400, y: 243 });
    dragTriage({ x: 400, y: 243 }, false);

    store().undo();

    expect(triage()?.position).toEqual(before);
  });
});
