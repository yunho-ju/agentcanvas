// 대화의 상태 전이 — 말을 보내고(G1·G2), 기다리는 동안 잠그고(G3), 판을 붙잡아 두고(G4),
// 실패·거절을 남기고(G5·G6), 새 대화와 지우기를 가른다(I1~I4).
// 서버로 나가는 길은 전부 갈아 끼운다: 이 시험이 보는 것은 store가 무엇을 부탁하고 무엇을 쥐는가다.
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { ChatTurn } from "../src/api/runs";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import type { SpecPublication } from "../src/generated/spec_publication";
import { chatIsWaiting, publishedChatSpec } from "../src/store/chatSlice";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

/** 사람 말(과 지난 대화)을 받는 게시된 판. */
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

/** 말을 받아 적는 서버 대역 — 무엇을 실어 보냈는지 여기서 본다. */
function chatServer(
  reply: (asked: ChatTurn, count: number) => { runId: string; threadId: string } | { failure: { key: string } },
) {
  const asked: ChatTurn[] = [];
  useEditor.setState({
    sendChatTurn: async (_specId, turn) => {
      asked.push(turn);
      const answer = reply(turn, asked.length);
      if ("failure" in answer) return { failure: answer.failure as never };
      return {
        run: {
          id: answer.runId,
          spec_id: example.id,
          spec_revision: example.revision,
          created_at: "2026-08-01T12:30:00Z",
          thread_id: answer.threadId,
        },
        status: "running",
      };
    },
  });
  return asked;
}

/** 이벤트를 흘려보내는 스트림 대역 — 실행마다 정해 둔 이벤트를 그대로 준다. */
function streamGiving(events: Record<string, RunEvent[]>) {
  useEditor.setState({
    watchChatEvents: async (runId, watch) => {
      for (const one of events[runId] ?? []) watch.onEvent(one);
      return { ended: true, lastSeq: null };
    },
  });
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 25; tick += 1) await Promise.resolve();
}

beforeEach(() => {
  // 시험마다 문서를 놓은 자리에서 시작한다 — 앞 시험이 읽어 본 판의 기억까지 함께 놓는다.
  useEditor.getState().abandonChat();
  useEditor.setState({
    spec: example,
    publication,
    publishedVersion: 7,
    publishedSpec: graphTaking("message", "history"),
    publishedSpecFailure: null,
    chatOpen: true,
    chatThreadId: null,
    chatPin: null,
    chatTurns: [],
    chatDraft: "",
    chatNotice: null,
    chatDeleteAsking: false,
  });
  streamGiving({});
});

describe("게시된 판을 불러온다 (F 판정의 근거)", () => {
  it("게시된 판의 몸통을 서버에서 읽어 둔다", async () => {
    const asked: string[] = [];
    useEditor.setState({
      publishedSpec: null,
      askSpecRevision: async (id, revision) => {
        asked.push(`${id}@${revision}`);
        return { saved: graphTaking("message"), issues: [] };
      },
    });

    await store().loadPublishedSpec();

    expect(asked).toEqual([`${example.id}@${example.revision}`]);
    expect(publishedChatSpec(store())?.id).toBe(example.id);
  });

  it("판을 못 읽으면 그 까닭을 쥔다 — 모르는 것과 못 읽은 것은 다른 자리다 (M2)", async () => {
    useEditor.setState({
      publishedSpec: null,
      askSpecRevision: async () => ({ failure: { key: "open.offline" } }),
    });

    await store().loadPublishedSpec();

    expect(publishedChatSpec(store())).toBeNull();
    expect(store().publishedSpecFailure).toEqual({ key: "open.offline" });
  });

  it("못 읽은 판을 저 혼자 계속 두드리지 않는다 — 다시 읽는 것은 사람이 시킬 때다 (M2)", async () => {
    let asks = 0;
    useEditor.setState({
      publishedSpec: null,
      askSpecRevision: async () => {
        asks += 1;
        return { failure: { key: "open.offline" } };
      },
    });

    await store().loadPublishedSpec();
    await store().loadPublishedSpec();

    expect(asks).toBe(1);
  });

  it("읽긴 읽었는데 그 판이 아니어도 저 혼자 다시 묻지 않는다 — 끝없는 되묻기를 만들지 않는다", async () => {
    let asks = 0;
    useEditor.setState({
      publishedSpec: null,
      // 서버가 답은 했지만 지금 내놓은 판의 몸통이 아니다 (그 사이 게시가 오간 자리).
      askSpecRevision: async () => {
        asks += 1;
        return {
          saved: { ...graphTaking("message"), revision: `sha256:${"b".repeat(64)}` },
          issues: [],
        };
      },
    });

    await store().loadPublishedSpec();
    await store().loadPublishedSpec();
    await store().loadPublishedSpec();

    expect(asks).toBe(1);
    expect(publishedChatSpec(store())).toBeNull();
  });

  it("사람이 다시 확인하라고 하면 다시 읽고, 읽히면 까닭도 걷힌다 (M2)", async () => {
    let asks = 0;
    useEditor.setState({
      publishedSpec: null,
      askSpecRevision: async () => {
        asks += 1;
        return asks === 1
          ? { failure: { key: "open.offline" } }
          : { saved: graphTaking("message"), issues: [] };
      },
    });
    await store().loadPublishedSpec();

    await store().retryPublishedSpec();

    expect(asks).toBe(2);
    expect(store().publishedSpecFailure).toBeNull();
    expect(publishedChatSpec(store())?.id).toBe(example.id);
  });

  it("손에 든 몸통이 지금 내놓은 판의 것이 아니면 없는 것으로 본다 (M1)", () => {
    useEditor.setState({
      publication: { ...publication, revision: `sha256:${"b".repeat(64)}` },
      publishedSpec: graphTaking("message"),
    });

    expect(publishedChatSpec(store())).toBeNull();
  });

  it("내놓은 판이 없으면 묻지 않는다", async () => {
    let asks = 0;
    useEditor.setState({
      publication: null,
      publishedSpec: null,
      askSpecRevision: async () => {
        asks += 1;
        return { saved: example, issues: [] };
      },
    });

    await store().loadPublishedSpec();

    expect(asks).toBe(0);
    expect(publishedChatSpec(store())).toBeNull();
  });
});

describe("말 한 마디 (G1·G2)", () => {
  it("첫 말은 대화 이름 없이 나간다 — 서버가 실행 이름으로 대화를 연다 (결정 5)", async () => {
    const asked = chatServer(() => ({ runId: "run_1", threadId: "run_1" }));
    store().setChatDraft("안녕");

    await store().sayInChat();

    expect(asked[0]?.threadId).toBeUndefined();
    expect(asked[0]?.input).toEqual({ message: "안녕" });
    expect(store().chatThreadId).toBe("run_1");
  });

  it("보낸 말은 그 자리에서 대화에 선다 — 답을 기다리는 동안에도 보인다", async () => {
    chatServer(() => ({ runId: "run_1", threadId: "run_1" }));
    store().setChatDraft("안녕");

    await store().sayInChat();

    expect(store().chatTurns.map((turn) => turn.said)).toEqual(["안녕"]);
    expect(store().chatDraft).toBe("");
  });

  it("답이 오면 그 말이 끝난다", async () => {
    chatServer(() => ({ runId: "run_1", threadId: "run_1" }));
    streamGiving({
      run_1: [
        event("llm.completed", { text: "반가워요" }, "clinical-agent"),
        event("run.completed", {}, undefined, 2),
      ],
    });
    store().setChatDraft("안녕");

    await store().sayInChat();
    await settle();

    expect(chatIsWaiting(store())).toBe(false);
    expect(store().chatTurns[0]?.events).toHaveLength(2);
  });

  it("두 번째 말에는 대화 이름과 지난 대화가 함께 실린다 (G2)", async () => {
    const asked = chatServer((_turn, count) => ({
      runId: `run_${count}`,
      threadId: "run_1",
    }));
    streamGiving({
      run_1: [
        event("llm.completed", { text: "반가워요" }, "clinical-agent"),
        event("run.completed", {}, undefined, 2),
      ],
    });
    store().setChatDraft("안녕");
    await store().sayInChat();
    await settle();

    store().setChatDraft("잘 지내?");
    await store().sayInChat();

    expect(asked[1]?.threadId).toBe("run_1");
    expect(asked[1]?.input).toEqual({
      message: "잘 지내?",
      history: [
        { role: "user", text: "안녕" },
        { role: "assistant", text: "반가워요" },
      ],
    });
  });

  it("답을 기다리는 동안에는 다음 말을 받지 않는다 (G3)", async () => {
    const asked = chatServer(() => ({ runId: "run_1", threadId: "run_1" }));
    useEditor.setState({ watchChatEvents: async () => ({ ended: false, lastSeq: null }) });
    store().setChatDraft("안녕");
    await store().sayInChat();

    store().setChatDraft("또 안녕");
    await store().sayInChat();

    expect(chatIsWaiting(store())).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it("빈 말은 보내지 않는다", async () => {
    const asked = chatServer(() => ({ runId: "run_1", threadId: "run_1" }));
    store().setChatDraft("   ");

    await store().sayInChat();

    expect(asked).toHaveLength(0);
  });
});

describe("어느 판과 이야기하는가 (G4)", () => {
  it("첫 말이 판을 붙잡는다", async () => {
    chatServer(() => ({ runId: "run_1", threadId: "run_1" }));
    store().setChatDraft("안녕");

    await store().sayInChat();

    expect(store().chatPin).toEqual({ revision: example.revision, version: 7 });
  });

  it("보내는 사이에 다시 게시돼도 붙잡은 판과 그 번호는 한 시점의 것이다 (m7)", async () => {
    chatServer(() => {
      // 서버가 대답하기 전에 게시가 바뀐 자리 — 판 번호만 뒤늦은 시점에서 오면 안 된다.
      useEditor.setState({ publishedVersion: 9 });
      return { runId: "run_1", threadId: "run_1" };
    });
    store().setChatDraft("안녕");

    await store().sayInChat();

    expect(store().chatPin).toEqual({ revision: example.revision, version: 7 });
  });

  it("대화 도중 다른 판을 게시해도 붙잡은 판은 움직이지 않는다", async () => {
    chatServer((_turn, count) => ({ runId: `run_${count}`, threadId: "run_1" }));
    streamGiving({
      run_1: [event("run.completed", {})],
    });
    store().setChatDraft("안녕");
    await store().sayInChat();
    await settle();

    useEditor.setState({
      publication: { ...publication, revision: `sha256:${"b".repeat(64)}` },
      publishedVersion: 9,
    });

    expect(store().chatPin).toEqual({ revision: example.revision, version: 7 });
  });
});

describe("어그러진 말 (G5·G6)", () => {
  it("서버가 실행을 열어 주지 않으면 그 까닭이 그 말에 남는다 (G6)", async () => {
    chatServer(() => ({ failure: { key: "chat.start.notPublished" } }));
    store().setChatDraft("안녕");

    await store().sayInChat();

    expect(store().chatTurns[0]?.halted).toEqual({ key: "chat.start.notPublished" });
    // 그 까닭은 말 옆에 한 번만 선다 — 같은 사실을 안내 줄로 다시 말하지 않는다.
    expect(store().chatNotice).toBeNull();
    expect(chatIsWaiting(store())).toBe(false);
  });

  it("실행이 실패해도 적은 말은 남고 입력줄이 다시 열린다 (G5)", async () => {
    chatServer(() => ({ runId: "run_1", threadId: "run_1" }));
    streamGiving({ run_1: [event("run.failed", { reason: "provider_error" })] });
    store().setChatDraft("안녕");

    await store().sayInChat();
    await settle();

    expect(store().chatTurns[0]?.said).toBe("안녕");
    expect(chatIsWaiting(store())).toBe(false);
  });
});

describe("새 대화와 지우기 (I1~I4)", () => {
  async function oneTurn(): Promise<void> {
    chatServer(() => ({ runId: "run_1", threadId: "run_1" }));
    streamGiving({ run_1: [event("run.completed", {})] });
    store().setChatDraft("안녕");
    await store().sayInChat();
    await settle();
  }

  it("새 대화는 화면만 처음으로 돌린다 — 서버에는 아무 부탁도 하지 않는다 (I1)", async () => {
    await oneTurn();
    let deletes = 0;
    useEditor.setState({
      sendThreadDelete: async () => {
        deletes += 1;
        return { ok: true };
      },
    });

    store().newChatThread();

    expect(store().chatTurns).toEqual([]);
    expect(store().chatThreadId).toBeNull();
    expect(store().chatPin).toBeNull();
    expect(deletes).toBe(0);
  });

  it("지우기는 되묻고 나서 그 대화를 서버에서 지운다 (I2)", async () => {
    await oneTurn();
    const asked: string[] = [];
    useEditor.setState({
      sendThreadDelete: async (threadId) => {
        asked.push(threadId);
        return { ok: true };
      },
    });

    store().askToDeleteChat();
    expect(store().chatDeleteAsking).toBe(true);
    await store().deleteChatThread();

    expect(asked).toEqual(["run_1"]);
    expect(store().chatTurns).toEqual([]);
    expect(store().chatDeleteAsking).toBe(false);
    expect(store().feedbackNotice?.message).toEqual({ key: "chat.delete.ok" });
  });

  it("아직 끝나지 않은 말이 있으면 그 까닭을 말한다 — 조용히 실패하지 않는다 (I3)", async () => {
    await oneTurn();
    useEditor.setState({
      sendThreadDelete: async () => ({ failure: { key: "chat.thread.delete.stillGoing" } }),
    });

    store().askToDeleteChat();
    await store().deleteChatThread();

    expect(store().chatNotice).toEqual({ key: "chat.thread.delete.stillGoing" });
    expect(store().chatTurns).toHaveLength(1);
  });

  it("밸브 앞에 멈춘 대화는 다음 걸음을 말한다 — 먼저 승인하거나 거절하기 (I3)", async () => {
    chatServer(() => ({ runId: "run_1", threadId: "run_1" }));
    streamGiving({
      run_1: [
        event("human.approval_requested", {}, "human-gate"),
        event("run.paused", { waiting_for: "human-gate" }, "human-gate", 2),
      ],
    });
    store().setChatDraft("안녕");
    await store().sayInChat();
    await settle();
    useEditor.setState({
      sendThreadDelete: async () => ({ failure: { key: "chat.thread.delete.stillGoing" } }),
    });

    store().askToDeleteChat();
    await store().deleteChatThread();

    expect(store().chatNotice).toEqual({ key: "chat.delete.gateFirst" });
  });

  it("기다리던 말을 그만둘 수 있다 — 지울 수 없는 대화를 만들지 않는다 (I3)", async () => {
    const stopped: string[] = [];
    chatServer(() => ({ runId: "run_1", threadId: "run_1" }));
    useEditor.setState({
      watchChatEvents: async () => ({ ended: false, lastSeq: null }),
      sendRunCancel: async (runId) => {
        stopped.push(runId);
        return { ok: true };
      },
    });
    store().setChatDraft("안녕");
    await store().sayInChat();

    await store().stopChatTurn();

    expect(stopped).toEqual(["run_1"]);
    expect(chatIsWaiting(store())).toBe(false);
  });

  it("그만두지 못했으면 그 까닭을 말한다 — 조용히 실패하지 않는다 (I3)", async () => {
    chatServer(() => ({ runId: "run_1", threadId: "run_1" }));
    useEditor.setState({
      watchChatEvents: async () => ({ ended: false, lastSeq: null }),
      sendRunCancel: async () => ({ failure: { key: "chat.stop.offline" } }),
    });
    store().setChatDraft("안녕");
    await store().sayInChat();

    await store().stopChatTurn();

    expect(store().chatNotice).toEqual({ key: "chat.stop.offline" });
    expect(chatIsWaiting(store())).toBe(true);
  });

  it("문서를 놓으면 대화도 놓는다 (I4)", async () => {
    await oneTurn();

    store().abandonChat();

    expect(store().chatOpen).toBe(false);
    expect(store().chatTurns).toEqual([]);
    expect(store().chatThreadId).toBeNull();
  });
});
