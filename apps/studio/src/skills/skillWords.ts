// 파서가 댄 까닭을 사람이 읽을 한 줄로 옮기는 표 (DESIGN §7 skill-import-card).
// 원문 issue 코드는 화면에 나가지 않는다 — 모르는 코드도 침묵하지 않고 일반 문구로 말한다.
import type { SkillDef } from "../generated/skill_def";
import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  type SkillIssue,
  skillNameIssue,
} from "../graph/skillMarkdown";
import { type Message, type MessageKey, msg } from "../i18n/messages";
import { resolveStarterSkill } from "../registry/starterSkills";

/** 새 판정 코드가 계약에 생기면 여기 한 줄이다 (분기 대신 표). */
const ISSUE_WORDS: Record<string, MessageKey> = {
  "skill.name": "skillImport.issue.name",
  "skill.description": "skillImport.issue.description",
  "skill.body": "skillImport.issue.body",
  "skill.frontmatter": "skillImport.issue.frontmatter",
  "skill.reference": "skillImport.issue.reference",
  "skill.long": "skillImport.issue.long",
};

export function issueWords(issues: SkillIssue[]): Message[] {
  return issues.map((issue) => msg(ISSUE_WORDS[issue.code] ?? "skillImport.issue.other"));
}

/**
 * 사람이 적고 있는 이름이 아직 이름이 아닌 까닭 한 줄 — 지키면 null.
 * 규칙은 계약이 실어 보낸 그것 하나다(skillNameIssue) — 화면이 규칙을 다시 적지 않고,
 * 영어 원문 대신 이 자리에서 쉬운 말로 옮긴다.
 */
export function skillNameProblem(name: string): Message | null {
  if (name.trim() === "") return msg("skillMake.name.empty");
  return skillNameIssue(name) === undefined ? null : msg("skillImport.issue.name");
}

/**
 * 사람이 적고 있는 '언제 쓰나요'가 아직 쓸 수 없는 까닭 한 줄 — 지키면 null.
 * 길이 규칙도 계약이 실어 보낸 그것이다 — 청을 보내 놓고 서버가 물리게 하지 않는다 (§9).
 */
export function skillDescriptionProblem(description: string): Message | null {
  const written = description.trim();
  if (written === "") return msg("skillMake.description.empty");
  if (written.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    return msg("skillMake.description.long", { max: SKILL_DESCRIPTION_MAX_LENGTH });
  }
  return null;
}

/** 주소를 사람이 읽을 자리 이름으로 — 어디서 왔는지만 말하면 된다. */
function whereFrom(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/**
 * 이 skill이 어디서 왔는가 — 패널의 줄과 가져오기 카드의 캡션이 같은 이 답을 쓴다.
 * 번들 시작 skill은 "이 문서에서 만듦"이 아니다: 우리가 실어 보낸 글 그대로면 그렇게 말한다.
 */
export function sourceCaption(skill: SkillDef): Message {
  if (skill.source) return msg("skills.source.imported", { where: whereFrom(skill.source.url) });
  const starter = resolveStarterSkill(skill.ref);
  if (starter && starter.body === skill.body) return msg("skills.source.starter");
  return msg("skills.source.made");
}
