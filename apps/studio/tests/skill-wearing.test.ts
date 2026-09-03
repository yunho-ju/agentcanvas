// 입은 skill이 문서와 맞는가 — engine(Python)의 `validate_graph`와 같은 판정이어야 한다.
// 두 언어가 같은 케이스 파일(examples/skill-wearing/cases.json)을 읽어 같은 코드를 낸다.
// 문구(message)는 비교하지 않는다 — 언어가 다르다 (examples/skill-wearing/README.md).
import { describe, expect, it } from "vitest";
import cases from "../../../examples/skill-wearing/cases.json";
import type { AgentSpec, SkillDef } from "../src/generated/agent_spec";
import { skillIssues } from "../src/graph/skillIssues";

function skill(name: string): SkillDef {
  return {
    ref: `skill://${name}@1`,
    name,
    description: `Use when ${name} is what the answer needs.`,
    body: "Do the thing this skill is named after.\n",
  };
}

function specWearing(skills: string[], wears: string[]): AgentSpec {
  return {
    schema_version: "agent.spec/v1",
    id: "test-agent",
    version: 1,
    revision: `sha256:${"0".repeat(64)}`,
    status: "draft",
    input_schema: { type: "object" },
    state_schema: { type: "object" },
    nodes: [
      {
        id: "agent",
        type: "llm.agent",
        position: { x: 0, y: 0 },
        config: { model_ref: "model://default", skill_refs: wears },
      },
    ],
    edges: [],
    skills: skills.map(skill),
  } as AgentSpec;
}

function codesOf(spec: AgentSpec): string[] {
  return skillIssues(spec)
    .map((issue) => issue.code)
    .sort();
}

describe("두 언어가 함께 읽는 '입은 skill' 케이스", () => {
  it.each(cases)("$name", (testCase) => {
    expect(codesOf(specWearing(testCase.skills, testCase.wears))).toEqual(
      [...testCase.codes].sort(),
    );
  });
});

describe("판정 하나하나", () => {
  it("문서에 없는 skill을 입으면 어느 단계인지 말하고 실행을 막는다", () => {
    const issues = skillIssues(specWearing([], ["skill://plain-answer@1"]));
    expect(issues).toEqual([
      {
        severity: "error",
        code: "skill.missing",
        message: expect.stringContaining("skill://plain-answer@1"),
        nodeId: "agent",
      },
    ]);
  });

  it("같은 skill이 문서에 두 번 실리면 실행을 막는다", () => {
    const issues = skillIssues(
      specWearing(["plain-answer", "plain-answer"], ["skill://plain-answer@1"]),
    );
    expect(issues.map((issue) => issue.severity)).toEqual(["error"]);
  });

  it("아무도 안 입은 skill은 알려만 준다 — 잘못이 아니다", () => {
    const issues = skillIssues(specWearing(["plain-answer"], []));
    expect(issues.map((issue) => issue.severity)).toEqual(["info"]);
    expect(issues[0].nodeId).toBeUndefined();
  });

  it("연결 이름을 입은 skill로 잘못 읽지 않는다", () => {
    const spec = specWearing([], []);
    spec.nodes[0].config = { model_ref: "model://default", toolset_refs: ["reference"] };
    expect(skillIssues(spec)).toEqual([]);
  });
});
