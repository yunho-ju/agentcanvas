import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { StatusBar } from "../src/canvas/StatusBar";
import type { AgentSpec } from "../src/generated/agent_spec";
import { msg } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

beforeEach(() => {
  useEditor.setState({
    connectionHint: null,
    isDraft: false,
    notice: null,
    feedbackNotice: null,
  });
});

describe("StatusBar", () => {
  it("stays quiet while nothing is wrong", () => {
    render(<StatusBar />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // 연결이 안 되는 이유는 손이 있는 자리에서 말한다 (DESIGN §7 채널 분리).
  it("says nothing about a connection that was refused", () => {
    useEditor.getState().loadSpec(example);
    useEditor.getState().connect(
      {
        source: "triage",
        sourceHandle: "route",
        target: "clinical-agent",
        targetHandle: "messages",
      },
      { x: 40, y: 60 },
    );

    render(<StatusBar />);

    expect(useEditor.getState().connectionHint).not.toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/종류가 달라요/)).not.toBeInTheDocument();
  });

  it("tells the user that this graph is a new draft, not a loaded file", () => {
    useEditor.setState({ isDraft: true });
    render(<StatusBar />);
    expect(screen.getByText("새 초안")).toBeInTheDocument();
  });

  it("says nothing about a draft once a file has been loaded", () => {
    render(<StatusBar />);
    expect(screen.queryByText("새 초안")).not.toBeInTheDocument();
  });

  it("tells the user what an edit did behind their back", () => {
    useEditor.setState({
      notice: msg("edit.config.notice", {
        id: "input",
        impact: [msg("impact.edges.did", { count: 1 })],
      }),
    });
    render(<StatusBar />);
    expect(screen.getByRole("status")).toHaveTextContent("연결 1개가 끊어졌다");
  });

  it("lets the user dismiss that notice too", async () => {
    useEditor.setState({ notice: msg("impact.edges.did", { count: 1 }) });
    render(<StatusBar />);

    await userEvent.click(screen.getByRole("button", { name: "확인" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

});

// 저장 소식은 세기가 다르다 — 잘 됐는가, 손볼 곳이 남았는가, 못 했는가 (DESIGN §7 doc-card).
describe("저장 소식 토스트", () => {
  const app = readFileSync(join(process.cwd(), "src/app.css"), "utf-8");

  function cssBlock(selector: string): string {
    const at = app.indexOf(`${selector} {`);
    return at === -1 ? "" : app.slice(at, app.indexOf("}", at));
  }

  it("잘 저장했으면 그렇게 말하고 닫을 수 있다", async () => {
    useEditor.setState({ feedbackNotice: { message: msg("save.ok"), tone: "ok" } });
    render(<StatusBar />);

    expect(screen.getByRole("status")).toHaveTextContent("저장했어요");

    await userEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(useEditor.getState().feedbackNotice).toBeNull();
  });

  it("손볼 곳이 남았으면 그 세기로 말한다", () => {
    useEditor.setState({
      feedbackNotice: { message: msg("save.ok.issues", { count: 2 }), tone: "warn" },
    });
    const { container } = render(<StatusBar />);

    expect(screen.getByRole("status")).toHaveTextContent("손볼 곳 2곳");
    expect(container.querySelector('[data-tone="warn"]')).toBeInTheDocument();
  });

  it("저장하지 못했으면 무엇이 문제인지 말한다", () => {
    useEditor.setState({ feedbackNotice: { message: msg("save.offline"), tone: "danger" } });
    const { container } = render(<StatusBar />);

    expect(screen.getByRole("alert")).toHaveTextContent("서버에 닿지 못했어요");
    expect(container.querySelector('[data-tone="danger"]')).toBeInTheDocument();
  });

  it("세 가지 세기를 색과 기호 둘로 나눈다 — 색만으로 말하지 않는다", () => {
    expect(cssBlock('.status-bar__toast[data-tone="ok"]')).toContain("var(--accent)");
    expect(cssBlock('.status-bar__toast[data-tone="warn"]')).toContain("var(--warn)");
    expect(cssBlock('.status-bar__toast[data-tone="danger"]')).toContain("var(--danger)");
  });

  it.each([
    ["ok", "save.ok", "✓"],
    ["warn", "save.ok.issues", "!"],
    ["danger", "save.offline", "✕"],
  ])("%s 소식은 저만의 기호를 단다", (tone, key, mark) => {
    useEditor.setState({
      feedbackNotice: {
        message: msg(key as "save.ok", { count: 1 }),
        tone: tone as "ok" | "warn" | "danger",
      },
    });
    const { container } = render(<StatusBar />);

    expect(container.querySelector(".status-bar__mark")).toHaveTextContent(mark);
  });
});
