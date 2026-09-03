// 붙여 넣거나 주소를 주면 skill이 된다 (DESIGN §7 skill-import-card).
// 승인 전에는 문서가 그대로다. 파서가 읽지 못하면 코드가 아니라 쉬운 말이 나온다.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { SkillDef } from "../src/generated/skill_def";
import { STARTER_SKILLS } from "../src/registry/starterSkills";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

const PASTED = [
  "---",
  "name: plain-answer",
  "description: use it when you answer a person",
  "license: MIT",
  "---",
  "",
  "# Answer plainly",
  "",
  "Say it in one sentence.",
  "",
].join("\n");

function store() {
  return useEditor.getState();
}

function held(): SkillDef[] {
  return store().spec?.skills ?? [];
}

function openWith(skills: SkillDef[] = []) {
  act(() => store().loadSpec({ ...example, skills }));
}

async function openCard() {
  await userEvent.click(screen.getByRole("button", { name: "skill" }));
  await userEvent.click(screen.getByRole("button", { name: "skill 가져오기" }));
}

function box() {
  return screen.getByRole("textbox", { name: "붙여 넣은 글" });
}

async function pasteAndRead(text = PASTED) {
  await openCard();
  await userEvent.type(box(), text.replace(/[{[]/g, "$&$&"));
  await userEvent.click(screen.getByRole("button", { name: "읽어 보기" }));
}

/** 붙여 넣는 대신 값을 그대로 놓는다 — 긴 글에 userEvent.type을 쓰지 않는다. */
async function readSource(text: string) {
  await openCard();
  act(() => store().setSkillImportSource(text));
  await userEvent.click(screen.getByRole("button", { name: "읽어 보기" }));
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  openWith();
});

describe("가져오기 카드의 입력 상태", () => {
  it("무엇을 주는지 두 가지 중에서 고른다", async () => {
    render(<App />);

    await openCard();

    const card = screen.getByRole("dialog", { name: "skill을 가져올까요" });
    for (const name of ["글 붙여넣기", "주소"]) {
      expect(within(card).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(card).getByText(/skills\.sh 주소를 주세요/)).toBeInTheDocument();
  });

  it("적기 전에는 무엇이 필요한지 말하며 기다린다", async () => {
    render(<App />);

    await openCard();

    const read = screen.getByRole("button", { name: "읽어 보기" });
    expect(read).toBeDisabled();
    expect(read).toHaveAttribute("title", "먼저 붙여 넣거나 주소를 적어 주세요");
  });
});

describe("붙여 넣은 글을 읽는다", () => {
  it("읽으면 이름·쓰임새·본문 미리보기와 길이를 보여 주고, 문서는 아직 그대로다", async () => {
    render(<App />);

    await pasteAndRead();

    const card = screen.getByRole("dialog", { name: "이 skill을 넣을까요" });
    expect(within(card).getByText("plain-answer")).toBeInTheDocument();
    expect(within(card).getByText("use it when you answer a person")).toBeInTheDocument();
    expect(within(card).getByText(/Say it in one sentence\./)).toBeInTheDocument();
    expect(within(card).getByText(/MIT/)).toBeInTheDocument();
    expect(within(card).getByText(/3줄/)).toBeInTheDocument();
    expect(held()).toEqual([]);
    // 이름표도, 판정 코드도 화면에 나가지 않는다 — 사람이 읽을 말만 남는다.
    expect(card.textContent).not.toContain("skill://");
    expect(card.textContent).not.toContain("skill.");
  });

  it("넣으면 패널과 입는 skill 목록에 그 자리에서 나타나고, 되돌리기 한 걸음으로 빠진다", async () => {
    render(<App />);
    await pasteAndRead();
    const steps = store().undoStack.length;

    await userEvent.click(screen.getByRole("button", { name: "문서에 넣기" }));

    expect(
      screen.queryByRole("dialog", { name: "이 skill을 넣을까요" }),
    ).not.toBeInTheDocument();
    expect(held().map((skill) => skill.name)).toEqual(["plain-answer"]);
    expect(
      within(screen.getByRole("region", { name: "skill" })).getByText("plain-answer"),
    ).toBeInTheDocument();
    expect(store().undoStack.length).toBe(steps + 1);

    // 같은 문서를 보는 설정 카드에도 그 자리에서 나타난다 — 두 표면이 한 문서를 읽는다.
    act(() => store().select("node", "clinical-agent"));
    expect(
      screen.getByRole("checkbox", { name: /plain-answer/ }),
    ).toBeInTheDocument();

    act(() => store().undo());
    expect(held()).toEqual([]);
  });

  it("이름 규칙을 어기면 쉬운 말로 말하고, 적은 것을 잃지 않는다", async () => {
    render(<App />);

    await readSource(PASTED.replace("name: plain-answer", "name: Plain Answer"));

    const card = screen.getByRole("dialog", { name: "skill을 가져올까요" });
    expect(within(card).getByRole("alert")).toHaveTextContent(
      /소문자·숫자·하이픈만 쓸 수 있어요/,
    );
    expect(within(card).getByRole("alert").textContent).not.toContain("skill.name");
    expect(box()).toHaveValue(PASTED.replace("name: plain-answer", "name: Plain Answer"));
    expect(held()).toEqual([]);
  });

  it("쓰임새가 없으면 그것도 쉬운 말로 말한다", async () => {
    render(<App />);

    await readSource(PASTED.replace("description: use it when you answer a person\n", ""));

    expect(screen.getByRole("alert")).toHaveTextContent(/언제 쓰는 글인지/);
  });

  it("긴 글은 막지 않고 미리 알려 준다", async () => {
    const long = [...Array(520).keys()].map((line) => `line ${line}`).join("\n");
    render(<App />);

    await readSource(`${PASTED}\n${long}\n`);

    const card = screen.getByRole("dialog", { name: "이 skill을 넣을까요" });
    expect(within(card).getByText(/긴 글이에요/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "문서에 넣기" })).toBeEnabled();
  });

  it("긴 본문은 처음 몇 줄만 보이고 나머지는 눌러서 편다", async () => {
    const twenty = [...Array(20).keys()].map((line) => `line ${line}`).join("\n");
    render(<App />);

    await readSource(`${PASTED}\n${twenty}\n`);

    const card = screen.getByRole("dialog", { name: "이 skill을 넣을까요" });
    expect(within(card).queryByText(/line 19/)).not.toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "더 보기" }));
    expect(within(card).getByText(/line 19/)).toBeInTheDocument();
  });

  it("다시 적기를 고르면 적던 자리로 돌아가고 문서는 그대로다", async () => {
    render(<App />);
    await pasteAndRead();

    await userEvent.click(screen.getByRole("button", { name: "다시 적기" }));

    expect(screen.getByRole("dialog", { name: "skill을 가져올까요" })).toBeInTheDocument();
    expect(held()).toEqual([]);
  });
});

describe("같은 이름의 skill이 이미 있을 때", () => {
  const older: SkillDef = {
    ref: "skill://plain-answer@1",
    name: "plain-answer",
    description: "the one already here",
    body: "one\ntwo\nthree\nfour\nfive\n",
    license: null,
    compatibility: null,
    metadata: {},
    references: [],
    source: null,
  };

  it("조용히 덮지 않는다 — 바꿔 넣기로 묻고 줄 수 차이를 말한다", async () => {
    openWith([older]);
    render(<App />);

    await pasteAndRead();

    const card = screen.getByRole("dialog", { name: "이 skill을 넣을까요" });
    expect(within(card).queryByRole("button", { name: "문서에 넣기" })).toBeNull();
    expect(within(card).getByText(/지금 판은 5줄, 새 판은 3줄이에요/)).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "바꿔 넣기" }));

    expect(held()).toHaveLength(1);
    expect(held()[0].description).toBe("use it when you answer a person");

    act(() => store().undo());
    expect(held()[0].description).toBe("the one already here");
  });
});

describe("주소로 가져오기", () => {
  // 출처는 사람이 적은 그 주소다 — 저장소 안 어느 파일을 읽었는지는 우리가 찾아본 길이다.
  it("서버가 가져온 글을 같은 파서가 읽고, 적은 주소를 출처로 남긴다", async () => {
    useEditor.setState({
      fetchSkillOnServer: async () => ({ text: PASTED }),
    });
    render(<App />);
    await openCard();
    await userEvent.click(screen.getByRole("button", { name: "주소" }));
    act(() => store().setSkillImportSource("https://skills.sh/acme/kit/plain-answer"));

    await userEvent.click(screen.getByRole("button", { name: "읽어 보기" }));

    const card = screen.getByRole("dialog", { name: "이 skill을 넣을까요" });
    expect(within(card).getByText(/skills\.sh\/acme\/kit\/plain-answer/)).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "문서에 넣기" }));
    expect(held()[0].source?.url).toBe("https://skills.sh/acme/kit/plain-answer");
  });

  it("허용하지 않는 자리면 쉬운 말로 말하고 적은 주소를 잃지 않는다", async () => {
    useEditor.setState({
      fetchSkillOnServer: async () => ({ failure: { key: "skillImport.error.host" } }),
    });
    render(<App />);
    await openCard();
    await userEvent.click(screen.getByRole("button", { name: "주소" }));
    act(() => store().setSkillImportSource("https://example.com/whatever"));

    await userEvent.click(screen.getByRole("button", { name: "읽어 보기" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /이 주소에서는 가져올 수 없어요/,
    );
    expect(screen.getByRole("textbox", { name: "가져올 주소" })).toHaveValue(
      "https://example.com/whatever",
    );
    expect(held()).toEqual([]);
  });
});

describe("시작 skill", () => {
  const first = Object.values(STARTER_SKILLS)[0];

  it("입력 상태에서 세 줄을 보여 주고, 누르면 곧장 미리보기로 간다", async () => {
    render(<App />);

    await openCard();

    const starters = screen.getByRole("group", { name: "시작 skill에서 고르기" });
    expect(within(starters).getAllByRole("button")).toHaveLength(3);

    await userEvent.click(within(starters).getByRole("button", { name: new RegExp(first.name) }));

    const card = screen.getByRole("dialog", { name: "이 skill을 넣을까요" });
    expect(within(card).getByText(first.name)).toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "문서에 넣기" }));
    expect(held().map((skill) => skill.name)).toEqual([first.name]);
  });

  // 시작 skill은 우리가 실어 보낸 글이다 — "이 문서에서 만듦"이라고 말하면 거짓이다.
  it("어디서 왔는지 정직하게 말한다 — 시작 skill이다", async () => {
    render(<App />);
    await openCard();
    const starters = screen.getByRole("group", { name: "시작 skill에서 고르기" });

    await userEvent.click(
      within(starters).getByRole("button", { name: new RegExp(first.name) }),
    );

    const card = screen.getByRole("dialog", { name: "이 skill을 넣을까요" });
    expect(within(card).getByText(/시작 skill/)).toBeInTheDocument();
    expect(within(card).queryByText(/이 문서에서 만듦/)).not.toBeInTheDocument();

    await userEvent.click(within(card).getByRole("button", { name: "문서에 넣기" }));

    const row = within(screen.getByRole("region", { name: "skill" })).getByRole(
      "listitem",
      { name: first.name },
    );
    expect(within(row).getByText(/시작 skill/)).toBeInTheDocument();
  });
});

// 적던 칸은 글을 적는 자리다 — 그 칸의 Esc는 그 칸의 것이고, 카드는 한 걸음 뒤에 닫힌다
// (DESIGN §1 ①′ — tool-wrap-card와 같은 규칙).
describe("가져오기 카드에서 Esc가 물러나는 순서", () => {
  it("적던 칸에서 한 번 누르면 손만 떼고 카드는 그대로 서 있다", async () => {
    render(<App />);
    await openCard();
    expect(box()).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    expect(box()).not.toHaveFocus();
    expect(screen.getByRole("dialog", { name: "skill을 가져올까요" })).toBeInTheDocument();
  });

  it("한 번 더 누르면 카드가 물러나고 손은 부른 자리로 돌아간다", async () => {
    render(<App />);
    await openCard();

    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { name: "skill을 가져올까요" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "skill" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "skill 가져오기" })).toHaveFocus();
  });
});
