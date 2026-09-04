// '고치기' 모드 — 기존 그래프에 objective를 주고, 제안문·후보를 읽고, 승인한다 (OPT-1, 등급 B).
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function candidateSpec(): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.map((node) =>
      node.id === "triage"
        ? { ...node, config: { ...node.config, model_ref: "model://small" } }
        : node,
    ),
  };
}

function candidateOutcome(): OptimizeOutcome {
  return { candidate: candidateSpec(), issues: [], proposal: PROPOSAL };
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

const REACT_ONLY = [
  {
    id: "react",
    shortName: { ko: "도구를 쓰며 답 다듬기", en: "Look things up while answering" },
  },
];

function withShape(patternId: string): OptimizeOutcome {
  return {
    candidate: candidateSpec(),
    issues: [],
    proposal: { ...PROPOSAL, pattern_id: patternId },
  };
}

async function askToFix() {
  await userEvent.click(fixButton());
  await userEvent.type(
    screen.getByRole("textbox", { name: "무엇을 고칠까요" }),
    "비용을 줄여줘",
  );
  await userEvent.click(screen.getByRole("button", { name: "고칠 방법 찾기" }));
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

  it("제안이 카탈로그의 모양을 가리키면 짧은 이름 칩 하나가 대상 노드 칩 옆에 선다", async () => {
    useEditor.setState({
      optimizeOnServer: async () => withShape("react"),
      serverPatterns: null,
      fetchServerPatterns: async () => REACT_ONLY,
    });
    render(<App />);

    await askToFix();

    const panel = screen.getByRole("region", { name: "고치기" });
    await within(panel).findByText("도구를 쓰며 답 다듬기");
    // DESIGN §7: 칩은 제안문 묶음 안 '대상 노드' 옆에 선다 — 패널 아무 데나가 아니다.
    const targets = panel.querySelector(".optimize-panel__targets") as HTMLElement;
    expect(within(targets).getByText("도구를 쓰며 답 다듬기")).toBeInTheDocument();
  });

  it("가리키는 모양이 없으면 모양 목록을 서버에 묻지도 않는다", async () => {
    const fetchServerPatterns = vi.fn(async () => REACT_ONLY);
    useEditor.setState({ serverPatterns: null, fetchServerPatterns });
    render(<App />);

    await askToFix();

    expect(fetchServerPatterns).not.toHaveBeenCalled();
  });

  it("목록을 못 들은 채 다음 제안이 모양을 가리키면 다시 묻는다", async () => {
    let told = false;
    const fetchServerPatterns = vi.fn(async () => {
      // 첫 물음에는 서버가 답하지 못한다 — 그 뒤의 물음에야 목록을 듣는다.
      const answer = told ? REACT_ONLY : null;
      told = true;
      return answer;
    });
    useEditor.setState({
      optimizeOnServer: async () => withShape("react"),
      serverPatterns: null,
      fetchServerPatterns,
    });
    render(<App />);
    await askToFix();
    const panel = screen.getByRole("region", { name: "고치기" });
    expect(within(panel).queryByText("도구를 쓰며 답 다듬기")).toBeNull();

    // '다시 적기'는 적은 objective를 그대로 둔 채 입력 상태로 돌아간다 — 다시 보내기만 하면 된다.
    await userEvent.click(screen.getByRole("button", { name: "다시 적기" }));
    await userEvent.click(screen.getByRole("button", { name: "고칠 방법 찾기" }));

    expect(await within(panel).findByText("도구를 쓰며 답 다듬기")).toBeInTheDocument();
  });

  it("모양 칩은 표시일 뿐 누를 것이 아니다", async () => {
    useEditor.setState({
      optimizeOnServer: async () => withShape("react"),
      serverPatterns: null,
      fetchServerPatterns: async () => REACT_ONLY,
    });
    render(<App />);

    await askToFix();

    const panel = screen.getByRole("region", { name: "고치기" });
    const chip = await within(panel).findByText("도구를 쓰며 답 다듬기");
    expect(chip.closest("button")).toBeNull();
  });

  it("모양을 가리키지 않는 제안에는 칩이 없다", async () => {
    useEditor.setState({
      serverPatterns: null,
      fetchServerPatterns: async () => REACT_ONLY,
    });
    render(<App />);

    await askToFix();

    const panel = screen.getByRole("region", { name: "고치기" });
    expect(within(panel).queryByText("도구를 쓰며 답 다듬기")).toBeNull();
  });

  it("모양 목록을 못 읽으면 코드 이름 대신 아무 칩도 보이지 않는다", async () => {
    useEditor.setState({
      optimizeOnServer: async () => withShape("react"),
      serverPatterns: null,
      fetchServerPatterns: async () => null,
    });
    render(<App />);

    await askToFix();

    const panel = screen.getByRole("region", { name: "고치기" });
    expect(within(panel).queryByText(/react/)).toBeNull();
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
