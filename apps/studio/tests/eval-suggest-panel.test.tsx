// AI가 지어 준 제안을 고르는 화면 (DESIGN §7 eval-suggest-card, EVAL-2).
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { EvalPanel } from "../src/eval/EvalPanel";
import { SUGGEST_DEFAULT, type CaseSuggestion } from "../src/eval/caseSuggestions";
import type { AgentSpec } from "../src/generated/agent_spec";
import { setLocale } from "../src/i18n/localeStore";
import { useEditor } from "../src/store/editor";
import { serveEval } from "./fakeEvalServer";
import { serveSaves } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function suggestion(title: string, input: Record<string, unknown> = { question: "머리가 아파요" }): CaseSuggestion {
  return { title, input, expected_phrases: ["병원"] };
}

/** 지시문을 적어 둔 문서 — 지시문이 있어야 지어 달라고 할 수 있다. */
function specWithInstruction(): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.map((node) =>
      node.id === "clinical-agent"
        ? { ...node, config: { ...node.config, instruction: "환자에게 쉬운 말로 답해요" } }
        : node,
    ),
  } as AgentSpec;
}

/** 지시문을 가질 수 있는 노드가 하나도 없는 문서. */
function specWithoutPrompts(): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.filter((node) => !node.type.startsWith("llm.")),
    edges: [],
  } as AgentSpec;
}

/** 지시문 자리는 있으나 공백만 적어 둔 문서 — 아직 아무 말도 적지 않은 것과 같다. */
function specWithBlankInstruction(): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.map((node) =>
      node.id === "clinical-agent" ? { ...node, config: { ...node.config, instruction: "   " } } : node,
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
    caseSaveNotice: null,
    batchId: null,
    batchStatus: "idle",
    batch: null,
    evalAdvanced: false,
    evalBatchHistory: null,
    evalBatchHistoryLoading: false,
    evalBatchHistoryFailure: null,
    evalSelectedHistoryId: null,
    suggesting: false,
    suggestions: null,
    suggestAskedFor: 0,
    suggestChosen: [],
    suggestHowMany: SUGGEST_DEFAULT,
    suggestEdgeCases: true,
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

function askButton() {
  return screen.getByRole("button", { name: "지어 줘" });
}

describe("지어 달라고 청하는 줄", () => {
  it("몇 개를 지어 줄지 묻고, 까다로운 경우를 섞을지도 묻는다", async () => {
    await openPanel(specWithInstruction());

    expect(screen.getByLabelText("몇 개 지어 볼까요")).toHaveValue(SUGGEST_DEFAULT);
    expect(screen.getByLabelText("까다로운 경우도 섞기")).toBeChecked();
  });

  it("한 번에 지을 수 없는 개수는 그릴 때 막고 까닭을 말한다", async () => {
    await openPanel(specWithInstruction());

    act(() => store().setSuggestHowMany(21));

    expect(askButton()).toBeDisabled();
    expect(askButton()).toHaveAttribute("title", "한 번에 1개부터 20개까지 지어 드릴 수 있어요");
    expect(screen.getByText("한 번에 1개부터 20개까지 지어 드릴 수 있어요")).toBeInTheDocument();
  });

  it("0개도 같은 자리에서 같은 까닭으로 막힌다", async () => {
    await openPanel(specWithInstruction());

    act(() => store().setSuggestHowMany(0));

    expect(askButton()).toBeDisabled();
  });

  it("지시문 자리는 있으나 아직 아무 말도 적지 않았으면 지어 줄 수 없다고 말한다", async () => {
    // 예제 그래프 그대로 — 단계는 있고 지시문은 비어 있다(같은 화면의 지시문 카드도 그렇게 말한다).
    await openPanel(example);

    expect(askButton()).toBeDisabled();
    expect(askButton()).toHaveAttribute(
      "title",
      "지시문이 있어야 지어 줄 수 있어요 — 단계에 무엇을 하라고 적어 주세요",
    );
  });

  it("공백만 적어 둔 지시문도 아직 적지 않은 것으로 본다 — 실행기와 같은 판정이다", async () => {
    await openPanel(specWithBlankInstruction());

    expect(askButton()).toBeDisabled();
  });

  it("지시문을 가질 수 있는 노드가 아예 없는 그래프에서도 같은 자리에서 같은 말을 한다", async () => {
    await openPanel(specWithoutPrompts());

    expect(askButton()).toBeDisabled();
  });

  it("여러 단계 중 한 곳에만 지시문이 적혀 있어도 지어 줄 수 있다", async () => {
    await openPanel(specWithInstruction());

    expect(askButton()).toBeEnabled();
  });

  it("지어 보는 동안에는 다시 청할 수 없고 그렇다고 말한다", async () => {
    await openPanel(specWithInstruction());

    act(() => useEditor.setState({ suggesting: true }));

    expect(askButton()).toBeDisabled();
    expect(screen.getByText("지어 보는 중이에요")).toBeInTheDocument();
  });
});

describe("지어 온 제안 고르기", () => {
  async function withSuggestions(suggestions: CaseSuggestion[], askedFor = suggestions.length) {
    await openPanel(specWithInstruction());
    act(() => useEditor.setState({ suggestions, suggestAskedFor: askedFor, suggestChosen: [] }));
  }

  it("지어 온 만큼 카드가 서고, 한 장마다 무엇을 넣고 무슨 말이 있어야 하는지 읽힌다", async () => {
    await withSuggestions([suggestion("첫 시험"), suggestion("둘째 시험")]);

    expect(screen.getByText("첫 시험")).toBeInTheDocument();
    expect(
      screen.getAllByText("넣을 값: 머리가 아파요 → 있어야 할 말: 병원"),
    ).toHaveLength(2);
  });

  it("넣을 값이 없는 제안도 조용히 비어 있지 않다", async () => {
    await withSuggestions([suggestion("넣을 것 없는 시험", {})]);

    expect(screen.getByText("넣을 값 없음 → 있어야 할 말: 병원")).toBeInTheDocument();
  });

  it("청한 수보다 적게 왔으면 그렇다고 사실대로 말한다", async () => {
    await withSuggestions([suggestion("첫 시험"), suggestion("둘째 시험"), suggestion("셋째 시험")], 5);

    expect(screen.getByText("5개 중 3개를 지었어요 — 담을 것만 골라요")).toBeInTheDocument();
  });

  it("아무것도 고르지 않았으면 담을 수 없고 그 까닭을 말한다", async () => {
    await withSuggestions([suggestion("첫 시험")]);

    const keep = screen.getByRole("button", { name: "고른 것 담기" });
    expect(keep).toBeDisabled();
    expect(keep).toHaveAttribute("title", "담을 시험을 먼저 골라 주세요");
  });

  it("카드를 누르면 담을 것으로 골라지고, 다시 누르면 놓는다", async () => {
    await withSuggestions([suggestion("첫 시험"), suggestion("둘째 시험")]);

    await userEvent.click(screen.getByText("둘째 시험"));
    expect(store().suggestChosen).toEqual([1]);

    await userEvent.click(screen.getByText("둘째 시험"));
    expect(store().suggestChosen).toEqual([]);
  });

  it("고른 것을 담으면 그것만 묶음에 들어간다", async () => {
    await withSuggestions([suggestion("첫 시험"), suggestion("둘째 시험")]);

    await userEvent.click(screen.getByText("첫 시험"));
    await userEvent.click(screen.getByRole("button", { name: "고른 것 담기" }));

    expect(store().dataset?.cases?.map((one) => one.title)).toEqual(["첫 시험"]);
  });

  it("지은 것을 버리면 제안도 고른 것도 남지 않는다 — 묶음은 그대로다", async () => {
    await withSuggestions([suggestion("첫 시험")]);

    await userEvent.click(screen.getByText("첫 시험"));
    await userEvent.click(screen.getByRole("button", { name: "지은 것 버리기" }));

    expect(store().suggestions).toBeNull();
    expect(store().dataset?.cases ?? []).toEqual([]);
  });
});
