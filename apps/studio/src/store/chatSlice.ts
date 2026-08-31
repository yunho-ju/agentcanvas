// 대화의 상태 — 지금 어느 대화의 몇 마디가 오갔고, 무엇을 기다리는가.
// 말의 뜻(답인가 실패인가 거절인가)은 여기서 정하지 않는다: chat/의 순수 함수가 이벤트를 읽는다.
// 서버로 나가는 길은 전부 주입받는다 — 시험은 그 자리만 갈아 끼운다 (runSlice와 같은 관례).
import type { StateCreator } from "zustand";
import {
  type ChatTurn,
  type RunCancelOutcome,
  type RunStartOutcome,
  cancelRunOnServer,
  startChatTurnOnServer,
  streamRunEvents,
} from "../api/runs";
import { type SaveOutcome, fetchSpecRevision } from "../api/specs";
import { type ThreadDeleteOutcome, deleteThreadOnServer } from "../api/threads";
import { type ChatDoor, publishedBody } from "../chat/chatEntry";
import type { ChatPin } from "../chat/chatPin";
import {
  type ChatTurnState,
  chatHistory,
  chatTurnEnd,
  chatTurnInput,
} from "../chat/chatTurn";
import type { AgentSpec } from "../generated/agent_spec";
import type { RunEvent } from "../generated/run_event";
import { type Message, msg } from "../i18n/messages";
import { mergedEvents } from "../run/eventLog";
import { answerGate as submitGateAnswer } from "../run/gateAnswer";
import { unansweredPause } from "../run/player";
import { RunStream, type WatchRun } from "../run/runStream";
import type { EditorState } from "./editor";

/** 게시된 판의 몸통을 읽는 길. */
export type AskSpecRevision = (id: string, revision: string) => Promise<SaveOutcome>;

/** 게시된 판에 말을 거는 길 — 어느 판인지는 서버가 집는다. */
export type SendChatTurn = (
  specId: string,
  turn: ChatTurn,
) => Promise<RunStartOutcome>;

export type SendThreadDelete = (threadId: string) => Promise<ThreadDeleteOutcome>;
export type SendRunCancel = (runId: string) => Promise<RunCancelOutcome>;

export interface ChatSlice {
  /** 대화 화면이 열려 있는가 — 이 모드에서도 캔버스는 배경에 그대로다 */
  chatOpen: boolean;
  /** 지금 이어 가는 대화 — 첫 말의 실행 이름을 서버가 대화 이름으로 삼는다 (결정 5) */
  chatThreadId: string | null;
  /** 이 대화가 붙잡아 둔 판 — 시작할 때 집고 그 뒤로 움직이지 않는다 (G4) */
  chatPin: ChatPin | null;
  /** 붙잡은 그 판의 몸통 — 대화 도중 다른 판이 게시돼도 하던 대화는 이 판과 이어진다 */
  chatSpec: AgentSpec | null;
  /** 오간 말들 — 세션 동안만 남는다 (새로고침 뒤 복원은 CHAT-4) */
  chatTurns: ChatTurnState[];
  chatDraft: string;
  /** 대화 안에서 말해야 할 까닭 한 줄 — 조용히 실패하지 않는다 */
  chatNotice: Message | null;
  /** 지우겠다는 뜻을 한 번 더 묻는 중인가 — 되돌릴 수 없는 일이라 다시 묻는다 */
  chatDeleteAsking: boolean;
  /** 밸브에 보낸 답의 대답을 기다리는 중인가 — 이 사이에 다시 눌러도 답은 한 번만 간다 */
  chatAnswering: boolean;
  /** 확인 카드가 열려 있는가 — 닫아 두어도 그 말은 멈춘 채로 남는다 (DESIGN §1 ②) */
  chatGateCardOpen: boolean;
  /** 거절하겠다는 뜻을 한 번 더 묻는 중인가 — Esc가 무엇을 먼저 무를지 화면 밖도 알아야 한다 */
  chatRejectAsking: boolean;
  /** 게시된 판의 몸통 — 대화 문을 열지 말지와 무엇을 실어 보낼지가 여기서 나온다 */
  publishedSpec: AgentSpec | null;
  /** 그 몸통을 읽어 보려다 못 읽은 까닭 — 못 읽은 것을 '아직 읽는 중'이라고 말하지 않는다 */
  publishedSpecFailure: Message | null;
  askSpecRevision: AskSpecRevision;
  sendChatTurn: SendChatTurn;
  watchChatEvents: WatchRun;
  sendThreadDelete: SendThreadDelete;
  sendRunCancel: SendRunCancel;
  /** 지금 게시된 판의 몸통을 불러온다 — 이미 그 판을 들고 있거나 못 읽은 판이면 다시 묻지 않는다 */
  loadPublishedSpec: () => Promise<void>;
  /** 사람이 다시 확인하라고 했다 — 못 읽었던 판을 한 번 더 읽어 본다 */
  retryPublishedSpec: () => Promise<void>;
  enterChatMode: () => void;
  leaveChatMode: () => void;
  setChatDraft: (said: string) => void;
  /** 적어 둔 말을 게시된 판에 보낸다 — 말 한 번이 실행 하나다 */
  sayInChat: () => Promise<void>;
  /** 서버가 흘려보낸 이벤트를 그 말에 쌓는다 */
  appendChatEvents: (runId: string, events: RunEvent[]) => void;
  /** 대화 안의 밸브에 답한다 — 승인하면 이어지고, 거절하면 그 말이 거기서 끝난다 */
  approveChatGate: (values?: Record<string, unknown>) => Promise<void>;
  rejectChatGate: () => Promise<void>;
  /** 기다리던 말을 여기서 그만둔다 — 그래야 지울 수 없는 대화가 생기지 않는다 (I3) */
  stopChatTurn: () => Promise<void>;
  /** 화면의 대화만 처음으로 돌린다 — 서버의 지난 말은 그대로 둔다 (I1) */
  newChatThread: () => void;
  /** 확인 카드를 열거나 닫는다 — 닫아도 그 말은 멈춘 채로 남는다 */
  setChatGateCardOpen: (open: boolean) => void;
  /** 거절하겠다고 말했다 — 아직 아무 답도 하지 않았고, 카드가 한 번 더 묻는다 */
  askToRejectChatGate: () => void;
  /** 다시 묻는 물음을 무른다 — 원래의 물음으로 돌아간다 */
  cancelChatRejectGate: () => void;
  askToDeleteChat: () => void;
  cancelDeleteChat: () => void;
  /** 이 대화를 서버에서 지운다 — 아직 끝나지 않은 말이 있으면 서버가 하나도 지우지 않는다 (I2·I3) */
  deleteChatThread: () => Promise<void>;
  /** 문서를 놓는다 — 듣던 스트림을 끊고 대화를 잊는다 (I4) */
  abandonChat: () => void;
}

/** 대화를 갓 시작한 자리 — 새 대화도 문서를 놓는 일도 이 자리로 돌아간다. */
const NEW_THREAD: Pick<
  ChatSlice,
  | "chatThreadId"
  | "chatPin"
  | "chatSpec"
  | "chatTurns"
  | "chatDraft"
  | "chatNotice"
  | "chatDeleteAsking"
  | "chatAnswering"
  | "chatGateCardOpen"
  | "chatRejectAsking"
> = {
  chatThreadId: null,
  chatPin: null,
  chatSpec: null,
  chatTurns: [],
  chatDraft: "",
  chatNotice: null,
  chatDeleteAsking: false,
  chatAnswering: false,
  chatGateCardOpen: true,
  chatRejectAsking: false,
};

/**
 * 지금 대화 상대가 되는 판의 몸통 — 게시된 판의 것이 아니면 없는 것으로 본다.
 * (게시가 바뀐 뒤 아직 새 판을 못 읽었으면 '모른다'가 정답이다 — 옛 판으로 판정하지 않는다.)
 */
export function publishedChatSpec(state: EditorState): AgentSpec | null {
  return publishedBody(state.publication, state.publishedSpec);
}

/** 대화 문 앞에서 화면이 아는 사실 — 버튼도 패널도 이 한 자리를 보고 판정한다. */
export function chatDoor(state: EditorState): ChatDoor {
  return {
    hasDoc: state.spec !== null,
    publication: state.publication,
    publishedSpec: state.publishedSpec,
    publishedSpecFailure: state.publishedSpecFailure,
  };
}

/**
 * 지금 이 대화가 말을 거는 판 — 대화가 시작됐으면 붙잡은 그 판이고, 아직이면 지금 게시된 판이다.
 * 대화 도중 다른 판이 게시돼도 하던 대화는 첫 판으로 이어진다 (서버가 고정한 사실을 화면도 따른다).
 */
export function chatSpecOf(state: EditorState): AgentSpec | null {
  return state.chatSpec ?? publishedChatSpec(state);
}

/** 답을 기다리는 중인가 — 이 동안에는 다음 말을 받지 않는다 (G3). */
export function chatIsWaiting(state: EditorState): boolean {
  const last = state.chatTurns.at(-1);
  const spec = chatSpecOf(state);
  if (!last || spec === null) return false;
  return chatTurnEnd(spec, last) === null;
}

/** 확인 카드가 사람에게 묻고 있는가 — 열려 있고, 기다리는 밸브가 있을 때다 (DESIGN §1 ②). */
export function chatGateIsAsking(state: EditorState): boolean {
  return state.chatGateCardOpen && chatAwaitingGate(state) !== null;
}

/** 그 물음이 "정말 거절할까요"인가 — Esc가 가장 먼저 무르는 자리다 (DESIGN §1 ①). */
export function chatGateIsConfirmingReject(state: EditorState): boolean {
  return chatGateIsAsking(state) && state.chatRejectAsking;
}

/** 대화가 밸브 앞에 멈춰 섰는가 — 그렇다면 어느 노드에서인가 (H1). */
export function chatAwaitingGate(state: EditorState): string | null {
  const last = state.chatTurns.at(-1);
  if (!last) return null;
  return unansweredPause(last.events)?.node_id ?? null;
}

export const createChatSlice: StateCreator<EditorState, [], [], ChatSlice> = (
  set,
  get,
) => {
  /** 마지막으로 읽어 본 판 — 못 읽은 판을 저 혼자 다시 두드리지 않기 위한 기억이다(상태가 아니다). */
  let lastRead: string | null = null;

  /** 오간 말 하나를 고쳐 적는다 — 그 말이 이미 사라졌으면 아무 일도 하지 않는다. */
  const reviseTurn = (id: string, change: Partial<ChatTurnState>) =>
    set({
      chatTurns: get().chatTurns.map((turn) =>
        turn.id === id ? { ...turn, ...change } : turn,
      ),
    });

  const stream = new RunStream({
    watchRunEvents: (runId, watch) => get().watchChatEvents(runId, watch),
    onEvent: (runId, event) => get().appendChatEvents(runId, [event]),
    onLost: () => {},
    onFailure: (message) => set({ chatNotice: message }),
  });

  /** 사람의 답을 밸브에 보낸다 — 실행 화면과 같은 정책을 그대로 쓴다 (두 번 보내지 않기). */
  function answerChatGate(
    approved: boolean,
    values?: Record<string, unknown>,
  ): Promise<void> {
    return submitGateAnswer(approved, values, {
      sendRunAnswer: (runId, answer) => get().sendRunAnswer(runId, answer),
      isAwaitingGate: () => chatAwaitingGate(get()) !== null,
      isAnswering: () => get().chatAnswering,
      activeRunId: () => get().chatTurns.at(-1)?.runId ?? null,
      setAnswering: (chatAnswering) => set({ chatAnswering }),
      onFailure: (message) => set({ chatNotice: message }),
      // 답을 했으니 물음은 끝났다 — 이어지는 사건은 스트림으로 도착한다.
      onAnswered: () => set({ chatRejectAsking: false }),
    });
  }

  /**
   * 내놓은 판의 몸통을 읽어 둔다 — 이미 그 판을 들고 있으면 다시 묻지 않는다.
   * 못 읽은 판은 저 혼자 다시 두드리지 않는다(사람이 `다시 확인`을 누를 때만): 닿지 않는 서버를
   * 화면이 조용히 계속 부르지 않게 하되, 못 읽었다는 사실은 반드시 남긴다.
   */
  async function readPublishedSpec(asked: boolean): Promise<void> {
    const published = get().publication;
    if (published === null) {
      lastRead = null;
      return set({ publishedSpec: null, publishedSpecFailure: null });
    }
    if (publishedBody(published, get().publishedSpec) !== null) return;
    // 한 판은 한 번만 물어본다 — 못 읽었든, 읽었는데 그 판이 아니든 같다.
    // (성공만 재요청을 막으면, 엉뚱한 판을 받은 자리에서 화면이 서버를 끝없이 두드린다.)
    if (lastRead === published.revision && !asked) return;
    lastRead = published.revision;
    set({ publishedSpecFailure: null });
    const outcome = await get().askSpecRevision(published.spec_id, published.revision);
    // 오가는 사이에 다른 판이 게시됐으면 이 대답은 그 판의 것이 아니다.
    if (get().publication?.revision !== published.revision) return;
    if (outcome.failure) return set({ publishedSpecFailure: outcome.failure });
    set({ publishedSpec: outcome.saved, publishedSpecFailure: null });
  }

  return {
    ...NEW_THREAD,
    chatOpen: false,
    publishedSpec: null,
    publishedSpecFailure: null,
    askSpecRevision: (id, revision) => fetchSpecRevision(id, revision),
    sendChatTurn: (specId, turn) => startChatTurnOnServer(specId, turn),
    watchChatEvents: (runId, watch) => streamRunEvents(runId, watch),
    sendThreadDelete: (threadId) => deleteThreadOnServer(threadId),
    sendRunCancel: (runId) => cancelRunOnServer(runId),

    loadPublishedSpec: () => readPublishedSpec(false),
    retryPublishedSpec: () => readPublishedSpec(true),

    enterChatMode: () => {
      set({ chatOpen: true });
      void get().loadPublishedSpec();
    },

    // 모드를 떠나면 듣던 스트림을 놓는다 — 세션 안의 대화도 여기서 끝난다 (복원은 CHAT-4).
    leaveChatMode: () => {
      stream.abandon();
      set({ ...NEW_THREAD, chatOpen: false });
    },

    setChatDraft: (chatDraft) => set({ chatDraft, chatNotice: null }),

    sayInChat: async () => {
      const said = get().chatDraft.trim();
      const spec = chatSpecOf(get());
      const published = get().publication;
      if (said === "" || spec === null || published === null) return;
      // 답을 기다리는 동안에는 두 번째 말을 받지 않는다 — 한 시점에 오가는 말은 하나다.
      if (chatIsWaiting(get())) return;

      const id = `turn_${get().chatTurns.length + 1}`;
      const input = chatTurnInput(spec, said, chatHistory(spec, get().chatTurns));
      set({
        chatTurns: [
          ...get().chatTurns,
          { id, said, runId: null, events: [], halted: null },
        ],
        chatDraft: "",
        chatNotice: null,
        // 새 말은 새 물음을 연다 — 지난 말에서 접어 둔 카드가 다음 확인을 가리지 않게 한다.
        chatGateCardOpen: true,
        chatRejectAsking: false,
      });

      const askedFor = stream.currentGeneration();
      const threadId = get().chatThreadId;
      // 붙잡을 판과 그 번호는 지금 이 순간의 것이다 — 대답을 기다리는 사이에 게시가 바뀌어도
      // 한 시점의 사실 하나로 남는다 (revision과 version이 서로 다른 순간에서 오지 않게).
      const version = get().publishedVersion;
      const outcome = await get().sendChatTurn(published.spec_id, {
        ...(threadId ? { threadId } : {}),
        input,
      });
      // 오가는 사이에 문서를 놓았다면 이 대답은 이 자리의 것이 아니다.
      if (stream.stale(askedFor)) return;
      // 물린 까닭은 그 말 옆에 남는다 — 같은 사실을 안내 줄로 한 번 더 말하지 않는다.
      if (outcome.failure) return reviseTurn(id, { halted: outcome.failure });
      reviseTurn(id, { runId: outcome.run.id });
      set({
        // 대화 이름도 붙잡는 판도 첫 말이 정한다 — 그 뒤로는 서버가 고정한 것을 그대로 믿는다.
        chatThreadId: get().chatThreadId ?? outcome.run.thread_id,
        chatPin: get().chatPin ?? { revision: outcome.run.spec_revision, version },
        chatSpec: get().chatSpec ?? spec,
      });
      void stream.follow(outcome.run.id);
    },

    appendChatEvents: (runId, heard) => {
      const turn = get().chatTurns.find((one) => one.runId === runId);
      // 이 대화에서 시작하지 않은 실행의 이벤트는 받지 않는다.
      if (!turn) return;
      reviseTurn(turn.id, { events: mergedEvents(turn.events, heard) });
    },

    approveChatGate: (values) => answerChatGate(true, values),
    rejectChatGate: () => answerChatGate(false),

    stopChatTurn: async () => {
      const runId = get().chatTurns.at(-1)?.runId;
      if (!runId || !chatIsWaiting(get())) return;
      const outcome = await get().sendRunCancel(runId);
      if (outcome.failure) return set({ chatNotice: outcome.failure });
      // 그만둔 사실은 이벤트로도 오지만, 화면은 그 자리에서 기다림을 놓는다.
      stream.stopListening();
      reviseTurn(get().chatTurns.at(-1)?.id ?? "", {
        halted: { key: "chat.turn.stopped" },
      });
    },

    newChatThread: () => {
      stream.abandon();
      set({ ...NEW_THREAD });
    },

    // 카드를 접으면 다시 묻던 물음도 함께 접힌다 — 다시 열면 원래의 물음부터다 (gateSlice와 같은 전이).
    setChatGateCardOpen: (chatGateCardOpen) =>
      set({ chatGateCardOpen, chatRejectAsking: false }),

    askToRejectChatGate: () => {
      if (chatAwaitingGate(get()) === null) return;
      set({ chatRejectAsking: true });
    },

    cancelChatRejectGate: () => set({ chatRejectAsking: false }),

    askToDeleteChat: () => {
      if (get().chatThreadId === null) return;
      set({ chatDeleteAsking: true });
    },

    cancelDeleteChat: () => set({ chatDeleteAsking: false }),

    deleteChatThread: async () => {
      const threadId = get().chatThreadId;
      if (threadId === null) return;
      const outcome = await get().sendThreadDelete(threadId);
      if (outcome.failure) {
        // 하나도 지우지 못했다는 사실을 대화 안에서 말한다 — 되묻기는 닫는다(같은 물음을 두 번 묻지 않는다).
        // 확인을 기다리느라 못 지운 것이면 그 다음 걸음(승인·거절)을 말한다 — 서버는 두 까닭을 같은 409로 물린다.
        set({
          chatDeleteAsking: false,
          chatNotice:
            chatAwaitingGate(get()) === null ? outcome.failure : msg("chat.delete.gateFirst"),
        });
        return;
      }
      stream.abandon();
      set({
        ...NEW_THREAD,
        feedbackNotice: { message: { key: "chat.delete.ok" }, tone: "ok" },
      });
    },

    abandonChat: () => {
      stream.abandon();
      lastRead = null;
      set({
        ...NEW_THREAD,
        chatOpen: false,
        publishedSpec: null,
        publishedSpecFailure: null,
      });
    },
  };
};
