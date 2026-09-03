/* eslint-disable */
/**
 * packages/contracts/json_schema/skill_def.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type Body = string;
export type Compatibility = string | null;
export type Description = string;
export type License = string | null;
export type Name = string;
export type Ref = string;
export type Path = string;
export type Text = string;
export type References = SkillReference[];
export type FetchedAt = string | null;
export type FetchedRevision = string | null;
export type Url = string;

/**
 * 표준 SKILL.md 하나 — 노드는 `skill_refs`에 이 `ref`를 적어 입는다.
 */
export interface SkillDef {
  body: Body;
  compatibility?: Compatibility;
  description: Description;
  license?: License;
  metadata?: Metadata;
  name: Name;
  ref: Ref;
  references?: References;
  source?: SkillSource | null;
}
export interface Metadata {
  [k: string]: string;
}
/**
 * skill 곁의 읽을 문서 하나 — 점진 공개의 셋째 단계에서 사람이 펼쳐 본다.
 */
export interface SkillReference {
  path: Path;
  text: Text;
}
/**
 * 이 skill이 어디서 왔는가 — 나중에 새 판이 나왔는지 확인하는 데 쓴다.
 */
export interface SkillSource {
  fetched_at?: FetchedAt;
  fetched_revision?: FetchedRevision;
  url: Url;
}
