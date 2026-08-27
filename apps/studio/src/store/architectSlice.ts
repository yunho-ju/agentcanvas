import type { StateCreator } from "zustand";
import { reviewArchitectSpec, type ArchitectReview } from "../architect/architect";
import {
  createArchitectDraftOnServer,
  type ArchitectDraftOutcome,
} from "../api/architect";
import type { AgentSpec } from "../generated/agent_spec";
import type { Message } from "../i18n/messages";
import type { EditorState } from "./editor";

export type ArchitectMode = "guided" | "review" | "closed";

export interface ArchitectSlice {
  architectMode: ArchitectMode;
  architectRequest: string;
  architectDraft: AgentSpec | null;
  architectReview: ArchitectReview | null;
  architectError: Message | null;
  architectLoading: boolean;
  requestArchitectDraft: (request: string, draftId: string) => Promise<ArchitectDraftOutcome>;
  setArchitectRequest: (request: string) => void;
  buildArchitectDraft: () => Promise<void>;
  reviewArchitectDraft: () => void;
  resetArchitect: () => void;
  skipArchitect: () => void;
  applyArchitectDraft: () => boolean;
}

export const createArchitectSlice: StateCreator<EditorState, [], [], ArchitectSlice> = (set, get) => {
  let buildSequence = 0;

  return {
    architectMode: "guided",
    architectRequest: "",
    architectDraft: null,
    architectReview: null,
    architectError: null,
    architectLoading: false,
    requestArchitectDraft: createArchitectDraftOnServer,
    setArchitectRequest: (architectRequest) => set({ architectRequest, architectError: null }),
    buildArchitectDraft: async () => {
      const request = get().architectRequest.trim();
      if (!request) {
        set({ architectError: { key: "architect.error.empty" }, architectLoading: false });
        return;
      }

      const sequence = ++buildSequence;
      set({
        architectLoading: true,
        architectDraft: null,
        architectReview: null,
        architectError: null,
      });

      let outcome: ArchitectDraftOutcome;
      try {
        outcome = await get().requestArchitectDraft(request, get().makeDraftId());
      } catch {
        outcome = { failure: { key: "architect.error.offline" } };
      }
      if (sequence !== buildSequence) return;

      if (outcome.failure) {
        set({ architectLoading: false, architectError: outcome.failure });
        return;
      }

      set({
        architectDraft: outcome.draft,
        architectMode: "review",
        architectReview: reviewArchitectSpec(outcome.draft),
        architectLoading: false,
        architectError: null,
      });
    },
    reviewArchitectDraft: () => {
      const draft = get().architectDraft;
      if (draft) set({ architectReview: reviewArchitectSpec(draft) });
    },
    resetArchitect: () => {
      buildSequence += 1;
      set({ architectMode: "guided", architectDraft: null, architectReview: null, architectError: null, architectLoading: false });
    },
    skipArchitect: () => {
      buildSequence += 1;
      set({ architectMode: "closed", architectDraft: null, architectReview: null, architectError: null, architectLoading: false });
    },
    applyArchitectDraft: () => {
      const { architectDraft, architectReview, spec, nodes } = get();
      if (!architectDraft || !architectReview?.passed || spec !== null || nodes.length !== 0) return false;
      get().loadSpec(architectDraft);
      set({ architectMode: "closed", architectDraft: null, architectReview: null, architectLoading: false });
      return true;
    },
  };
};
