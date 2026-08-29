// '고치기' 모드 — 기존 그래프에 objective를 주고, 제안문·후보를 읽고, 승인한다 (OPT-1, 등급 B).
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { OptimizeOutcome } from "../src/api/optimize";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

const PROPOSAL = {
  objective: { ko: "비용을 줄인다", en: "cut the cost" },
  hypothesis: { ko: "라우터가 큰 모델을 부른다", en: "the router calls a large model" },
  target_nodes: ["triage"],
  expected_effect: { ko: "작은 모델로 비용이 준다", en: "a smaller model cuts cost" },
  evidence: { batch_id: "batch_7", cases: 12, cases_with_gaps: 3 },
};

function candidateOutcome(): OptimizeOutcome {
  return {
    candidate: {
      ...example,
      nodes: example.nodes.map((node) =>
        node.id === "triage"
          ? { ...node, config: { ...node.config, model_ref: "model://small" } }
          : node,
      ),
    },
    issues: [],
    proposal: PROPOSAL,
  };
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
  useEditor.setState({ optimizeOnServer: async () => candidateOutcome() });
  store().leaveOptimizeMode();
});

function fixButton() {
  return screen.getByRole("button", { name: "고치기" });
}

describe("고치기 모드", () => {
  it("빈 캔버스에서는 고치기로 들어갈 수 없다", () => {
    act(() => useEditor.setState({ spec: null, nodes: [], edges: [] }));
    render(<App />);

    expect(fixButton()).toBeDisabled();
  });

  it("기존 그래프에서 고치기 → objective 입력 자리가 뜬다", async () => {
    render(<App />);

    await userEvent.click(fixButton());

    expect(
      screen.getByRole("textbox", { name: "무엇을 고칠까요" }),
    ).toBeInTheDocument();
  });

  it("objective를 보내면 제안문(가설·대상·기대효과·근거)이 검사와 함께 읽힌다", async () => {
    render(<App />);
    await userEvent.click(fixButton());
    await userEvent.type(
      screen.getByRole("textbox", { name: "무엇을 고칠까요" }),
      "비용을 줄여줘",
    );

    await userEvent.click(screen.getByRole("button", { name: "고칠 방법 찾기" }));

    const panel = screen.getByRole("region", { name: "고치기" });
    expect(within(panel).getByText("라우터가 큰 모델을 부른다")).toBeInTheDocument();
    expect(within(panel).getByText("작은 모델로 비용이 준다")).toBeInTheDocument();
    expect(within(panel).getByText(/triage/)).toBeInTheDocument();
    expect(within(panel).getByText(/12/)).toBeInTheDocument(); // 근거: 케이스 수
    // 승인 전 그래프 불변.
    expect(
      store().nodes.find((node) => node.id === "triage")?.data.spec.config?.model_ref,
    ).not.toBe("model://small");
  });

  it("승인 → 후보가 그래프에 앉고, 되돌리기 한 걸음으로 물러난다", async () => {
    render(<App />);
    await userEvent.click(fixButton());
    await userEvent.type(
      screen.getByRole("textbox", { name: "무엇을 고칠까요" }),
      "비용을 줄여줘",
    );
    await userEvent.click(screen.getByRole("button", { name: "고칠 방법 찾기" }));

    await userEvent.click(screen.getByRole("button", { name: "이대로 고치기" }));

    expect(
      store().nodes.find((node) => node.id === "triage")?.data.spec.config?.model_ref,
    ).toBe("model://small");
    act(() => store().undo());
    expect(
      store().nodes.find((node) => node.id === "triage")?.data.spec.config?.model_ref,
    ).not.toBe("model://small");
  });

  it("시험 결과가 없으면 추측이라고 정직하게 말한다", async () => {
    useEditor.setState({
      optimizeOnServer: async () => ({
        ...candidateOutcome(),
        proposal: {
          ...PROPOSAL,
          evidence: { batch_id: null, cases: 0, cases_with_gaps: 0 },
        },
      }),
    });
    render(<App />);
    await userEvent.click(fixButton());
    await userEvent.type(
      screen.getByRole("textbox", { name: "무엇을 고칠까요" }),
      "비용을 줄여줘",
    );
    await userEvent.click(screen.getByRole("button", { name: "고칠 방법 찾기" }));

    const panel = screen.getByRole("region", { name: "고치기" });
    expect(within(panel).getByText(/아직 시험 결과가 없어/)).toBeInTheDocument();
  });
});
