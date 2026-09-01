// 고칠 자리의 상태 — 어떤 대화를 훑어 두었고, 훑다가 지나친 것이 있는가 (CHAT-4c).
// '지난 대화' 목록(chatHistorySlice)과 변하는 까닭이 다르므로 자리를 따로 둔다.
// 훑는 법(다시 물을 것·동시에 물을 수·어느 판으로 판정할지)은 chat/fixSpotScan의 순수 정책이고,
// 이 자리는 문을 건네고 결과를 앉히는 상태 전이만 한다.
import type { StateCreator } from "zustand";
import type { ThreadSummary } from "../api/threads";
import { type FixSpotScan, scanThreads, withoutThread } from "../chat/fixSpotScan";
import { chatSpecId } from "./chatSlice";
import type { EditorState } from "./editor";

export interface ChatFixSpotSlice {
  /** 훑어 본 대화마다 다음에 볼 자리들 — 아직 훑지 못한 대화는 여기 없다 */
  chatFixSpots: FixSpotScan;
  /** 훑다가 지나친 대화가 있는가 — 있으면 조용하다고 말하지 않고 다시 훑을 길을 준다 */
  chatFixSpotsMissed: boolean;
  /** 이 대화들에서 고칠 자리를 파생한다 — 달라지지 않은 대화는 다시 묻지 않는다 */
  lookForFixSpots: (threads: ThreadSummary[]) => Promise<void>;
  /** 못 훑고 지나친 대화를 다시 훑어 본다 */
  retryFixSpotScan: () => Promise<void>;
  /** 지운 대화의 고칠 자리를 함께 놓는다 — 없는 대화의 자리를 말하지 않는다 */
  dropFixSpotsOf: (threadId: string) => void;
  /** 이 문서의 것이 아니게 되면 훑어 둔 것도 놓는다 */
  forgetFixSpots: () => void;
}

/**
 * 훑어 본 대화가 모두 조용한가 — 그때만 "고칠 자리가 보이지 않아요"라고 말할 수 있다 (N3).
 * 하나도 훑지 못했거나 지나친 것이 있으면 아무 말도 하지 않는다: 모르는 것을 없다고 말하지 않는다.
 */
export function chatNothingToFix(state: EditorState): boolean {
  if (state.chatFixSpotsMissed) return false;
  const scanned = Object.values(state.chatFixSpots);
  return scanned.length > 0 && scanned.every((one) => one.spots.length === 0);
}

export const createChatFixSpotSlice: StateCreator<EditorState, [], [], ChatFixSpotSlice> = (
  set,
  get,
) => ({
  chatFixSpots: {},
  chatFixSpotsMissed: false,

  lookForFixSpots: async (threads) => {
    const id = chatSpecId(get());
    if (id === null) return;
    // 훑고 오는 사이에 자리를 떠나거나 그 대화를 지울 수 있다 — 그때 온 답은 이 자리의 것이 아니다.
    // (복원과 같은 세대 확인 + 지금 목록에 그 대화가 남아 있는가.)
    const askedFor = get().chatGeneration();
    const stillOurs = (threadId: string) =>
      !get().chatStale(askedFor) &&
      (get().chatThreads ?? []).some((one) => one.thread_id === threadId);

    await scanThreads(threads, get().chatFixSpots, {
      readEvents: (threadId) => get().askThreadEvents(threadId),
      readRevision: async (revision) => (await get().askSpecRevision(id, revision)).saved ?? null,
      keep: (carried) => {
        if (get().chatStale(askedFor)) return;
        set({ chatFixSpots: carried, chatFixSpotsMissed: false });
      },
      // 훑은 대로 곧바로 앉힌다 — 느린 하나가 끝난 것들을 가리지 않는다.
      found: (threadId, scanned) => {
        if (!stillOurs(threadId)) return;
        set({ chatFixSpots: { ...get().chatFixSpots, [threadId]: scanned } });
      },
      missed: (threadId) => {
        if (!stillOurs(threadId)) return;
        set({ chatFixSpotsMissed: true });
      },
    });
  },

  retryFixSpotScan: async () => {
    const threads = get().chatThreads;
    if (threads === null) return;
    await get().lookForFixSpots(threads);
  },

  dropFixSpotsOf: (threadId) =>
    set({ chatFixSpots: withoutThread(get().chatFixSpots, threadId) }),

  forgetFixSpots: () => set({ chatFixSpots: {}, chatFixSpotsMissed: false }),
});
