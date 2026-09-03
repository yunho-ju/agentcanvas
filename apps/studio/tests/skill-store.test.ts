// 문서에 skill을 들이고 빼는 일은 되돌릴 수 있는 편집 하나다 (SK-3, DESIGN §7 skills-panel).
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { SkillDef } from "../src/generated/skill_def";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

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

/** 그 노드가 이 skill을 입은 문서 — 지우기가 노드를 건드리지 않는지 보는 자리. */
function wearing(skill: SkillDef): AgentSpec {
  return {
    ...example,
    skills: [skill],
    nodes: example.nodes.map((node) =>
      node.id === "clinical-agent"
        ? { ...node, config: { ...node.config, skill_refs: [skill.ref] } }
        : node,
    ),
  };
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("skill을 문서에 들인다", () => {
  it("들이면 문서의 목록에 서고, 되돌리기 한 걸음으로 사라진다", () => {
    const steps = store().undoStack.length;

    store().addSkill(aSkill("plain-answer"));

    expect(store().spec?.skills?.map((skill) => skill.name)).toEqual(["plain-answer"]);
    expect(store().undoStack.length).toBe(steps + 1);

    store().undo();
    expect(store().spec?.skills ?? []).toEqual([]);
  });

  it("같은 이름표를 다시 들이면 갈아 끼우고, 되돌리면 이전 판 그대로다", () => {
    store().addSkill(aSkill("plain-answer", "old\n"));

    store().replaceSkill(aSkill("plain-answer", "new\n"));

    expect(store().spec?.skills).toHaveLength(1);
    expect(store().spec?.skills?.[0].body).toBe("new\n");

    store().undo();
    expect(store().spec?.skills?.[0].body).toBe("old\n");
  });

  it("실행을 보는 동안에는 문서가 잠긴다 — 편집이 쌓이지 않는다", () => {
    useEditor.setState({ activeRunId: "run_1", runEvents: [{ seq: 1 } as never] });
    const steps = store().undoStack.length;

    store().addSkill(aSkill("plain-answer"));

    expect(store().spec?.skills ?? []).toEqual([]);
    expect(store().undoStack.length).toBe(steps);
  });
});

describe("가져오기 카드의 승인", () => {
  it("실행을 보는 동안에는 승인이 문서에 닿지 않고 까닭을 말한 채 기다린다", () => {
    store().openSkillImport();
    useEditor.setState({
      skillImportMode: "review",
      skillCandidate: aSkill("plain-answer"),
      activeRunId: "run_1",
      runEvents: [{ seq: 1 } as never],
    });

    store().applySkillImport();

    expect(store().spec?.skills ?? []).toEqual([]);
    expect(store().skillImportMode).toBe("review");
    expect(store().skillImportError?.key).toBe("run.locked");
  });
});

describe("skill을 문서에서 뺀다", () => {
  it("빼도 그 skill을 입은 노드의 설정은 그대로다 — 구조는 아무것도 빠지지 않는다", () => {
    const skill = aSkill("plain-answer");
    store().loadSpec(wearing(skill));

    store().removeSkill(skill.ref);

    expect(store().spec?.skills ?? []).toEqual([]);
    const node = store().nodes.find((one) => one.id === "clinical-agent");
    expect(node?.data.spec.config?.skill_refs).toEqual([skill.ref]);
    expect(store().nodes).toHaveLength(example.nodes.length);
    expect(store().edges).toHaveLength(example.edges.length);
  });

  it("입고 있던 단계가 있으면 그 사실을 말한다 — 조용히 끊지 않는다", () => {
    const skill = aSkill("plain-answer");
    store().loadSpec(wearing(skill));

    store().removeSkill(skill.ref);

    expect(store().notice?.key).toBe("edit.dropSkill.notice");
  });

  it("되돌리기 한 걸음으로 그 skill이 그대로 돌아온다", () => {
    const skill = aSkill("plain-answer");
    store().loadSpec(wearing(skill));

    store().removeSkill(skill.ref);
    store().undo();

    expect(store().spec?.skills).toEqual([skill]);
  });
});
