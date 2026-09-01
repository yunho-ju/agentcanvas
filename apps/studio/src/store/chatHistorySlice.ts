// 지난 대화의 상태 — 어떤 대화들이 있었고(J), 그 가운데 무엇을 열어 두었는가(K).
// '지금 대화'(chatSlice)와 변하는 까닭이 다르므로 자리를 따로 둔다: 여기는 목록과 복원만 안다.
// 되짓는 규칙은 chat/threadHistory의 순수 함수가 안다 — 이 자리는 상태 전이만 한다.
import type { StateCreator } from "zustand";
import {
  type SpecThreadsOutcome,
  type ThreadEventsOutcome,
  type ThreadSummary,
  fetchSpecThreads,
  fetchThreadEvents,
} from "../api/threads";
import { restoredTurns, runningElsewhere, versionOfRevision } from "../chat/threadHistory";
import { unansweredPause } from "../run/player";
import { type Message, msg } from "../i18n/messages";
import { chatIsWaiting, chatSpecId } from "./chatSlice";
import type { EditorState } from "./editor";

/** 지난 대화들을 물어보는 길. 시험은 이 자리에 가짜를 꽂는다 (chatSlice와 같은 관례). */
export type AskSpecThreads = (specId: string) => Promise<SpecThreadsOutcome>;
export type AskThreadEvents = (threadId: string) => Promise<ThreadEventsOutcome>;

/** 대화를 열다 못 연 자리 — 무엇을 열려 했고 왜 못 열었는가(그래야 다시 열어 볼 수 있다). */
export interface ChatOpenTrouble {
  threadId: string;
  why: Message;
}

/** 대화 패널 안의 두 뷰 — 여섯 번째 모드를 만들지 않는다 (결정 1). */
export type ChatView = "now" | "past";

export interface ChatHistorySlice {
  chatView: ChatView;
  /** 이 문서에서 오갔던 대화들 — 아직 물어보지 않았으면 없음(null)이다 */
  chatThreads: ThreadSummary[] | null;
  chatThreadsFailure: Message | null;
  /** 목록에서 지울지 한 번 더 묻는 중인 대화 — 되돌릴 수 없는 일이라 다시 묻는다 */
  chatThreadDeleting: string | null;
  chatThreadDeleteFailure: Message | null;
  /** 지금 열고 있는 대화 — 여는 동안 그 줄은 여는 중이라고 말하고, 다른 줄은 기다린다 */
  chatOpening: string | null;
  /** 못 연 대화와 그 까닭 — 반쯤 열린 대화를 남기지 않는다 (K5·K6) */
  chatOpenTrouble: ChatOpenTrouble | null;
  /** 기다리는 말이 있는데 지난 대화를 열려 한 자리 — 한 번 더 묻는다 (L1) */
  chatSwitchAsking: string | null;
  askSpecThreads: AskSpecThreads;
  askThreadEvents: AskThreadEvents;
  showPastChats: () => void;
  /** 지난 대화를 잊는다 — 문서를 놓거나 모드를 떠나면 이 목록은 이 문서의 것이 아니다 */
  forgetPastChats: () => void;
  showNowChat: () => void;
  /** 이 문서에서 오갔던 대화들을 다시 물어본다 */
  loadChatThreads: () => Promise<void>;
  /** 고른 대화를 연다 — 기다리는 말이 있으면 먼저 한 번 더 묻는다 */
  openPastChat: (threadId: string) => Promise<void>;
  /** 못 열었던 대화를 한 번 더 열어 본다 */
  retryOpenPastChat: () => Promise<void>;
  confirmSwitchPastChat: () => Promise<void>;
  cancelSwitchPastChat: () => void;
  askToDeletePastChat: (threadId: string) => void;
  cancelDeletePastChat: () => void;
  /** 목록에서 고른 대화를 서버에서 지운다 — 그 대화를 열어 두었으면 화면도 함께 비운다 */
  deletePastChat: () => Promise<void>;
}

/** 목록 뷰로 갈 때마다 지난 물음의 흔적은 접는다 — 같은 물음을 두 번 묻지 않는다. */
const NOTHING_ASKED: Pick<
  ChatHistorySlice,
  | "chatThreadDeleting"
  | "chatThreadDeleteFailure"
  | "chatOpenTrouble"
  | "chatSwitchAsking"
  | "chatOpening"
> = {
  chatThreadDeleting: null,
  chatThreadDeleteFailure: null,
  chatOpenTrouble: null,
  chatSwitchAsking: null,
  chatOpening: null,
};

export const createChatHistorySlice: StateCreator<EditorState, [], [], ChatHistorySlice> = (
  set,
  get,
) => {
  /** 지난 대화를 물어볼 문서 — 목록과 훑기가 같은 자리에서 문서를 고른다. */
  function specId(): string | null {
    return chatSpecId(get());
  }

  /** 새 대화 자리로 돌아가되 적던 말은 남긴다 — 그 말은 사람의 것이라 화면이 버리지 않는다. */
  function startFreshKeepingDraft(): void {
    const draft = get().chatDraft;
    get().newChatThread();
    set({ chatDraft: draft });
  }

  /** 고른 대화를 그대로 화면에 세운다 — 못 세우면 그 까닭만 남기고 하던 자리를 흔들지 않는다. */
  async function restore(threadId: string): Promise<void> {
    // 서버에 세 번 묻고 오는 사이에 자리를 뜰 수 있다 — 그때 온 대답은 이 자리의 것이 아니다.
    const askedFor = get().chatGeneration();
    /** 이 부탁이 지금 자리의 것이 아닌가 — 그렇다면 '여는 중'이라는 표시부터 거둔다(굳지 않게). */
    const stale = () => {
      if (!get().chatStale(askedFor)) return false;
      if (get().chatOpening === threadId) set({ chatOpening: null });
      return true;
    };
    const trouble = (why: Message) =>
      stale()
        ? undefined
        : set({
            chatOpenTrouble: { threadId, why },
            chatSwitchAsking: null,
            chatOpening: null,
          });

    set({ chatOpening: threadId, chatOpenTrouble: null });

    const heard = await get().askThreadEvents(threadId);
    if (stale()) return;
    if (heard.turns === undefined) return trouble(heard.failure);

    const first = heard.turns[0];
    // 오간 말이 하나도 없으면 열 대화가 없다 — 목록 자리에서 말하고, 다시 불러올 길을 준다.
    if (first === undefined) {
      return set({ chatOpening: null, chatThreadsFailure: msg("chat.thread.empty") });
    }
    const revision = first.run.spec_revision;
    const body = await get().askSpecRevision(specId() ?? "", revision);
    if (stale()) return;
    if (body.failure) return trouble(body.failure);

    // 판 번호는 곁들이는 말이다 — 판 기록을 못 읽었으면 번호 없이 말한다(열기를 막지 않는다).
    const history = await get().fetchRevisions(specId() ?? "");
    if (stale()) return;
    const turns = restoredTurns(heard.turns);
    // 듣던 스트림을 놓고 새 자리에서 시작한다 — 적던 말은 사람의 것이라 그대로 둔다.
    startFreshKeepingDraft();
    const elsewhere = runningElsewhere(body.saved, turns);
    set({
      ...NOTHING_ASKED,
      chatView: "now",
      chatOpening: null,
      chatThreadId: threadId,
      chatSpec: body.saved,
      chatPin: {
        revision,
        version: versionOfRevision(history.revisions ?? [], revision),
      },
      chatTurns: turns,
      // 도는 중인 실행은 따라가지 않는다 — 따라가는 척하지 않고 그렇다고 말한다.
      chatElsewhere: elsewhere,
      chatNotice: elsewhere ? msg("chat.thread.elsewhere") : null,
    });
    // 멈춰 서서 사람을 기다리는 대화는 다시 듣는다 — 답을 보낸 뒤 이어지는 사건이 도착할 길이다.
    // (이미 쌓인 것은 다시 흘러와도 순번이 그 이벤트의 이름이라 두 번 세지 않는다.)
    const held = turns.at(-1);
    if (!elsewhere && held && unansweredPause(held.events) !== null && held.runId !== null) {
      void get().followChatRun(held.runId);
    }
  }

  return {
    chatView: "now",
    chatThreads: null,
    chatThreadsFailure: null,
    ...NOTHING_ASKED,
    askSpecThreads: (id) => fetchSpecThreads(id),
    askThreadEvents: (threadId) => fetchThreadEvents(threadId),

    showPastChats: () => {
      set({ ...NOTHING_ASKED, chatView: "past" });
      void get().loadChatThreads();
    },

    showNowChat: () => set({ ...NOTHING_ASKED, chatView: "now" }),

    forgetPastChats: () => {
      set({
        ...NOTHING_ASKED,
        chatView: "now",
        chatThreads: null,
        chatThreadsFailure: null,
      });
      get().forgetFixSpots();
    },

    loadChatThreads: async () => {
      const id = specId();
      if (id === null) return;
      const outcome = await get().askSpecThreads(id);
      if (outcome.threads === undefined) {
        return set({ chatThreads: null, chatThreadsFailure: outcome.failure });
      }
      // 서버가 준 순서가 그대로 화면의 순서다 (최근에 말이 오간 것부터).
      set({ chatThreads: outcome.threads, chatThreadsFailure: null });
      void get().lookForFixSpots(outcome.threads);
    },

    openPastChat: async (threadId) => {
      // 여는 중에는 다른 대화를 겹쳐 열지 않는다 — 어느 대답이 이길지 사람이 알 수 없다.
      if (get().chatOpening !== null) return;
      // 기다리는 말이 있는데 자리를 뜨면 그 말을 놓친다 — 먼저 묻는다.
      // 다른 곳에서 도는 중이라고 이미 말한 대화라면 여기서는 아무것도 기다리지 않는다: 곧장 연다.
      if (chatIsWaiting(get()) && !get().chatElsewhere) {
        return set({ chatSwitchAsking: threadId });
      }
      await restore(threadId);
    },

    retryOpenPastChat: async () => {
      const threadId = get().chatOpenTrouble?.threadId;
      if (threadId === undefined) return;
      set({ chatOpenTrouble: null });
      await restore(threadId);
    },

    confirmSwitchPastChat: async () => {
      const threadId = get().chatSwitchAsking;
      if (threadId === null) return;
      set({ chatSwitchAsking: null });
      await restore(threadId);
    },

    cancelSwitchPastChat: () => set({ chatSwitchAsking: null }),

    askToDeletePastChat: (threadId) =>
      set({ chatThreadDeleting: threadId, chatThreadDeleteFailure: null }),

    cancelDeletePastChat: () => set({ chatThreadDeleting: null }),

    deletePastChat: async () => {
      const threadId = get().chatThreadDeleting;
      if (threadId === null) return;
      const outcome = await get().sendThreadDelete(threadId);
      if (outcome.failure) {
        // 하나도 지우지 못했다는 사실을 목록 안에서 말한다 — 되묻기는 닫는다.
        return set({ chatThreadDeleting: null, chatThreadDeleteFailure: outcome.failure });
      }
      // 열어 두었던 대화를 지웠으면 화면의 그 대화도 함께 사라진다 (없는 대화를 그리지 않는다).
      if (get().chatThreadId === threadId) startFreshKeepingDraft();
      // 지운 대화의 고칠 자리도 함께 사라진다 — 없는 대화를 두고 고칠 자리를 말하지 않는다 (m4).
      get().dropFixSpotsOf(threadId);
      set({
        chatThreadDeleting: null,
        chatThreadDeleteFailure: null,
        chatThreads: (get().chatThreads ?? []).filter((one) => one.thread_id !== threadId),
        feedbackNotice: { message: { key: "chat.delete.ok" }, tone: "ok" },
      });
    },
  };
};
