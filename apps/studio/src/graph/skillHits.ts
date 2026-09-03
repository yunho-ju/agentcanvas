// 찾은 skill 줄들에 대한 순수한 셈 (DESIGN §7 skill-find).
// 서버는 시작 skill과 바깥 목록만 알고, 이 문서가 무엇을 가졌는지는 화면만 안다 —
// 그래서 앞에 합치는 일과 "이미 있어요"를 말하는 일이 여기 있다.
import type { SkillDef } from "../generated/skill_def";
import { similarSkills } from "./similarSkills";

/** 서버가 돌려준 줄 하나 — 계약의 이름 그대로 받는다 (화면 이름으로 옮기는 자리는 아래). */
export interface ServerHit {
  name: string;
  description: string | null;
  origin: "starter" | "remote";
  url: string | null;
  installs: number | null;
  owner_repo: string | null;
  ref: string | null;
}

/** 어디서 온 줄인가 — 이 문서 / 시작 skill / 바깥 목록. */
export type FoundOrigin = "document" | "starter" | "remote";

/** 목록에 놓이는 줄 하나 — 누르면 무엇을 할지는 이 줄이 말한다. */
export interface FoundSkill {
  key: string;
  name: string;
  description: string | null;
  origin: FoundOrigin;
  /** 문서나 시작 skill의 이름표 — 바깥 줄에는 아직 없다 */
  ref: string | null;
  url: string | null;
  installs: number | null;
  ownerRepo: string | null;
  /** 같은 이름을 이 문서가 이미 가졌다 — 가져오는 대신 읽는다 */
  alreadyHave: boolean;
}

/** 이 물음에 닿는 이 문서의 skill들 — 고르는 규칙은 서버와 같은 낱말 겹침 하나다.
 *
 * 본문은 셈에 들지 않는다: 찾기는 이름과 쓰임새로 찾는다 (서버의 `search_skills`와 같은 규칙). */
export function documentMatches(query: string, skills: SkillDef[]): SkillDef[] {
  return similarSkills(
    { description: query, body: "" },
    skills.map((skill) => ({ ...skill, body: "" })),
    skills.length,
  ).map((matched) => skills.find((skill) => skill.ref === matched.ref) ?? matched);
}

/** 이 문서의 것을 앞에 놓고 서버가 준 차례(시작 skill → 바깥)를 잇는다.
 *
 * '이미 있어요'는 **이 문서 전부**에 대고 묻는다: 물음에 닿아 목록에 선 줄만 보고 물으면,
 * 다른 말로 찾았을 때 이미 가진 skill을 또 가져오라고 권하게 된다. */
export function mergeHits(
  held: SkillDef[],
  serverHits: ServerHit[],
  matched: SkillDef[],
): FoundSkill[] {
  const inTheDocument = new Map(held.map((skill) => [skill.name, skill]));
  const mine: FoundSkill[] = matched.map((skill) => ({
    key: `document:${skill.ref}`,
    name: skill.name,
    description: skill.description,
    origin: "document",
    ref: skill.ref,
    url: null,
    installs: null,
    ownerRepo: null,
    alreadyHave: false,
  }));
  const theirs: FoundSkill[] = serverHits.map((hit) => {
    // 같은 이름이 이 문서에 이미 있으면 누르는 길이 다르다 — 가져오지 않고 그것을 읽는다.
    const same = inTheDocument.get(hit.name);
    return {
      key: `${hit.origin}:${hit.ref ?? hit.url ?? hit.name}`,
      name: hit.name,
      description: hit.description,
      origin: hit.origin,
      ref: same ? same.ref : hit.ref,
      url: hit.url,
      installs: hit.installs,
      ownerRepo: hit.owner_repo,
      alreadyHave: same !== undefined,
    };
  });
  return [...mine, ...theirs];
}
