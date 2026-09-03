// 지난 대화 — 목록에서 고르고(J), 골라 열어 이어 말하고(K), 뷰를 오간다(L).
// 사람이 하는 그대로(클릭) 시험한다. 복원은 세션 기억이 아니라 서버에 쌓인 이벤트에서 나온다.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { SaveOutcome } from "../src/api/specs";
import type { ThreadEventsOutcome, ThreadSummary, ThreadTurn } from "../src/api/threads";
import { ChatPanel } from "../src/chat/ChatPanel";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import type { SpecPublication } from "../src/generated/spec_publication";
import { setLocale } from "../src/i18n/localeStore";
import { chatGateIsAsking } from "../src/store/chatSlice";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

/** 지난 대화가 붙잡았던 판 — 지금 게시된 판과 다른 판이다 (결정 3). */
const PAST_REVISION = `sha256:${"a".repeat(64)}`;

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

let seq = 0;

function event(
  event_type: RunEvent["event_type"],
  payload: Record<string, unknown> = {},
  nodeId?: string,
  runId = "run_1",
): RunEvent {
  seq += 1;
  return {
    event_type,
    payload,
    run_id: runId,
    seq,
    spec_revision: PAST_REVISION,
    timestamp: "2026-08-01T12:30:00Z",
    ...(nodeId ? { node_id: nodeId } : {}),
  };
}

function threadTurn(runId: string, threadId: string, events: RunEvent[]): ThreadTurn {
  return {
    run: {
      id: runId,
      spec_id: example.id,
      spec_revision: PAST_REVISION,
      created_at: "2026-08-01T12:30:00Z",
      thread_id: threadId,
    },
    events,
  };
}

function summary(known: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    thread_id: "run_1",
    first_said: "안녕",
    started_at: "2026-08-01T12:30:00Z",
    last_at: "2026-08-01T12:40:00Z",
    turns: 2,
    last_status: "completed",
    spec_revision: PAST_REVISION,
    ...known,
  };
}

/** 답까지 오간 대화 하나 — 복원하면 말풍선 두 개가 선다. */
const ANSWERED_THREAD = [
  threadTurn("run_1", "run_1", [
    event("run.started", { input: { message: "안녕" } }),
    event("llm.completed", { text: "반가워요" }, "clinical-agent"),
    event("run.completed", {}),
  ]),
];

/** 서버 대역 — 목록·이벤트·판 몸통·판 기록을 시험이 정한다. */
function serving(
  known: {
    threads?: ThreadSummary[];
    turns?: ThreadTurn[];
    events?: () => Promise<ThreadEventsOutcome>;
    body?: () => Promise<SaveOutcome>;
  } = {},
) {
  const asked: { threadId: string | null; sent: unknown[] } = { threadId: null, sent: [] };
  useEditor.setState({
    askSpecThreads: async () => ({ threads: known.threads ?? [summary()] }),
    askThreadEvents:
      known.events ??
      (async () => ({ turns: known.turns ?? ANSWERED_THREAD })),
    askSpecRevision:
      known.body ?? (async () => ({ saved: graphTaking("message"), issues: [] })),
    fetchRevisions: async () => ({
      revisions: [
        { version: 3, revision: PAST_REVISION, created_at: "2026-08-01T12:00:00Z" },
      ],
    }),
    sendChatTurn: async (_specId, turn) => {
      asked.sent.push(turn);
      return {
        run: {
          id: "run_9",
          spec_id: example.id,
          spec_revision: PAST_REVISION,
          created_at: "2026-08-01T13:00:00Z",
          thread_id: turn.threadId ?? "run_9",
        },
        status: "running",
      };
    },
    // 기본 대역의 스트림은 아무것도 흘리지 않고 닫힌다 — 무엇이 흘러오는지는 시험이 정한다.
    watchChatEvents: async () => ({ ended: true, lastSeq: null }),
    sendThreadDelete: async (threadId) => {
      asked.threadId = threadId;
      return { ok: true };
    },
  });
  return asked;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 25; tick += 1) await Promise.resolve();
  });
}

/** 목록 뷰로 간다 — 대화 안에서 3초 안에 찾을 수 있어야 하는 그 손잡이다. */
async function goToPast(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "지난 대화" }));
  await settle();
}

function rows(): string[] {
  return screen.getAllByRole("listitem").map((row) => row.textContent ?? "");
}

beforeEach(() => {
  act(() => setLocale("ko"));
  act(() => useEditor.getState().abandonChat());
  useEditor.setState({
    spec: example,
    publication,
    publishedVersion: 7,
    publishedSpec: graphTaking("message"),
    chatOpen: true,
    feedbackNotice: null,
  });
});

describe("지난 대화 목록 (J1~J4)", () => {
  it("최근에 말이 오간 대화가 위에 서고, 제목·시각·횟수·상태를 말한다 (J1)", async () => {
    serving({
      threads: [
        summary({ thread_id: "run_5", first_said: "나중 말", turns: 3 }),
        summary({ thread_id: "run_1", first_said: "먼저 말" }),
      ],
    });
    render(<ChatPanel />);

    await goToPast();

    expect(rows()[0]).toContain("나중 말");
    expect(rows()[1]).toContain("먼저 말");
    expect(rows()[0]).toContain("3번 오감");
    expect(rows()[0]).toContain("끝난 대화");
  });

  it("지난 대화가 없으면 말을 걸어 보라고 초대한다 (J2)", async () => {
    serving({ threads: [] });
    render(<ChatPanel />);

    await goToPast();

    expect(screen.getByText(/아직 지난 대화가 없어요/)).toBeInTheDocument();
  });

  it("사람 말 없이 시작한 실행도 목록에 서고, 제목을 지어내지 않는다 (J3)", async () => {
    serving({ threads: [summary({ first_said: null })] });
    render(<ChatPanel />);

    await goToPast();

    expect(screen.getByText("말 없이 시작한 실행")).toBeInTheDocument();
  });

  it("목록에서 지우기는 한 번 더 묻고, 지운 대화는 목록에서 사라진다 (J4)", async () => {
    const server = serving({ threads: [summary({ thread_id: "run_5", first_said: "지울 말" })] });
    render(<ChatPanel />);
    await goToPast();

    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    expect(screen.getByText(/정말 지울까요/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    await settle();

    expect(server.threadId).toBe("run_5");
    expect(screen.queryByText("지울 말")).toBeNull();
  });

  it("아직 끝나지 않은 말이 있으면 왜 못 지웠는지 목록 안에서 말한다 (J4)", async () => {
    serving({ threads: [summary({ first_said: "지울 말" })] });
    useEditor.setState({
      sendThreadDelete: async () => ({ failure: { key: "chat.thread.delete.stillGoing" } }),
    });
    render(<ChatPanel />);
    await goToPast();

    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    await settle();

    expect(screen.getByText(/하나도 지우지 않았어요/)).toBeInTheDocument();
    expect(screen.getByText("지울 말")).toBeInTheDocument();
  });

  it("되묻는 물음을 무르면 그 대화는 목록에 그대로 있다 (J4)", async () => {
    const server = serving({ threads: [summary({ first_said: "지울 말" })] });
    render(<ChatPanel />);
    await goToPast();

    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    await userEvent.click(screen.getByRole("button", { name: "그대로 두기" }));

    expect(screen.queryByText(/정말 지울까요/)).toBeNull();
    expect(screen.getByText("지울 말")).toBeInTheDocument();
    expect(server.threadId).toBeNull();
  });

  it("열어 둔 대화를 지우면 화면의 그 대화도 함께 비워진다 (J4)", async () => {
    serving();
    render(<ChatPanel />);
    await goToPast();
    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));
    await settle();

    await goToPast();
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    await settle();

    expect(store().chatThreadId).toBeNull();
    expect(store().chatTurns).toEqual([]);
  });

  // T6 ① — 한 대화를 못 읽은 것과 목록을 못 읽은 것은 다른 말이다.
  it("목록을 못 불러오면 목록 전용 문구로 말하고 다시 불러올 길을 준다", async () => {
    let asks = 0;
    serving();
    useEditor.setState({
      askSpecThreads: async () => {
        asks += 1;
        return asks === 1
          ? { failure: { key: "chat.threads.read.offline" } }
          : { threads: [summary({ first_said: "돌아온 말" })] };
      },
    });
    render(<ChatPanel />);
    await goToPast();

    expect(screen.getByText(/지난 대화 목록을 불러오지 못했어요/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
    await settle();

    expect(screen.getByText("돌아온 말")).toBeInTheDocument();
  });
});

describe("대화 문을 열고 닫을 때 (결정 1)", () => {
  it("아직 아무 말도 없이 대화를 열면 지난 대화가 먼저 보인다", async () => {
    serving({ threads: [summary({ first_said: "지난 말" })] });
    render(<ChatPanel />);

    await act(async () => store().enterChatMode());
    await settle();

    expect(screen.getByText("지난 말")).toBeInTheDocument();
  });

  // 이어 갈 대화가 0개면 목록은 막다른 골목이다 — 처음 온 사람은 곧장 말을 걸 수 있어야 한다.
  it("이어 갈 지난 대화가 없으면 적는 자리로 열고 입력줄에 손을 얹는다", async () => {
    serving({ threads: [] });
    render(<ChatPanel />);

    await act(async () => store().enterChatMode());
    await settle();

    expect(screen.getByLabelText("할 말")).toBeInTheDocument();
    expect(screen.getByLabelText("할 말")).toHaveFocus();
  });

  // 적던 말은 사람의 것이다 (DESIGN §1 Esc 체인 ③′와 같은 규칙).
  it("목록이 오기 전에 적기 시작했으면 목록으로 데려가지 않는다", async () => {
    let handOver: (threads: ThreadSummary[]) => void = () => {};
    const later = new Promise<ThreadSummary[]>((keep) => {
      handOver = keep;
    });
    serving();
    useEditor.setState({ askSpecThreads: async () => ({ threads: await later }) });
    render(<ChatPanel />);

    await act(async () => store().enterChatMode());
    await userEvent.type(screen.getByLabelText("할 말"), "안녕");
    await act(async () => {
      handOver([summary({ first_said: "지난 말" })]);
    });
    await settle();

    expect(screen.getByLabelText("할 말")).toHaveValue("안녕");
    expect(screen.queryByText("지난 말")).not.toBeInTheDocument();
  });

  it("하던 말이 있으면 하던 대화로 든다 — 목록이 대화를 가리지 않는다", async () => {
    serving();
    render(<ChatPanel />);
    await userEvent.type(screen.getByLabelText("할 말"), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await settle();

    await act(async () => store().enterChatMode());
    await settle();

    expect(screen.getByLabelText("할 말")).toBeInTheDocument();
  });

  it("대화를 떠나면 목록도 놓는다 — 다시 들어오면 서버에서 새로 읽는다", async () => {
    serving();
    render(<ChatPanel />);
    await goToPast();

    await act(async () => store().leaveChatMode());

    expect(store().chatThreads).toBeNull();
    expect(store().chatView).toBe("now");
  });
});

describe("지난 대화 열기 (K1~K6)", () => {
  async function openFirst(): Promise<void> {
    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));
    await settle();
  }

  it("고른 대화가 실시간과 같은 말풍선으로 되살아난다 (K1)", async () => {
    serving();
    render(<ChatPanel />);
    await goToPast();

    await openFirst();

    expect(screen.getByText("안녕")).toBeInTheDocument();
    expect(screen.getByText("반가워요")).toBeInTheDocument();
    expect(screen.getByLabelText("할 말")).not.toBeDisabled();
  });

  it("복원한 대화는 그 대화가 집었던 판을 말한다 — 지금 게시된 판이 아니다 (K1·결정 3)", async () => {
    serving();
    render(<ChatPanel />);
    await goToPast();

    await openFirst();

    expect(screen.getByText(/3번째 판과 이야기하는 중/)).toBeInTheDocument();
    expect(screen.queryByText(/7번째 판/)).toBeNull();
  });

  it("판 기록에서 번호를 못 찾으면 번호를 지어내지 않는다", async () => {
    serving();
    useEditor.setState({ fetchRevisions: async () => ({ revisions: [] }) });
    render(<ChatPanel />);
    await goToPast();

    await openFirst();

    expect(screen.getByText(/내놓은 판과 이야기하는 중/)).toBeInTheDocument();
  });

  it("이어 말하면 같은 대화로 이어진다 (K2)", async () => {
    const server = serving();
    render(<ChatPanel />);
    await goToPast();
    await openFirst();

    await userEvent.type(screen.getByLabelText("할 말"), "잘 지내?");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await settle();

    expect(server.sent).toEqual([{ threadId: "run_1", input: { message: "잘 지내?" } }]);
  });

  // M1 — 멈춰 선 대화를 복원했으면 그 실행을 다시 듣는다: 답을 보낸 뒤 이어지는 사건은
  // 스트림으로 도착한다(화면이 대신 넣어 주지 않는다). 그래서 시험도 스트림 자리에만 대역을 꽂는다.
  it("확인을 기다리며 멈춘 대화는 승인 카드째 되살아나고, 승인하면 답이 스트림으로 도착한다 (K3)", async () => {
    const held = [
      event("run.started", { input: { message: "안녕" } }),
      event("human.approval_requested", {}, "human-gate"),
      event("run.paused", { waiting_for: "human-gate" }, "human-gate"),
    ];
    const after = [
      event("run.resumed", { waiting_for: "human-gate", approved: true }, "human-gate"),
      event("llm.completed", { text: "이어서 답해요" }, "clinical-agent"),
      event("run.completed", {}),
    ];
    serving({ turns: [threadTurn("run_1", "run_1", held)] });
    let deliver: (() => void) | null = null;
    useEditor.setState({
      watchChatEvents: async (_runId, watch) => {
        await new Promise<void>((wake) => (deliver = wake));
        // 서버는 이미 쌓인 것부터 다시 흘려보낸다 — 같은 순번을 두 번 세지 않는다.
        for (const one of [...held, ...after]) watch.onEvent(one);
        return { ended: true, lastSeq: null };
      },
      sendRunAnswer: async (runId) => {
        (deliver as (() => void) | null)?.();
        return {
          run: {
            id: runId,
            spec_id: example.id,
            spec_revision: PAST_REVISION,
            created_at: "2026-08-01T12:30:00Z",
            thread_id: "run_1",
          },
          status: "running",
        };
      },
    });
    render(<ChatPanel />);
    await goToPast();
    await openFirst();
    expect(screen.getByRole("button", { name: "승인하고 계속" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "승인하고 계속" }));
    await settle();

    expect(screen.getAllByText("이어서 답해요")).toHaveLength(1);
    expect(store().chatTurns[0].events).toHaveLength(held.length + after.length);
  });

  // M2 — 세 번 묻고 오는 사이에 자리를 뜨면 그 대답은 이 자리의 것이 아니다.
  it("열기 도중 대화를 떠나면 늦게 온 대답이 버린 대화를 되살리지 못한다", async () => {
    let release: ((outcome: ThreadEventsOutcome) => void) | null = null;
    serving({
      events: () => new Promise<ThreadEventsOutcome>((keep) => (release = keep)),
    });
    render(<ChatPanel />);
    await goToPast();

    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));
    await act(async () => store().leaveChatMode());
    await act(async () => {
      (release as ((outcome: ThreadEventsOutcome) => void) | null)?.({
        turns: ANSWERED_THREAD,
      });
    });
    await settle();

    expect(store().chatTurns).toEqual([]);
    expect(store().chatThreadId).toBeNull();
    expect(store().chatOpen).toBe(false);
  });

  it("아직 도는 중인 대화는 따라가는 척하지 않고 그렇다고 말한다 (G5류)", async () => {
    serving({
      turns: [
        threadTurn("run_1", "run_1", [event("run.started", { input: { message: "안녕" } })]),
      ],
    });
    render(<ChatPanel />);
    await goToPast();

    await openFirst();

    expect(screen.getByText(/다른 곳에서 진행 중이에요/)).toBeInTheDocument();
  });

  it("새로고침한 것처럼 다 잊어도 목록에서 다시 열면 같은 대화가 돌아온다 (K4)", async () => {
    serving();
    render(<ChatPanel />);
    await goToPast();
    await openFirst();

    // 세션 기억을 통째로 놓는다 — 복원은 서버에 쌓인 이벤트에서만 나온다.
    await act(async () => {
      store().abandonChat();
      // 새로 열린 화면이 다시 읽어 온 것은 게시된 판뿐이다 — 오간 말은 아무것도 없다.
      useEditor.setState({ chatOpen: true, publishedSpec: graphTaking("message") });
    });
    await goToPast();
    await openFirst();

    expect(screen.getByText("안녕")).toBeInTheDocument();
    expect(screen.getByText("반가워요")).toBeInTheDocument();
  });

  it("오간 말을 못 읽으면 쉬운 말로 말하고 다시 열 길을 준다 (K5)", async () => {
    // 못 읽는 동안과 읽히는 동안을 시험이 정한다 — 몇 번째 물음인지로 정하지 않는다
    // (목록은 고칠 자리를 훑느라 같은 문을 여러 번 두드린다).
    let readable = false;
    serving({
      events: async () =>
        readable
          ? { turns: ANSWERED_THREAD }
          : { failure: { key: "chat.thread.read.failed", params: { status: "500" } } },
    });
    render(<ChatPanel />);
    await goToPast();

    await openFirst();

    expect(screen.getByText(/오간 말을 불러오지 못했어요/)).toBeInTheDocument();
    expect(screen.queryByText("반가워요")).toBeNull();

    readable = true;
    await userEvent.click(screen.getByRole("button", { name: "다시 열어 보기" }));
    await settle();

    expect(screen.getByText("반가워요")).toBeInTheDocument();
  });

  it("오간 말이 하나도 없는 대화는 열지 않고 그렇다고 말한다 (K5)", async () => {
    serving({ turns: [] });
    render(<ChatPanel />);
    await goToPast();

    await openFirst();

    expect(screen.getByText(/오간 말이 없어요/)).toBeInTheDocument();
    expect(store().chatThreadId).toBeNull();
  });

  it("그 대화가 집었던 판의 몸통을 못 읽어도 같은 문법으로 말한다 (K6)", async () => {
    serving({ body: async () => ({ failure: { key: "open.offline" } }) });
    render(<ChatPanel />);
    await goToPast();

    await openFirst();

    expect(screen.getByRole("button", { name: "다시 열어 보기" })).toBeInTheDocument();
    expect(screen.queryByText("반가워요")).toBeNull();
  });
});

describe("여는 동안·연 뒤에 화면이 지키는 것", () => {
  const HELD_THREAD = [
    threadTurn("run_1", "run_1", [
      event("run.started", { input: { message: "안녕" } }),
      event("human.approval_requested", {}, "human-gate"),
      event("run.paused", { waiting_for: "human-gate" }, "human-gate"),
    ]),
  ];
  const GOING_THREAD = [
    threadTurn("run_1", "run_1", [event("run.started", { input: { message: "안녕" } })]),
  ];

  async function openFirst(): Promise<void> {
    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));
    await settle();
  }

  // m3 — 목록 뷰에는 확인 카드가 없다: 보이지 않는 것에 Esc를 쓰지 않는다.
  it("목록을 보는 동안에는 멈춘 대화의 확인 카드가 Esc를 가져가지 않는다", async () => {
    serving({ turns: HELD_THREAD });
    render(<ChatPanel />);
    await goToPast();
    await openFirst();
    expect(chatGateIsAsking(store())).toBe(true);

    await goToPast();

    expect(chatGateIsAsking(store())).toBe(false);
  });

  // m4 — 듣고 있지 않으면서 기다리는 척하지 않는다.
  it("다른 곳에서 도는 대화를 복원하면 기다리는 줄을 세우지 않는다", async () => {
    serving({ turns: GOING_THREAD });
    render(<ChatPanel />);
    await goToPast();

    await openFirst();

    expect(screen.getByText(/다른 곳에서 진행 중이에요/)).toBeInTheDocument();
    expect(screen.queryByText("답을 만드는 중이에요")).toBeNull();
  });

  // 떠난 뒤 도착한 실패도 이 자리의 것이 아니다 — 그리고 '여는 중'이 굳어 목록이 잠기지 않는다.
  it("열기 도중 대화를 떠나면 늦게 온 실패도 화면을 바꾸지 않는다", async () => {
    let release: ((outcome: ThreadEventsOutcome) => void) | null = null;
    serving({
      events: () => new Promise<ThreadEventsOutcome>((keep) => (release = keep)),
    });
    render(<ChatPanel />);
    await goToPast();

    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));
    await act(async () => store().leaveChatMode());
    await act(async () => {
      (release as ((outcome: ThreadEventsOutcome) => void) | null)?.({
        failure: { key: "chat.thread.read.offline" },
      });
    });
    await settle();

    expect(store().chatOpenTrouble).toBeNull();
    expect(store().chatOpening).toBeNull();
    expect(store().chatTurns).toEqual([]);
  });

  it("여는 도중에는 지우기 확정도 기다린다 — 여는 사이에 세대가 바뀌지 않게", async () => {
    serving({
      threads: [summary(), summary({ thread_id: "run_5", first_said: "다른 말" })],
      events: () => new Promise<ThreadEventsOutcome>(() => undefined),
    });
    render(<ChatPanel />);
    await goToPast();
    await userEvent.click(within(screen.getAllByRole("listitem")[1]).getByRole("button", { name: "지우기" }));

    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));

    expect(
      within(screen.getAllByRole("listitem")[1]).getByRole("button", { name: "지우기" }),
    ).toBeDisabled();
  });

  it("열어 둔 대화를 지우는 사이에 온 대답으로 목록이 '여는 중'에 굳지 않는다", async () => {
    let release: ((outcome: ThreadEventsOutcome) => void) | null = null;
    // 대답이 붙잡히는 때를 시험이 정한다 — 몇 번째 물음인지로 정하지 않는다.
    let held = false;
    serving({
      threads: [summary(), summary({ thread_id: "run_5", first_said: "다른 말" })],
      events: () =>
        held
          ? new Promise<ThreadEventsOutcome>((keep) => (release = keep))
          : Promise.resolve({ turns: ANSWERED_THREAD }),
    });
    render(<ChatPanel />);
    await goToPast();
    await openFirst();
    await goToPast();

    // 하나를 여는 사이에, 열어 두었던 그 대화를 지운다 — 대화 자리가 새로 열린다(세대가 바뀐다).
    held = true;
    await userEvent.click(screen.getByRole("button", { name: /다른 말/ }));
    await act(async () => {
      store().askToDeletePastChat("run_1");
      await store().deletePastChat();
    });
    await act(async () => {
      (release as ((outcome: ThreadEventsOutcome) => void) | null)?.({
        turns: ANSWERED_THREAD,
      });
    });
    await settle();

    expect(store().chatOpening).toBeNull();
    expect(screen.queryByText("여는 중이에요")).toBeNull();
  });

  // m4·m9의 근거는 안내 문구가 아니라 사실이다 — 그 자리를 다른 안내가 덮어도 흔들리지 않는다.
  it("다른 안내가 그 자리를 덮어도 다른 곳에서 도는 중이라는 사실은 남는다", async () => {
    serving({ turns: GOING_THREAD });
    render(<ChatPanel />);
    await goToPast();
    await openFirst();

    useEditor.setState({
      sendThreadDelete: async () => ({ failure: { key: "chat.thread.delete.stillGoing" } }),
    });
    await act(async () => {
      store().askToDeleteChat();
      await store().deleteChatThread();
    });
    await settle();

    expect(screen.getByText(/하나도 지우지 않았어요/)).toBeInTheDocument();
    expect(screen.queryByText("답을 만드는 중이에요")).toBeNull();
  });

  // m5 — 100ms 안에 무슨 일이 일어나는지 말한다.
  it("여는 중에는 그 줄이 여는 중이라고 말하고, 다른 줄은 기다린다", async () => {
    let release: ((outcome: ThreadEventsOutcome) => void) | null = null;
    serving({
      threads: [summary(), summary({ thread_id: "run_5", first_said: "다른 말" })],
      events: () => new Promise<ThreadEventsOutcome>((keep) => (release = keep)),
    });
    render(<ChatPanel />);
    await goToPast();

    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));

    expect(screen.getByText("여는 중이에요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /다른 말/ })).toBeDisabled();

    await act(async () => {
      (release as ((outcome: ThreadEventsOutcome) => void) | null)?.({
        turns: ANSWERED_THREAD,
      });
    });
    await settle();

    expect(screen.getByText("반가워요")).toBeInTheDocument();
  });

  // m6 — 되묻기와 까닭은 사람이 누른 그 줄에서 말한다(패널 맨 위가 아니라).
  it("열기 실패는 누른 그 줄 안에서 말한다", async () => {
    serving({
      threads: [summary(), summary({ thread_id: "run_5", first_said: "다른 말" })],
      events: async () => ({ failure: { key: "chat.thread.read.offline" } }),
    });
    render(<ChatPanel />);
    await goToPast();

    await openFirst();

    const row = screen.getAllByRole("listitem")[0];
    expect(within(row).getByText(/오간 말을 불러오지 못했어요/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "다시 열어 보기" })).toBeInTheDocument();
  });

  it("전환을 되묻는 물음도 누른 그 줄 안에서 묻는다", async () => {
    serving({ threads: [summary(), summary({ thread_id: "run_5", first_said: "다른 말" })] });
    useEditor.setState({
      watchChatEvents: () => new Promise(() => undefined),
    });
    render(<ChatPanel />);
    await userEvent.type(screen.getByLabelText("할 말"), "기다리는 말");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await settle();
    await goToPast();

    await userEvent.click(screen.getByRole("button", { name: /다른 말/ }));
    await settle();

    const row = screen.getAllByRole("listitem")[1];
    expect(within(row).getByText(/지금 기다리는 말이 있어요/)).toBeInTheDocument();
  });

  // m7 — 문구가 시키는 일과 화면의 손잡이가 어긋나지 않는다.
  it("오간 말이 없는 대화를 열면 목록을 다시 불러올 손잡이를 준다", async () => {
    serving({ turns: [] });
    render(<ChatPanel />);
    await goToPast();

    await openFirst();

    expect(screen.getByText(/오간 말이 없어요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeInTheDocument();
  });

  // m8 — "사람이 건넨 말이 있는가"는 한 자리에서만 판정한다(목록 제목과 말풍선이 같은 규칙).
  it("빈 칸뿐인 말로 시작한 실행은 말풍선 대신 그 사실을 말한다", async () => {
    serving({
      turns: [
        threadTurn("run_1", "run_1", [
          event("run.started", { input: { message: "   " } }),
          event("run.completed", {}),
        ]),
      ],
    });
    render(<ChatPanel />);
    await goToPast();

    await openFirst();

    expect(screen.getByText(/말 없이 시작한 실행이에요/)).toBeInTheDocument();
  });

  // m9 — 듣고 있지 않은 대화는 자리를 떠도 놓칠 것이 없다.
  it("다른 곳에서 도는 대화를 두고 다른 대화를 열 때는 되묻지 않는다", async () => {
    serving({
      threads: [summary(), summary({ thread_id: "run_5", first_said: "다른 말" })],
      turns: GOING_THREAD,
    });
    render(<ChatPanel />);
    await goToPast();
    await openFirst();
    expect(screen.getByText(/다른 곳에서 진행 중이에요/)).toBeInTheDocument();

    await goToPast();
    useEditor.setState({ askThreadEvents: async () => ({ turns: ANSWERED_THREAD }) });
    await userEvent.click(screen.getByRole("button", { name: /다른 말/ }));
    await settle();

    expect(screen.queryByText(/지금 기다리는 말이 있어요/)).toBeNull();
    expect(screen.getByText("반가워요")).toBeInTheDocument();
  });

  // m10 — 적던 말은 사람의 것이다: 지우기도 복원과 같이 그 말을 남긴다.
  it("열어 둔 대화를 지워도 적던 말은 남는다", async () => {
    serving();
    render(<ChatPanel />);
    await goToPast();
    await openFirst();
    await userEvent.type(screen.getByLabelText("할 말"), "적던 말");

    await goToPast();
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    await userEvent.click(screen.getByRole("button", { name: "지우기" }));
    await settle();

    expect(store().chatDraft).toBe("적던 말");
  });
});

describe("뷰를 오가기 (L1·L2)", () => {
  it("답을 기다리는 중에 지난 대화를 열려 하면 한 번 더 묻는다 (L1)", async () => {
    serving();
    let flow: (() => void) | null = null;
    useEditor.setState({
      watchChatEvents: async () => {
        await new Promise<void>((wake) => (flow = wake));
        return { ended: true, lastSeq: null };
      },
    });
    render(<ChatPanel />);
    await userEvent.type(screen.getByLabelText("할 말"), "기다리는 말");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await settle();

    await goToPast();
    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));
    await settle();

    expect(screen.getByText(/지금 기다리는 말이 있어요/)).toBeInTheDocument();
    expect(screen.queryByText("반가워요")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "열기" }));
    await settle();

    expect(screen.getByText("반가워요")).toBeInTheDocument();
    (flow as (() => void) | null)?.();
  });

  it("되묻는 물음을 무르면 하던 대화는 그대로다 (L1)", async () => {
    serving();
    let flow: (() => void) | null = null;
    useEditor.setState({
      watchChatEvents: async () => {
        await new Promise<void>((wake) => (flow = wake));
        return { ended: true, lastSeq: null };
      },
    });
    render(<ChatPanel />);
    await userEvent.type(screen.getByLabelText("할 말"), "기다리는 말");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await settle();
    await goToPast();
    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));
    await settle();

    await userEvent.click(screen.getByRole("button", { name: "그대로 두기" }));
    await settle();

    expect(screen.queryByText("반가워요")).toBeNull();
    expect(store().chatThreadId).not.toBe("run_1");
    (flow as (() => void) | null)?.();
  });

  it("목록에서는 판 고정 표시가 서지 않는다 — 목록은 어느 한 판의 이야기가 아니다", async () => {
    serving();
    render(<ChatPanel />);
    await goToPast();
    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));
    await settle();
    expect(screen.getByText(/3번째 판과 이야기하는 중/)).toBeInTheDocument();

    await goToPast();

    expect(screen.queryByText(/판과 이야기하는 중/)).toBeNull();
  });

  it("기다리는 중이 아니면 곧장 목록과 대화를 오간다 (L2)", async () => {
    serving();
    render(<ChatPanel />);
    await goToPast();

    expect(screen.queryByLabelText("할 말")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "지금 대화" }));
    await settle();

    expect(screen.getByLabelText("할 말")).toBeInTheDocument();
  });
});

describe("목록에서 새로 말 걸기 (GP-2)", () => {
  it("이어 갈 대화가 없어도 목록에서 새로 말을 걸 수 있다", async () => {
    serving({ threads: [] });
    render(<ChatPanel />);

    await goToPast();

    expect(screen.getByRole("button", { name: "새 대화" })).toBeInTheDocument();
  });

  it("새 대화를 누르면 작성 뷰로 옮겨 가고 적는 자리에 초점이 선다", async () => {
    serving();
    render(<ChatPanel />);
    await goToPast();

    await userEvent.click(screen.getByRole("button", { name: "새 대화" }));
    await settle();

    const field = screen.getByLabelText("할 말");
    expect(field).toBeInTheDocument();
    expect(document.activeElement).toBe(field);
  });

  it("새 대화는 화면의 대화만 처음으로 돌리고, 적던 말은 그대로 둔다", async () => {
    serving();
    render(<ChatPanel />);
    await goToPast();
    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));
    await settle();
    await userEvent.type(screen.getByLabelText("할 말"), "적던 말");
    await goToPast();

    await userEvent.click(screen.getByRole("button", { name: "새 대화" }));
    await settle();

    expect(store().chatTurns).toEqual([]);
    expect(store().chatThreadId).toBeNull();
    expect(screen.getByLabelText("할 말")).toHaveValue("적던 말");
    expect(document.activeElement).toBe(screen.getByLabelText("할 말"));
  });

  it("답을 기다리는 중에는 새 대화가 서지 않는다 — 기다리던 말을 말없이 버리지 않는다", async () => {
    serving();
    useEditor.setState({ watchChatEvents: () => new Promise(() => undefined) });
    render(<ChatPanel />);
    await userEvent.type(screen.getByLabelText("할 말"), "기다리는 말");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));
    await settle();
    await goToPast();

    const fresh = screen.getByRole("button", { name: "새 대화" });
    expect(fresh).toBeDisabled();
    expect(fresh).toHaveAttribute("title", "답이 올 때까지 기다려 주세요");
  });

  it("대화를 여는 중에는 새 대화가 서지 않고 그 까닭을 말한다", async () => {
    serving({ events: () => new Promise<ThreadEventsOutcome>(() => {}) });
    render(<ChatPanel />);
    await goToPast();

    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));

    const fresh = screen.getByRole("button", { name: "새 대화" });
    expect(fresh).toBeDisabled();
    expect(fresh).toHaveAttribute("title", "고른 대화를 여는 중이에요 — 잠시만요");
  });
});
