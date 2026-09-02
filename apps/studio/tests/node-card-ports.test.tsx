// 포트가 생기거나 이름이 바뀌면 카드는 캔버스에 제 포트 자리를 다시 알린다.
// jsdom은 자리를 재지 못하므로 "다시 알렸는가"를 계약으로 잡는다 — 알리지 않으면
// React Flow는 낡은 포트 위치를 들고 있어 새 포트에서 끈 연결이 조용히 버려진다.
import { ReactFlowProvider } from "@xyflow/react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { NodeCard } from "../src/canvas/NodeCard";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { AgentNodeData } from "../src/graph/serialize";
import { nodeTypes, resolvePorts } from "../src/registry/registry";
import { useEditor } from "../src/store/editor";

const told = vi.fn();

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return { ...actual, useUpdateNodeInternals: () => told };
});

const example = exampleSpec as unknown as AgentSpec;

function inputCard(bindings: Record<string, string>): AgentNodeData {
  const nodeType = nodeTypes["core.input"];
  const spec = { id: "n", type: "core.input", position: { x: 0, y: 0 }, config: { bindings } };
  return { spec, nodeType, ports: resolvePorts(spec, nodeType) };
}

function card(data: AgentNodeData) {
  return (
    <ReactFlowProvider>
      <NodeCard id="n" data={data} />
    </ReactFlowProvider>
  );
}

beforeEach(() => {
  useEditor.getState().loadSpec(example);
  told.mockClear();
});

describe("포트가 바뀌면 캔버스에 다시 알린다", () => {
  it("입력 노드에 행을 적어 포트가 생기면 다시 알린다", () => {
    const view = render(card(inputCard({})));
    const before = told.mock.calls.length;

    view.rerender(card(inputCard({ question: "" })));

    expect(told.mock.calls.length).toBeGreaterThan(before);
    expect(told).toHaveBeenLastCalledWith("n");
  });

  it("포트 이름이 한 글자씩 바뀌어도 그때마다 다시 알린다", () => {
    const view = render(card(inputCard({ q: "" })));
    const before = told.mock.calls.length;

    view.rerender(card(inputCard({ qu: "" })));
    view.rerender(card(inputCard({ que: "" })));

    expect(told.mock.calls.length).toBe(before + 2);
  });

  it("포트가 그대로면 다시 그려도 알리지 않는다", () => {
    const view = render(card(inputCard({ question: "" })));
    const before = told.mock.calls.length;

    view.rerender(card(inputCard({ question: "" })));

    expect(told.mock.calls.length).toBe(before);
  });
});
