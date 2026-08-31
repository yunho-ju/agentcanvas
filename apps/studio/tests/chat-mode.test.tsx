// 대화 모드로 드는 문 (F1~F5) — 열 수 있는가, 못 열면 왜인가, 열면 무엇이 물러나는가.
// 판정의 근거는 캔버스가 아니라 게시된 판이다 (DESIGN §7 chat-panel).
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { ChatPanel } from "../src/chat/ChatPanel";
import { EvalPanel } from "../src/eval/EvalPanel";
import { OptimizePanel } from "../src/optimize/OptimizePanel";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { SpecPublication } from "../src/generated/spec_publication";
import { setLocale } from "../src/i18n/localeStore";
import { ModeSegment } from "../src/shell/ModeSegment";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function graphTaking(...names: string[]): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.map((node) =>
      node.type === "core.input"
        ? {
            ...node,
            config: {
              bindings: Object.fromEntries(names.map((name) => [name, `input.${name}`])),
            },
          }
        : node,
    ),
  } as AgentSpec;
}

const publication: SpecPublication = {
  spec_id: example.id,
  revision: example.revision,
  published_at: "2026-08-01T12:00:00Z",
};

function chatButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "대화" }) as HTMLButtonElement;
}

function screenWithModes() {
  return render(
    <>
      <ModeSegment />
      <EvalPanel />
      <OptimizePanel />
      <ChatPanel />
    </>,
  );
}

beforeEach(() => {
  act(() => setLocale("ko"));
  // 시험마다 문서를 놓은 자리에서 시작한다 — 앞 시험이 읽어 본 판의 기억까지 함께 놓는다.
  act(() => useEditor.getState().abandonChat());
  useEditor.setState({
    spec: null,
    savedSpec: null,
    nodes: [],
    edges: [],
    runEvents: [],
    evalPanelOpen: false,
    optimizeMode: "closed",
    publication: null,
    publishedVersion: null,
    publishedSpec: null,
    publishedSpecFailure: null,
    chatOpen: false,
    chatTurns: [],
    chatThreadId: null,
    chatPin: null,
    chatDraft: "",
    chatNotice: null,
    askSpecRevision: async () => ({ saved: graphTaking("message"), issues: [] }),
  });
});

describe("대화 모드로 드는 문", () => {
  it("문서가 없으면 들어갈 수 없고 그 까닭을 말한다 (F4)", () => {
    screenWithModes();

    expect(chatButton()).toBeDisabled();
    expect(chatButton().title).toContain("먼저 만들거나 열어야");
  });

  it("내놓은 판이 없으면 들어갈 수 없고 게시하라고 말한다 (F2)", () => {
    act(() => {
      useEditor.setState({ spec: example });
    });
    screenWithModes();

    expect(chatButton()).toBeDisabled();
    expect(chatButton().title).toContain("게시");
  });

  it("내놓은 판이 사람 말을 받지 않으면 무엇을 고쳐야 하는지 말한다 (F3)", () => {
    act(() => {
      useEditor.setState({
        spec: example,
        publication,
        publishedSpec: graphTaking("question"),
      });
    });
    screenWithModes();

    expect(chatButton()).toBeDisabled();
    expect(chatButton().title).toContain("message");
  });

  it("내놓은 판이 message를 받으면 대화가 열린다 (F1)", async () => {
    act(() => {
      useEditor.setState({
        spec: example,
        publication,
        publishedSpec: graphTaking("message"),
      });
    });
    screenWithModes();

    await userEvent.click(chatButton());

    expect(store().chatOpen).toBe(true);
    expect(screen.getByRole("region", { name: "대화" })).toBeInTheDocument();
  });

  it("게시된 판을 아직 못 읽었으면 확인 중이라고 말한다 — 없다고 말하지 않는다", () => {
    act(() => {
      useEditor.setState({ spec: example, publication, publishedSpec: null });
    });
    screenWithModes();

    expect(chatButton()).toBeDisabled();
    expect(chatButton().title).toContain("확인하는 중");
  });

  it("대화를 열면 시험 패널은 물러난다 — 우측 자리는 하나다 (F5)", async () => {
    act(() => {
      useEditor.setState({
        spec: example,
        publication,
        publishedSpec: graphTaking("message"),
        evalPanelOpen: true,
      });
    });
    screenWithModes();

    await userEvent.click(chatButton());

    expect(store().evalPanelOpen).toBe(false);
    expect(screen.queryByRole("region", { name: "시험해 보기" })).toBeNull();
  });

  it("다시 누르면 대화가 닫힌다 — 같은 자리로 들고 난다", async () => {
    act(() => {
      useEditor.setState({
        spec: example,
        publication,
        publishedSpec: graphTaking("message"),
        chatOpen: true,
      });
    });
    screenWithModes();

    await userEvent.click(chatButton());

    expect(store().chatOpen).toBe(false);
    expect(screen.queryByRole("region", { name: "대화" })).toBeNull();
  });

  // M1 — 새 판을 게시한 직후, 손에 든 몸통은 아직 옛 판의 것이다.
  it("들고 있는 몸통이 지금 내놓은 판의 것이 아니면 문을 열지 않는다 — 빈 화면을 만들지 않는다", () => {
    act(() => {
      useEditor.setState({
        spec: example,
        publication: { ...publication, revision: `sha256:${"b".repeat(64)}` },
        publishedSpec: graphTaking("message"),
      });
    });
    screenWithModes();

    expect(chatButton()).toBeDisabled();
    expect(chatButton().title).toContain("확인하는 중");
  });

  // M2 — 못 읽었으면 "확인 중"이라고 거짓말하지 않고, 다시 확인할 길을 준다.
  it("판을 못 읽었으면 그 까닭을 말하고, 눌러서 다시 확인할 수 있다", async () => {
    let asks = 0;
    act(() => {
      useEditor.setState({
        spec: example,
        publication,
        publishedSpec: null,
        // 처음에는 서버에 닿지 못하고, 사람이 다시 눌렀을 때는 읽힌다.
        askSpecRevision: async () => {
          asks += 1;
          return asks === 1
            ? { failure: { key: "open.offline" } }
            : { saved: graphTaking("message"), issues: [] };
        },
      });
    });
    screenWithModes();

    await waitFor(() => expect(chatButton().title).toContain("확인하지 못했어요"));
    expect(chatButton()).not.toBeDisabled();

    await userEvent.click(chatButton());

    await waitFor(() => expect(asks).toBe(2));
    // 다시 읽혔으면 문은 열린 자리로 돌아간다 — 그때 비로소 대화가 열린다.
    await waitFor(() => expect(chatButton().title).not.toContain("확인하지 못했어요"));
    expect(store().chatOpen).toBe(false);
  });

  // M6 — 우측 자리는 하나다. 대화만 남을 닫는 것이 아니라 남도 대화를 닫는다.
  it("시험을 열면 대화가 물러난다 (F5 역방향)", async () => {
    act(() => {
      useEditor.setState({
        spec: example,
        publication,
        publishedSpec: graphTaking("message"),
        chatOpen: true,
      });
    });
    screenWithModes();

    await userEvent.click(screen.getByRole("button", { name: "시험" }));

    expect(store().chatOpen).toBe(false);
    expect(screen.queryByRole("region", { name: "대화" })).toBeNull();
  });

  it("고치기를 열어도 대화가 물러난다 (F5 역방향)", async () => {
    act(() => {
      useEditor.setState({
        spec: example,
        publication,
        publishedSpec: graphTaking("message"),
        chatOpen: true,
      });
    });
    screenWithModes();

    await userEvent.click(screen.getByRole("button", { name: "고치기" }));

    expect(store().chatOpen).toBe(false);
    expect(screen.queryByRole("region", { name: "대화" })).toBeNull();
  });

  it("만들기로 돌아가도 대화가 물러난다 (F5 역방향)", async () => {
    act(() => {
      useEditor.setState({
        spec: example,
        publication,
        publishedSpec: graphTaking("message"),
        chatOpen: true,
      });
    });
    screenWithModes();

    await userEvent.click(screen.getByRole("button", { name: "만들기" }));

    expect(store().chatOpen).toBe(false);
  });

  it("기존 네 모드는 그대로 있다 — 다섯째가 자리를 뺏지 않는다", () => {
    screenWithModes();

    for (const name of ["만들기", "실행", "시험", "고치기"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});
