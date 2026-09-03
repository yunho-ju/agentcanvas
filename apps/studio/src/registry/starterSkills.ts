// Python `agentcanvas_contracts.starter_skills`의 TS 미러.
// 빈 문서 앞에서 바로 입어 볼 수 있는 시작 skill — 화면에 글을 하드코딩하지 않는다.
// 문서 안 skill의 카탈로그가 아니다: 고르면 문서(spec.skills)로 복사되어 그때부터 문서의 것이다.
import starterData from "../../../../packages/contracts/json_schema/starter_skills.json";
import type { SkillDef } from "../generated/skill_def";

export type { SkillDef } from "../generated/skill_def";

export const STARTER_SKILLS: Record<string, SkillDef> = starterData as unknown as Record<
  string,
  SkillDef
>;

/** ref가 가리키는 시작 skill — 정확히 같은 이름만 찾고, 못 찾으면 없다고 말한다 (던지지 않는다). */
export function resolveStarterSkill(ref: string): SkillDef | undefined {
  return STARTER_SKILLS[ref];
}
