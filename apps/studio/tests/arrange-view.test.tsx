// 정리한 다음에는 정리된 결과가 보여야 한다 — 화면이 전부를 담도록 데려간다 (DESIGN §7 arrange).
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { Canvas } from "../src/canvas/Canvas";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";

const fitView = vi.fn();

vi.mock("@xyflow/react", async () => {
  const actual = await vi.importActual<typeof import("@xyflow/react")>("@xyflow/react");
  return {
    ...actual,
    useReactFlow: () => ({ ...actual.useReactFlow(), fitView }),
  };
});

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

beforeEach(() => {
  store().loadSpec(example);
  fitView.mockClear();
});

describe("정리한 뒤의 화면", () => {
  it("정리하기를 누르면 캔버스가 전부를 한 화면에 담는다", () => {
    render(<Canvas />);
    fitView.mockClear();

    act(() => {
      store().arrangeNodes();
    });

    expect(fitView).toHaveBeenCalledTimes(1);
  });

  it("아무도 부탁하지 않았으면 화면은 스스로 움직이지 않는다", () => {
    render(<Canvas />);

    expect(fitView).not.toHaveBeenCalled();
  });
});
