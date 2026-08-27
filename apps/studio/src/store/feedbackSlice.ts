// 저장·실행·문서 복귀처럼 여러 흐름이 한 줄로 알려야 하는 일반 feedback 채널.
// 연결 안내(history notice)와 eval 패널 소식은 각자 손이 있는 자리를 지킨다.
import type { StateCreator } from "zustand";
import type { Message } from "../i18n/messages";
import type { EditorState } from "./editor";

/** 하단 feedback toast가 말할 세기 — 성공·주의·실패를 같은 문법으로 보여 준다. */
export type FeedbackTone = "ok" | "warn" | "danger";

export interface FeedbackNotice {
  message: Message;
  tone: FeedbackTone;
}

export interface FeedbackSlice {
  feedbackNotice: FeedbackNotice | null;
  dismissFeedbackNotice: () => void;
}

export const createFeedbackSlice: StateCreator<EditorState, [], [], FeedbackSlice> = (
  set,
) => ({
  feedbackNotice: null,

  dismissFeedbackNotice: () => set({ feedbackNotice: null }),
});
