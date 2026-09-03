// Python `agentcanvas_contracts.skill_similarity`의 TS 미러 — 같은 후보에서 같은 참고를 고른다.
// 새 skill의 초안을 지을 때 화면이 보여 주는 참고와 서버가 프롬프트에 싣는 예시가 갈리면,
// 사람이 본 것과 모델이 읽은 것이 달라진다 (examples/skill-similarity/cases.json이 둘을 맞춰 본다).
// 셈은 낱말 겹침 하나뿐이다: 뜻을 아는 척하지 않고, 언제나 같은 답을 낸다.
import type { SkillDef } from "../generated/skill_def";

/** 몇 개까지 참고로 보여 주는가 — DESIGN §7 skill-make-card의 '2~3개'. */
export const SIMILAR_SKILL_LIMIT = 3;

/**
 * 어느 글에나 있어 아무것도 가려내지 못하는 낱말들 — 최소한만 둔다.
 * 늘리는 것은 두 언어에 함께 늘린다 (한쪽만 늘리면 같은 픽스처에서 다른 줄을 고른다).
 */
const EVERYDAY_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "for", "from",
  "has", "have", "how", "if", "in", "into", "is", "it", "its", "must", "not", "of",
  "on", "or", "so", "that", "the", "then", "they", "this", "to", "up", "use", "used",
  "uses", "using", "was", "we", "what", "when", "which", "who", "will", "with", "you",
  "your",
]);

/** 낱말 하나 — 로마자·숫자가 이어진 토막, 또는 한글이 이어진 토막(U+AC00–U+D7A3).
 *  Python `skill_similarity._WORD`와 글자 하나까지 같아야 두 언어가 같은 줄을 고른다.
 *  한글은 코드포인트로 적는다 — 이 파일은 사전이 아니라서 화면 글자를 두지 않는다. */
const WORD = /[a-z0-9]+|[\uac00-\ud7a3]+/g;

/** 지금 만들고 있는 skill — 아직 문서의 것이 아니라 SkillDef가 아니다. */
export interface SkillQuery {
  name?: string;
  description: string;
  body: string;
}

/**
 * 참고가 될 수 있는 skill들 — 이 문서의 것과 시작 skill을 한 목록으로 놓는다.
 * 같은 이름표가 양쪽에 있으면 **문서의 것**이 이긴다: 사람이 고친 글을 우리 사본으로 덮지 않는다.
 */
export function referenceCandidates(held: SkillDef[], starters: SkillDef[]): SkillDef[] {
  const inTheDocument = new Set(held.map((skill) => skill.ref));
  return [...held, ...starters.filter((starter) => !inTheDocument.has(starter.ref))];
}

/** 글 하나가 쓴 낱말들 — 대소문자·구두점은 셈에 들지 않는다(한글도 낱말이다). */
function wordsIn(text: string): Set<string> {
  const found = text.toLowerCase().match(WORD) ?? [];
  return new Set(found.filter((word) => !EVERYDAY_WORDS.has(word)));
}

/** 두 글이 얼마나 같은 낱말을 쓰는가 — 겹친 낱말 수를 둘이 쓴 낱말 수로 나눈 값. */
function overlap(one: Set<string>, other: Set<string>): number {
  let shared = 0;
  for (const word of one) if (other.has(word)) shared += 1;
  if (shared === 0) return 0;
  return shared / (one.size + other.size - shared);
}

function textOf(one: { name?: string; description: string; body: string }): string {
  return `${one.name ?? ""} ${one.description} ${one.body}`;
}

/**
 * 이 지시문과 가장 비슷한 skill들 — 겹치는 낱말이 하나도 없는 것은 참고가 아니다.
 * 점수가 같으면 이름 차례다: 두 언어가 같은 줄을 고르도록 흔들리는 자리를 남기지 않는다.
 */
export function similarSkills(
  query: SkillQuery,
  candidates: SkillDef[],
  howMany: number = SIMILAR_SKILL_LIMIT,
): SkillDef[] {
  const asked = wordsIn(textOf(query));
  return candidates
    .map((skill) => ({ skill, score: overlap(asked, wordsIn(textOf(skill))) }))
    .filter((scored) => scored.score > 0)
    .sort((one, other) =>
      other.score - one.score || one.skill.name.localeCompare(other.skill.name, "en"),
    )
    .slice(0, howMany)
    .map((scored) => scored.skill);
}
