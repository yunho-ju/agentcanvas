// 실행 버튼이 물을 것이 있을 때 서는 카드 (DESIGN §7 run-input-card).
// Esc는 카드가 혼자 다루지 않는다 — 물러나는 순서(DESIGN §1 ①′)가 맡으므로 앱을 통째로 세운다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { setLocale } from "../src/i18n/localeStore";
import { RunControls } from "../src/shell/RunControls";
import { useEditor } from "../src/store/editor";
import { serveRuns, serveSaves, settle } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;
const trial = { runId: "run_input_card", startedAt: new Date("2026-08-01T12:30:00.000Z") };

function store() {
  return useEditor.getState();
}

/** 입력 노드가 이 값들을 받는 문서 — 제목·필수는 문서의 input_schema가 정한다. */
function graphAsking(
  bindings: Record<string, string>,
  inputSchema: Record<string, unknown> = {},
): AgentSpec {
  return {
    ...example,
    input_schema: inputSchema,
    nodes: example.nodes.map((node) =>
      node.type === "core.input" ? { ...node, config: { bindings } } : node,
    ),
  } as AgentSpec;
}

/** 입력 노드가 없는 문서 — 실행이 물을 것이 없다. */
const askingNothing = {
  ...example,
  input_schema: {},
  nodes: example.nodes.filter((node) => node.type !== "core.input"),
  edges: example.edges.filter(
    (edge) => edge.source.node !== "input" && edge.target.node !== "input",
  ),
} as AgentSpec;

const ONE_FIELD = graphAsking({ question: "input.question" });

const TITLED = graphAsking(
  { question: "input.question" },
  {
    type: "object",
    properties: {
      question: {
        type: "string",
        title: "Question",
        "x-i18n": { ko: { title: "물어볼 것" } },
      },
    },
    required: ["question"],
  },
);

function pressRun() {
  return userEvent.click(screen.getByRole("button", { name: "실행해 보기" }));
}

beforeEach(() => {
  act(() => setLocale("ko"));
  useEditor.setState({ runInputOpen: false, runInputValues: {} });
  store().loadSpec(example);
  serveSaves();
});

describe("물을 것이 있을 때의 실행 버튼", () => {
  it("카드를 세우고, 아직 실행하지는 않는다", async () => {
    store().loadSpec(ONE_FIELD);
    const server = serveRuns(trial);
    render(<RunControls />);

    await pressRun();

    expect(screen.getByRole("dialog", { name: "실행에 넣을 값" })).toBeInTheDocument();
    expect(screen.getByLabelText("question")).toBeInTheDocument();
    expect(server.starts).toBe(0);
  });

  it("물을 것이 없으면 카드 없이 바로 실행한다", async () => {
    store().loadSpec(askingNothing);
    serveSaves();
    const server = serveRuns(trial);
    render(<RunControls />);

    await pressRun();
    await settle();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.starts).toBe(1);
  });

  it("적어 넣은 값과 함께 실행한다", async () => {
    store().loadSpec(ONE_FIELD);
    const asked: (Record<string, unknown> | undefined)[] = [];
    serveRuns(trial);
    const sent = store().sendRunStart;
    useEditor.setState({
      sendRunStart: (specId, revision, input) => {
        asked.push(input);
        return sent(specId, revision, input);
      },
    });
    render(<RunControls />);

    await pressRun();
    await userEvent.type(screen.getByLabelText("question"), "무엇을 볼까");
    await userEvent.click(screen.getByRole("button", { name: "이 값으로 실행" }));
    await settle();

    expect(asked).toEqual([{ question: "무엇을 볼까" }]);
  });

  it("실행이 시작되면 카드는 물러난다", async () => {
    store().loadSpec(ONE_FIELD);
    serveRuns(trial);
    render(<RunControls />);

    await pressRun();
    await userEvent.click(screen.getByRole("button", { name: "이 값으로 실행" }));
    await settle();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // 폼을 여는 버튼은 멱등하다 — 연타가 사람이 시킨 적 없는 취소가 되지 않는다 (DESIGN §7 run-input-card).
  it("카드가 열려 있을 때 실행 버튼을 다시 누르면 닫지 않고 첫 칸에 손을 얹는다", async () => {
    store().loadSpec(ONE_FIELD);
    serveRuns(trial);
    const { container } = render(<RunControls />);

    await pressRun();
    await pressRun();

    expect(screen.getByRole("dialog", { name: "실행에 넣을 값" })).toBeInTheDocument();
    expect(container.querySelector(".run-input-card__form input")).toHaveFocus();
  });

  it("닫는 손잡이는 '그만두기'다 — 재클릭이 아니라 이 버튼이 카드를 접는다", async () => {
    store().loadSpec(ONE_FIELD);
    serveRuns(trial);
    render(<RunControls />);

    await pressRun();
    await userEvent.click(screen.getByRole("button", { name: "그만두기" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("그만두면 실행하지 않고 적은 값만 남는다", async () => {
    store().loadSpec(ONE_FIELD);
    const server = serveRuns(trial);
    render(<RunControls />);

    await pressRun();
    await userEvent.type(screen.getByLabelText("question"), "무엇을 볼까");
    await userEvent.click(screen.getByRole("button", { name: "그만두기" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(server.starts).toBe(0);
    await pressRun();
    expect(screen.getByLabelText("question")).toHaveValue("무엇을 볼까");
  });

  it("다른 문서를 열면 적어 둔 값은 남지 않는다", async () => {
    store().loadSpec(ONE_FIELD);
    serveRuns(trial);
    render(<RunControls />);

    await pressRun();
    await userEvent.type(screen.getByLabelText("question"), "무엇을 볼까");
    await userEvent.click(screen.getByRole("button", { name: "그만두기" }));
    act(() => store().loadSpec(ONE_FIELD));
    await pressRun();

    expect(screen.getByLabelText("question")).toHaveValue("");
  });
});

describe("문서가 제목과 필수를 들고 있을 때", () => {
  it("라벨은 문서가 준 제목이다", async () => {
    store().loadSpec(TITLED);
    serveRuns(trial);
    render(<RunControls />);

    await pressRun();

    expect(screen.getByLabelText(/물어볼 것/)).toBeInTheDocument();
  });

  it("영어로 읽는 사람에게는 영어 제목으로 묻는다", async () => {
    store().loadSpec(TITLED);
    serveRuns(trial);
    render(<RunControls />);

    await pressRun();
    act(() => setLocale("en"));

    expect(screen.getByLabelText(/Question/)).toBeInTheDocument();
  });

  it("필수를 채우기 전에는 실행을 막고 그 까닭을 말한다", async () => {
    store().loadSpec(TITLED);
    serveRuns(trial);
    render(<RunControls />);

    await pressRun();

    const run = screen.getByRole("button", { name: "이 값으로 실행" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute("title", "필수 입력을 채우면 실행할 수 있어요");
  });

  // 공백 한 칸은 적은 것이 아니다 — 보내는 쪽에서 버릴 값으로 잠금을 풀어 주지 않는다.
  it("공백만 넣은 필수 칸은 아직 채운 것이 아니다", async () => {
    store().loadSpec(TITLED);
    serveRuns(trial);
    render(<RunControls />);

    await pressRun();
    await userEvent.type(screen.getByLabelText(/물어볼 것/), "   ");

    expect(screen.getByRole("button", { name: "이 값으로 실행" })).toBeDisabled();
  });

  it("채우는 순간 실행할 수 있게 된다", async () => {
    store().loadSpec(TITLED);
    serveRuns(trial);
    render(<RunControls />);

    await pressRun();
    await userEvent.type(screen.getByLabelText(/물어볼 것/), "무엇을 볼까");

    expect(screen.getByRole("button", { name: "이 값으로 실행" })).toBeEnabled();
  });
});

describe("카드 앞에서 누른 Escape", () => {
  async function openedInTheApp() {
    const view = render(<App />);
    await act(async () => {
      store().loadSpec(ONE_FIELD);
    });
    serveSaves();
    serveRuns(trial);
    await pressRun();
    return view;
  }

  it("칸에 손이 있으면 그 손만 뗀다 — 카드는 서 있다", async () => {
    const { container } = await openedInTheApp();
    const field = container.querySelector<HTMLInputElement>(".run-input-card__form input");
    if (!field) throw new Error("the run input card has no field");
    field.focus();

    await userEvent.keyboard("{Escape}");

    expect(field).not.toHaveFocus();
    expect(container.querySelector(".run-input-card")).toBeInTheDocument();
  });

  it("다음 Escape가 카드를 접는다 — 한 번에 한 걸음", async () => {
    const { container } = await openedInTheApp();
    container.querySelector<HTMLInputElement>(".run-input-card__form input")?.focus();

    await userEvent.keyboard("{Escape}{Escape}");

    expect(container.querySelector(".run-input-card")).not.toBeInTheDocument();
    expect(store().runInputValues).toEqual({});
  });
});

describe("카드가 입은 옷", () => {
  const app = readFileSync(join(process.cwd(), "src/app.css"), "utf-8");

  function cssBlock(selector: string): string {
    const at = app.indexOf(`${selector} {`);
    return at === -1 ? "" : app.slice(at, app.indexOf("}", at));
  }

  it("실행 버튼 아래 같은 기둥에 선다", () => {
    // 우상단 자리는 이제 상단 그리드의 오른쪽 칸이다 (DESIGN §1 상단 레이어).
    expect(cssBlock(".layer-top")).toContain("grid-template-columns: auto 1fr auto");
    expect(cssBlock(".layer-top-right")).toContain("flex-direction: column");
    expect(cssBlock(".layer-top-right")).toContain("gap: var(--space-2)");
  });

  it("떠 있는 카드의 문법을 그대로 입는다", () => {
    expect(cssBlock(".run-input-card")).toContain("var(--radius-card)");
    expect(cssBlock(".run-input-card")).toContain("var(--panel-inspector)");
  });

  it("칸들은 승인 폼과 같은 간격으로 쌓인다", () => {
    expect(cssBlock(".run-input-card__form")).toContain("flex-direction: column");
    expect(cssBlock(".run-input-card__form")).toContain("gap: var(--space-2)");
  });

  it("라벨도 다른 라벨과 같은 글이다", () => {
    expect(cssBlock(".run-input-card__label")).toContain("font-size: var(--text-label)");
    expect(cssBlock(".run-input-card__label")).toContain("color: var(--ink)");
  });

  it("아직 받을 수 없는 실행은 손짓에 반응하지 않는다", () => {
    expect(app).toContain(".run-input-card__run:hover:not(:disabled)");
    expect(app).toContain(".run-input-card__run:active:not(:disabled)");
    expect(app).not.toContain(".run-input-card__run:hover {");
    expect(cssBlock(".run-input-card__run:disabled")).toContain("opacity: 0.4");
  });

  it("두 버튼 모두 키보드 초점을 보여준다", () => {
    for (const button of [".run-input-card__run", ".run-input-card__cancel"]) {
      expect(app).toContain(`${button}:focus-visible`);
    }
  });

  it("색은 토큰으로만 말한다", () => {
    const cardRules = app.match(/\.run-input-card[^{]*\{[^}]*\}/g) ?? [];

    expect(cardRules.length).toBeGreaterThan(4);
    expect(cardRules.join("\n")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

// 카드의 실행 버튼도 실행 버튼이다 — 저장·시작이 오가는 동안 조용한 무반응을 두지 않는다 (DESIGN §9).
describe("카드가 일하는 동안", () => {
  it("저장이 오가는 동안 '이 값으로 실행'은 잠기고 그 까닭을 말한다", async () => {
    store().loadSpec(ONE_FIELD);
    render(<RunControls />);
    await pressRun();

    act(() => useEditor.setState({ saving: true }));

    const run = screen.getByRole("button", { name: "이 값으로 실행" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute("title", expect.stringContaining("저장"));
  });

  it("실행을 여는 동안에도 잠기고 그 까닭을 말한다", async () => {
    store().loadSpec(ONE_FIELD);
    render(<RunControls />);
    await pressRun();

    act(() => useEditor.setState({ startingRun: true }));

    const run = screen.getByRole("button", { name: "이 값으로 실행" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute("title", expect.stringContaining("여는 중"));
  });
});
