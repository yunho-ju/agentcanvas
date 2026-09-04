import type { StateCreator } from "zustand";
import { reviewArchitectSpec, type ArchitectReview } from "../architect/architect";
import {
  createArchitectDraftOnServer,
  type ArchitectDraftOutcome,
} from "../api/architect";
import type { AgentSpec } from "../generated/agent_spec";
import type { PatternAnswer } from "../generated/pattern_answer";
import type { PatternAsk } from "../generated/pattern_ask";
import type { SkippedPattern } from "../generated/skipped_pattern";
import type { Message } from "../i18n/messages";
import type { EditorState } from "./editor";

export type ArchitectMode = "guided" | "asking" | "review" | "closed";

export type ArchitectAnswer = PatternAnswer["answer"];

export interface ArchitectSlice {
  architectMode: ArchitectMode;
  architectRequest: string;
  architectDraft: AgentSpec | null;
  architectReview: ArchitectReview | null;
  /** 서버가 알아보지 못해 초안에서 빼낸 skill이 몇 개인가 — 검토 카드가 그 사실을 말한다 */
  architectDroppedSkills: number;
  /** 서버가 되묻는 물음들 — 한 번에 하나씩 묻는다 */
  architectAsks: PatternAsk[];
  /** 물음의 pattern_id마다 사람이 한 답 */
  architectAnswers: Record<string, ArchitectAnswer>;
  /** 지금 몇 번째 물음 앞에 서 있는가 */
  architectAskAt: number;
  /** 예라고 했는데 서버가 넣지 못한 모양들 — 검토 카드가 그 까닭을 말한다 */
  architectSkippedPatterns: SkippedPattern[];
  architectError: Message | null;
  architectLoading: boolean;
  requestArchitectDraft: (
    request: string,
    draftId: string,
    answers: PatternAnswer[],
  ) => Promise<ArchitectDraftOutcome>;
  setArchitectRequest: (request: string) => void;
  buildArchitectDraft: () => Promise<void>;
  answerArchitectAsk: (answer: ArchitectAnswer) => void;
  closeArchitectAsks: () => void;
  reviewArchitectDraft: () => void;
  resetArchitect: () => void;
  skipArchitect: () => void;
  applyArchitectDraft: () => boolean;
}

/** 되묻기 한 판이 끝난 자리 — 물음도 답도 다음 판으로 넘어가지 않는다. */
const NOTHING_ASKED = {
  architectAsks: [] as PatternAsk[],
  architectAnswers: {} as Record<string, ArchitectAnswer>,
  architectAskAt: 0,
};

export const createArchitectSlice: StateCreator<EditorState, [], [], ArchitectSlice> = (set, get) => {
  let buildSequence = 0;

  /** 물은 차례 그대로 답을 모은다 — 아직 답하지 않은 물음은 실리지 않는다. */
  function answersSoFar(): PatternAnswer[] {
    const { architectAsks, architectAnswers } = get();
    return architectAsks
      .filter((ask) => architectAnswers[ask.pattern_id] !== undefined)
      .map((ask) => ({ pattern_id: ask.pattern_id, answer: architectAnswers[ask.pattern_id] }));
  }

  return {
    architectMode: "guided",
    architectRequest: "",
    architectDraft: null,
    architectReview: null,
    architectDroppedSkills: 0,
    ...NOTHING_ASKED,
    architectSkippedPatterns: [],
    architectError: null,
    architectLoading: false,
    requestArchitectDraft: (request, draftId, answers) =>
      createArchitectDraftOnServer(request, draftId, undefined, { answers }),
    setArchitectRequest: (architectRequest) => set({ architectRequest, architectError: null }),
    buildArchitectDraft: async () => {
      const request = get().architectRequest.trim();
      if (!request) {
        set({ architectError: { key: "architect.error.empty" }, architectLoading: false });
        return;
      }

      const sequence = ++buildSequence;
      const answers = answersSoFar();
      set({
        architectLoading: true,
        architectDraft: null,
        architectReview: null,
        architectDroppedSkills: 0,
        architectSkippedPatterns: [],
        architectError: null,
      });

      let outcome: ArchitectDraftOutcome;
      try {
        outcome = await get().requestArchitectDraft(request, get().makeDraftId(), answers);
      } catch {
        outcome = { failure: { key: "architect.error.offline" } };
      }
      if (sequence !== buildSequence) return;

      if (outcome.failure) {
        // 답을 못 전한 판은 끝난 판이다 — 다시 부탁하면 처음부터 묻는다(옛 답이 새 부탁에
        // 몰래 실리지 않게).
        set({ ...NOTHING_ASKED, architectLoading: false, architectError: outcome.failure });
        return;
      }

      if (outcome.asks) {
        set({
          ...NOTHING_ASKED,
          architectAsks: outcome.asks,
          architectMode: "asking",
          architectLoading: false,
        });
        return;
      }

      set({
        ...NOTHING_ASKED,
        architectDraft: outcome.draft,
        architectMode: "review",
        architectReview: reviewArchitectSpec(outcome.draft),
        architectDroppedSkills: outcome.droppedSkillRefs?.length ?? 0,
        architectSkippedPatterns: outcome.skippedPatterns ?? [],
        architectLoading: false,
        architectError: null,
      });
    },
    answerArchitectAsk: (answer) => {
      const { architectAsks, architectAskAt, architectAnswers } = get();
      const ask = architectAsks[architectAskAt];
      if (!ask) return;
      const asked = architectAskAt + 1;
      set({
        architectAnswers: { ...architectAnswers, [ask.pattern_id]: answer },
        architectAskAt: asked,
      });
      // 마지막 답을 들으면 그대로 초안을 부른다 — 로딩은 처음 적던 자리에서 말한다.
      if (asked === architectAsks.length) {
        set({ architectMode: "guided" });
        void get().buildArchitectDraft();
      }
    },
    closeArchitectAsks: () => {
      buildSequence += 1;
      set({ ...NOTHING_ASKED, architectMode: "closed", architectLoading: false });
    },
    reviewArchitectDraft: () => {
      const draft = get().architectDraft;
      if (draft) set({ architectReview: reviewArchitectSpec(draft) });
    },
    resetArchitect: () => {
      buildSequence += 1;
      set({ ...NOTHING_ASKED, architectMode: "guided", architectDraft: null, architectReview: null, architectDroppedSkills: 0, architectSkippedPatterns: [], architectError: null, architectLoading: false });
    },
    skipArchitect: () => {
      buildSequence += 1;
      set({ ...NOTHING_ASKED, architectMode: "closed", architectDraft: null, architectReview: null, architectDroppedSkills: 0, architectSkippedPatterns: [], architectError: null, architectLoading: false });
    },
    applyArchitectDraft: () => {
      const { architectDraft, architectReview, spec, nodes } = get();
      if (!architectDraft || !architectReview?.passed || spec !== null || nodes.length !== 0) return false;
      get().loadSpec(architectDraft);
      set({ ...NOTHING_ASKED, architectMode: "closed", architectDraft: null, architectReview: null, architectDroppedSkills: 0, architectSkippedPatterns: [], architectLoading: false });
      return true;
    },
  };
};
