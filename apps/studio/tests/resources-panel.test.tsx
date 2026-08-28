// 연결을 보고 새로 만드는 자리 (DESIGN §7 resources-panel / tool-wrap-card, API_TOOLS P2b).
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import { runOnServer } from "./fakeRunServer";
import type { AgentSpec, ResourceBinding } from "../src/generated/agent_spec";
import { Inspector } from "../src/inspector/Inspector";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

const PROPOSED = {
  id: "article-search",
  kind: "http.api",
  server_ref: "api://article-search",
  allowed_tools: [],
  approval_policy: "read_only_auto",
  tools: [
    {
      name: "search_articles",
      plain_description: { ko: "글을 찾아 준다.", en: "Finds articles for you." },
      input_schema: {
        type: "object",
        properties: { query: { type: "string", title: "찾을 말" } },
      },
      output_schema: {
        type: "object",
        properties: { articles: { type: "array", title: "찾은 글 목록" } },
      },
      timeout_ms: 8000,
      call: {
        transport: "http",
        method: "GET",
        url_template: "https://api.example.com/search",
        auth: "secret://article-api-key",
      },
      result_handling: { mode: "full" },
    },
  ],
} as unknown as ResourceBinding;

function store() {
  return useEditor.getState();
}

function candidate(): AgentSpec {
  const spec = store().exportSpec();
  return { ...spec, resources: [...(spec.resources ?? []), PROPOSED] };
}

function openPanel() {
  return userEvent.click(screen.getByRole("button", { name: "연결" }));
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
  useEditor.setState({
    wrapToolsOnServer: async () => ({ candidate: candidate(), issues: [] }),
  });
});

describe("연결 패널", () => {
  it("문서가 가진 연결과 그 도구를 보여 준다", async () => {
    render(<App />);

    await openPanel();

    const panel = screen.getByRole("region", { name: "연결" });
    expect(within(panel).getByText("clinical-reference")).toBeInTheDocument();
    expect(within(panel).getByText("search_article")).toBeInTheDocument();
    expect(
      within(panel).getByText("물어본 것과 관련 있는 진료 지침 글을 찾아 목록으로 돌려준다."),
    ).toBeInTheDocument();
  });

  it("연결이 없는 문서에는 그 사실과 만드는 길을 함께 보여 준다", async () => {
    act(() => store().loadSpec({ ...example, resources: [] }));
    render(<App />);

    await openPanel();

    const panel = screen.getByRole("region", { name: "연결" });
    expect(within(panel).getByText("이 문서에는 아직 연결이 없어요")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "새 연결" })).toBeEnabled();
  });

  it("실행을 보는 동안에는 만들 수 없고 그 까닭을 말한다", async () => {
    render(<App />);
    await openPanel();
    await act(async () => {
      await runOnServer({
        runId: "run_example",
        startedAt: new Date("2026-08-01T12:30:00.000Z"),
      });
    });

    const button = within(screen.getByRole("region", { name: "연결" })).getByRole(
      "button",
      { name: "새 연결" },
    );
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("실행"));
  });
});

describe("붙여 넣으면 도구가 된다", () => {
  async function paste() {
    render(<App />);
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "새 연결" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "붙여 넣은 내용" }),
      "openapi 3.1.0",
    );
    await userEvent.click(screen.getByRole("button", { name: "도구로 바꾸기" }));
  }

  it("무엇을 붙여 넣는지 세 가지 중에서 고른다", async () => {
    render(<App />);
    await openPanel();

    await userEvent.click(screen.getByRole("button", { name: "새 연결" }));

    const card = screen.getByRole("dialog", { name: "무엇을 연결할까요" });
    for (const name of ["API 문서 붙여넣기", "요청 예시(curl)", "말로 설명"]) {
      expect(within(card).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("미리보기는 도구마다 쉬운 말 카드로 보여 주고, 승인 전에는 문서가 그대로다", async () => {
    await paste();

    const card = screen.getByRole("dialog", { name: "이 연결을 넣을까요" });
    expect(within(card).getByText("search_articles")).toBeInTheDocument();
    expect(within(card).getByText("글을 찾아 준다.")).toBeInTheDocument();
    expect(within(card).getByText(/찾을 말.*찾은 글 목록/)).toBeInTheDocument();
    expect(within(card).getByText(/열쇠 값은 서버에 따로 둬요/)).toBeInTheDocument();
    expect(store().spec?.resources).toHaveLength(1);
  });

  it("문서에 넣으면 그 자리에서 목록에 나타나고, 되돌리기 한 걸음으로 빠진다", async () => {
    await paste();
    const steps = store().undoStack.length;

    await userEvent.click(screen.getByRole("button", { name: "문서에 넣기" }));

    expect(
      screen.queryByRole("dialog", { name: "이 연결을 넣을까요" }),
    ).not.toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "연결" });
    expect(within(panel).getByText("article-search")).toBeInTheDocument();
    expect(within(panel).getByText("search_articles")).toBeInTheDocument();
    expect(store().undoStack.length).toBe(steps + 1);

    act(() => store().undo());
    expect(store().spec?.resources?.map((one) => one.id)).toEqual([
      "clinical-reference",
    ]);
  });

  it("넣은 연결은 노드의 연결 고르기 목록에도 그대로 나타난다", async () => {
    await paste();
    await userEvent.click(screen.getByRole("button", { name: "문서에 넣기" }));

    act(() => {
      const spec = store().spec as AgentSpec;
      store().loadSpec({
        ...spec,
        nodes: [
          ...spec.nodes,
          { id: "tool", type: "tool.mcp", position: { x: 0, y: 0 }, config: {} },
        ],
      });
      store().select("node", "tool");
    });
    render(<Inspector />);

    expect(
      within(screen.getByRole("combobox", { name: /사용할 연결/ })).getByRole("option", {
        name: "article-search",
      }),
    ).toBeInTheDocument();
  });

  it("새로 들어올 연결이 없으면 말없이 입력으로 돌아가지 않고 그 사실을 말한다", async () => {
    useEditor.setState({
      wrapToolsOnServer: async () => ({ candidate: store().exportSpec(), issues: [] }),
    });
    await paste();

    const card = screen.getByRole("dialog", { name: "이 연결을 넣을까요" });
    expect(within(card).getByRole("alert")).toHaveTextContent(
      /새로 들어올 연결이 없어요/,
    );
    expect(
      within(card).queryByRole("button", { name: "문서에 넣기" }),
    ).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "다시 적기" })).toBeEnabled();
  });

  it("다시 적기를 고르면 붙여 넣던 자리로 돌아가고 문서는 그대로다", async () => {
    await paste();

    await userEvent.click(screen.getByRole("button", { name: "다시 적기" }));

    expect(
      screen.getByRole("dialog", { name: "무엇을 연결할까요" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "붙여 넣은 내용" })).toHaveValue(
      "openapi 3.1.0",
    );
    expect(store().spec?.resources).toHaveLength(1);
  });

  it("그만두면 문서를 그대로 두고 닫는다", async () => {
    render(<App />);
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "새 연결" }));

    await userEvent.click(screen.getByRole("button", { name: "그만두기" }));

    expect(
      screen.queryByRole("dialog", { name: "무엇을 연결할까요" }),
    ).not.toBeInTheDocument();
    expect(store().spec?.resources).toHaveLength(1);
  });

  it("붙여 넣기 전에는 무엇이 필요한지 말하며 기다린다", async () => {
    render(<App />);
    await openPanel();
    await userEvent.click(screen.getByRole("button", { name: "새 연결" }));

    const build = screen.getByRole("button", { name: "도구로 바꾸기" });
    expect(build).toBeDisabled();
    expect(build).toHaveAttribute("title", "먼저 붙여 넣어 주세요");
  });

  it("서버가 답하지 못하면 그 까닭을 말하고 적은 것을 잃지 않는다", async () => {
    useEditor.setState({
      wrapToolsOnServer: async () => ({ failure: { key: "toolWrap.error.offline" } }),
    });
    await paste();

    expect(screen.getByRole("alert")).toHaveTextContent(/서버에 닿지 못했어요/);
    expect(screen.getByRole("textbox", { name: "붙여 넣은 내용" })).toHaveValue(
      "openapi 3.1.0",
    );
  });
});
