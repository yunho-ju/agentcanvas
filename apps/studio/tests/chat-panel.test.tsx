// 대화 화면 — 말을 보내고(G1) 기다리고(G3) 실패·거절을 읽고(G5·G6·H2) 밸브에 답하고(H1)
// 새 대화·지우기·그만두기를 한다(I1~I3). 사람이 하는 그대로(클릭·타이핑) 시험한다.
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { ChatPanel } from "../src/chat/ChatPanel";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import type { SpecPublication } from "../src/generated/spec_publication";
import { setLocale } from "../src/i18n/localeStore";
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

function event(
  event_type: RunEvent["event_type"],
  payload: Record<string, unknown> = {},
  nodeId?: string,
  seq = 1,
): RunEvent {
  return {
    event_type,
    payload,
    run_id: "run_1",
    seq,
    spec_revision: example.revision,
    timestamp: "2026-08-01T12:30:00Z",
    ...(nodeId ? { node_id: nodeId } : {}),
  };
}

const ANSWERED = [
  event("llm.completed", { text: "반가워요" }, "clinical-agent"),
  event("run.completed", {}, undefined, 2),
];

/** 말을 받아 주는 서버 대역 — 흘려보낼 이벤트는 시험이 정한다. */
function serving(events: RunEvent[], hold = false) {
  let resume: (() => void) | null = null;
  useEditor.setState({
    sendChatTurn: async () => ({
      run: {
        id: "run_1",
        spec_id: example.id,
        spec_revision: example.revision,
        created_at: "2026-08-01T12:30:00Z",
        thread_id: "run_1",
      },
      status: "running",
    }),
    watchChatEvents: async (_runId, watch) => {
      if (hold) await new Promise<void>((wake) => (resume = wake));
      for (const one of events) watch.onEvent(one);
      return { ended: true, lastSeq: null };
    },
  });
  return { flow: () => resume?.() };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 25; tick += 1) await Promise.resolve();
  });
}

function saying(): HTMLTextAreaElement {
  return screen.getByLabelText("할 말") as HTMLTextAreaElement;
}

function sendButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "보내기" }) as HTMLButtonElement;
}

async function say(text: string): Promise<void> {
  await userEvent.type(saying(), text);
  await userEvent.click(sendButton());
  await settle();
}

beforeEach(() => {
  act(() => setLocale("ko"));
  // 시험마다 문서를 놓은 자리에서 시작한다 — 앞 시험이 읽어 본 판의 기억까지 함께 놓는다.
  act(() => useEditor.getState().abandonChat());
  useEditor.setState({
    spec: example,
    publication,
    publishedVersion: 7,
    publishedSpec: graphTaking("message"),
    chatOpen: true,
    chatThreadId: null,
    chatPin: null,
    chatTurns: [],
    chatDraft: "",
    chatNotice: null,
    chatDeleteAsking: false,
    chatAnswering: false,
    chatGateCardOpen: true,
    chatRejectAsking: false,
    chatSpec: null,
    publishedSpecFailure: null,
    feedbackNotice: null,
  });
});

describe("말을 주고받는 자리 (G1·G3·G5)", () => {
  it("아직 아무 말도 없으면 말을 걸어 보라고 초대한다", () => {
    render(<ChatPanel />);

    expect(screen.getByText(/말을 걸어 보세요/)).toBeInTheDocument();
  });

  it("보낸 말은 그 자리에 서고, 답이 오면 답이 따라 선다 (G1)", async () => {
    serving(ANSWERED);
    render(<ChatPanel />);

    await say("안녕");

    expect(screen.getByText("안녕")).toBeInTheDocument();
    expect(screen.getByText("반가워요")).toBeInTheDocument();
  });

  it("답을 기다리는 동안에는 기다린다고 말하고 입력줄을 잠근다 (G3)", async () => {
    const server = serving(ANSWERED, true);
    render(<ChatPanel />);

    await say("안녕");

    expect(screen.getByText("답을 만드는 중이에요")).toBeInTheDocument();
    expect(saying()).toBeDisabled();
    expect(sendButton()).toBeDisabled();
    expect(sendButton().title).toContain("기다려");

    await act(async () => server.flow());
    await settle();

    expect(screen.getByText("반가워요")).toBeInTheDocument();
    expect(saying()).not.toBeDisabled();
  });

  it("적은 말이 없으면 보내기가 이유를 말한다", () => {
    render(<ChatPanel />);

    expect(sendButton()).toBeDisabled();
    expect(sendButton().title).toContain("적어");
  });

  it("실패한 말은 쉬운 말로 남고 입력줄이 다시 열린다 (G5)", async () => {
    serving([event("run.failed", { reason: "provider_error" })]);
    render(<ChatPanel />);

    await say("안녕");

    expect(screen.getByText("안녕")).toBeInTheDocument();
    expect(screen.queryByText(/provider_error/)).toBeNull();
    expect(screen.getByRole("alert").textContent).not.toBe("");
    expect(saying()).not.toBeDisabled();
  });

  it("서버가 말을 물리면 그 까닭과 다음 걸음을 말한다 (G6)", async () => {
    useEditor.setState({
      sendChatTurn: async () => ({ failure: { key: "chat.start.notPublished" } }),
    });
    render(<ChatPanel />);

    await say("안녕");

    expect(screen.getByText(/먼저 게시하면/)).toBeInTheDocument();
    expect(saying()).not.toBeDisabled();
  });
});

describe("어느 판과 이야기하는지 보인다 (G4)", () => {
  it("첫 말을 보내면 붙잡은 판을 말한다", async () => {
    serving(ANSWERED);
    render(<ChatPanel />);

    await say("안녕");

    expect(screen.getByText(/7번째 판과 이야기하는 중/)).toBeInTheDocument();
  });

  it("대화 도중 다른 판을 게시해도 그 줄은 바뀌지 않는다", async () => {
    serving(ANSWERED);
    render(<ChatPanel />);
    await say("안녕");

    await act(async () => {
      useEditor.setState({
        publication: { ...publication, revision: `sha256:${"b".repeat(64)}` },
        publishedVersion: 9,
      });
    });

    expect(screen.getByText(/7번째 판과 이야기하는 중/)).toBeInTheDocument();
    expect(screen.queryByText(/9번째 판/)).toBeNull();
  });
});

describe("대화 안의 밸브 (H1·H2)", () => {
  const HELD = [
    event("human.approval_requested", {}, "human-gate"),
    event("run.paused", { waiting_for: "human-gate" }, "human-gate", 2),
  ];

  function answering(after: RunEvent[]) {
    useEditor.setState({
      sendRunAnswer: async (runId) => {
        // 사람의 답에 이어지는 사건들은 스트림으로 오던 것과 같은 길로 도착한다.
        store().appendChatEvents(runId, after);
        return {
          run: {
            id: runId,
            spec_id: example.id,
            spec_revision: example.revision,
            created_at: "2026-08-01T12:30:00Z",
            thread_id: "run_1",
          },
          status: "running",
        };
      },
    });
  }

  it("확인을 기다리면 대화 안에서 승인할 수 있고, 승인하면 답이 온다 (H1)", async () => {
    serving(HELD);
    answering([
      event("run.resumed", { waiting_for: "human-gate", approved: true }, "human-gate", 3),
      event("llm.completed", { text: "반가워요" }, "clinical-agent", 4),
      event("run.completed", {}, undefined, 5),
    ]);
    render(<ChatPanel />);
    await say("안녕");

    await userEvent.click(screen.getByRole("button", { name: "승인하고 계속" }));
    await settle();

    expect(screen.getByText("반가워요")).toBeInTheDocument();
  });

  it("도구를 부르기 전 확인이면 어느 도구를 승인하는지 말한다 (M5 — 실행 화면과 같은 말)", async () => {
    const withTool = {
      ...graphTaking("message"),
      resources: [
        {
          id: "clinical-reference",
          kind: "mcp.toolset",
          server_ref: "mcp://clinical-reference",
          approval_policy: "ask_first",
          tools: [
            {
              name: "lookup",
              plain_description: { ko: "이름으로 문헌을 찾아요.", en: "Finds an article." },
              input_schema: { type: "object" },
              output_schema: { type: "string" },
              timeout_ms: 5000,
              call: { transport: "mcp", remote_name: "lookup" },
            },
          ],
        },
      ],
    } as unknown as AgentSpec;
    act(() => {
      useEditor.setState({ publishedSpec: withTool, chatSpec: null });
    });
    serving([
      event(
        "human.approval_requested",
        { tool_name: "lookup", resource_ref: "clinical-reference" },
        "clinical-agent",
      ),
      event("run.paused", { waiting_for: "clinical-agent" }, "clinical-agent", 2),
    ]);
    render(<ChatPanel />);

    await say("안녕");

    expect(screen.getByText(/'lookup' 도구를 불러도 될까요/)).toBeInTheDocument();
    expect(screen.getByText("이름으로 문헌을 찾아요.")).toBeInTheDocument();
  });

  it("확인 카드를 닫아 둬도 돌아갈 길이 남는다 — 실행은 멈춘 채다 (M5)", async () => {
    serving(HELD);
    render(<ChatPanel />);
    await say("안녕");

    act(() => {
      store().setChatGateCardOpen(false);
    });

    expect(screen.queryByRole("button", { name: "승인하고 계속" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "확인하러 가기" }));

    expect(screen.getByRole("button", { name: "승인하고 계속" })).toBeInTheDocument();
  });

  it("거절 되묻기는 store가 안다 — Esc가 무엇을 먼저 무를지 화면 밖도 알아야 한다 (M5)", async () => {
    serving(HELD);
    render(<ChatPanel />);
    await say("안녕");

    await userEvent.click(screen.getByRole("button", { name: "거절하기" }));

    expect(store().chatRejectAsking).toBe(true);
    act(() => store().cancelChatRejectGate());
    expect(screen.getByRole("button", { name: "거절하기" })).toBeInTheDocument();
  });

  it("거절하면 그 말이 거절로 끝났다고 대화에 남는다 (H2)", async () => {
    serving(HELD);
    answering([
      event("run.resumed", { waiting_for: "human-gate", approved: false }, "human-gate", 3),
      event("run.completed", {}, undefined, 4),
    ]);
    render(<ChatPanel />);
    await say("안녕");

    // 거절은 되돌릴 수 없다 — 실행 화면과 같은 문법으로 한 번 더 묻는다.
    await userEvent.click(screen.getByRole("button", { name: "거절하기" }));
    await userEvent.click(screen.getByRole("button", { name: "정말 거절하기" }));
    await settle();

    expect(screen.getByText(/거절해서 이 말은 여기서 끝났어요/)).toBeInTheDocument();
    expect(saying()).not.toBeDisabled();
  });
});

describe("새 대화·지우기·그만두기 (I1~I3)", () => {
  it("새 대화는 화면만 비운다 — 서버에는 아무 부탁도 하지 않는다 (I1)", async () => {
    serving(ANSWERED);
    let deletes = 0;
    useEditor.setState({
      sendThreadDelete: async () => {
        deletes += 1;
        return { ok: true };
      },
    });
    render(<ChatPanel />);
    await say("안녕");

    await userEvent.click(screen.getByRole("button", { name: "새 대화" }));

    expect(screen.queryByText("안녕")).toBeNull();
    expect(deletes).toBe(0);
  });

  it("지우기는 한 번 더 묻고 나서 지운다 (I2)", async () => {
    serving(ANSWERED);
    useEditor.setState({ sendThreadDelete: async () => ({ ok: true }) });
    render(<ChatPanel />);
    await say("안녕");

    await userEvent.click(screen.getByRole("button", { name: "대화 지우기" }));
    expect(screen.getByText(/정말 지울까요/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    await settle();

    expect(screen.queryByText("안녕")).toBeNull();
    expect(store().feedbackNotice?.message).toEqual({ key: "chat.delete.ok" });
  });

  it("되묻는 물음은 무를 수 있다 — 무르면 대화는 그대로다 (I2)", async () => {
    serving(ANSWERED);
    render(<ChatPanel />);
    await say("안녕");

    await userEvent.click(screen.getByRole("button", { name: "대화 지우기" }));
    await userEvent.click(screen.getByRole("button", { name: "그대로 두기" }));

    expect(screen.getByText("안녕")).toBeInTheDocument();
    expect(screen.queryByText(/정말 지울까요/)).toBeNull();
  });

  it("아직 끝나지 않은 말이 있으면 왜 못 지웠는지 말한다 (I3)", async () => {
    serving(ANSWERED);
    useEditor.setState({
      sendThreadDelete: async () => ({ failure: { key: "chat.thread.delete.stillGoing" } }),
    });
    render(<ChatPanel />);
    await say("안녕");

    await userEvent.click(screen.getByRole("button", { name: "대화 지우기" }));
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    await settle();

    expect(screen.getByText(/하나도 지우지 않았어요/)).toBeInTheDocument();
    expect(screen.getByText("안녕")).toBeInTheDocument();
  });

  it("기다리는 동안에는 그만두는 길이 화면에 있다 — 지울 수 없는 대화를 만들지 않는다 (I3)", async () => {
    const server = serving(ANSWERED, true);
    const stopped: string[] = [];
    useEditor.setState({
      sendRunCancel: async (runId) => {
        stopped.push(runId);
        return { ok: true };
      },
    });
    render(<ChatPanel />);
    await say("안녕");

    await userEvent.click(screen.getByRole("button", { name: "그만 기다리기" }));
    await settle();

    expect(stopped).toEqual(["run_1"]);
    expect(saying()).not.toBeDisabled();
    server.flow();
  });
});
