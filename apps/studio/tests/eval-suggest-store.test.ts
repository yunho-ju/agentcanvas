// AI가 지어 준 제안은 담아야 묶음에 들어간다 — 승인 전에 dataset이 바뀌는 길은 없다 (EVAL-2).
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import {
  SUGGEST_DEFAULT,
  type CaseSuggestion,
  type SuggestOutcome,
} from "../src/eval/caseSuggestions";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";
import { serveEval } from "./fakeEvalServer";
import { serveSaves, settle } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function suggestion(title: string): CaseSuggestion {
  return { title, input: { question: "머리가 아파요" }, expected_phrases: ["병원"] };
}

/** 지어 달라는 청을 받아 적어 둔 답을 내주는 대역 — 무엇을 청했는지도 기억한다. */
function serveSuggestions(outcome: SuggestOutcome) {
  const asked: { howMany: number; includeEdgeCases: boolean; existingTitles: string[] }[] = [];
  useEditor.setState({
    fetchCaseSuggestions: async (_spec, howMany, includeEdgeCases, existingTitles) => {
      asked.push({ howMany, includeEdgeCases, existingTitles });
      return outcome;
    },
  });
  return asked;
}

async function openPanel() {
  store().loadSpec(example);
  const server = serveEval();
  store().enterEvalMode();
  await settle();
  return server;
}

beforeEach(async () => {
  serveSaves();
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
    caseSaveNotice: null,
    suggestions: null,
    suggestChosen: [],
    suggesting: false,
    suggestHowMany: SUGGEST_DEFAULT,
    suggestEdgeCases: true,
  });
});

describe("지어 달라고 하기", () => {
  it("지어 온 제안은 화면 몫으로만 들어온다 — 묶음은 그대로다", async () => {
    await openPanel();
    serveSuggestions({ payload: { askedFor: 5, suggestions: [suggestion("첫 시험")] } });

    await store().suggestCases();

    expect(store().suggestions).toHaveLength(1);
    expect(store().dataset?.cases ?? []).toEqual([]);
  });

  it("몇 개를 청했는지 그대로 들고 있다 — 화면이 '5개 중 1개'를 사실대로 말한다", async () => {
    await openPanel();
    serveSuggestions({ payload: { askedFor: 5, suggestions: [suggestion("첫 시험")] } });

    await store().suggestCases();

    expect(store().suggestAskedFor).toBe(5);
  });

  it("이미 지어 둔 제목을 함께 보낸다 — 같은 것을 또 짓지 않게", async () => {
    await openPanel();
    useEditor.setState({
      dataset: { id: "ds", name: "묶음", cases: [{ id: "case", title: "이미 있는 시험", input: {}, expected_phrases: ["병원"] }] },
    });
    const asked = serveSuggestions({ payload: { askedFor: 1, suggestions: [suggestion("첫 시험")] } });
    store().setSuggestHowMany(1);
    store().setSuggestEdgeCases(false);

    await store().suggestCases();

    expect(asked).toEqual([{ howMany: 1, includeEdgeCases: false, existingTitles: ["이미 있는 시험"] }]);
  });

  it("지어 오지 못하면 쉬운 말로 말하고 묶음은 건드리지 않는다", async () => {
    await openPanel();
    serveSuggestions({ failure: { key: "eval.suggest.failed" } });

    await store().suggestCases();

    expect(store().caseSaveNotice?.message.key).toBe("eval.suggest.failed");
    expect(store().suggestions).toBeNull();
    expect(store().dataset?.cases ?? []).toEqual([]);
  });

  it("지어 달라고 할 수 없는 개수면 아예 묻지 않는다", async () => {
    await openPanel();
    const asked = serveSuggestions({ payload: { askedFor: 0, suggestions: [] } });
    store().setSuggestHowMany(0);

    await store().suggestCases();

    expect(asked).toEqual([]);
  });
});

describe("골라 담기", () => {
  async function threeSuggestions() {
    const server = await openPanel();
    serveSuggestions({
      payload: {
        askedFor: 3,
        suggestions: [suggestion("첫 시험"), suggestion("둘째 시험"), suggestion("셋째 시험")],
      },
    });
    await store().suggestCases();
    return server;
  }

  it("고른 것만 묶음에 들어가고 나머지는 버려진다", async () => {
    await threeSuggestions();

    store().toggleSuggestion(0);
    store().toggleSuggestion(2);
    await store().keepChosenSuggestions();

    expect(store().dataset?.cases?.map((one) => one.title)).toEqual(["첫 시험", "셋째 시험"]);
    expect(store().suggestions).toBeNull();
  });

  it("담은 것은 서버에도 맡긴다 — 케이스를 손으로 저장할 때와 같은 길이다", async () => {
    const server = await threeSuggestions();

    store().toggleSuggestion(1);
    await store().keepChosenSuggestions();

    expect([...server.datasets.values()][0]?.cases?.map((one) => one.title)).toEqual(["둘째 시험"]);
  });

  it("아무것도 고르지 않고 담으면 아무 일도 없다", async () => {
    await threeSuggestions();

    await store().keepChosenSuggestions();

    expect(store().dataset?.cases ?? []).toEqual([]);
    expect(store().suggestions).toHaveLength(3);
  });

  it("이미 있는 시험과 제목이 같아도 담긴다 — 이름은 저마다 다르다", async () => {
    await openPanel();
    serveSuggestions({ payload: { askedFor: 1, suggestions: [suggestion("같은 제목")] } });
    await store().suggestCases();
    store().toggleSuggestion(0);
    await store().keepChosenSuggestions();

    serveSuggestions({ payload: { askedFor: 1, suggestions: [suggestion("같은 제목")] } });
    await store().suggestCases();
    store().toggleSuggestion(0);
    await store().keepChosenSuggestions();

    const cases = store().dataset?.cases ?? [];
    expect(cases.map((one) => one.title)).toEqual(["같은 제목", "같은 제목"]);
    expect(new Set(cases.map((one) => one.id)).size).toBe(2);
  });
});

describe("담기 전에 자리를 뜨면", () => {
  it("패널을 떠나면 지어 둔 제안은 남지 않는다 — 저장된 것도 없다", async () => {
    const server = await openPanel();
    serveSuggestions({ payload: { askedFor: 2, suggestions: [suggestion("첫 시험"), suggestion("둘째 시험")] } });
    await store().suggestCases();
    store().toggleSuggestion(0);

    store().leaveEvalMode();

    expect(store().suggestions).toBeNull();
    expect(store().suggestChosen).toEqual([]);
    expect([...server.datasets.values()]).toEqual([]);
  });

  it("떠나며 버린 제안은 다시 들어와도 되살아나지 않는다 — 늦게 온 답은 버린다", async () => {
    await openPanel();
    let answer: (outcome: SuggestOutcome) => void = () => {};
    useEditor.setState({
      fetchCaseSuggestions: () =>
        new Promise<SuggestOutcome>((resolve) => {
          answer = resolve;
        }),
    });
    const asking = store().suggestCases();

    store().leaveEvalMode();
    store().enterEvalMode();
    await settle();
    answer({ payload: { askedFor: 1, suggestions: [suggestion("첫 시험")] } });
    await asking;

    expect(store().suggestions).toBeNull();
  });

  it("다른 문서를 열면 앞 문서의 제안은 따라오지 않는다", async () => {
    await openPanel();
    serveSuggestions({ payload: { askedFor: 1, suggestions: [suggestion("첫 시험")] } });
    await store().suggestCases();

    store().abandonEval();

    expect(store().suggestions).toBeNull();
  });
});
