// 무엇을 잘하게 하고 싶은지 물으면 skill을 찾아 주는 자리 (DESIGN §7 skill-find).
// 가져오기 카드의 세 번째 입력 종류다 — 카드의 자리(모드·미리보기)는 함께 쓰되,
// 무엇을 묻고 무엇을 찾는가는 이쪽의 바뀔 이유다 (만들기 모드와 같은 나눔).
// 이 문서가 무엇을 가졌는지는 화면만 안다: 서버에는 물음만 가고 문서는 가지 않는다.
import type { StateCreator } from "zustand";
import {
  type SkillFetchOutcome,
  type SkillSearchOutcome,
  searchSkillsOnServer,
} from "../api/skills";
import type { SkillDef } from "../generated/skill_def";
import { type FoundSkill, documentMatches, mergeHits } from "../graph/skillHits";
import { resolveStarterSkill } from "../registry/starterSkills";
import type { EditorState } from "./editor";
import {
  CLOSED_SKILL_IMPORT,
  type SkillFindCardState,
  skillCardAfterReading,
} from "./skillImportSlice";
import { docSkills } from "./skillSlice";

export interface SkillFindSlice extends SkillFindCardState {
  /** 서버에 묻는 길 — 테스트는 이 자리만 갈아 끼운다 */
  searchSkillsOnServer: (query: string) => Promise<SkillSearchOutcome>;
  setSkillFindQuery: (query: string) => void;
  /** 적은 물음으로 시작 skill과 바깥 목록을 찾아본다 */
  findSkills: () => Promise<void>;
  /** 줄 하나를 누른다 — 문서의 것은 읽고, 그 밖의 것은 읽어 보고 넣는 길로 간다 */
  openFoundSkill: (found: FoundSkill) => Promise<void>;
}

/** 목록에 놓인 줄들 — 이 문서의 것을 앞에 합치는 규칙은 순수 모듈 하나다. */
export function foundSkills(state: EditorState): FoundSkill[] {
  if (state.skillFindHits === null) return [];
  const held = docSkills(state);
  return mergeHits(held, state.skillFindHits, documentMatches(state.skillFindAsked, held));
}

/** 누른 줄이 가리키는 이 문서의 skill — 이미 가진 것은 가져오지 않고 읽는다. */
function heldSkill(state: EditorState, found: FoundSkill): SkillDef | undefined {
  return docSkills(state).find((skill) => skill.ref === found.ref);
}

export const createSkillFindSlice: StateCreator<EditorState, [], [], SkillFindSlice> = (
  set,
  get,
) => {
  let findSequence = 0;

  return {
    skillFindQuery: CLOSED_SKILL_IMPORT.skillFindQuery,
    skillFindAsked: CLOSED_SKILL_IMPORT.skillFindAsked,
    skillFindLoading: CLOSED_SKILL_IMPORT.skillFindLoading,
    skillFindHits: CLOSED_SKILL_IMPORT.skillFindHits,
    skillFindRemoteReached: CLOSED_SKILL_IMPORT.skillFindRemoteReached,
    skillFindReading: CLOSED_SKILL_IMPORT.skillFindReading,
    searchSkillsOnServer: (query) => searchSkillsOnServer(query),

    setSkillFindQuery: (skillFindQuery) =>
      set({ skillFindQuery, skillImportError: null }),

    findSkills: async () => {
      const query = get().skillFindQuery.trim();
      if (query === "") return;
      const sequence = ++findSequence;
      set({ skillFindLoading: true, skillImportError: null, skillFindReading: null });

      let outcome: SkillSearchOutcome;
      try {
        outcome = await get().searchSkillsOnServer(query);
      } catch {
        outcome = { failure: { key: "skillImport.error.offline" } };
      }
      if (sequence !== findSequence) return;

      if (outcome.hits === undefined) {
        // 적은 물음은 그대로 둔다 — 닿지 못한 것은 사람의 잘못이 아니다.
        set({
          skillFindLoading: false,
          skillImportError: outcome.failure ?? { key: "skillImport.error.strange" },
        });
        return;
      }
      set({
        skillFindLoading: false,
        skillFindAsked: query,
        skillFindHits: outcome.hits,
        skillFindRemoteReached: outcome.remoteReached === true,
      });
    },

    openFoundSkill: async (found) => {
      // 이 문서가 이미 가진 글은 가져오는 것이 아니라 읽는 것이다 (DESIGN §7 skill-find).
      const held = heldSkill(get(), found);
      if (held) {
        set({ skillFindReading: held, skillImportError: null });
        return;
      }
      if (found.origin === "starter" && found.ref !== null) {
        // 시작 skill은 카탈로그의 글 그대로다 — 아무것도 가져오지 않는다.
        const starter = resolveStarterSkill(found.ref);
        if (!starter) return;
        set({
          skillImportMode: "review",
          skillCandidate: starter,
          skillCandidateWarnings: [],
          skillImportError: null,
        });
        return;
      }
      if (found.url === null) return;
      const sequence = ++findSequence;
      set({ skillImportLoading: true, skillImportError: null });

      let outcome: SkillFetchOutcome;
      try {
        outcome = await get().fetchSkillOnServer(found.url);
      } catch {
        outcome = { failure: { key: "skillImport.error.offline" } };
      }
      if (sequence !== findSequence) return;

      if (outcome.text === undefined) {
        set({
          skillImportLoading: false,
          skillImportError: outcome.failure ?? { key: "skillImport.error.strange" },
        });
        return;
      }
      // 어디서 왔는가는 그 줄이 가리킨 자리다 — 주소 모드와 같은 길이다.
      set(skillCardAfterReading(outcome.text, found.url));
    },
  };
};
