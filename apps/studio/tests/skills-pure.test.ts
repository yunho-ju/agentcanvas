// 문서가 가진 skill에 대한 순수한 셈 — 넣고, 빼고, 무엇이 달라지는지 세고,
// 누가 입었는지 읽는다 (SK-3). 화면과 store가 같은 답을 함께 쓴다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { SkillDef } from "../src/generated/skill_def";
import { skillWearIssues } from "../src/graph/nodeSetupIssues";
import { toFlow } from "../src/graph/serialize";
import {
  duplicateSkillRefs,
  missingWornRefs,
  skillIssues,
} from "../src/graph/skillIssues";
import { nameInSkillRef } from "../src/graph/skillMarkdown";
import { countedLines, nodesWearing, withSkill, withoutSkill } from "../src/graph/skills";
import { nodeTypes } from "../src/registry/registry";

const example = exampleSpec as unknown as AgentSpec;

function aSkill(name: string, body = "Answer plainly.\n"): SkillDef {
  return {
    ref: `skill://${name}@1`,
    name,
    description: `use ${name} when you answer`,
    body,
    license: null,
    compatibility: null,
    metadata: {},
    references: [],
    source: null,
  };
}

describe("문서의 skill 목록 다루기", () => {
  it("새 skill은 목록 뒤에 붙는다", () => {
    const first = aSkill("plain-answer");
    const second = aSkill("cite-sources");

    expect(withSkill([first], second).map((skill) => skill.name)).toEqual([
      "plain-answer",
      "cite-sources",
    ]);
  });

  it("같은 이름표의 skill은 그 자리에서 갈아 끼운다 — 둘이 되지 않는다", () => {
    const before = aSkill("plain-answer", "old\n");
    const after = aSkill("plain-answer", "new\n");

    const next = withSkill([aSkill("cite-sources"), before], after);

    expect(next.map((skill) => skill.name)).toEqual(["cite-sources", "plain-answer"]);
    expect(next[1].body).toBe("new\n");
  });

  it("뺀 목록은 나머지 차례를 그대로 지킨다", () => {
    const list = [aSkill("a"), aSkill("b"), aSkill("c")];

    expect(withoutSkill(list, "skill://b@1").map((skill) => skill.name)).toEqual([
      "a",
      "c",
    ]);
  });

  it("없는 이름표를 빼라고 해도 목록은 그대로다", () => {
    const list = [aSkill("a")];

    expect(withoutSkill(list, "skill://zzz@1")).toEqual(list);
  });

  it("이전 판과 새 판의 길이를 줄 수로 센다 — 조용히 덮지 않기 위한 셈", () => {
    const before = aSkill("plain-answer", "one\ntwo\n");
    const after = aSkill("plain-answer", "one\ntwo\nthree\n");

    expect(countedLines(before.body)).toBe(2);
    expect(countedLines(after.body)).toBe(3);
  });
});

describe("누가 이 skill을 입었는가", () => {
  const wearing: AgentSpec = {
    ...example,
    skills: [aSkill("plain-answer")],
    nodes: example.nodes.map((node) =>
      node.id === "clinical-agent"
        ? { ...node, config: { ...node.config, skill_refs: ["skill://plain-answer@1"] } }
        : node,
    ),
  };

  it("입은 노드의 이름을 돌려준다", () => {
    expect(nodesWearing(toFlow(wearing).nodes, "skill://plain-answer@1")).toEqual([
      "clinical-agent",
    ]);
  });

  it("아무도 안 입은 skill에는 이름이 없다", () => {
    expect(nodesWearing(toFlow(wearing).nodes, "skill://cite-sources@1")).toEqual([]);
  });
});

describe("문서에 없는 skill을 입은 노드", () => {
  /** 그 단계가 입은 이름표를 적어 둔 문서 하나. */
  function wearing(
    worn: Record<string, string[]>,
    skills: SkillDef[] = [],
  ): AgentSpec {
    const agent = example.nodes.find((node) => node.id === "clinical-agent");
    return {
      ...example,
      skills,
      nodes: [
        ...example.nodes.map((node) =>
          worn[node.id] ? { ...node, config: { ...node.config, skill_refs: worn[node.id] } } : node,
        ),
        // 같은 판정을 두 단계에서 함께 본다 — 한 노드짜리 문서로만 맞춰 보지 않는다.
        ...(worn.second
          ? [{ ...agent!, id: "second", config: { ...agent?.config, skill_refs: worn.second } }]
          : []),
      ],
    };
  }

  const one = wearing({ "clinical-agent": ["skill://plain-answer@1"] });
  const two = wearing(
    {
      "clinical-agent": ["skill://plain-answer@1", "skill://cite-sources@1"],
      second: ["skill://ask-before-acting@1"],
    },
    [aSkill("cite-sources")],
  );

  /** 문서 전체의 판정이 말한 (어느 단계, 어느 이름표) 짝들. */
  function saidByTheDocument(spec: AgentSpec): { node: string; ref: string }[] {
    return skillIssues(spec)
      .filter((issue) => issue.code === "skill.missing")
      .map((issue) => ({
        node: issue.nodeId ?? "",
        // 문서 전체의 판정은 이름표를 글 안에 담아 말한다 (Python 미러와 같은 문장).
        ref: /skill:\/\/[^"]+/.exec(issue.message)?.[0] ?? "",
      }));
  }

  it("그 사실을 그 칸의 손볼 곳으로 말한다", () => {
    const node = one.nodes.find((candidate) => candidate.id === "clinical-agent");

    const issues = skillWearIssues(node!, nodeTypes["llm.agent"], []);

    expect(issues).toHaveLength(1);
    expect(issues[0].field).toBe("skill_refs");
    expect(issues[0].message.params?.name).toBe("plain-answer");
  });

  it("문서가 그 skill을 들고 있으면 할 말이 없다", () => {
    const node = one.nodes.find((candidate) => candidate.id === "clinical-agent");

    expect(skillWearIssues(node!, nodeTypes["llm.agent"], [aSkill("plain-answer")])).toEqual(
      [],
    );
  });

  // 같은 사실을 두 자리에서 다르게 판정하지 않는다 — 어느 단계의 어느 이름표인지까지 맞는다.
  it.each([
    ["한 단계가 하나를 입은 문서", one],
    ["두 단계가 셋을 입고 문서는 하나만 가진 문서", two],
  ])("문서 전체를 보는 판정(skill.missing)과 같은 것을 가리킨다: %s", (_name, spec) => {
    const perNode = spec.nodes.flatMap((node) =>
      missingWornRefs(
        node,
        nodeTypes[node.type],
        (spec.skills ?? []).map((skill) => skill.ref),
      ).map((ref) => ({ node: node.id, ref })),
    );

    expect(perNode).toEqual(saidByTheDocument(spec));
    // 그 칸의 손볼 곳도 같은 이름을 부른다 (이름표가 아니라 사람이 부르는 이름으로).
    const agent = spec.nodes.find((node) => node.id === "clinical-agent");
    expect(
      skillWearIssues(agent!, nodeTypes["llm.agent"], spec.skills ?? []).map(
        (issue) => issue.message.params?.name,
      ),
    ).toEqual(
      perNode
        .filter((missing) => missing.node === "clinical-agent")
        .map((missing) => nameInSkillRef(missing.ref)),
    );
  });
});

describe("같은 이름표를 두 번 든 문서", () => {
  it("그 이름표를 가려낸다 — 문서 전체의 판정과 같은 자리에서 나온다", () => {
    const twice = [aSkill("plain-answer"), aSkill("cite-sources"), aSkill("plain-answer")];

    expect(duplicateSkillRefs(twice)).toEqual(["skill://plain-answer@1"]);
    expect(
      skillIssues({ ...example, skills: twice }).filter(
        (issue) => issue.code === "skill.duplicate",
      ),
    ).toHaveLength(1);
  });

  it("한 번씩만 든 문서에는 가려낼 것이 없다", () => {
    expect(duplicateSkillRefs([aSkill("plain-answer"), aSkill("cite-sources")])).toEqual([]);
  });
});
