// 지시문 하나를 skill로 만든다 (DESIGN §7 skill-make-card).
// 승인 전에는 문서가 그대로이고, 승인 1회로 문서의 skill과 그 단계가 따르는 목록이 함께 선다.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { SkillDef } from "../src/generated/skill_def";
import { SKILL_DESCRIPTION_MAX_LENGTH } from "../src/graph/skillMarkdown";
import { useEditor } from "../src/store/editor";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;
const AGENT = "clinical-agent";
const INSTRUCTION = "Answer in short sentences and leave out jargon.";

const DRAFT = [
  "---",
  "name: plain-answer",
  "description: Use when you answer a person",
  "---",
  "",
  "# plain-answer",
  "",
  "Answer in short sentences.",
  "",
].join("\n");

function store() {
  return useEditor.getState();
}

function held(): SkillDef[] {
  return store().spec?.skills ?? [];
}

function wornBy(): string[] {
  const node = store().nodes.find((one) => one.id === AGENT);
  const worn = node?.data.spec.config?.skill_refs;
  return Array.isArray(worn) ? (worn as string[]) : [];
}

function aSkill(name: string, description: string, body = "Answer plainly.\n"): SkillDef {
  return {
    ref: `skill://${name}@1`,
    name,
    description,
    body,
    license: null,
    compatibility: null,
    metadata: {},
    references: [],
    source: null,
  };
}

/** 그 단계에 지시문이 적혀 있는 문서를 열고 그 단계를 고른다. */
function openWith(instruction: string, skills: SkillDef[] = []) {
  act(() =>
    store().loadSpec({
      ...example,
      skills,
      nodes: example.nodes.map((node) =>
        node.id === AGENT ? { ...node, config: { ...node.config, instruction } } : node,
      ),
    }),
  );
  act(() => store().select("node", AGENT));
}

function entry() {
  return screen.getByRole("button", { name: "skill로 저장" });
}

async function openCard() {
  await userEvent.click(entry());
}

async function fillAndDraft(name = "plain-answer") {
  await openCard();
  await userEvent.type(screen.getByRole("textbox", { name: "이름" }), name);
  await userEvent.type(
    screen.getByRole("textbox", { name: "언제 쓰나요" }),
    "Use when you answer a person",
  );
  await userEvent.click(screen.getByRole("button", { name: "초안 만들기" }));
}

beforeEach(() => {
  useEditor.setState({
    runEvents: [],
    runHistory: [],
    activeRunId: null,
    evalPanelOpen: false,
    draftSkillOnServer: async () => ({ text: DRAFT, draftedBy: "model" as const }),
  });
  openWith(INSTRUCTION);
});

describe("입구 — 지시문 칸의 [skill로 저장]", () => {
  it("적힌 것이 없으면 잠기고 무엇이 필요한지 말한다", () => {
    openWith("   \n  ");
    render(<App />);

    expect(entry()).toBeDisabled();
    expect(entry()).toHaveAttribute(
      "title",
      "지시문을 먼저 적어야 skill로 만들 수 있어요",
    );
  });

  it("실행을 보는 동안에는 잠기고 그 까닭을 말한다", async () => {
    render(<App />);

    await act(async () => {
      await runOnServer({ runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") });
    });

    expect(entry()).toBeDisabled();
    expect(entry().getAttribute("title")).toMatch(/실행/);
  });

  it("누르면 그 지시문을 들고 만들기 카드가 선다", async () => {
    render(<App />);

    await openCard();

    const card = screen.getByRole("dialog", { name: "이 지시문을 skill로 만들까요" });
    expect(within(card).getByText(new RegExp(INSTRUCTION))).toBeInTheDocument();
    // 처음 만나는 말은 뜻을 함께 말한다 (용어 원칙).
    expect(within(card).getByText(/일하는 방법을 적어 둔 글/)).toBeInTheDocument();
  });
});

describe("적는 자리", () => {
  it("이름 규칙을 어기면 한 줄로 말하고 초안 만들기가 잠긴다 — 문서는 그대로다", async () => {
    render(<App />);
    await openCard();

    await userEvent.type(screen.getByRole("textbox", { name: "이름" }), "Plain Answer");
    await userEvent.type(
      screen.getByRole("textbox", { name: "언제 쓰나요" }),
      "Use when you answer a person",
    );

    const card = screen.getByRole("dialog", { name: "이 지시문을 skill로 만들까요" });
    expect(within(card).getByRole("alert")).toHaveTextContent(
      /소문자·숫자·하이픈만 쓸 수 있어요/,
    );
    expect(within(card).getByRole("button", { name: "초안 만들기" })).toBeDisabled();
    expect(held()).toEqual([]);
  });

  it("언제 쓰는지 적기 전에는 초안 만들기가 잠기고 까닭을 말한다", async () => {
    render(<App />);
    await openCard();

    await userEvent.type(screen.getByRole("textbox", { name: "이름" }), "plain-answer");

    const draft = screen.getByRole("button", { name: "초안 만들기" });
    expect(draft).toBeDisabled();
    expect(draft).toHaveAttribute("title", "언제 쓰는 글인지 한 줄로 적어 주세요");
  });

  it("쓰임새가 너무 길면 한 줄로 말하고 초안 만들기가 잠긴다 — 서버가 물리게 두지 않는다", async () => {
    render(<App />);
    await openCard();
    await userEvent.type(screen.getByRole("textbox", { name: "이름" }), "plain-answer");

    act(() => store().setSkillMakeDescription("x".repeat(SKILL_DESCRIPTION_MAX_LENGTH + 1)));

    const card = screen.getByRole("dialog", { name: "이 지시문을 skill로 만들까요" });
    expect(within(card).getByRole("alert")).toHaveTextContent(/한 줄로 짧게/);
    expect(within(card).getByRole("button", { name: "초안 만들기" })).toBeDisabled();
  });

  it("비슷한 skill을 두어 줄 보여 주고, 누르면 그 자리에서 본문이 펼쳐진다", async () => {
    openWith(INSTRUCTION, [
      aSkill(
        "answer-plainly",
        "Use when you answer a person and it must be easy to read.",
        "Write short sentences. Leave out jargon.\n",
      ),
    ]);
    render(<App />);
    await openCard();

    const references = screen.getByRole("group", { name: "비슷한 skill 참고하기" });
    const row = within(references).getByRole("button", { name: /answer-plainly/ });
    expect(within(references).getAllByRole("button").length).toBeLessThanOrEqual(3);
    expect(screen.queryByText(/Leave out jargon\./)).not.toBeInTheDocument();

    await userEvent.click(row);

    expect(screen.getByText(/Leave out jargon\./)).toBeInTheDocument();
  });

  it("비슷한 것이 하나도 없으면 참고 목록 자체가 없다 — 빈 목록을 던지지 않는다", async () => {
    openWith("Zahlen addieren und Rechnungen summieren.");
    render(<App />);
    await openCard();

    expect(
      screen.queryByRole("group", { name: "비슷한 skill 참고하기" }),
    ).not.toBeInTheDocument();
  });
});

describe("초안", () => {
  it("모델이 지은 초안을 미리보기로 보여 주고, 문서는 아직 그대로다", async () => {
    render(<App />);

    await fillAndDraft();

    const card = screen.getByRole("dialog", { name: "이 skill을 넣고 따르게 할까요" });
    expect(within(card).getByText("Use when you answer a person")).toBeInTheDocument();
    expect(within(card).getByText(/Answer in short sentences\./)).toBeInTheDocument();
    expect(within(card).getByText("넣으면 이 단계가 바로 따르게 돼요")).toBeInTheDocument();
    expect(within(card).queryByText(/부를 모델이 없어/)).not.toBeInTheDocument();
    expect(held()).toEqual([]);
  });

  it("부를 모델이 없어 틀만 잡았으면 그렇게 말한다 — 실패라고 하지 않는다", async () => {
    useEditor.setState({
      draftSkillOnServer: async () => ({ text: DRAFT, draftedBy: "scaffold" as const }),
    });
    render(<App />);

    await fillAndDraft();

    const card = screen.getByRole("dialog", { name: "이 skill을 넣고 따르게 할까요" });
    expect(
      within(card).getByText("부를 모델이 없어 틀만 잡았어요 — 본문은 지시문 그대로예요"),
    ).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "문서에 넣고 따르기" })).toBeEnabled();
  });

  // 읽지 못한 초안을 말없이 삼키면 [초안 만들기]는 아무 일도 하지 않는 손잡이가 된다 (§9).
  it("지어 온 글을 읽지 못하면 그 까닭을 쉬운 말로 말하고 적은 것을 잃지 않는다", async () => {
    useEditor.setState({
      draftSkillOnServer: async () => ({
        text: "Just some prose with no front matter at all.\n",
        draftedBy: "model" as const,
      }),
    });
    render(<App />);

    await fillAndDraft();

    const card = screen.getByRole("dialog", { name: "이 지시문을 skill로 만들까요" });
    expect(within(card).getByRole("alert")).toHaveTextContent(/맨 위 칸을 읽지 못했어요/);
    expect(within(card).getByRole("alert").textContent).not.toContain("skill.");
    expect(screen.getByRole("textbox", { name: "이름" })).toHaveValue("plain-answer");
    expect(screen.getByRole("textbox", { name: "언제 쓰나요" })).toHaveValue(
      "Use when you answer a person",
    );
    expect(held()).toEqual([]);
  });

  it("지어 오지 못하면 쉬운 말로 말하고 적은 것을 잃지 않는다", async () => {
    useEditor.setState({
      draftSkillOnServer: async () => ({ failure: { key: "skillMake.error.offline" } }),
    });
    render(<App />);

    await fillAndDraft();

    expect(screen.getByRole("alert")).toHaveTextContent(/서버에 닿지 못했어요/);
    expect(screen.getByRole("textbox", { name: "이름" })).toHaveValue("plain-answer");
    expect(screen.getByRole("textbox", { name: "언제 쓰나요" })).toHaveValue(
      "Use when you answer a person",
    );
  });
});

describe("승인", () => {
  it("문서에 서고 그 단계가 곧바로 따른다 — 되돌리기 한 걸음으로 둘 다 물러난다", async () => {
    render(<App />);
    await fillAndDraft();
    const steps = store().undoStack.length;

    await userEvent.click(screen.getByRole("button", { name: "문서에 넣고 따르기" }));

    expect(
      screen.queryByRole("dialog", { name: "이 skill을 넣고 따르게 할까요" }),
    ).not.toBeInTheDocument();
    expect(held().map((one) => one.name)).toEqual(["plain-answer"]);
    expect(wornBy()).toEqual(["skill://plain-answer@1"]);
    // 그 자리에서 보인다 — 설정 카드의 체크 목록에 체크된 채 선다.
    expect(screen.getByRole("checkbox", { name: /plain-answer/ })).toBeChecked();
    expect(store().undoStack.length).toBe(steps + 1);

    act(() => store().undo());
    expect(held()).toEqual([]);
    expect(wornBy()).toEqual([]);
  });

  it("같은 이름이 이미 있으면 조용히 덮지 않는다 — 줄 수로 말하고 바꿔 넣는다", async () => {
    openWith(INSTRUCTION, [
      aSkill("plain-answer", "the one already here", "one\ntwo\nthree\nfour\nfive\n"),
    ]);
    render(<App />);
    await fillAndDraft();

    const card = screen.getByRole("dialog", { name: "이 skill을 넣고 따르게 할까요" });
    expect(
      within(card).queryByRole("button", { name: "문서에 넣고 따르기" }),
    ).toBeNull();
    expect(within(card).getByText(/지금 판은 5줄/)).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "바꿔 넣고 따르기" }));

    expect(held()).toHaveLength(1);
    expect(held()[0].description).toBe("Use when you answer a person");
    expect(wornBy()).toEqual(["skill://plain-answer@1"]);
  });

  it("다시 만들기를 고르면 적던 자리로 돌아가고 문서는 그대로다", async () => {
    render(<App />);
    await fillAndDraft();

    await userEvent.click(screen.getByRole("button", { name: "다시 만들기" }));

    expect(
      screen.getByRole("dialog", { name: "이 지시문을 skill로 만들까요" }),
    ).toBeInTheDocument();
    expect(held()).toEqual([]);
  });
});

describe("승인 뒤 — 지시문 칸 아래", () => {
  async function approve() {
    render(<App />);
    await fillAndDraft();
    await userEvent.click(screen.getByRole("button", { name: "문서에 넣고 따르기" }));
  }

  it("지시문을 그대로 두었다고 말하고, 시험을 지어 볼 수 있다고 알려 준다", async () => {
    await approve();

    expect(screen.getByText(/지시문은 그대로 두었어요/)).toBeInTheDocument();
    expect(screen.getByText(/시험해 보기에서 이 skill을 시험할 케이스/)).toBeInTheDocument();
    // 지시문은 정말 그대로다 — 만든 일이 적어 둔 말을 건드리지 않는다.
    expect(screen.getByRole("textbox", { name: "지시문" })).toHaveValue(INSTRUCTION);
  });

  it("[시험 짓기]는 시험해 보기로 데려가 지어 달라 청하는 자리에 손을 놓는다", async () => {
    await approve();

    await userEvent.click(screen.getByRole("button", { name: "시험 짓기" }));

    expect(store().evalPanelOpen).toBe(true);
    expect(screen.getByRole("spinbutton", { name: "몇 개 지어 볼까요" })).toHaveFocus();
  });

  // 되돌리기로 그 걸음이 물러났으면 그 말도 참말이 아니다 — 문서에 없는 skill을 시험하러 보내지 않는다.
  it("되돌리면 그 말도 함께 물러나고, 다시하기로 함께 돌아온다", async () => {
    await approve();

    act(() => store().undo());
    expect(screen.queryByText(/지시문은 그대로 두었어요/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "시험 짓기" })).not.toBeInTheDocument();

    act(() => store().redo());
    expect(screen.getByText(/지시문은 그대로 두었어요/)).toBeInTheDocument();
  });

  it("닫으면 그 말은 사라진다", async () => {
    await approve();

    await userEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(screen.queryByText(/지시문은 그대로 두었어요/)).not.toBeInTheDocument();
  });

  it("다른 단계를 고르면 그 말은 그 자리에 남지 않는다", async () => {
    await approve();

    act(() => store().select("node", "triage"));

    expect(screen.queryByText(/지시문은 그대로 두었어요/)).not.toBeInTheDocument();
  });
});
