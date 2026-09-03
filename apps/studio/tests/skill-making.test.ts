// @vitest-environment node
// 지시문 하나가 skill이 되기까지의 순수한 셈 — contracts(Python)와 같은 답이어야 한다.
// 두 언어가 같은 케이스 파일(examples/skill-similarity, examples/skill-scaffold)을 읽는다.
import { describe, expect, it } from "vitest";
import scaffoldCases from "../../../examples/skill-scaffold/cases.json";
import similarCases from "../../../examples/skill-similarity/cases.json";
import type { SkillDef } from "../src/generated/skill_def";
import { referenceCandidates, similarSkills } from "../src/graph/similarSkills";
import { parseSkillMarkdown, skillRefFor } from "../src/graph/skillMarkdown";
import { scaffoldSkill } from "../src/graph/skillScaffold";

/** 케이스가 적어 둔 세 칸으로 문서 안 skill 하나를 짓는다 — 나머지는 이 셈과 상관이 없다. */
function skillOf(one: { name: string; description: string; body: string }): SkillDef {
  return {
    ref: skillRefFor(one.name),
    name: one.name,
    description: one.description,
    body: one.body,
    license: null,
    compatibility: null,
    metadata: {},
    references: [],
    source: null,
  };
}

describe("두 언어가 함께 읽는 '비슷한 skill' 케이스", () => {
  it.each(similarCases)("$name", (testCase) => {
    const chosen = similarSkills(
      testCase.query,
      testCase.candidates.map(skillOf),
      testCase.howMany,
    );
    expect(chosen.map((skill) => skill.name)).toEqual(testCase.expect);
  });
});

describe("비슷한 skill을 고르는 규칙", () => {
  const plain = skillOf({
    name: "plain-answer",
    description: "Use when you answer a person and the answer must be easy to read.",
    body: "Write short sentences.\n",
  });

  it("고를 것이 없으면 빈 목록이다 — 빈 자리를 지어내지 않는다", () => {
    expect(similarSkills({ description: "anything", body: "anything" }, [])).toEqual([]);
  });

  it("적어 주지 않으면 세 개까지 고른다", () => {
    const many = [1, 2, 3, 4].map((at) =>
      skillOf({
        name: `answer-${at}`,
        description: "Use when you answer a person.",
        body: `Write ${"very ".repeat(at)}short sentences.\n`,
      }),
    );
    expect(similarSkills({ description: "answer a person", body: "" }, many)).toHaveLength(3);
  });

  it("같은 이름표가 문서와 시작 skill에 다 있으면 문서의 것만 참고가 된다", () => {
    const mine: SkillDef = { ...plain, description: "my own words about answering" };
    const starters = [plain, skillOf({ name: "other", description: "x", body: "y\n" })];

    const candidates = referenceCandidates([mine], starters);

    expect(candidates.filter((one) => one.ref === plain.ref)).toEqual([mine]);
    expect(candidates.map((one) => one.name)).toEqual(["plain-answer", "other"]);
  });
});

describe("두 언어가 함께 읽는 '틀 초안' 케이스", () => {
  it.each(scaffoldCases)("$name — 같은 글자를 낸다", (testCase) => {
    expect(
      scaffoldSkill(testCase.skillName, testCase.description, testCase.instruction),
    ).toBe(`${testCase.expect.join("\n")}\n`);
  });

  it.each(scaffoldCases)("$name — 우리 파서가 issue 없이 읽는다", (testCase) => {
    const parsed = parseSkillMarkdown(
      scaffoldSkill(testCase.skillName, testCase.description, testCase.instruction),
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.skill?.name).toBe(testCase.skillName);
    expect(parsed.skill?.description).toBe(testCase.description);
  });
});
