// 지금 그래프를 objective로 고친다: objective 입력 → 후보+제안문 review → 승인.
// 후보를 만드는 일은 서버가, 그래프에 앉히는 일은 되돌릴 수 있는 명령 하나(adoptSpec)가 한다.
// ArchitectSlice의 3상태 흐름을 물려받되, 빈 캔버스가 아니라 **기존 그래프** 위에서 돈다.
import type { StateCreator } from "zustand";
import { type ArchitectReview, reviewArchitectSpec } from "../architect/architect";
import { type OptimizeOutcome, optimizeOnServer } from "../api/optimize";
import type { AgentSpec } from "../generated/agent_spec";
import type { OptimizationProposal } from "../generated/optimization_proposal";
import { sceneOf } from "../graph/scene";
import { adoptSpec } from "../history/graphCommands";
import type { Message } from "../i18n/messages";
import type { EditorState } from "./editor";

/** 한 시점에 하나만 묻는다: 무엇을 고칠까(input) / 이 후보를 앉힐까(review). */
export type OptimizeMode = "closed" | "input" | "review";

export interface OptimizeSlice {
  optimizeMode: OptimizeMode;
  optimizeObjective: string;
  optimizeCandidate: AgentSpec | null;
  optimizeReview: ArchitectReview | null;
  optimizeProposal: OptimizationProposal | null;
  optimizeError: Message | null;
  optimizeLoading: boolean;
  /** 서버에 묻는 길 — 테스트는 이 자리만 갈아 끼운다 (선례: requestArchitectDraft) */
  optimizeOnServer: (objective: string, baseSpec: AgentSpec) => Promise<OptimizeOutcome>;
  enterOptimizeMode: () => void;
  leaveOptimizeMode: () => void;
  setOptimizeObjective: (objective: string) => void;
  buildOptimizeCandidate: () => Promise<void>;
  resetOptimize: () => void;
  applyOptimizeCandidate: () => boolean;
}

/** 그래프를 옮겨 가거나 승인을 마치면 이 자리는 처음으로 돌아간다. */
export const CLOSED_OPTIMIZE = {
  optimizeMode: "closed",
  optimizeObjective: "",
  optimizeCandidate: null,
  optimizeReview: null,
  optimizeProposal: null,
  optimizeError: null,
  optimizeLoading: false,
} as const;

export const createOptimizeSlice: StateCreator<EditorState, [], [], OptimizeSlice> = (
  set,
  get,
) => {
  let buildSequence = 0;

  return {
    ...CLOSED_OPTIMIZE,
    optimizeOnServer: (objective, baseSpec) =>
      optimizeOnServer({ objective, baseSpec }),

    // 고칠 그래프가 없으면 들어가지 않는다 — Optimizer는 빈 캔버스가 아니라 기존 그래프의 것이다.
    enterOptimizeMode: () => {
      if (get().spec === null) return;
      // 우측 자리는 하나다 — 고치기를 열면 대화는 물러난다 (DESIGN §1 배치표).
      get().leaveChatMode();
      set({ ...CLOSED_OPTIMIZE, optimizeMode: "input" });
    },
    leaveOptimizeMode: () => {
      buildSequence += 1;
      set(CLOSED_OPTIMIZE);
    },
    setOptimizeObjective: (optimizeObjective) =>
      set({ optimizeObjective, optimizeError: null }),

    buildOptimizeCandidate: async () => {
      const objective = get().optimizeObjective.trim();
      if (!objective) {
        set({ optimizeError: { key: "optimize.error.empty" }, optimizeLoading: false });
        return;
      }

      const sequence = ++buildSequence;
      set({
        optimizeLoading: true,
        optimizeCandidate: null,
        optimizeProposal: null,
        optimizeReview: null,
        optimizeError: null,
      });

      let outcome: OptimizeOutcome;
      try {
        outcome = await get().optimizeOnServer(objective, get().exportSpec());
      } catch {
        outcome = { failure: { key: "optimize.error.offline" } };
      }
      if (sequence !== buildSequence) return;

      if (outcome.failure) {
        set({
          optimizeLoading: false,
          optimizeError: outcome.failure,
          optimizeMode: "input",
        });
        return;
      }

      set({
        optimizeCandidate: outcome.candidate,
        optimizeProposal: outcome.proposal,
        optimizeReview: reviewArchitectSpec(outcome.candidate),
        optimizeMode: "review",
        optimizeLoading: false,
        optimizeError: null,
      });
    },

    resetOptimize: () =>
      set({
        optimizeMode: "input",
        optimizeCandidate: null,
        optimizeProposal: null,
        optimizeReview: null,
        optimizeError: null,
      }),

    applyOptimizeCandidate: () => {
      // 후보는 서버가 이미 validate_graph로 통과시킨 것이다(preview_of) — 그래서 앉힐 수 있다.
      // 화면의 검사 3종은 사람이 읽으라고 보여 줄 뿐, 승인의 게이트가 아니다(빈 캔버스가
      // 아니라 사람 확인 밸브가 있는 기존 그래프도 고칠 수 있어야 한다).
      const { optimizeCandidate, spec } = get();
      if (!optimizeCandidate || spec === null) return false;
      // 지금 그래프를 후보로 갈아 앉힌다 — 지난 실행을 채택할 때와 같은 명령(1 undo 걸음).
      get().runCommand(adoptSpec(sceneOf(get()), get().exportSpec(), optimizeCandidate));
      buildSequence += 1;
      set(CLOSED_OPTIMIZE);
      return true;
    },
  };
};
