// 이 단계가 따를 skill을 고르는 칸 (DESIGN §7 skill-wear).
import { ReactFlowProvider } from "@xyflow/react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { NodeCard } from "../src/canvas/NodeCard";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { SkillDef } from "../src/generated/skill_def";
import { Inspector } from "../src/inspector/Inspector";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;
const AGENT = "clinical-agent";

function store() {
  return useEditor.getState();
}

function aSkill(name: string): SkillDef {
  return {
    ref: `skill://${name}@1`,
    name,
    description: `use ${name} when you answer`,
    body: "Answer plainly.\n",
    license: null,
    compatibility: null,
    metadata: {},
    references: [],
    source: null,
  };
}

/** 문서에 skill을 놓고, 그 단계가 무엇을 입었는지 정한 채 문서를 연다. */
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
  act(() => store().select("node", AGENT));
}

/** 지금 문서에 서 있는 그 단계의 카드 하나 — 캔버스가 그리는 그 컴포넌트 그대로다. */
function renderAgentCard() {
  const node = store().nodes.find((one) => one.id === AGENT);
  return render(
    <ReactFlowProvider>
      <NodeCard id={AGENT} data={node!.data} />
    </ReactFlowProvider>,
  );
}

function wearBox(name: string) {
  return screen.getByRole("checkbox", { name: new RegExp(name) });
}

function configOfAgent(): unknown {
  return store().nodes.find((node) => node.id === AGENT)?.data.spec.config?.skill_refs;
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("입는 skill 칸", () => {
  it("문서가 가진 skill을 이름과 쓰임새 한 줄로 늘어놓는다", () => {
    openWith([aSkill("plain-answer")]);
    render(<Inspector />);

    expect(wearBox("plain-answer")).toBeInTheDocument();
    expect(
      screen.getByText("use plain-answer when you answer"),
    ).toBeInTheDocument();
  });

  it("체크 한 번이 문서에 적히고, 되돌리기 한 걸음으로 돌아간다", async () => {
    openWith([aSkill("plain-answer")]);
    render(<Inspector />);
    const steps = store().undoStack.length;

    await userEvent.click(wearBox("plain-answer"));

    expect(configOfAgent()).toEqual(["skill://plain-answer@1"]);
    expect(store().undoStack.length).toBe(steps + 1);

    act(() => store().undo());
    expect(configOfAgent() ?? []).toEqual([]);
  });

  it("체크를 풀면 그 줄만 빠진다", async () => {
    openWith([aSkill("plain-answer"), aSkill("cite-sources")], [
      "skill://plain-answer@1",
      "skill://cite-sources@1",
    ]);
    render(<Inspector />);

    await userEvent.click(wearBox("plain-answer"));

    expect(configOfAgent()).toEqual(["skill://cite-sources@1"]);
  });

  it("문서에 skill이 없으면 빈 목록 대신 그 사실과 가져오는 길을 말한다", () => {
    openWith([]);
    render(<Inspector />);

    expect(
      screen.getByText(/이 문서에는 아직 skill이 없어요 — 가져오면/),
    ).toBeInTheDocument();
    // 옆 칸('쓸 도구')의 체크는 이 칸의 것이 아니다 — 이 무리 안에서만 센다.
    expect(
      within(screen.getByRole("group", { name: /입는 skill/ })).queryAllByRole("checkbox"),
    ).toHaveLength(0);
  });

  it("가져오기 버튼이 그 카드를 연다", async () => {
    openWith([]);
    render(<Inspector />);

    await userEvent.click(screen.getByRole("button", { name: "skill 가져오기…" }));

    expect(store().skillImportMode).toBe("input");
  });

  it("실행을 보는 동안에는 가져올 수 없고 그 까닭을 말한다", async () => {
    openWith([]);
    act(() =>
      useEditor.setState({ activeRunId: "run_1", runEvents: [{ seq: 1 } as never] }),
    );
    render(<Inspector />);

    const button = screen.getByRole("button", { name: "skill 가져오기…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("실행"));
  });
});

describe("문서에 없는 skill을 입고 있을 때", () => {
  it("그 줄은 체크된 채 남고 경고 한 줄이 붙는다 — 조용히 지우지 않는다", () => {
    openWith([], ["skill://plain-answer@1"]);
    render(<Inspector />);

    expect(wearBox("plain-answer")).toBeChecked();
    const said = screen.getByText("문서에 없는 skill");
    // 이 줄은 쓰임새 한 줄이 아니라 경고다 — 색과 자리가 다르다 (DESIGN §7 skill-wear warn-ink).
    expect(said).toHaveClass("skill-wear__warn");
    expect(said).not.toHaveClass("skill-wear__what");
  });

  it("문서가 가진 skill 줄은 경고가 아니라 쓰임새를 말한다", () => {
    openWith([aSkill("plain-answer")], ["skill://plain-answer@1"]);
    render(<Inspector />);

    const said = screen.getByText("use plain-answer when you answer");
    expect(said).toHaveClass("skill-wear__what");
    expect(screen.queryByText("문서에 없는 skill")).not.toBeInTheDocument();
  });

  it("체크를 풀면 그 줄이 사라진다", async () => {
    openWith([], ["skill://plain-answer@1"]);
    render(<Inspector />);

    await userEvent.click(wearBox("plain-answer"));

    expect(configOfAgent()).toEqual([]);
    expect(screen.queryByText("문서에 없는 skill")).not.toBeInTheDocument();
  });

  it("판정은 필드 오류가 한다 — 이름표가 아니라 이름으로 말한다", () => {
    openWith([], ["skill://plain-answer@1"]);
    render(<Inspector />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("'plain-answer' skill이 이 문서에 없어요");
    expect(alert.textContent).not.toContain("skill://");
  });

  // 카드는 캔버스 위에 있지만, 캔버스가 카드를 어디에 놓는지는 실브라우저의 몫이다
  // (jsdom은 자리를 재지 못해 노드를 감춘 채 그린다) — 여기서는 카드 자신을 세워 뱃지를 본다.
  it("노드 카드의 뱃지도 그 사실을 센다", () => {
    openWith([], ["skill://plain-answer@1"]);

    renderAgentCard();

    expect(screen.getByRole("button", { name: /설정 필요/ })).toHaveAttribute(
      "title",
      expect.stringContaining("plain-answer"),
    );
  });

  it("아무도 안 입은 skill(INFO)은 뱃지에 세지 않는다", () => {
    openWith([aSkill("plain-answer")]);

    renderAgentCard();

    expect(screen.queryByRole("button", { name: /설정 필요/ })).not.toBeInTheDocument();
  });
});
