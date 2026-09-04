import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { providerDraftFixture, withAHumanGate } from "./architect-fixtures";
import type { ArchitectDraftOutcome } from "../src/api/architect";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { PatternAnswer } from "../src/generated/pattern_answer";
import type { PatternAsk } from "../src/generated/pattern_ask";
import type { SkippedPattern } from "../src/generated/skipped_pattern";
import { useEditor } from "../src/store/editor";

const THREE_ASKS: PatternAsk[] = [
  {
    pattern_id: "react",
    question: { ko: "무언가 찾아봐야 하나요?", en: "Does it look things up?" },
    cost: { ko: "실행이 길어져요", en: "Runs take longer" },
  },
  {
    pattern_id: "human_gate",
    question: { ko: "사람이 먼저 확인해야 하나요?", en: "Should a person approve?" },
    cost: { ko: "확인에서 기다려요", en: "It waits at the check" },
  },
  {
    pattern_id: "router",
    question: { ko: "여러 갈래인가요?", en: "Are there several branches?" },
    cost: { ko: "모델 호출이 한 번 더 들어요", en: "One more model call" },
  },
];

/** 첫 부름은 물음을, 답을 실은 부름은 초안을 돌려주는 서버 자리 (P6a). */
function serverThatAsksFirst(
  skippedPatterns: SkippedPattern[] = [],
  shape: (spec: AgentSpec) => AgentSpec = (spec) => spec,
) {
  const sent: PatternAnswer[][] = [];
  async function requestArchitectDraft(
    request: string,
    draftId: string,
    answers: PatternAnswer[] = [],
  ): Promise<ArchitectDraftOutcome> {
    sent.push(answers);
    if (answers.length === 0) return { asks: THREE_ASKS };
    const drafted = await providerDraftFixture(request, draftId);
    return drafted.draft
      ? { ...drafted, draft: shape(drafted.draft), skippedPatterns }
      : drafted;
  }
  return { requestArchitectDraft, sent };
}

async function askTheQuestions(requestArchitectDraft: unknown) {
  const user = userEvent.setup();
  useEditor.setState({ requestArchitectDraft } as never);
  render(<App />);
  await user.type(screen.getByRole("textbox", { name: "무엇을 만들까요" }), "answer questions");
  await user.click(screen.getByRole("button", { name: "초안 만들기" }));
  return user;
}

beforeEach(() =>
  useEditor.setState({
    spec: null,
    nodes: [],
    edges: [],
    architectMode: "guided",
    architectRequest: "",
    architectDraft: null,
    architectReview: null,
    architectError: null,
    architectLoading: false,
    architectAsks: [],
    architectAnswers: {},
    architectAskAt: 0,
    architectSkippedPatterns: [],
    requestArchitectDraft: providerDraftFixture,
    firstStepsDismissed: false,
  }),
);

describe("Architect asks back", () => {
  it("asks one question at a time and says which one it is", async () => {
    const { requestArchitectDraft } = serverThatAsksFirst();
    const user = await askTheQuestions(requestArchitectDraft);

    expect(await screen.findByRole("heading", { name: "무언가 찾아봐야 하나요?" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "사람이 먼저 확인해야 하나요?" })).not.toBeInTheDocument();
    expect(screen.getByText("실행이 길어져요")).toBeInTheDocument();
    expect(screen.getByText("3개 중 1번째")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "네" }));

    expect(screen.getByRole("heading", { name: "사람이 먼저 확인해야 하나요?" })).toBeInTheDocument();
    expect(screen.getByText("3개 중 2번째")).toBeInTheDocument();
  });

  it("leaves the first-steps card out while it is asking", async () => {
    const { requestArchitectDraft } = serverThatAsksFirst();
    await askTheQuestions(requestArchitectDraft);
    await screen.findByRole("heading", { name: "무언가 찾아봐야 하나요?" });

    expect(screen.queryByText("첫 그래프, 네 걸음이면 돼요")).not.toBeInTheDocument();
  });

  it("never shows the code name of the shape it is asking about", async () => {
    const { requestArchitectDraft } = serverThatAsksFirst();
    await askTheQuestions(requestArchitectDraft);
    const asking = (await screen.findByRole("heading", { name: "무언가 찾아봐야 하나요?" })).closest("section");

    expect(asking?.textContent).not.toContain("react");
  });

  it("carries every answer into the second call", async () => {
    const { requestArchitectDraft, sent } = serverThatAsksFirst();
    const user = await askTheQuestions(requestArchitectDraft);

    await user.click(await screen.findByRole("button", { name: "네" }));
    await user.click(screen.getByRole("button", { name: "아니요" }));
    await user.click(screen.getByRole("button", { name: "잘 모르겠어요" }));

    expect(sent[1]).toEqual([
      { pattern_id: "react", answer: "yes" },
      { pattern_id: "human_gate", answer: "no" },
      { pattern_id: "router", answer: "skipped" },
    ]);
    expect(await screen.findByRole("heading", { name: "초안 확인" })).toBeInTheDocument();
  });

  it("closes the card on Escape and starts over when it opens again", async () => {
    const { requestArchitectDraft } = serverThatAsksFirst();
    const user = await askTheQuestions(requestArchitectDraft);
    await screen.findByRole("heading", { name: "무언가 찾아봐야 하나요?" });

    await user.keyboard("{Escape}");

    expect(useEditor.getState().architectMode).toBe("closed");
    expect(useEditor.getState().architectAsks).toEqual([]);
    expect(useEditor.getState().architectAnswers).toEqual({});

    useEditor.setState({ architectMode: "guided" });
    expect(await screen.findByRole("textbox", { name: "무엇을 만들까요" })).toHaveValue("answer questions");
    expect(screen.queryByRole("heading", { name: "무언가 찾아봐야 하나요?" })).not.toBeInTheDocument();
  });

  it("applies a draft that stops for a person", async () => {
    const { requestArchitectDraft } = serverThatAsksFirst([], withAHumanGate);
    const user = await askTheQuestions(requestArchitectDraft);

    await user.click(await screen.findByRole("button", { name: "네" }));
    await user.click(screen.getByRole("button", { name: "잘 모르겠어요" }));
    await user.click(screen.getByRole("button", { name: "잘 모르겠어요" }));
    await screen.findByRole("heading", { name: "초안 확인" });

    expect(screen.getByRole("button", { name: "캔버스에 적용" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "캔버스에 적용" }));
    expect(useEditor.getState().nodes.map((node) => node.id)).toContain("answer-gate");
  });

  it("hides the first-steps card while the draft is being reviewed too", async () => {
    const { requestArchitectDraft } = serverThatAsksFirst();
    const user = await askTheQuestions(requestArchitectDraft);
    await user.click(await screen.findByRole("button", { name: "네" }));
    await user.click(screen.getByRole("button", { name: "네" }));
    await user.click(screen.getByRole("button", { name: "네" }));
    await screen.findByRole("heading", { name: "초안 확인" });

    expect(screen.queryByText("첫 그래프, 네 걸음이면 돼요")).not.toBeInTheDocument();
  });

  it("offers a way back to the request on the last question", async () => {
    const { requestArchitectDraft } = serverThatAsksFirst();
    const user = await askTheQuestions(requestArchitectDraft);
    await screen.findByRole("heading", { name: "무언가 찾아봐야 하나요?" });
    expect(screen.queryByRole("button", { name: "다시 적기" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "네" }));
    await user.click(screen.getByRole("button", { name: "네" }));
    await user.click(screen.getByRole("button", { name: "다시 적기" }));

    expect(await screen.findByRole("textbox", { name: "무엇을 만들까요" })).toHaveValue("answer questions");
    expect(useEditor.getState().architectAsks).toEqual([]);
  });

  it("says on the review card which shape it could not add", async () => {
    const { requestArchitectDraft } = serverThatAsksFirst([
      {
        pattern_id: "react",
        why: { ko: "쓸 도구를 먼저 골라 주세요.", en: "Pick the tools first." },
      },
    ]);
    const user = await askTheQuestions(requestArchitectDraft);

    await user.click(await screen.findByRole("button", { name: "네" }));
    await user.click(screen.getByRole("button", { name: "네" }));
    await user.click(screen.getByRole("button", { name: "네" }));

    expect(await screen.findByText("이 모양은 넣지 못했어요 — 쓸 도구를 먼저 골라 주세요.")).toBeInTheDocument();
  });
});
