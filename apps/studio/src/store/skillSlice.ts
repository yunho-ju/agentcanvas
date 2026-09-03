// 문서가 가진 skill을 들이고, 갈아 끼우고, 빼는 상태 전이.
// 셈은 순수 모듈(graph/skills)이 하고, 문서를 바꾸는 일은 되돌릴 수 있는 명령 하나
// (history/skillCommands)가 한다. 가져오기 카드의 상태기계는 skillImportSlice의 몫이다.
import type { StateCreator } from "zustand";
import type { SkillDef } from "../generated/skill_def";
import { nodesWearing } from "../graph/skills";
import { dropSkill, swapSkill, takeInSkill } from "../history/skillCommands";
import type { EditorState } from "./editor";

export interface SkillSlice {
  addSkill: (skill: SkillDef) => void;
  replaceSkill: (skill: SkillDef) => void;
  removeSkill: (ref: string) => void;
}

export const createSkillSlice: StateCreator<EditorState, [], [], SkillSlice> = (
  _set,
  get,
) => ({
  addSkill: (skill) => {
    get().ensureDoc();
    get().runCommand(takeInSkill(get().spec?.skills ?? [], skill));
  },

  replaceSkill: (skill) => {
    get().runCommand(swapSkill(get().spec?.skills ?? [], skill));
  },

  removeSkill: (ref) => {
    get().runCommand(
      dropSkill(get().spec?.skills ?? [], ref, nodesWearing(get().nodes, ref)),
    );
  },
});

/** 아직 skill이 없는 문서가 늘 같은 빈 목록을 내어 주는 자리 — 그리기를 흔들지 않는다. */
const NO_SKILLS: SkillDef[] = [];

/** 지금 이 문서가 가진 skill들 — 화면이 목록을 읽는 하나뿐인 자리. */
export function docSkills(state: EditorState): SkillDef[] {
  return state.spec?.skills ?? NO_SKILLS;
}
