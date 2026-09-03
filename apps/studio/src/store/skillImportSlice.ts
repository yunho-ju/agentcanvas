// 붙여 넣거나 주소를 준 글이 skill이 되기까지의 상태기계 (DESIGN §7 skill-import-card).
// 한 시점에 하나만 묻고, 승인 전에는 문서를 건드리지 않는다 — 문서를 바꾸는 일은
// skillSlice의 명령들이 한다 (읽는 일과 들이는 일은 서로 다른 바뀔 이유다).
// 지시문을 skill로 **만드는** 길은 skillMakeSlice의 몫이다: 이 카드의 자리(모드·미리보기)를
// 함께 쓰되, 무엇을 묻고 무엇을 짓는가는 그쪽의 바뀔 이유다.
import type { StateCreator } from "zustand";
import { type SkillFetchOutcome, fetchSkillOnServer } from "../api/skills";
import type { SkillDef } from "../generated/skill_def";
import type { ServerHit } from "../graph/skillHits";
import { parseSkillMarkdown } from "../graph/skillMarkdown";
import type { Message } from "../i18n/messages";
import { resolveStarterSkill } from "../registry/starterSkills";
import { LOCKED_HINT } from "../run/lockWords";
import { issueWords } from "../skills/skillWords";
import type { EditorState } from "./editor";
import { isRunning } from "./runSlice";

/** 한 시점에 하나만 묻는다: 무엇을 가져올까(input) / 이것을 넣을까(review) */
export type SkillImportMode = "closed" | "input" | "review";

/** 어디서 가져오는가 — 붙여 넣은 글, 또는 주소 */
export type SkillSourceKind = "paste" | "url";

/** 카드가 지금 무엇을 묻고 있는가 — 가져올 것을 받거나, 찾아보거나 */
export type SkillImportKind = SkillSourceKind | "find";

export interface SkillImportSlice {
  skillImportMode: SkillImportMode;
  skillImportKind: SkillImportKind;
  /** 붙여 넣은 글, 또는 적은 주소 (고른 종류에 따라 뜻이 다르다) */
  skillImportSource: string;
  skillImportLoading: boolean;
  /** 서버에 닿지 못한 까닭 한 줄 */
  skillImportError: Message | null;
  /** 글을 읽지 못한 까닭들 — 쉬운 말 한 줄씩 */
  skillImportIssues: Message[];
  /** 승인을 기다리는 skill — 아직 문서의 것이 아니다 */
  skillCandidate: SkillDef | null;
  /** 넣어도 되지만 알고는 있어야 할 것들 (긴 글 등) */
  skillCandidateWarnings: Message[];
  /** 서버에 묻는 길 — 테스트는 이 자리만 갈아 끼운다 */
  fetchSkillOnServer: (url: string) => Promise<SkillFetchOutcome>;
  openSkillImport: () => void;
  closeSkillImport: () => void;
  setSkillImportKind: (kind: SkillImportKind) => void;
  setSkillImportSource: (source: string) => void;
  /** 적은 것을 읽어 미리보기로 간다 — 붙여넣기는 그 자리에서, 주소는 서버를 거쳐서 */
  readSkillImport: () => Promise<void>;
  /** 시작 skill 하나를 고른다 — 붙여넣기와 같은 길, 값이 채워졌을 뿐이다 */
  pickStarterSkill: (ref: string) => void;
  rewriteSkillImport: () => void;
  applySkillImport: () => void;
}

/** 카드가 들고 있는 것들 — 닫히면 이 자리는 통째로 처음으로 돌아간다. */
type SkillCardState = Pick<
  SkillImportSlice,
  | "skillImportMode"
  | "skillImportKind"
  | "skillImportSource"
  | "skillImportLoading"
  | "skillImportError"
  | "skillImportIssues"
  | "skillCandidate"
  | "skillCandidateWarnings"
>;

/** 만들기 모드가 함께 비우는 자리 — 카드는 하나라 닫으면 둘 다 처음으로 돌아간다. */
export interface SkillMakeCardState {
  skillMake: { nodeId: string; instruction: string } | null;
  skillMakeName: string;
  skillMakeDescription: string;
  skillDraftedBy: "model" | "scaffold" | null;
}

/** 찾아보기가 함께 비우는 자리 — 카드는 하나라 닫으면 셋 다 처음으로 돌아간다. */
export interface SkillFindCardState {
  skillFindQuery: string;
  /** 실제로 물어본 물음 — 적는 동안 결과가 흔들리지 않게 답과 함께 둔다 */
  skillFindAsked: string;
  skillFindLoading: boolean;
  /** 서버가 준 줄들 — 아직 찾지 않았으면 null(결과 없음과 다른 일이다) */
  skillFindHits: ServerHit[] | null;
  skillFindRemoteReached: boolean;
  /** 카드 안에서 펴 읽고 있는 이 문서의 skill */
  skillFindReading: SkillDef | null;
}

/** 문서를 옮겨 가거나 승인을 마치면 이 자리는 처음으로 돌아간다. */
export const CLOSED_SKILL_IMPORT: SkillCardState &
  SkillMakeCardState &
  SkillFindCardState = {
  skillImportMode: "closed",
  skillImportKind: "paste",
  skillImportSource: "",
  skillImportLoading: false,
  skillImportError: null,
  skillImportIssues: [],
  skillCandidate: null,
  skillCandidateWarnings: [],
  skillMake: null,
  skillMakeName: "",
  skillMakeDescription: "",
  skillDraftedBy: null,
  skillFindQuery: "",
  skillFindAsked: "",
  skillFindLoading: false,
  skillFindHits: null,
  skillFindRemoteReached: false,
  skillFindReading: null,
};

/**
 * 읽은 원문 하나가 카드에 남기는 자리 — 못 읽으면 적은 것을 그대로 두고 까닭만 말한다.
 * 순수하다: 가져오기와 만들기가 **같은 이 규칙 하나**로 미리보기에 이른다.
 */
export function skillCardAfterReading(
  text: string,
  from?: string,
): Partial<SkillCardState> {
  const parsed = parseSkillMarkdown(text);
  if (parsed.skill === null) {
    return {
      skillImportLoading: false,
      skillImportMode: "input",
      skillImportIssues: issueWords(parsed.issues),
    };
  }
  // 어디서 왔는가는 사람이 적은 그 주소다 — 붙여 넣거나 지은 글에는 출처가 없다.
  const source = from ? { url: from, fetched_revision: null, fetched_at: null } : null;
  return {
    skillImportLoading: false,
    skillImportMode: "review",
    skillImportIssues: [],
    skillImportError: null,
    skillCandidate: { ...parsed.skill, source },
    skillCandidateWarnings: issueWords(parsed.issues),
  };
}

/** 적은 것에서 SKILL.md 원문에 이르는 길 — 종류가 늘면 여기 한 줄이다. */
type ReadsSource = (
  state: EditorState,
  source: string,
) => Promise<{ text?: string; failure?: Message }>;

const SOURCE_READERS: Record<SkillSourceKind, ReadsSource> = {
  paste: async (_state, source) => ({ text: source }),
  url: (state, source) => state.fetchSkillOnServer(source),
};

export const createSkillImportSlice: StateCreator<
  EditorState,
  [],
  [],
  SkillImportSlice
> = (set, get) => {
  let askSequence = 0;

  return {
    ...CLOSED_SKILL_IMPORT,
    fetchSkillOnServer: (url) => fetchSkillOnServer(url),

    // 실행을 보는 동안 문서는 잠겨 있다 — 잠금 규칙은 기존 것을 그대로 묻는다.
    openSkillImport: () => {
      if (isRunning(get())) return;
      set({ ...CLOSED_SKILL_IMPORT, skillImportMode: "input" });
    },

    closeSkillImport: () => {
      askSequence += 1;
      set(CLOSED_SKILL_IMPORT);
    },

    setSkillImportKind: (skillImportKind) =>
      set({ skillImportKind, skillImportError: null, skillImportIssues: [] }),

    setSkillImportSource: (skillImportSource) =>
      set({ skillImportSource, skillImportError: null, skillImportIssues: [] }),

    readSkillImport: async () => {
      const source = get().skillImportSource.trim();
      if (source === "") {
        set({ skillImportError: { key: "skillImport.error.empty" } });
        return;
      }
      const kind = get().skillImportKind;
      // 찾아보기에는 읽을 원문이 아직 없다 — 줄을 누르는 것이 그 길이다.
      if (kind === "find") return;
      const sequence = ++askSequence;
      set({ skillImportLoading: true, skillImportError: null, skillImportIssues: [] });

      let outcome: Awaited<ReturnType<ReadsSource>>;
      try {
        outcome = await SOURCE_READERS[kind](get(), source);
      } catch {
        outcome = { failure: { key: "skillImport.error.offline" } };
      }
      if (sequence !== askSequence) return;

      if (outcome.text === undefined) {
        set({
          skillImportLoading: false,
          skillImportMode: "input",
          skillImportError: outcome.failure ?? { key: "skillImport.error.strange" },
        });
        return;
      }
      set(
        skillCardAfterReading(
          outcome.text,
          get().skillImportKind === "url" ? source : undefined,
        ),
      );
    },

    pickStarterSkill: (ref) => {
      const starter = resolveStarterSkill(ref);
      if (!starter) return;
      set({ ...CLOSED_SKILL_IMPORT, skillImportMode: "review", skillCandidate: starter });
    },

    rewriteSkillImport: () =>
      set({
        skillImportMode: "input",
        skillCandidate: null,
        skillCandidateWarnings: [],
        skillImportError: null,
      }),

    applySkillImport: () => {
      const candidate = get().skillCandidate;
      if (!candidate) return;
      // 실행을 보는 동안 문서는 잠겨 있다 — 승인을 조용히 삼키지 않고 까닭을 말한 채
      // 제안을 그대로 들고 기다린다 (tool-wrap-card와 같은 규칙).
      if (isRunning(get())) {
        set({ skillImportError: LOCKED_HINT });
        return;
      }
      askSequence += 1;
      // 만들던 중이었다면 그 단계가 곧바로 따르게 하는 것까지가 한 걸음이다.
      if (get().skillMake) {
        get().applySkillMake(candidate);
        return;
      }
      const held = get().spec?.skills ?? [];
      // 같은 이름의 skill이 이미 있으면 갈아 끼운다 — 조용히 덮지 않는다는 말은
      // 카드가 [바꿔 넣기]로 이미 했다.
      if (held.some((one) => one.ref === candidate.ref)) {
        get().replaceSkill(candidate);
      } else {
        get().addSkill(candidate);
      }
      set(CLOSED_SKILL_IMPORT);
    },
  };
};

/** 지금 skill을 가져오는(또는 만드는) 카드가 떠 있는가 (Esc 체인이 묻는 자리). */
export function skillImportIsOpen(state: EditorState): boolean {
  return state.skillImportMode !== "closed";
}

/** 승인이 문서에 무엇을 할 것인가 — 같은 이름표가 이미 있으면 갈아 끼우는 일이다. */
export function skillImportReplaces(state: EditorState): SkillDef | undefined {
  const candidate = state.skillCandidate;
  if (!candidate) return undefined;
  return (state.spec?.skills ?? []).find((one) => one.ref === candidate.ref);
}
