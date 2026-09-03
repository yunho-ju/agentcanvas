// Python `agentcanvas_contracts.skill_markdown`의 TS 미러 — 같은 SKILL.md에서 같은 답을 낸다.
// 우리만의 형식을 발명하지 않는다: 표준(agentskills.io) 파일을 그대로 읽고 그대로 쓴다.
// frontmatter는 YAML 부분집합만 읽는다 — 맨 위 `키: 스칼라` 줄과 한 단계 들여쓴 `metadata:` 맵.
// 그 밖의 모양은 조용히 넘기지 않고 `skill.frontmatter`로 말한다. 던지지 않는 순수 함수다
// (examples/skill-markdown/cases.json이 두 언어의 판정을 맞춰 본다).
import skillDefSchema from "../../../../packages/contracts/json_schema/skill_def.json";
import type { SkillDef, SkillReference } from "../generated/skill_def";

export const FRONTMATTER_FENCE = "---";

/** 표준이 권하는 본문 길이 — 넘어도 읽지만, 넘었다고 말은 한다. */
export const BODY_LINE_LIMIT = 500;

// 이름·길이 규칙은 계약이 실어 보낸다 (json_schema/skill_def.json) — 화면에 다시 적지 않는다.
// registry가 node_registry.json을 읽는 것과 같은 자리다: 규칙은 한 곳에서만 나온다.
export const SKILL_NAME_PATTERN = skillDefSchema.properties.name.pattern;
export const SKILL_NAME_MAX_LENGTH = skillDefSchema.properties.name.maxLength;
export const SKILL_DESCRIPTION_MAX_LENGTH =
  skillDefSchema.properties.description.maxLength;

/** 곁의 문서가 사는 자리 — 이 아래의 글만 skill과 함께 기록한다. */
export const REFERENCES_PREFIX = "references/";

const KNOWN_KEYS = ["name", "description", "license", "compatibility"];
const METADATA_KEY = "metadata";
const VALUE_STARTS_A_STRUCTURE = ["|", ">", "-", "[", "{", "&", "*"];
const NAME_RULE = new RegExp(SKILL_NAME_PATTERN);

// 본문 끝에서 떼어 내는 글자 — 두 언어가 똑같이 이 넉 자만 뗀다 (`bodyOf` 참고).
const TRAILING_WHITESPACE = /[ \t\r\n]+$/;

export interface SkillIssue {
  code: string;
  message: string;
}

export interface SkillParse {
  skill: SkillDef | null;
  issues: SkillIssue[];
}

function issueOf(code: string, message: string): SkillIssue {
  return { code, message };
}

/** 표준 이름 규칙을 어긴 이유 한 줄 — 지키면 undefined. */
export function skillNameIssue(name: string): string | undefined {
  if (name.length < 1 || name.length > SKILL_NAME_MAX_LENGTH) {
    return `a skill name must be 1 to ${SKILL_NAME_MAX_LENGTH} characters, but "${name}" is ${name.length}`;
  }
  if (!NAME_RULE.test(name)) {
    return `a skill name may hold only lowercase letters, digits and single hyphens between them, but "${name}" does not`;
  }
  return undefined;
}

/** 이름 하나가 가리키는 ref — 이름과 ref는 한 자리에서만 이어 붙인다. */
export function skillRefFor(name: string, revision = "1"): string {
  return `skill://${name}@${revision}`;
}

interface Frontmatter {
  lines: string[] | null;
  remainder: string;
}

/** 맨 위 `---` 두 줄 사이와 그 아래 본문 — 울타리가 없으면 앞이 없다고 답한다. */
function splitFrontmatter(text: string): Frontmatter {
  const lines = text.split("\n");
  if (lines.length === 0 || lines[0].trim() !== FRONTMATTER_FENCE) {
    return { lines: null, remainder: text };
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === FRONTMATTER_FENCE) {
      return { lines: lines.slice(1, index), remainder: lines.slice(index + 1).join("\n") };
    }
  }
  return { lines: null, remainder: text };
}

function scalarIssue(key: string, value: string): SkillIssue | undefined {
  if (value === "") {
    return issueOf(
      "skill.frontmatter",
      `"${key}" has no value — this file's front matter must be written as 'key: value' on one line`,
    );
  }
  if (VALUE_STARTS_A_STRUCTURE.some((start) => value.startsWith(start))) {
    return issueOf(
      "skill.frontmatter",
      `"${key}" holds a value we do not read — we read only plain one-line values and a one-level 'metadata:' map`,
    );
  }
  return undefined;
}

function unreadableLine(line: string, why: string): SkillIssue {
  return issueOf("skill.frontmatter", `we do not read this line: "${line.trim()}" — ${why}`);
}

interface ReadFrontmatter {
  fields: Record<string, string>;
  metadata: Record<string, string>;
  issues: SkillIssue[];
}

/** 읽은 맨 위 칸 — (이름표 키들, metadata, 못 읽은 모양들). */
function readFrontmatter(lines: string[]): ReadFrontmatter {
  const fields: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  const issues: SkillIssue[] = [];
  let inMetadata = false;

  for (const line of lines) {
    if (line.trim() === "") continue;

    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (!inMetadata || !line.startsWith("  ") || [" ", "\t"].includes(line.slice(2, 3))) {
        issues.push(unreadableLine(line, "only a one-level 'metadata:' map may be indented"));
        continue;
      }
      const indented = line.slice(2);
      const separator = indented.indexOf(":");
      if (separator === -1) {
        issues.push(unreadableLine(line, "write it as 'key: value'"));
        continue;
      }
      const key = indented.slice(0, separator).trim();
      const value = indented.slice(separator + 1).trim();
      const problem = scalarIssue(key, value);
      if (problem) {
        issues.push(problem);
        continue;
      }
      metadata[key] = value;
      continue;
    }

    inMetadata = false;
    const separator = line.indexOf(":");
    if (separator === -1) {
      issues.push(unreadableLine(line, "write it as 'key: value'"));
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === METADATA_KEY && value === "") {
      inMetadata = true;
      continue;
    }
    const problem = scalarIssue(key, value);
    if (problem) {
      issues.push(problem);
      continue;
    }
    if (KNOWN_KEYS.includes(key)) {
      fields[key] = value;
    } else {
      metadata[key] = value;
    }
  }

  return { fields, metadata, issues };
}

/**
 * 본문 — 앞의 빈 줄과 뒤의 여백을 떼고 늘 한 줄 바꿈으로 끝낸다 (왕복이 같아지도록).
 * 떼어 내는 여백은 TRAILING_WHITESPACE 넉 자뿐이다: `trimEnd()`는 글 끝의 U+FEFF까지
 * 떼어 내지만 파이썬 `str.rstrip()`은 남긴다 — 언어가 주는 집합을 쓰면 같은 파일에서
 * 다른 본문을 읽게 된다.
 */
function bodyOf(remainder: string): string {
  const body = remainder.replace(/^\n+/, "").replace(TRAILING_WHITESPACE, "");
  return body === "" ? "" : `${body}\n`;
}

/** skill을 만들 수 없는 이유들 — 하나라도 있으면 skill을 만들지 않는다. */
function contentIssues(fields: Record<string, string>, body: string): SkillIssue[] {
  const issues: SkillIssue[] = [];
  const name = fields.name ?? "";
  if (name === "") {
    issues.push(issueOf("skill.name", "a skill must say its name in 'name:' at the top"));
  } else {
    const problem = skillNameIssue(name);
    if (problem) issues.push(issueOf("skill.name", problem));
  }

  const description = fields.description ?? "";
  if (description === "") {
    issues.push(
      issueOf(
        "skill.description",
        "a skill must say when to use it in 'description:' at the top",
      ),
    );
  } else if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    issues.push(
      issueOf(
        "skill.description",
        `a description may be at most ${SKILL_DESCRIPTION_MAX_LENGTH} characters, but this one is ${description.length}`,
      ),
    );
  }

  if (body === "") {
    issues.push(issueOf("skill.body", "a skill must say something under its front matter"));
  }
  return issues;
}

interface ReferenceResult {
  kept: SkillReference[];
  issues: SkillIssue[];
}

/** 곁의 문서 — `references/` 아래의 읽을 글만 싣는다 (scripts/·assets/는 v1에서 뜻이 없다). */
function referenceResult(references: Record<string, string>): ReferenceResult {
  const kept: SkillReference[] = [];
  const issues: SkillIssue[] = [];
  for (const path of Object.keys(references).sort()) {
    if (!path.startsWith(REFERENCES_PREFIX)) {
      issues.push(
        issueOf(
          "skill.reference",
          `"${path}" is left out — a skill carries only the documents under "${REFERENCES_PREFIX}"`,
        ),
      );
      continue;
    }
    kept.push({ path, text: references[path] });
  }
  return { kept, issues };
}

/** 표준 SKILL.md 한 장을 읽는다 — 못 읽으면 던지지 않고 이유를 돌려준다. */
export function parseSkillMarkdown(
  text: string,
  references: Record<string, string> = {},
): SkillParse {
  const { lines, remainder } = splitFrontmatter(text);
  if (lines === null) {
    return {
      skill: null,
      issues: [
        issueOf(
          "skill.frontmatter",
          "a SKILL.md starts with a '---' line, its name and description, and another '---' line",
        ),
      ],
    };
  }

  const read = readFrontmatter(lines);
  const body = bodyOf(remainder);
  const issues = [...read.issues, ...contentIssues(read.fields, body)];
  if (issues.length > 0) return { skill: null, issues };

  const { kept, issues: referenceIssues } = referenceResult(references);
  issues.push(...referenceIssues);
  if (body.replace(/\n+$/, "").split("\n").length > BODY_LINE_LIMIT) {
    issues.push(
      issueOf(
        "skill.long",
        `this skill is longer than the ${BODY_LINE_LIMIT} lines the standard suggests — it still works, but a shorter one is easier to follow`,
      ),
    );
  }

  return {
    skill: {
      ref: skillRefFor(read.fields.name),
      name: read.fields.name,
      description: read.fields.description,
      body,
      license: read.fields.license ?? null,
      compatibility: read.fields.compatibility ?? null,
      metadata: read.metadata,
      references: kept,
      source: null,
    },
    issues,
  };
}

/** skill 하나를 표준 SKILL.md로 다시 쓴다 — 읽어 들이면 같은 skill이 된다. */
export function renderSkillMarkdown(skill: SkillDef): string {
  const front = [`name: ${skill.name}`, `description: ${skill.description}`];
  if (skill.license !== null && skill.license !== undefined) {
    front.push(`license: ${skill.license}`);
  }
  if (skill.compatibility !== null && skill.compatibility !== undefined) {
    front.push(`compatibility: ${skill.compatibility}`);
  }
  const metadata = skill.metadata ?? {};
  const keys = Object.keys(metadata).sort();
  if (keys.length > 0) {
    front.push(`${METADATA_KEY}:`);
    front.push(...keys.map((key) => `  ${key}: ${metadata[key]}`));
  }
  return `${FRONTMATTER_FENCE}\n${front.join("\n")}\n${FRONTMATTER_FENCE}\n\n${skill.body}`;
}
