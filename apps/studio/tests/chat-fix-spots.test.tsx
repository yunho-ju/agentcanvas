// 고칠 자리를 목록에서 보고(N), 대화 한 마디를 시험 케이스로 넘긴다(O).
// 사람이 하는 그대로(클릭) 시험한다 — 파생 규칙 자체는 chat-fix-spots-pure가 고정한다.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { ThreadEventsOutcome, ThreadSummary, ThreadTurn } from "../src/api/threads";
import { ChatPanel } from "../src/chat/ChatPanel";
import { EvalPanel } from "../src/eval/EvalPanel";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import type { SpecPublication } from "../src/generated/spec_publication";
import { setLocale } from "../src/i18n/localeStore";
import { useEditor } from "../src/store/editor";
import { serveEval } from "./fakeEvalServer";

const example = exampleSpec as unknown as AgentSpec;

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
    turns: 1,
    last_status: "completed",
    spec_revision: PAST_REVISION,
    ...known,
  };
}

/** 답까지 오간 대화 — 조용한 성공이다. */
const ANSWERED_THREAD = [
  threadTurn("run_1", "run_1", [
    event("run.started", { input: { message: "안녕", history: [{ role: "user", text: "먼저" }] } }),
    event("llm.completed", { text: "반가워요" }, "clinical-agent"),
    event("run.completed", {}),
  ]),
];

/** 도구가 답을 못 가져온 대화. */
const TOOL_TROUBLE_THREAD = [
  threadTurn("run_1", "run_1", [
    event("run.started", { input: { message: "안녕" } }),
    event(
      "tool.completed",
      {
        resource_ref: "pubmed",
        tool_name: "search",
        ok: false,
        error: { reason: "timeout", message: "connection reset by peer" },
      },
      "clinical-agent",
    ),
    event("llm.completed", { text: "반가워요" }, "clinical-agent"),
    event("run.completed", {}),
  ]),
];

/** 서버 대역이 몇 번 두드려졌는지 — 훑기의 값은 이 수로 지켜진다. */
interface Knocks {
  events: string[];
  bodies: string[];
}

function serving(
  known: {
    threads?: ThreadSummary[];
    turns?: ThreadTurn[];
    events?: (threadId: string) => Promise<ThreadEventsOutcome>;
    /** 판마다 다른 몸통 — 지난 대화는 제 판으로 판정받아야 한다 (M1) */
    bodies?: Record<string, AgentSpec>;
    bodyFails?: boolean;
  } = {},
) {
  const knocks: Knocks = { events: [], bodies: [] };
  useEditor.setState({
    askSpecThreads: async () => ({ threads: known.threads ?? [summary()] }),
    askThreadEvents: async (threadId: string) => {
      knocks.events.push(threadId);
      return known.events
        ? known.events(threadId)
        : { turns: known.turns ?? ANSWERED_THREAD };
    },
    askSpecRevision: async (_specId: string, revision: string) => {
      knocks.bodies.push(revision);
      if (known.bodyFails) return { failure: { key: "open.offline" } };
      const body = known.bodies?.[revision] ?? graphTaking("message", "history");
      return { saved: body, issues: [] };
    },
    fetchRevisions: async () => ({
      revisions: [{ version: 3, revision: PAST_REVISION, created_at: "2026-08-01T12:00:00Z" }],
    }),
    watchChatEvents: async () => ({ ended: true, lastSeq: null }),
  });
  return knocks;
}

/** 답하는 노드의 이름이 바뀐 판 — 옛 대화를 이 판으로 읽으면 답이 사라진 것처럼 보인다. */
function graphSpeaking(nodeId: string): AgentSpec {
  const base = graphTaking("message", "history");
  return {
    ...base,
    nodes: base.nodes.map((node) =>
      node.id === "clinical-agent" ? { ...node, id: nodeId } : node,
    ),
  } as AgentSpec;
}

/** 목록 뷰를 닫았다가 다시 연다 — 두 번째 열기에서 무엇을 다시 묻는지 보는 길. */
async function backAndForth(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "지금 대화" }));
  await goToPast();
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 25; tick += 1) await Promise.resolve();
  });
}

async function goToPast(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "지난 대화" }));
  await settle();
}

beforeEach(() => {
  act(() => setLocale("ko"));
  act(() => useEditor.getState().abandonChat());
  act(() => useEditor.getState().abandonEval());
  useEditor.setState({
    spec: example,
    publication,
    publishedVersion: 7,
    publishedSpec: graphTaking("message", "history"),
    chatOpen: true,
    feedbackNotice: null,
    caseDraft: null,
    dataset: null,
    datasetSynced: null,
  });
  serveEval();
});

/** 대화와 시험은 한 자리를 나눠 쓴다 — 승격은 그 사이를 건너므로 둘 다 세워 둔다. */
function panels() {
  return render(
    <>
      <ChatPanel />
      <EvalPanel />
    </>,
  );
}

describe("목록에서 보이는 고칠 자리 (N1~N3)", () => {
  it("어그러진 자리가 있는 대화는 그 줄에서 쉬운 말로 말한다 (N1)", async () => {
    serving({ turns: TOOL_TROUBLE_THREAD });
    render(<ChatPanel />);

    await goToPast();

    const row = screen.getAllByRole("listitem")[0];
    const badge = within(row).getByText(/답을 못 가져왔어요/);
    // DESIGN §7 뱃지 ② — 어느 연결·어느 도구·무슨 갈래인지가 상시 보인다(title에 숨기지 않는다).
    expect(badge.textContent).toContain("pubmed");
    expect(badge.textContent).toContain("search");
    expect(badge.textContent).toContain("기다렸는데 답이 오지 않았어요");
  });

  it("뱃지는 점수도 백분율도 서버 원문도 말하지 않는다 (N1 — 요약 pill 규율)", async () => {
    serving({ turns: TOOL_TROUBLE_THREAD });
    render(<ChatPanel />);

    await goToPast();

    const badge = screen.getByText(/답을 못 가져왔어요/).textContent ?? "";
    expect(badge).not.toContain("%");
    expect(badge).not.toContain("timeout");
    expect(badge).not.toContain("connection reset by peer");
  });

  it("뱃지를 누르면 그 대화가 열린다 (N2)", async () => {
    serving({ turns: TOOL_TROUBLE_THREAD });
    render(<ChatPanel />);
    await goToPast();

    await userEvent.click(screen.getByText(/답을 못 가져왔어요/));
    await settle();

    expect(store().chatThreadId).toBe("run_1");
    expect(screen.getByText("반가워요")).toBeInTheDocument();
  });

  it("전부 조용하면 없는 문제를 지어내지 않고 그렇다고 말한다 (N3)", async () => {
    serving();
    render(<ChatPanel />);

    await goToPast();

    expect(screen.getByText("고칠 자리가 보이지 않아요")).toBeInTheDocument();
  });

  it("고칠 자리가 하나라도 있으면 조용하다는 말은 서지 않는다 (N3)", async () => {
    serving({ turns: TOOL_TROUBLE_THREAD });
    render(<ChatPanel />);

    await goToPast();

    expect(screen.queryByText("고칠 자리가 보이지 않아요")).toBeNull();
  });

  it("훑어보지 못한 대화는 뱃지도 조용하다는 말도 없다 — 모르는 것을 없다고 말하지 않는다", async () => {
    serving({ events: async () => ({ failure: { key: "chat.thread.read.offline" } }) });
    render(<ChatPanel />);

    await goToPast();

    expect(screen.queryByText("고칠 자리가 보이지 않아요")).toBeNull();
    expect(screen.getByRole("button", { name: /안녕/ })).toBeInTheDocument();
  });
});

describe("대화 한 마디를 시험 케이스로 (O1~O3)", () => {
  async function openFirst(): Promise<void> {
    await userEvent.click(screen.getByRole("button", { name: /안녕/ }));
    await settle();
  }

  it("복원한 말에서 시험 케이스로 넘기면 시험 모드가 열리고 초안이 선다 (O1)", async () => {
    serving();
    panels();
    await goToPast();
    await openFirst();

    await userEvent.click(screen.getByRole("button", { name: "여기서 시험 케이스로" }));
    await settle();

    expect(store().evalPanelOpen).toBe(true);
    expect(store().caseDraft?.input.message).toBe("안녕");
    expect(store().caseDraft?.title).not.toBe("");
  });

  it("기대 문구는 사람이 적는다 — 답이 있어도 자동으로 채워 저장하지 않는다 (O1)", async () => {
    serving();
    panels();
    await goToPast();
    await openFirst();

    await userEvent.click(screen.getByRole("button", { name: "여기서 시험 케이스로" }));
    await settle();

    expect(store().caseDraft?.expectedText).toBe("");
    expect(store().casePhraseHint).toBe("반가워요");
    expect(store().dataset?.cases ?? []).toHaveLength(0);
  });

  it("대화 맥락째 케이스가 된다 — 실려 있던 지난 대화도 함께 온다 (O3)", async () => {
    serving();
    panels();
    await goToPast();
    await openFirst();

    await userEvent.click(screen.getByRole("button", { name: "여기서 시험 케이스로" }));
    await settle();

    expect(store().caseDraft?.input.history).toEqual([{ role: "user", text: "먼저" }]);
  });

  it("답이 없던 말에는 후보를 지어내지 않는다", async () => {
    serving({
      turns: [
        threadTurn("run_1", "run_1", [
          event("run.started", { input: { message: "안녕" } }),
          event("run.completed", {}),
        ]),
      ],
    });
    panels();
    await goToPast();
    await openFirst();

    await userEvent.click(screen.getByRole("button", { name: "여기서 시험 케이스로" }));
    await settle();

    expect(store().casePhraseHint).toBeNull();
  });

  it("후보는 사람이 눌러야 칸에 들어가고, 저장은 기존 길 그대로다 (O2)", async () => {
    serving();
    panels();
    await goToPast();
    await openFirst();
    await userEvent.click(screen.getByRole("button", { name: "여기서 시험 케이스로" }));
    await settle();

    await userEvent.click(screen.getByRole("button", { name: "이 말을 넣기" }));
    expect(store().caseDraft?.expectedText).toBe("반가워요");

    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await settle();

    const saved = store().dataset?.cases ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0].expected_phrases).toEqual(["반가워요"]);
    expect(saved[0].input.message).toBe("안녕");
  });

  it("적고 있던 초안이 있으면 덮어쓰지 않는다 (m6)", async () => {
    serving();
    panels();
    await goToPast();
    await openFirst();
    await userEvent.click(screen.getByRole("button", { name: "여기서 시험 케이스로" }));
    await settle();
    act(() => store().setCaseDraft({ title: "적던 시험" }));

    act(() => store().enterChatMode());
    act(() => store().promoteChatTurn("run_1"));

    expect(store().caseDraft?.title).toBe("적던 시험");
  });

  it("답을 기다리는 중인 말에는 승격 손잡이를 세우지 않는다 (m6)", async () => {
    serving({
      turns: [
        threadTurn("run_1", "run_1", [event("run.started", { input: { message: "안녕" } })]),
      ],
    });
    panels();
    await goToPast();
    await openFirst();

    expect(screen.queryByRole("button", { name: "여기서 시험 케이스로" })).toBeNull();
  });

  it("후보를 넣어도 사람이 적어 둔 말은 지우지 않는다", async () => {
    serving();
    panels();
    await goToPast();
    await openFirst();
    await userEvent.click(screen.getByRole("button", { name: "여기서 시험 케이스로" }));
    await settle();

    await userEvent.type(screen.getByLabelText(/들어있어야 하는 말/), "안녕");
    await userEvent.click(screen.getByRole("button", { name: "이 말을 넣기" }));

    expect(store().caseDraft?.expectedText).toBe("안녕\n반가워요");
  });
});

describe("훑기는 그 스레드의 판으로 판정한다 (M1)", () => {
  it("옛 판에 고정된 대화에 거짓 뱃지를 붙이지 않는다", async () => {
    // 지금 게시된 판은 답하는 노드의 이름이 바뀌었다 — 그 판으로 읽으면 답이 없던 것처럼 보인다.
    useEditor.setState({ publishedSpec: graphSpeaking("answer-bot") });
    serving({ bodies: { [PAST_REVISION]: graphTaking("message", "history") } });
    render(<ChatPanel />);

    await goToPast();

    expect(screen.queryByText(/끝내지 못한 대화/)).toBeNull();
    expect(screen.getByText("고칠 자리가 보이지 않아요")).toBeInTheDocument();
  });

  it("같은 판은 한 번만 받아 온다 — 대화마다 몸통을 다시 묻지 않는다 (M3)", async () => {
    const knocks = serving({
      threads: [
        summary({ thread_id: "run_1" }),
        summary({ thread_id: "run_5" }),
        summary({ thread_id: "run_7" }),
      ],
    });
    render(<ChatPanel />);

    await goToPast();

    expect(knocks.bodies.filter((one) => one === PAST_REVISION)).toHaveLength(1);
  });

  it("판 몸통을 못 받은 대화는 판정하지 않는다 — 조용하다고 말하지 않는다 (m5)", async () => {
    serving({ bodyFails: true });
    render(<ChatPanel />);

    await goToPast();

    expect(screen.queryByText("고칠 자리가 보이지 않아요")).toBeNull();
    expect(screen.getByText(/훑지 못했어요/)).toBeInTheDocument();
  });
});

describe("훑기의 값 (M3)", () => {
  it("한꺼번에 다 두드리지 않는다 — 동시에 묻는 수를 제한한다", async () => {
    const held: (() => void)[] = [];
    let started = 0;
    serving({
      threads: [1, 2, 3, 4, 5, 6].map((n) => summary({ thread_id: `run_${n}` })),
      events: () =>
        new Promise<ThreadEventsOutcome>((keep) => {
          started += 1;
          held.push(() => keep({ turns: ANSWERED_THREAD }));
        }),
    });
    render(<ChatPanel />);

    await goToPast();

    expect(started).toBe(4);

    await act(async () => {
      for (const release of [...held]) release();
    });
    await settle();
    expect(started).toBe(6);
  });

  it("달라진 것이 없는 대화는 다시 훑지 않는다 — 마지막 시각이 그대로면 내용도 그대로다", async () => {
    const knocks = serving({
      threads: [summary({ thread_id: "run_1" }), summary({ thread_id: "run_5" })],
    });
    render(<ChatPanel />);
    await goToPast();
    expect(knocks.events).toHaveLength(2);

    await backAndForth();

    expect(knocks.events).toHaveLength(2);
  });

  it("말이 더 오간 대화는 다시 훑는다 — 마지막 시각이 달라지면 내용도 달라졌다", async () => {
    let lastAt = "2026-08-01T12:40:00Z";
    const knocks: { events: string[] } = { events: [] };
    useEditor.setState({
      askSpecThreads: async () => ({ threads: [summary({ last_at: lastAt })] }),
      askThreadEvents: async (threadId: string) => {
        knocks.events.push(threadId);
        return { turns: ANSWERED_THREAD };
      },
      askSpecRevision: async () => ({ saved: graphTaking("message", "history"), issues: [] }),
      fetchRevisions: async () => ({ revisions: [] }),
      watchChatEvents: async () => ({ ended: true, lastSeq: null }),
    });
    render(<ChatPanel />);
    await goToPast();

    lastAt = "2026-08-01T13:40:00Z";
    await backAndForth();

    expect(knocks.events).toHaveLength(2);
  });

  it("못 훑은 대화는 다시 훑어 볼 손잡이를 준다 (m5)", async () => {
    let readable = false;
    serving({
      events: async () =>
        readable
          ? { turns: TOOL_TROUBLE_THREAD }
          : { failure: { key: "chat.thread.read.offline" } },
    });
    render(<ChatPanel />);
    await goToPast();
    expect(screen.getByText(/훑지 못했어요/)).toBeInTheDocument();

    readable = true;
    await userEvent.click(screen.getByRole("button", { name: "다시 훑어보기" }));
    await settle();

    expect(screen.queryByText(/훑지 못했어요/)).toBeNull();
    expect(screen.getByText(/답을 못 가져왔어요/)).toBeInTheDocument();
  });

  it("지운 대화의 고칠 자리는 함께 사라진다 (m4)", async () => {
    serving({
      threads: [summary({ thread_id: "run_1" }), summary({ thread_id: "run_5" })],
      events: async (threadId) => ({
        turns: threadId === "run_1" ? TOOL_TROUBLE_THREAD : ANSWERED_THREAD,
      }),
    });
    useEditor.setState({ sendThreadDelete: async () => ({ ok: true }) });
    render(<ChatPanel />);
    await goToPast();
    expect(screen.getByText(/답을 못 가져왔어요/)).toBeInTheDocument();

    await act(async () => {
      store().askToDeletePastChat("run_1");
      await store().deletePastChat();
    });
    await settle();

    expect(screen.queryByText(/답을 못 가져왔어요/)).toBeNull();
    expect(screen.getByText("고칠 자리가 보이지 않아요")).toBeInTheDocument();
  });
});

describe("목록 위 요약 줄 (M2)", () => {
  it("무엇부터 보면 좋은지 목록 위에서 한 줄로 말한다", async () => {
    serving({ turns: TOOL_TROUBLE_THREAD });
    render(<ChatPanel />);

    await goToPast();

    expect(screen.getByText(/여기부터 보면 좋아요/)).toBeInTheDocument();
  });

  it("고칠 자리가 없으면 요약 줄도 서지 않는다", async () => {
    serving();
    render(<ChatPanel />);

    await goToPast();

    expect(screen.queryByText(/여기부터 보면 좋아요/)).toBeNull();
  });
});

describe("훑어 둔 것이 낡지 않게 (M-신규·m-신규)", () => {
  /** 목록이 부르는 대로 달라지는 대역 — 같은 대화의 상태가 바뀌는 자리를 시험이 정한다. */
  function shifting(known: {
    first: Partial<ThreadSummary>;
    then: Partial<ThreadSummary>;
    firstTurns: ThreadTurn[];
    thenTurns: ThreadTurn[];
  }) {
    // 목록을 몇 번째 읽는 중인지로 그 회차의 사실을 돌려준다 — 훑기가 그 회차의 말을 보게.
    let round = 0;
    useEditor.setState({
      askSpecThreads: async () => {
        round += 1;
        return { threads: [summary(round === 1 ? known.first : known.then)] };
      },
      askThreadEvents: async () => ({
        turns: round === 1 ? known.firstTurns : known.thenTurns,
      }),
      askSpecRevision: async () => ({ saved: graphTaking("message", "history"), issues: [] }),
      fetchRevisions: async () => ({ revisions: [] }),
      watchChatEvents: async () => ({ ended: true, lastSeq: null }),
    });
  }

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

  const BROKEN_THREAD = [
    threadTurn("run_1", "run_1", [
      event("run.started", { input: { message: "안녕" } }),
      event("run.failed", { reason: "provider_error" }),
    ]),
  ];

  // 밸브 승인은 새 실행을 열지 않고 하던 실행을 이어 간다 — 마지막 시각은 그대로다.
  it("승인해서 이어진 대화는 다시 훑는다 — 멈춰 있다는 말이 되살아나지 않는다", async () => {
    shifting({
      first: { last_status: "paused" },
      then: { last_status: "completed" },
      firstTurns: HELD_THREAD,
      thenTurns: ANSWERED_THREAD,
    });
    render(<ChatPanel />);
    await goToPast();
    expect(screen.getByText(/확인을 기다리다 멈췄어요/)).toBeInTheDocument();

    await backAndForth();

    expect(screen.queryByText(/확인을 기다리다 멈췄어요/)).toBeNull();
    expect(screen.getByText("고칠 자리가 보이지 않아요")).toBeInTheDocument();
  });

  it("돌던 대화가 어그러지면 조용하던 줄이 그 사실을 말한다", async () => {
    shifting({
      first: { last_status: "running" },
      then: { last_status: "failed" },
      firstTurns: GOING_THREAD,
      thenTurns: BROKEN_THREAD,
    });
    render(<ChatPanel />);
    await goToPast();
    expect(within(screen.getAllByRole("listitem")[0]).queryByText(/끝내지 못한 대화/)).toBeNull();

    await backAndForth();

    const row = screen.getAllByRole("listitem")[0];
    expect(within(row).getByText(/끝내지 못한 대화/)).toBeInTheDocument();
  });

  it("한 대화가 늦어도 나머지 뱃지는 먼저 선다 (m-신규1)", async () => {
    serving({
      threads: [summary({ thread_id: "run_1" }), summary({ thread_id: "run_5" })],
      events: async (threadId) =>
        threadId === "run_1"
          ? new Promise<ThreadEventsOutcome>(() => undefined)
          : { turns: TOOL_TROUBLE_THREAD },
    });
    render(<ChatPanel />);

    await goToPast();

    expect(screen.getByText(/답을 못 가져왔어요/)).toBeInTheDocument();
  });

  it("훑는 도중 지운 대화는 늦게 온 훑기로 되살아나지 않는다 (m-신규2)", async () => {
    let release: ((outcome: ThreadEventsOutcome) => void) | null = null;
    serving({
      threads: [summary({ thread_id: "run_1" }), summary({ thread_id: "run_5" })],
      events: (threadId) =>
        threadId === "run_1"
          ? new Promise<ThreadEventsOutcome>((keep) => (release = keep))
          : Promise.resolve({ turns: ANSWERED_THREAD }),
    });
    useEditor.setState({ sendThreadDelete: async () => ({ ok: true }) });
    render(<ChatPanel />);
    await goToPast();

    await act(async () => {
      store().askToDeletePastChat("run_1");
      await store().deletePastChat();
    });
    await act(async () => {
      (release as ((outcome: ThreadEventsOutcome) => void) | null)?.({
        turns: TOOL_TROUBLE_THREAD,
      });
    });
    await settle();

    expect(store().chatFixSpots["run_1"]).toBeUndefined();
    expect(screen.queryByText(/답을 못 가져왔어요/)).toBeNull();
  });
});
