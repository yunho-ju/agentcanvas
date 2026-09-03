// skill 찾아보기 (DESIGN §7 skill-find) — 가져오기 카드의 세 번째 입력 종류.
// 줄을 누르면 origin마다 길이 다르다: 문서의 것은 읽고, 시작 skill과 바깥 것은 읽어 보고 넣는다.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { SkillDef } from "../src/generated/skill_def";
import type { ServerHit } from "../src/graph/skillHits";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

const REMOTE_BODY = [
  "---",
  "name: table-tidy",
  "description: use it when numbers should be a table",
  "---",
  "",
  "Lay the numbers out in a table.",
  "",
].join("\n");

const STARTER_HIT: ServerHit = {
  name: "plain-answer",
  description: "Use when the reader is not an expert.",
  origin: "starter",
  url: null,
  installs: null,
  owner_repo: null,
  ref: "skill://plain-answer@1",
};

const REMOTE_HIT: ServerHit = {
  name: "table-tidy",
  description: null,
  origin: "remote",
  url: "https://skills.sh/acme/kit/table-tidy",
  installs: 12000,
  owner_repo: "acme/kit",
  ref: null,
};

function aSkill(name: string, description: string): SkillDef {
  return {
    ref: `skill://${name}@1`,
    name,
    description,
    body: "Keep the house style.\n",
    license: null,
    compatibility: null,
    metadata: {},
    references: [],
    source: null,
  };
}

function store() {
  return useEditor.getState();
}

function openWith(skills: SkillDef[] = []) {
  act(() => store().loadSpec({ ...example, skills }));
}

async function openFind() {
  await userEvent.click(screen.getByRole("button", { name: "skill" }));
  await userEvent.click(screen.getByRole("button", { name: "skill 가져오기" }));
  await userEvent.click(screen.getByRole("button", { name: "찾아보기" }));
}

function answering(hits: ServerHit[], remoteReached = true) {
  useEditor.setState({
    searchSkillsOnServer: async () => ({ hits, remoteReached }),
  });
}

async function search(what = "표로 정리") {
  await openFind();
  await userEvent.type(
    screen.getByRole("textbox", { name: "무엇을 잘하게 하고 싶나요" }),
    what,
  );
  await userEvent.click(screen.getByRole("button", { name: "찾기" }));
}

function card() {
  return screen.getByRole("dialog", { name: "skill을 가져올까요" });
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  openWith();
});

describe("찾아보기로 들어가는 길", () => {
  it("무엇을 주는지 세 가지 중에서 고른다", async () => {
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "skill" }));
    await userEvent.click(screen.getByRole("button", { name: "skill 가져오기" }));

    for (const name of ["글 붙여넣기", "주소", "찾아보기"]) {
      expect(within(card()).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("적기 전에는 무엇이 필요한지 말하며 기다린다", async () => {
    render(<App />);

    await openFind();

    const find = screen.getByRole("button", { name: "찾기" });
    expect(find).toBeDisabled();
    expect(find).toHaveAttribute("title", "먼저 무엇을 찾을지 적어 주세요");
  });
});

describe("찾은 결과", () => {
  it("이 문서의 것이 앞에 서고 시작 skill과 바깥 것이 뒤따르며, 출처와 설치 수를 말한다", async () => {
    openWith([aSkill("table-house", "Use when a table should follow our house style.")]);
    answering([STARTER_HIT, REMOTE_HIT]);
    render(<App />);

    await search("table");

    const rows = within(card()).getAllByRole("button", { name: /table-house|plain-answer|table-tidy/ });
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("table-house"),
      expect.stringContaining("plain-answer"),
      expect.stringContaining("table-tidy"),
    ]);
    expect(rows[0]).toHaveTextContent("이 문서에 있어요");
    expect(rows[1]).toHaveTextContent("시작 skill");
    expect(rows[2]).toHaveTextContent("acme/kit");
    expect(rows[2]).toHaveTextContent("12,000");
    // 전체 주소는 캡션이 아니라 title로 — 원문은 화면에 늘어놓지 않는다.
    expect(rows[2]).toHaveAttribute("title", "https://skills.sh/acme/kit/table-tidy");
    expect(card().textContent).not.toContain("skill://");
  });

  it("설명을 아는 줄은 그 설명을 한 줄 더 보여 주고, 모르는 줄은 지어내지 않는다", async () => {
    answering([STARTER_HIT, REMOTE_HIT]);
    render(<App />);

    await search("table");

    const starter = within(card()).getByRole("button", { name: /plain-answer/ });
    expect(starter).toHaveTextContent("Use when the reader is not an expert.");
    // 바깥 줄은 설명을 모른다 — 이름과 출처 한 줄이 전부다.
    const remote = within(card()).getByRole("button", { name: /table-tidy/ });
    expect(remote.textContent).toBe("table-tidyskills.sh의 acme/kit · 설치 12,000번");
  });

  it("바깥에 닿지 못하면 그 사실을 말한다 — 빈 결과로 둔갑시키지 않는다", async () => {
    answering([STARTER_HIT], false);
    render(<App />);

    await search("plain");

    expect(within(card()).getByText(/바깥 목록은 지금 닿지 않았어요/)).toBeInTheDocument();
  });

  it("아무것도 없으면 다음 걸음을 가리킨다", async () => {
    answering([], true);
    render(<App />);

    await search("zzzz");

    expect(within(card()).getByText(/찾은 skill이 없어요/)).toBeInTheDocument();
  });

  it("서버에 닿지 못하면 까닭을 말하고 적은 것은 그대로 둔다", async () => {
    useEditor.setState({
      searchSkillsOnServer: async () => ({ failure: { key: "skillImport.error.offline" } }),
    });
    render(<App />);

    await search("plain");

    expect(within(card()).getByText(/서버에 닿지 못했어요/)).toBeInTheDocument();
    expect(store().skillFindQuery).toBe("plain");
  });
});

describe("줄을 누르면 origin마다 길이 다르다", () => {
  it("이 문서의 것은 그 자리에서 읽는다 — 가져오기가 아니다", async () => {
    openWith([aSkill("table-house", "Use when a table should follow our house style.")]);
    answering([]);
    render(<App />);
    await search("table");

    await userEvent.click(within(card()).getByRole("button", { name: /table-house/ }));

    expect(within(card()).getByText(/Keep the house style\./)).toBeInTheDocument();
    // 읽는 것은 넣는 것이 아니다 — 승인 손잡이가 서지 않는다.
    expect(
      screen.queryByRole("button", { name: "문서에 넣기" }),
    ).not.toBeInTheDocument();
  });

  it("시작 skill은 카탈로그의 글 그대로 미리보기로 간다", async () => {
    answering([STARTER_HIT]);
    render(<App />);
    await search("plain");

    await userEvent.click(within(card()).getByRole("button", { name: /plain-answer/ }));

    const review = screen.getByRole("dialog", { name: "이 skill을 넣을까요" });
    expect(within(review).getByText("plain-answer")).toBeInTheDocument();
    expect(store().spec?.skills ?? []).toEqual([]);
  });

  it("바깥 것은 서버가 본문을 읽어 온 뒤에야 미리보기로 간다", async () => {
    const asked: string[] = [];
    answering([REMOTE_HIT]);
    useEditor.setState({
      fetchSkillOnServer: async (url: string) => {
        asked.push(url);
        return { text: REMOTE_BODY };
      },
    });
    render(<App />);
    await search("table");

    await userEvent.click(within(card()).getByRole("button", { name: /table-tidy/ }));

    expect(asked).toEqual(["https://skills.sh/acme/kit/table-tidy"]);
    const review = screen.getByRole("dialog", { name: "이 skill을 넣을까요" });
    expect(within(review).getByText(/Lay the numbers out in a table\./)).toBeInTheDocument();
    expect(store().spec?.skills ?? []).toEqual([]);
  });

  it("다른 말로 찾아도 이미 가진 skill은 가져오라고 권하지 않는다", async () => {
    openWith([aSkill("table-tidy", "Use when numbers should be laid out.")]);
    answering([{ ...REMOTE_HIT, name: "table-tidy" }]);
    render(<App />);

    // 물음에 닿는 문서 줄은 없지만, 그 이름은 이 문서에 있다.
    await search("spreadsheet");

    const row = within(card()).getByRole("button", { name: /table-tidy/ });
    expect(row).toHaveTextContent("이미 있어요");
    await userEvent.click(row);

    expect(within(card()).getByText(/Keep the house style\./)).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "이 skill을 넣을까요" }),
    ).not.toBeInTheDocument();
  });

  it("가져온 글을 읽지 못하면 까닭을 말하고 찾은 목록은 그대로 둔다", async () => {
    answering([REMOTE_HIT]);
    useEditor.setState({
      fetchSkillOnServer: async () => ({
        text: "---\nname: Table Tidy\ndescription: use it\n---\n\nBody.\n",
      }),
    });
    render(<App />);
    await search("table");

    await userEvent.click(within(card()).getByRole("button", { name: /table-tidy/ }));

    expect(within(card()).getByText(/이름은 소문자·숫자·하이픈만/)).toBeInTheDocument();
    // 찾은 목록은 그대로 있다 — 한 번 더 고를 수 있어야 한다.
    expect(within(card()).getByRole("button", { name: /table-tidy/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "이 skill을 넣을까요" }),
    ).not.toBeInTheDocument();
  });

  it("문서에 이미 있는 이름은 그렇게 말하고, 눌러도 가져오지 않고 읽는다", async () => {
    openWith([aSkill("plain-answer", "The one we already keep.")]);
    answering([STARTER_HIT]);
    render(<App />);
    await search("plain");

    const rows = within(card()).getAllByRole("button", { name: /plain-answer/ });
    expect(rows[1]).toHaveTextContent("이미 있어요");
    await userEvent.click(rows[1]);

    expect(within(card()).getByText(/Keep the house style\./)).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "이 skill을 넣을까요" }),
    ).not.toBeInTheDocument();
  });
});
