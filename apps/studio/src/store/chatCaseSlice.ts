// 대화 한 마디를 시험 케이스로 넘기는 자리 (CHAT-4c O) — promoteFailedRun의 형제다.
// 여기는 상태 전이만 한다: 무엇을 옮길지는 chat/chatCase의 순수 함수가 정하고,
// 초안을 세우고 저장하는 길은 이미 있는 것(enterEvalMode·startNewCase·saveCaseDraft) 그대로다.
import type { StateCreator } from "zustand";
import { chatCaseSeed } from "../chat/chatCase";
import { chatTurnEnd } from "../chat/chatTurn";
import { msg, translate } from "../i18n/messages";
import { getLocale } from "../i18n/localeStore";
import { chatSpecOf } from "./chatSlice";
import type { EditorState } from "./editor";

export interface ChatCaseSlice {
  /** 이 말을 시험 케이스 초안으로 옮긴다 — 담기 전에는 저장이 아니다 */
  promoteChatTurn: (turnId: string) => void;
}

export const createChatCaseSlice: StateCreator<EditorState, [], [], ChatCaseSlice> = (
  _set,
  get,
) => ({
  promoteChatTurn: (turnId) => {
    const turn = get().chatTurns.find((one) => one.id === turnId);
    const spec = chatSpecOf(get());
    if (!turn || spec === null) return;
    // 적고 있던 초안이 있으면 덮어쓰지 않는다 — 사람이 적던 것은 사람의 것이다(promoteFailedRun과 같다).
    if (get().caseDraft) return;
    // 아직 끝나지 않은 말은 옮길 결말이 없다 — 기다리는 대화를 되묻지도 않고 버리지 않는다.
    if (chatTurnEnd(spec, turn) === null) return;
    // 시험을 열면 대화는 물러난다(한 자리를 나눠 쓴다) — 그 전에 옮길 것을 손에 쥔다.
    const seed = chatCaseSeed(spec, turn);

    get().enterEvalMode();
    get().startNewCase({
      title: translate(getLocale(), msg("eval.case.fromChat.title")),
      input: seed.input,
    });
    // 그 말이 받은 답은 후보로만 내민다 — 기대 문구는 사람이 적는다(자동 저장 금지).
    get().offerPhraseFromChat(seed.answer);
  },
});
