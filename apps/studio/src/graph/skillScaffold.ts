// Python `agentcanvas_contracts.skill_scaffold`의 TS 미러 — 같은 입력에서 같은 글자를 낸다.
// 부를 모델이 없을 때 지시문을 표준 SKILL.md 구조로 옮기는 틀 초안이다: 모르는 것을 지어내지
// 않는다 — 사람이 적지 않은 절은 만들지 않고, 본문은 적어 둔 지시문 그대로다
// (examples/skill-scaffold/cases.json이 두 언어를 맞춰 본다).
import { FRONTMATTER_FENCE, quoteScalar } from "./skillMarkdown";

/** 지시문이 들어가는 절의 제목 — 모델이 짓는 초안도 같은 이름의 절을 쓴다. */
export const HOW_TO_DO_IT = "## How to do it";

// 앞의 빈 줄과 뒤의 여백만 뗀다 — 줄 안의 들여쓰기는 사람이 적은 그대로다
// (skillMarkdown의 본문 다듬기와 같은 넉 자만 뗀다).
const TRAILING_WHITESPACE = /[ \t\r\n]+$/;

function written(instruction: string): string {
  return instruction.replace(/^\n+/, "").replace(TRAILING_WHITESPACE, "");
}

/** 지시문 하나를 표준 SKILL.md 한 장의 틀로 옮긴다 — 이름과 쓰임새는 사람이 적은 그대로다. */
export function scaffoldSkill(
  name: string,
  description: string,
  instruction: string,
): string {
  const body = [`# ${name}`, "", description];
  const steps = written(instruction);
  if (steps !== "") body.push("", HOW_TO_DO_IT, "", steps);
  return [
    FRONTMATTER_FENCE,
    `name: ${quoteScalar(name)}`,
    `description: ${quoteScalar(description)}`,
    FRONTMATTER_FENCE,
    "",
    ...body,
    "",
  ].join("\n");
}
