// 시험 패널이 '지금 시험받는 지시문'을 같은 화면에서 보여 준다 (DESIGN §7 eval-prompt-card, EVAL-1).
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { EvalPanel } from "../src/eval/EvalPanel";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { EvalBatch } from "../src/generated/eval_batch";
import type { EvalCase } from "../src/generated/eval_case";
import { setLocale } from "../src/i18n/localeStore";
import { useEditor } from "../src/store/editor";
import { serveSaves } from "./fakeRunServer";
import { serveEval } from "./fakeEvalServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

/** 지시문을 노드에 적어 둔 문서 — 원본은 노드 config 하나뿐이다. */
function specWith(instructions: Record<string, string>): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.map((node) =>
      instructions[node.id] === undefined
        ? node
        : { ...node, config: { ...node.config, instruction: instructions[node.id] } },
    ),
  } as AgentSpec;
}

beforeEach(() => {
  act(() => setLocale("ko"));
  useEditor.setState({
    spec: null,
    savedSpec: null,
    nodes: [],
    edges: [],
    evalPanelOpen: false,
    dataset: null,
    datasetSynced: null,
    datasetKnownOnServer: false,
    caseDraft: null,
    lastDeletedCase: null,
    batchId: null,
    batchStatus: "idle",
    batch: null,
    evalAdvanced: false,
    evalBatchHistory: null,
    evalBatchHistoryLoading: false,
    evalBatchHistoryFailure: null,
    evalSelectedHistoryId: null,
  });
  serveSaves();
});

async function openPanel(spec: AgentSpec) {
  store().loadSpec(spec);
  serveEval();
  act(() => store().enterEvalMode());
  await act(() => Promise.resolve());
  render(<EvalPanel />);
}

function promptCards() {
  return screen.getAllByRole("button", { name: /지시문/ });
}

describe("eval-prompt-card — 지금 무엇을 시험하는가", () => {
  it("지시문을 적어 둔 노드가 있으면 그 지시문 본문이 시험 패널에 보인다", async () => {
    await openPanel(specWith({ "clinical-agent": "환자에게 쉬운 말로 답해요" }));

    expect(screen.getByText("지금 시험하는 지시문")).toBeInTheDocument();
    expect(screen.getByText("환자에게 쉬운 말로 답해요")).toBeInTheDocument();
  });

  it("지시문 노드가 여럿이면 노드마다 한 장씩, 어느 노드인지 알아볼 수 있다", async () => {
    await openPanel(specWith({ triage: "먼저 급한지 가려요", "clinical-agent": "친절하게 답해요" }));

    expect(promptCards()).toHaveLength(2);
    expect(screen.getByText("먼저 급한지 가려요")).toBeInTheDocument();
    expect(screen.getByText("친절하게 답해요")).toBeInTheDocument();
    expect(screen.getByText("triage")).toBeInTheDocument();
    expect(screen.getByText("clinical-agent")).toBeInTheDocument();
  });

  it("아직 지시문이 없는 노드는 조용히 비어 있지 않고 그렇게 말한다", async () => {
    await openPanel(example);

    expect(screen.getAllByText("아직 지시문이 없어요 — 눌러서 적어요")).toHaveLength(2);
  });

  it("지시문을 가질 수 있는 노드가 없으면 지시문 구역 자체를 그리지 않는다", async () => {
    const noPrompts = {
      ...example,
      nodes: example.nodes.filter((node) => !node.type.startsWith("llm.")),
      edges: [],
    } as AgentSpec;

    await openPanel(noPrompts);

    expect(screen.queryByText("지금 시험하는 지시문")).not.toBeInTheDocument();
  });

  it("패널을 연 채 그래프에서 지시문을 고치면 카드가 따라 바뀐다", async () => {
    await openPanel(specWith({ "clinical-agent": "옛 지시문" }));

    act(() => store().updateNodeConfig("clinical-agent", { instruction: "새 지시문" }));

    expect(screen.getByText("새 지시문")).toBeInTheDocument();
    expect(screen.queryByText("옛 지시문")).not.toBeInTheDocument();
  });

  it("카드를 누르면 그 노드가 골라진다 — 고치는 곳은 인스펙터 하나뿐이다", async () => {
    await openPanel(specWith({ "clinical-agent": "환자에게 쉬운 말로 답해요" }));

    await userEvent.click(screen.getByText("환자에게 쉬운 말로 답해요"));

    expect(store().nodes.find((node) => node.id === "clinical-agent")?.selected).toBe(true);
  });
});

describe("빠진 말 토막 — 실패의 까닭을 이름으로 말한다", () => {
  const evalCase: EvalCase = {
    id: "case-missing",
    title: "인사에 두 마디가 있는가",
    input: {},
    expected_phrases: ["반갑습니다", "감사합니다"],
  };

  async function failedCase(
    attempts: { passed: boolean; output_text: string }[],
    expectedPhrases: string[] = evalCase.expected_phrases,
  ) {
    await openPanel(specWith({ "clinical-agent": "환자에게 쉬운 말로 답해요" }));
    const batch: EvalBatch = {
      id: "batch-missing",
      dataset_id: store().dataset?.id as string,
      spec_id: "spec",
      spec_revision: "rev",
      started_at: "2026-08-20T03:04:05.000Z",
      results: [
        {
          case_id: evalCase.id,
          evaluator: "expected_phrases",
          evaluator_version: "v1",
          passed: false,
          attempts: attempts.map((attempt, index) => ({ run_id: `run-${index}`, ...attempt })),
        },
      ],
    };
    act(() =>
      useEditor.setState({
        dataset: {
          ...store().dataset!,
          cases: [{ ...evalCase, expected_phrases: expectedPhrases as EvalCase["expected_phrases"] }],
        },
        batch,
        batchId: batch.id,
        batchStatus: "completed",
      }),
    );
    await userEvent.click(screen.getByText(evalCase.title));
  }

  it("실패한 케이스를 펼치면 답에 없던 말만 골라 보여 준다", async () => {
    await failedCase([{ passed: false, output_text: "반갑습니다, 오늘도 좋은 하루예요" }]);

    expect(screen.getByText("답에 없던 말")).toBeInTheDocument();
    expect(screen.getByText("감사합니다")).toBeInTheDocument();
    expect(screen.queryByText("반갑습니다")).not.toBeInTheDocument();
  });

  // 마지막 회차가 통과해도 케이스는 집계로 실패할 수 있다 — 빠진 말은 실패한 그 회차에서 나온다.
  it("여러 번 돌렸으면 가장 최근 실패한 회차의 답과 그 회차의 빠진 말을 함께 보여 준다", async () => {
    await failedCase([
      { passed: false, output_text: "반갑습니다" },
      { passed: true, output_text: "반갑습니다, 감사합니다" },
    ]);

    expect(screen.getByText("1번째 돌림의 답")).toBeInTheDocument();
    expect(screen.getByText("반갑습니다")).toBeInTheDocument();
    expect(screen.getByText("감사합니다")).toBeInTheDocument();
  });

  it("규칙대로는 빠진 말이 없는데 실패했다면, 어디를 보면 되는지까지 말한다", async () => {
    await failedCase([{ passed: false, output_text: "반갑습니다,\n\n  감사합니다" }]);

    expect(
      screen.getByText("어느 말이 빠졌는지 찾지 못했어요 — '자세히 보기'를 켜면 회차마다 무엇이 나왔는지 볼 수 있어요"),
    ).toBeInTheDocument();
  });

  it("같은 말을 두 번 적어 둔 케이스도 두 칩을 그대로 보여 준다", async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args[0]);
    try {
      await failedCase([{ passed: false, output_text: "" }], ["감사합니다", "감사합니다"]);

      expect(screen.getAllByText("감사합니다")).toHaveLength(2);
      expect(errors).toEqual([]);
    } finally {
      console.error = original;
    }
  });
});
