// 적어 둔 지시문 하나가 skill이 되기까지의 상태기계 (DESIGN §7 skill-make-card).
// 카드의 자리(모드·미리보기)는 skillImportSlice와 함께 쓴다 — 한 카드, 두 모드 — 하지만
// 무엇을 묻고 무엇을 짓고 누가 입는가는 이 자리의 바뀔 이유다.
import type { StateCreator } from "zustand";
import {
  type DraftedBy,
  type SkillDraftAsk,
  type SkillDraftOutcome,
  draftSkillOnServer,
} from "../api/skillDraft";
import type { SkillDef } from "../generated/skill_def";
import { referenceCandidates, similarSkills } from "../graph/similarSkills";
import { sceneOf } from "../graph/scene";
import { nodesWearing } from "../graph/skills";
import { takeInSkillAndWear } from "../history/skillCommands";
import { STARTER_SKILLS } from "../registry/starterSkills";
import { skillDescriptionProblem, skillNameProblem } from "../skills/skillWords";
import type { EditorState } from "./editor";
import { isRunning } from "./runSlice";
import { CLOSED_SKILL_IMPORT, skillCardAfterReading } from "./skillImportSlice";
import { docSkills } from "./skillSlice";

/** 만들기 모드가 들고 온 것 — 어느 단계의, 어떤 지시문을 skill로 옮기는가 */
export interface SkillMaking {
  nodeId: string;
  instruction: string;
}

/** 만든 skill이 어느 단계의 것이 되었는가 — 승인 뒤 그 자리에 남는 말의 근거 */
export interface SkillMade {
  nodeId: string;
  ref: string;
}

export interface SkillMakeSlice {
  /** 지시문을 skill로 옮기는 중이면 그 단계와 지시문 — 아니면 가져오는 중이다 */
  skillMake: SkillMaking | null;
  /** 사람이 적고 있는 이름 (규칙은 그릴 때 막는다) */
  skillMakeName: string;
  /** 사람이 적고 있는 '언제 쓰나요' 한 줄 */
  skillMakeDescription: string;
  /** 미리보기의 이 글을 무엇이 지었는가 — 모델인가, 틀인가 */
  skillDraftedBy: DraftedBy | null;
  /** 방금 만들어 입힌 skill — 지시문 칸 아래 캡션이 이 자리를 읽는다 */
  skillMadeFor: SkillMade | null;
  /** 초안을 지어 달라고 묻는 길 — 테스트는 이 자리만 갈아 끼운다 */
  draftSkillOnServer: (ask: SkillDraftAsk) => Promise<SkillDraftOutcome>;
  /** 지시문 하나를 들고 만들기 모드로 연다 (inspector의 [skill로 저장]) */
  openSkillMake: (nodeId: string, instruction: string) => void;
  setSkillMakeName: (name: string) => void;
  setSkillMakeDescription: (description: string) => void;
  /** 적은 것으로 초안을 지어 미리보기로 간다 — 부를 모델이 없으면 틀 초안이 온다 */
  draftSkill: () => Promise<void>;
  /** 만든 skill을 문서에 들이고 그 단계가 따르게 한다 — 카드의 승인이 부르는 자리 */
  applySkillMake: (skill: SkillDef) => void;
  /** 만든 자리의 말을 놓는다 (캡션의 닫기) */
  forgetSkillMade: () => void;
}

export const createSkillMakeSlice: StateCreator<EditorState, [], [], SkillMakeSlice> = (
  set,
  get,
) => {
  // 몇 번째 청인가 — 늦게 온 답을 버리는 요청 토큰 (다른 슬라이스와 같은 관례).
  let asked = 0;

  return {
    skillMake: null,
    skillMakeName: "",
    skillMakeDescription: "",
    skillDraftedBy: null,
    skillMadeFor: null,
    draftSkillOnServer: (ask) => draftSkillOnServer(ask),

    // 만들기도 가져오기와 같은 카드다 — 열 때 지난 자리를 통째로 비우고 이 단계를 들고 선다.
    openSkillMake: (nodeId, instruction) => {
      if (isRunning(get())) return;
      set({
        ...CLOSED_SKILL_IMPORT,
        skillImportMode: "input",
        skillMake: { nodeId, instruction },
      });
    },

    setSkillMakeName: (skillMakeName) =>
      set({ skillMakeName, skillImportError: null, skillImportIssues: [] }),

    setSkillMakeDescription: (skillMakeDescription) =>
      set({ skillMakeDescription, skillImportError: null, skillImportIssues: [] }),

    draftSkill: async () => {
      const making = get().skillMake;
      if (!making) return;
      const name = get().skillMakeName.trim();
      const description = get().skillMakeDescription.trim();
      // 그릴 때 막은 것은 여기서도 막힌다 — 화면과 store가 같은 판정 한 곳을 본다.
      if (skillNameProblem(name) !== null) return;
      if (skillDescriptionProblem(description) !== null) return;

      const sequence = ++asked;
      set({ skillImportLoading: true, skillImportError: null, skillImportIssues: [] });
      let outcome: SkillDraftOutcome;
      try {
        outcome = await get().draftSkillOnServer({
          instruction: making.instruction,
          name,
          description,
          references: skillMakeReferences(get()),
        });
      } catch {
        outcome = { failure: { key: "skillMake.error.offline" } };
      }
      // 기다리는 사이 카드를 닫았거나 다른 지시문으로 다시 열었으면 늦은 답은 버린다.
      if (sequence !== asked || get().skillMake !== making) return;

      if (outcome.text === undefined) {
        // 실패해도 적은 이름·설명은 그 자리에 그대로 있다.
        set({
          skillImportLoading: false,
          skillImportMode: "input",
          skillImportError: outcome.failure ?? { key: "skillMake.error.strange" },
        });
        return;
      }
      set(skillCardAfterReading(outcome.text));
      // 읽지 못한 글은 미리보기가 아니다 — 무엇이 지었는지도 그 자리에 남기지 않는다.
      set({
        skillDraftedBy:
          get().skillImportMode === "review" ? (outcome.draftedBy ?? null) : null,
      });
    },

    applySkillMake: (skill) => {
      const making = get().skillMake;
      if (!making) return;
      get().ensureDoc();
      // 문서에 들이는 일과 그 단계가 따르게 하는 일은 한 걸음이다 (반쯤 적용되는 길은 없다).
      get().runCommand(takeInSkillAndWear(sceneOf(get()), skill, making.nodeId));
      asked += 1;
      set({
        ...CLOSED_SKILL_IMPORT,
        skillMadeFor: { nodeId: making.nodeId, ref: skill.ref },
      });
    },

    forgetSkillMade: () => set({ skillMadeFor: null }),
  };
};

/**
 * 지금 만들고 있는 skill과 비슷해 참고가 될 skill들 — 이 문서의 것과 시작 skill에서 고른다.
 * 화면이 보여 주는 목록이자 서버에 함께 보내는 예시다: 사람이 본 것과 모델이 읽은 것을
 * 한 자리에서 고른다 (규칙은 두 언어가 함께 쓰는 similarSkills 하나뿐이다).
 */
export function skillMakeReferences(state: EditorState): SkillDef[] {
  const making = state.skillMake;
  if (!making) return [];
  return similarSkills(
    {
      name: state.skillMakeName,
      description: state.skillMakeDescription,
      body: making.instruction,
    },
    referenceCandidates(docSkills(state), Object.values(STARTER_SKILLS)),
  );
}

/**
 * 방금 만든 말이 아직 참말인가 — 문서가 그 skill을 들고 있고 그 단계가 아직 따르는가.
 * 되돌리기로 그 걸음이 물러났으면 이 말도 함께 물러난다: 상태를 되돌림에서 손대는 대신
 * **문서에게 묻는다**(문서가 언제나 원본이다).
 */
export function skillMadeStillTrue(state: EditorState): SkillMade | null {
  const made = state.skillMadeFor;
  if (!made) return null;
  const held = docSkills(state).some((skill) => skill.ref === made.ref);
  const worn = nodesWearing(state.nodes, made.ref).includes(made.nodeId);
  return held && worn ? made : null;
}
