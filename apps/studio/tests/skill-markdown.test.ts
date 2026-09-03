// @vitest-environment node
// 표준 SKILL.md 하나를 읽고 다시 쓰는 순수 함수 — contracts(Python)와 같은 판정이어야 한다.
// 두 언어가 같은 케이스 파일(examples/skill-markdown/cases.json)과 같은 cases/*.md를 읽는다.
// 문구(message)는 비교하지 않는다 — 언어가 다르다 (examples/skill-markdown/README.md).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import skillDefSchema from "../../../packages/contracts/json_schema/skill_def.json";
import cases from "../../../examples/skill-markdown/cases.json";
import {
  nameInSkillRef,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  SKILL_NAME_PATTERN,
  parseSkillMarkdown,
  renderSkillMarkdown,
  skillNameIssue,
} from "../src/graph/skillMarkdown";

const CASE_DIR = fileURLToPath(new URL("../../../examples/skill-markdown", import.meta.url));

function textOf(file: string): string {
  return readFileSync(`${CASE_DIR}/cases/${file}`, "utf-8");
}

describe("두 언어가 함께 읽는 SKILL.md 케이스", () => {
  it.each(cases)("$name — 같은 issue 코드를 낸다", (testCase) => {
    const parsed = parseSkillMarkdown(textOf(testCase.file));
    expect(parsed.issues.map((issue) => issue.code)).toEqual(testCase.issues);
  });

  it.each(cases)("$name — 같은 skill을 만든다", (testCase) => {
    const parsed = parseSkillMarkdown(textOf(testCase.file));
    if (testCase.expect === null) {
      expect(parsed.skill).toBeNull();
      return;
    }
    expect(parsed.skill).not.toBeNull();
    const skill = parsed.skill as NonNullable<typeof parsed.skill>;
    expect({
      ref: skill.ref,
      name: skill.name,
      description: skill.description,
      license: skill.license,
      compatibility: skill.compatibility,
      metadata: skill.metadata,
      body: skill.body,
    }).toEqual(testCase.expect);
  });

  it.each(cases)("$name — 다시 써서 읽으면 같은 skill이다", (testCase) => {
    const parsed = parseSkillMarkdown(textOf(testCase.file));
    if (parsed.skill === null) return;
    expect(parseSkillMarkdown(renderSkillMarkdown(parsed.skill)).skill).toEqual(parsed.skill);
  });
});

describe("읽을 수 없는 SKILL.md", () => {
  it("맨 위 칸이 없으면 던지지 않고 이유를 말한다", () => {
    const parsed = parseSkillMarkdown("Write short sentences.\n");
    expect(parsed.issues.map((issue) => issue.code)).toEqual(["skill.frontmatter"]);
    expect(parsed.skill).toBeNull();
  });

  it.each([
    "name:\n  - plain-answer",
    "name plain-answer",
    "metadata:\n  nested:\n    deep: 1",
    "name: |\n  plain-answer",
  ])("우리가 읽는 YAML 부분집합 밖이면 말한다: %s", (frontmatter) => {
    const parsed = parseSkillMarkdown(`---\n${frontmatter}\n---\n\nbody\n`);
    expect(parsed.issues.map((issue) => issue.code)).toContain("skill.frontmatter");
    expect(parsed.skill).toBeNull();
  });

  it("본문이 비어 있으면 skill이 아무 말도 하지 않는다고 말한다", () => {
    const parsed = parseSkillMarkdown(
      "---\nname: plain-answer\ndescription: Use when it must be plain.\n---\n\n",
    );
    expect(parsed.issues.map((issue) => issue.code)).toEqual(["skill.body"]);
    expect(parsed.skill).toBeNull();
  });
});

describe("skill 곁의 문서", () => {
  it("references/ 아래의 글은 함께 실린다", () => {
    const parsed = parseSkillMarkdown(textOf("valid.md"), {
      "references/style.md": "Short lines.",
    });
    expect(parsed.skill?.references).toEqual([
      { path: "references/style.md", text: "Short lines." },
    ]);
  });

  it("references/ 밖의 파일은 빼고, 뺐다고 말한다", () => {
    const parsed = parseSkillMarkdown(textOf("valid.md"), { "scripts/run.sh": "echo hi" });
    expect(parsed.issues.map((issue) => issue.code)).toEqual(["skill.reference"]);
    expect(parsed.skill?.references).toEqual([]);
  });
});

describe("이름·길이 규칙", () => {
  it("계약이 실어 보낸 그 규칙을 그대로 쓴다 — 화면에 규칙을 다시 적지 않는다", () => {
    expect(SKILL_NAME_PATTERN).toBe(skillDefSchema.properties.name.pattern);
    expect(SKILL_NAME_MAX_LENGTH).toBe(skillDefSchema.properties.name.maxLength);
    expect(SKILL_DESCRIPTION_MAX_LENGTH).toBe(
      skillDefSchema.properties.description.maxLength,
    );
  });

  it.each(["plain-answer", "a", "a1-b2", "Plain-Answer", "plain--answer", "-plain", "plain-"])(
    "%s 에 대해 계약의 pattern과 같은 답을 낸다",
    (name) => {
      const allowedBySchema = new RegExp(skillDefSchema.properties.name.pattern).test(name);
      expect(skillNameIssue(name) === undefined).toBe(allowedBySchema);
    },
  );

  it.each(["plain-answer\n", "plain-answer\n\n"])(
    "뒤에 개행이 붙은 %j 은 그 이름이 아니다",
    (name) => {
      expect(skillNameIssue(name)).toBeDefined();
    },
  );
});

// 이름표에서 이름을 읽는 자리 — 파이썬 `name_in_skill_ref`와 같은 케이스에 같은 답을 낸다.
describe("이름표가 가리키는 이름", () => {
  it.each([
    ["skill://plain-answer@1", "plain-answer"],
    ["skill://plain-answer", "plain-answer"],
    ["skill://", undefined],
    ["tool://plain-answer@1", undefined],
  ])("%j 이 가리키는 이름은 %j 이다", (ref, name) => {
    expect(nameInSkillRef(ref)).toBe(name);
  });
});
