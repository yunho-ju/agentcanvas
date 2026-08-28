// 붙여 넣은 API 설명 -> 연결 제안 -> 사람의 승인. 승인 전에는 문서를 건드리지 않는다.
// 제안을 만드는 일은 서버가, 문서에 들이는 일은 되돌릴 수 있는 명령 하나가 한다.
import type { StateCreator } from "zustand";
import { type ToolSourceKind, type ToolWrapOutcome, wrapToolsOnServer } from "../api/toolWrap";
import type { AgentSpec } from "../generated/agent_spec";
import { takeInConnections } from "../history/docCommands";
import { LOCKED_HINT } from "../run/lockWords";
import type { Message } from "../i18n/messages";
import { newConnections } from "../resources/resourceWords";
import type { EditorState } from "./editor";
import { isRunning } from "./runSlice";

/** 한 시점에 하나만 묻는다: 무엇을 붙여 넣었나(input) / 이것을 넣을까(review) */
export type ToolWrapMode = "closed" | "input" | "review";

export interface ToolWrapSlice {
  toolWrapMode: ToolWrapMode;
  toolWrapKind: ToolSourceKind;
  toolWrapSource: string;
  toolWrapCandidate: AgentSpec | null;
  toolWrapError: Message | null;
  toolWrapLoading: boolean;
  /** 서버에 묻는 길 — 테스트는 이 자리만 갈아 끼운다 (선례: requestArchitectDraft) */
  wrapToolsOnServer: (
    source: string,
    sourceKind: ToolSourceKind,
    baseSpec: AgentSpec,
  ) => Promise<ToolWrapOutcome>;
  openToolWrap: () => void;
  closeToolWrap: () => void;
  setToolWrapKind: (kind: ToolSourceKind) => void;
  setToolWrapSource: (source: string) => void;
  buildToolWrap: () => Promise<void>;
  rewriteToolWrap: () => void;
  applyToolWrap: () => void;
}

/** 문서를 옮겨 가거나 승인을 마치면 이 자리는 처음으로 돌아간다. */
export const CLOSED_TOOL_WRAP = {
  toolWrapMode: "closed",
  toolWrapKind: "openapi",
  toolWrapSource: "",
  toolWrapCandidate: null,
  toolWrapError: null,
  toolWrapLoading: false,
} as const;

export const createToolWrapSlice: StateCreator<EditorState, [], [], ToolWrapSlice> = (
  set,
  get,
) => {
  let askSequence = 0;

  return {
    ...CLOSED_TOOL_WRAP,
    wrapToolsOnServer: (source, sourceKind, baseSpec) =>
      wrapToolsOnServer(source, sourceKind, baseSpec),

    // 실행을 보는 동안 그래프는 잠겨 있다 — 잠금 규칙은 기존 것을 그대로 묻는다.
    openToolWrap: () => {
      if (isRunning(get())) return;
      set({ toolWrapMode: "input", toolWrapError: null });
    },
    closeToolWrap: () => {
      askSequence += 1;
      set(CLOSED_TOOL_WRAP);
    },
    setToolWrapKind: (toolWrapKind) => set({ toolWrapKind, toolWrapError: null }),
    setToolWrapSource: (toolWrapSource) => set({ toolWrapSource, toolWrapError: null }),

    buildToolWrap: async () => {
      const source = get().toolWrapSource.trim();
      if (!source) {
        set({ toolWrapError: { key: "toolWrap.error.empty" }, toolWrapLoading: false });
        return;
      }

      const sequence = ++askSequence;
      set({ toolWrapLoading: true, toolWrapCandidate: null, toolWrapError: null });

      let outcome: ToolWrapOutcome;
      try {
        outcome = await get().wrapToolsOnServer(
          source,
          get().toolWrapKind,
          get().exportSpec(),
        );
      } catch {
        outcome = { failure: { key: "toolWrap.error.offline" } };
      }
      if (sequence !== askSequence) return;

      if (outcome.failure) {
        set({
          toolWrapLoading: false,
          toolWrapError: outcome.failure,
          toolWrapMode: "input",
        });
        return;
      }

      set({
        toolWrapCandidate: outcome.candidate,
        toolWrapMode: "review",
        toolWrapLoading: false,
        toolWrapError: null,
      });
    },

    rewriteToolWrap: () =>
      set({ toolWrapMode: "input", toolWrapCandidate: null, toolWrapError: null }),

    applyToolWrap: () => {
      const candidate = get().toolWrapCandidate;
      if (!candidate) return;
      // 실행을 보는 동안 그래프는 잠겨 있다 — 승인을 조용히 삼키지 않고 까닭을 말한 채
      // 제안을 그대로 들고 기다린다 (기존 잠금 문구를 그대로 쓴다).
      if (isRunning(get())) {
        set({ toolWrapError: LOCKED_HINT });
        return;
      }
      get().ensureDoc();
      // 넣는 것은 미리보기가 보여 준 것 — 새로 들어올 연결뿐이다. 화면이 보여 주지 않은
      // 삭제·교체를 승인이 대신 옮기지 않는다 (서버 표도 더하기 하나로 좁혀져 있다).
      const current = get().spec?.resources ?? [];
      const arriving = newConnections(candidate.resources ?? [], current);
      get().runCommand(takeInConnections(current, [...current, ...arriving]));
      askSequence += 1;
      set(CLOSED_TOOL_WRAP);
    },
  };
};
