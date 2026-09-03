// 문서의 skill을 보고, 읽고, 지우는 자리 (DESIGN §7 skills-panel).
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { SkillDef } from "../src/generated/skill_def";
import { useEditor } from "../src/store/editor";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;
const AGENT = "clinical-agent";

function store() {
  return useEditor.getState();
}

function aSkill(over: Partial<SkillDef> = {}): SkillDef {
  return {
    ref: "skill://plain-answer@1",
    name: "plain-answer",
    description: "use it when you answer a person",
    body: "# Answer plainly\n\nSay it in one sentence.\n\n- no jargon\n",
    license: "MIT",
    compatibility: null,
    metadata: {},
    references: [],
    source: null,
    ...over,
  };
}

function openWith(skills: SkillDef[], worn: string[] = []) {
  act(() =>
    store().loadSpec({
      ...example,
      skills,
      nodes: example.nodes.map((node) =>
        node.id === AGENT ? { ...node, config: { ...node.config, skill_refs: worn } } : node,
      ),
    }),
  );
}

function openPanel() {
  return userEvent.click(screen.getByRole("button", { name: "skill" }));
}

function panel() {
  return screen.getByRole("region", { name: "skill" });
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("skill 패널", () => {
  it("독에서 부르면 문서의 skill을 이름과 쓰임새로 보여 준다", async () => {
    openWith([aSkill()]);
    render(<App />);

    await openPanel();

    expect(within(panel()).getByText("plain-answer")).toBeInTheDocument();
    expect(
      within(panel()).getByText("use it when you answer a person"),
    ).toBeInTheDocument();
  });

  it("어디서 왔는지 말한다 — 가져온 것과 여기서 만든 것을 가른다", async () => {
    openWith([
      aSkill(),
      aSkill({
        ref: "skill://cite-sources@1",
        name: "cite-sources",
        source: { url: "https://skills.sh/acme/kit/cite-sources" },
      }),
    ]);
    render(<App />);

    await openPanel();

    expect(within(panel()).getByText("이 문서에서 만듦")).toBeInTheDocument();
    expect(
      within(panel()).getByText(/skills\.sh\/acme\/kit\/cite-sources/),
    ).toBeInTheDocument();
  });

  it("누가 입었는지 단계 이름으로 말하고, 아무도 안 입었으면 그 사실을 말한다", async () => {
    openWith([aSkill(), aSkill({ ref: "skill://cite-sources@1", name: "cite-sources" })], [
      "skill://plain-answer@1",
    ]);
    render(<App />);

    await openPanel();

    const worn = within(panel()).getByRole("listitem", { name: "plain-answer" });
    expect(within(worn).getByText(AGENT)).toBeInTheDocument();
    const idle = within(panel()).getByRole("listitem", { name: "cite-sources" });
    expect(within(idle).getByText("아직 아무 단계도 안 따라요")).toBeInTheDocument();
  });

  it("읽기를 누르면 본문이 그 자리에서 펼쳐지고, 다시 누르면 접힌다", async () => {
    openWith([aSkill()]);
    render(<App />);
    await openPanel();

    await userEvent.click(within(panel()).getByRole("button", { name: "읽기" }));

    expect(within(panel()).getByText("Answer plainly")).toBeInTheDocument();
    expect(within(panel()).getByText("Say it in one sentence.")).toBeInTheDocument();
    expect(within(panel()).getByText("no jargon")).toBeInTheDocument();

    await userEvent.click(within(panel()).getByRole("button", { name: "읽기" }));
    expect(within(panel()).queryByText("Answer plainly")).not.toBeInTheDocument();
  });

  it("지우면 곧바로 목록에서 빠지고, 되돌리기 한 걸음으로 살아난다", async () => {
    openWith([aSkill()], ["skill://plain-answer@1"]);
    render(<App />);
    await openPanel();
    const steps = store().undoStack.length;

    await userEvent.click(within(panel()).getByRole("button", { name: "지우기" }));

    expect(store().spec?.skills ?? []).toEqual([]);
    expect(store().undoStack.length).toBe(steps + 1);
    expect(within(panel()).getByText("이 문서에는 아직 skill이 없어요")).toBeInTheDocument();

    act(() => store().undo());
    expect(store().spec?.skills).toHaveLength(1);
  });

  it("되묻지 않는 대신 무섭지 않다고 말한다", async () => {
    openWith([aSkill()]);
    render(<App />);

    await openPanel();

    expect(
      within(panel()).getByText("되돌리기로 언제든 살릴 수 있어요"),
    ).toBeInTheDocument();
  });

  it("skill이 없는 문서에는 그 사실과 가져오는 길을 함께 보여 준다", async () => {
    openWith([]);
    render(<App />);

    await openPanel();

    expect(within(panel()).getByText("이 문서에는 아직 skill이 없어요")).toBeInTheDocument();
    await userEvent.click(within(panel()).getByRole("button", { name: "skill 가져오기" }));
    expect(store().skillImportMode).toBe("input");
  });

  it("실행을 보는 동안에는 가져오기도 지우기도 잠기고 까닭을 말한다", async () => {
    openWith([aSkill()]);
    render(<App />);
    await openPanel();
    await act(async () => {
      await runOnServer({
        runId: "run_example",
        startedAt: new Date("2026-08-01T12:30:00.000Z"),
      });
    });

    for (const name of ["skill 가져오기", "지우기"]) {
      const button = within(panel()).getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", expect.stringContaining("실행"));
    }
  });

  // 같은 이름표를 두 번 든 문서는 잘못이다 (validator skill.duplicate) — 그 줄이 말한다.
  it("같은 skill이 두 번 들어 있으면 그 줄이 그 사실을 말한다", async () => {
    openWith([aSkill(), aSkill()]);
    render(<App />);

    await openPanel();

    const said = within(panel()).getAllByText("이 문서에 두 번 들어 있어요");
    expect(said).toHaveLength(2);
    expect(said[0]).toHaveClass("skills-panel__warn");
  });

  it("한 번씩만 든 문서에는 그 말이 없다", async () => {
    openWith([aSkill(), aSkill({ ref: "skill://cite-sources@1", name: "cite-sources" })]);
    render(<App />);

    await openPanel();

    expect(
      within(panel()).queryByText("이 문서에 두 번 들어 있어요"),
    ).not.toBeInTheDocument();
  });

  it("이름표(skill://…)는 화면에 쓰지 않는다 — 사람이 부르는 이름만 보인다", async () => {
    openWith([aSkill()], ["skill://plain-answer@1"]);
    render(<App />);

    await openPanel();

    expect(panel().textContent).not.toContain("skill://");
    expect(panel().textContent).not.toContain("skill_refs");
  });
});
