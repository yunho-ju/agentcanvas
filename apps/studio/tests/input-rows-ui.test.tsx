// 화면에서 받는 줄을 만들면 실행이 그대로 묻는다 — 설정 카드와 실행 입력 카드를 한 흐름으로 본다
// (DESIGN §7 input-rows "결과가 보이는 곳": 실행 입력 카드의 칸 종류).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { setLocale } from "../src/i18n/localeStore";
import { Inspector } from "../src/inspector/Inspector";
import { RunControls } from "../src/shell/RunControls";
import { useEditor } from "../src/store/editor";
import { serveRuns, serveSaves } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

/** 아직 아무것도 받지 않는 문서 — 받는 줄은 여기서부터 사람이 만든다. */
const ASKING_NOTHING = {
  ...example,
  input_schema: {},
  nodes: example.nodes.map((node) =>
    node.type === "core.input" ? { ...node, config: { bindings: {} } } : node,
  ),
  edges: example.edges.filter((edge) => edge.source.node !== "input"),
} as AgentSpec;

function store() {
  return useEditor.getState();
}

async function addRow(name: string) {
  await userEvent.click(screen.getByRole("button", { name: "줄 추가" }));
  await userEvent.type(screen.getAllByLabelText(/번째 이름/).at(-1) as HTMLElement, name);
  // 이름은 칸을 떠날 때 확정된다 (DESIGN §7 input-rows).
  await userEvent.tab();
  return screen.getByDisplayValue(name).closest("li") as HTMLElement;
}

beforeEach(() => {
  act(() => setLocale("ko"));
  useEditor.setState({ runInputOpen: false, runInputValues: {} });
  store().loadSpec(ASKING_NOTHING);
  store().select("node", "input");
  serveSaves();
  serveRuns({ runId: "run_input_rows", startedAt: new Date("2026-09-03T09:00:00.000Z") });
});

describe("받는 줄을 만들고 실행을 눌렀을 때", () => {
  it("고른 종류 그대로 묻는다 — 숫자면 숫자 칸이다", async () => {
    render(
      <>
        <Inspector />
        <RunControls />
      </>,
    );

    const row = await addRow("count");
    await userEvent.selectOptions(within(row).getByLabelText(/번째 종류/), "number");
    await userEvent.click(screen.getByRole("button", { name: "실행해 보기" }));

    expect(screen.getByRole("dialog", { name: "실행에 넣을 값" })).toBeInTheDocument();
    expect(screen.getByLabelText(/count/)).toHaveAttribute("type", "number");
  });

  it("꼭 받아요를 켠 값이 비어 있으면 실행을 막고 그 까닭을 말한다", async () => {
    render(
      <>
        <Inspector />
        <RunControls />
      </>,
    );

    const row = await addRow("count");
    await userEvent.click(within(row).getByLabelText("꼭 받아요"));
    await userEvent.click(screen.getByRole("button", { name: "실행해 보기" }));

    const run = screen.getByRole("button", { name: "이 값으로 실행" });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute("title", "필수 입력을 채우면 실행할 수 있어요");
  });

  it("자료형 원문은 두 카드 어디에도 없다", async () => {
    const { container } = render(
      <>
        <Inspector />
        <RunControls />
      </>,
    );

    const row = await addRow("count");
    await userEvent.selectOptions(within(row).getByLabelText(/번째 종류/), "list");
    await userEvent.click(screen.getByRole("button", { name: "실행해 보기" }));

    for (const raw of ["string", "number", "integer", "boolean", "array", "object"]) {
      expect(container.textContent).not.toContain(raw);
    }
  });
});

// 줄 편집기가 입은 옷 (DESIGN §7 input-rows "4상태" · 토큰만).
describe("받는 줄이 입은 옷", () => {
  const app = readFileSync(join(process.cwd(), "src/app.css"), "utf-8");

  function cssBlock(selector: string): string {
    const at = app.indexOf(`${selector} {`);
    return at === -1 ? "" : app.slice(at, app.indexOf("}", at));
  }

  it("이름·값 표와 같은 상자에 담긴다", () => {
    expect(cssBlock(".control--rows")).toContain("var(--radius-control)");
    expect(cssBlock(".control--rows")).toContain("var(--hairline)");
  });

  it("줄 하나가 두 행으로 쌓여 좁은 패널에서도 지우기가 보인다", () => {
    expect(cssBlock(".control--rows .control__row")).toContain("flex-direction: column");
    expect(cssBlock(".control__row-line")).toContain("display: flex");
    expect(cssBlock(".control__row-line")).toContain("gap: var(--space-1)");
  });

  it("이름·값 표의 줄은 한 행 그대로다", () => {
    expect(cssBlock(".control__row")).not.toContain("flex-direction: column");
  });

  it("종류를 고르는 칸도 네 가지 상태를 모두 말한다", () => {
    expect(app).toContain(".control__row select:hover:not(:disabled)");
    expect(app).toContain(".control__row select:active:not(:disabled)");
    expect(app).toContain(".control__row select:focus-visible");
    expect(app).toContain(".control__row select:disabled");
  });

  it("꼭 받아요는 글과 네모가 한 줄로 붙어 선다", () => {
    expect(cssBlock(".control__check")).toContain("display: flex");
    expect(cssBlock(".control__check")).toContain("gap: var(--space-1)");
  });

  it("색은 토큰으로만 말한다", () => {
    const rules = app.match(/\.control__(row|check)[^{]*\{[^}]*\}/g) ?? [];

    expect(rules.length).toBeGreaterThan(4);
    expect(rules.join("\n")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
