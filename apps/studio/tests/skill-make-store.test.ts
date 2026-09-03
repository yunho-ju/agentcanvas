// 지시문 하나를 skill로 만드는 길의 상태 전이 (SK-5, DESIGN §7 skill-make-card).
// 승인 전에는 문서가 그대로이고, 승인 1회는 되돌리기 한 걸음이다 — 문서의 skill과
// 그 단계가 입는 목록이 **함께** 오간다.
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { SkillDraftOutcome } from "../src/api/skillDraft";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { SkillDef } from "../src/generated/skill_def";
import { STARTER_SKILLS } from "../src/registry/starterSkills";
import { useEditor } from "../src/store/editor";
import { skillMakeReferences } from "../src/store/skillMakeSlice";

const example = exampleSpec as unknown as AgentSpec;
const NODE = "clinical-agent";
const INSTRUCTION = "Answer in short sentences and leave out jargon.";

function store() {
  return useEditor.getState();
}

function skillsOf(): SkillDef[] {
  return store().spec?.skills ?? [];
}

function wornBy(id = NODE): string[] {
  const node = store().nodes.find((one) => one.id === id);
  const worn = node?.data.spec.config?.skill_refs;
  return Array.isArray(worn) ? (worn as string[]) : [];
}

function aSkill(name: string, body = "Answer plainly.\n"): SkillDef {
  return {
    ref: `skill://${name}@1`,
    name,
    description: `use ${name} when you answer a person`,
    body,
    license: null,
    compatibility: null,
    metadata: {},
    references: [],
    source: null,
  };
}

const DRAFT = [
  "---",
  "name: plain-answer",
  "description: Use when you answer a person",
  "---",
  "",
  "# plain-answer",
  "",
  "Answer in short sentences.",
  "",
].join("\n");

/** 초안을 지어 주는 자리를 가짜로 갈아 끼운다 — 화면은 서버를 부르지 않는다. */
function serverSays(outcome: SkillDraftOutcome) {
  useEditor.setState({ draftSkillOnServer: async () => outcome });
}

async function makeAndDraft(name = "plain-answer") {
  store().openSkillMake(NODE, INSTRUCTION);
  store().setSkillMakeName(name);
  store().setSkillMakeDescription("Use when you answer a person");
  await store().draftSkill();
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
  serverSays({ text: DRAFT, draftedBy: "model" });
});

describe("만들기 모드를 연다", () => {
  it("어느 단계의 어떤 지시문인지 들고 열린다", () => {
    store().openSkillMake(NODE, INSTRUCTION);

    expect(store().skillMake).toEqual({ nodeId: NODE, instruction: INSTRUCTION });
    expect(store().skillImportMode).toBe("input");
  });

  it("실행을 보는 동안에는 열리지 않는다 — 문서가 잠겨 있다", () => {
    useEditor.setState({ activeRunId: "run_1", runEvents: [{ seq: 1 } as never] });

    store().openSkillMake(NODE, INSTRUCTION);

    expect(store().skillMake).toBeNull();
    expect(store().skillImportMode).toBe("closed");
  });

  it("가져오기로 열면 만들기 자리는 비어 있다 — 한 카드, 두 모드", () => {
    store().openSkillMake(NODE, INSTRUCTION);
    store().closeSkillImport();

    store().openSkillImport();

    expect(store().skillMake).toBeNull();
  });
});

describe("참고할 skill을 고른다", () => {
  it("문서의 skill과 시작 skill 중에서 비슷한 것만 든다", () => {
    const far = aSkill("count-invoices");
    store().loadSpec({
      ...example,
      skills: [{ ...far, description: "Rechnungen summieren.", body: "Zahlen addieren.\n" }],
    });
    store().openSkillMake(NODE, "Answer the person plainly and cite the document you used.");

    const chosen = skillMakeReferences(store());

    expect(chosen.length).toBeGreaterThan(0);
    expect(chosen.length).toBeLessThanOrEqual(3);
    expect(chosen.map((one) => one.name)).not.toContain("count-invoices");
  });

  it("문서가 시작 skill과 같은 이름표를 가지면 문서의 것만 든다 — 같은 줄을 두 번 보여 주지 않는다", () => {
    const starter = Object.values(STARTER_SKILLS)[0];
    store().loadSpec({ ...example, skills: [{ ...starter, description: `${starter.description} (mine)` }] });
    store().openSkillMake(NODE, starter.description);

    const chosen = skillMakeReferences(store());

    expect(chosen.filter((one) => one.ref === starter.ref)).toHaveLength(1);
    expect(chosen.find((one) => one.ref === starter.ref)?.description).toContain("(mine)");
  });
});

describe("초안을 짓는다", () => {
  it("지어 온 글을 같은 파서로 읽고 미리보기로 간다 — 문서는 아직 그대로다", async () => {
    await makeAndDraft();

    expect(store().skillImportMode).toBe("review");
    expect(store().skillCandidate?.name).toBe("plain-answer");
    expect(store().skillDraftedBy).toBe("model");
    expect(skillsOf()).toEqual([]);
  });

  it("틀만 잡았다는 답도 미리보기로 간다 — 무엇이 지었는지를 그대로 들고 간다", async () => {
    serverSays({ text: DRAFT, draftedBy: "scaffold" });

    await makeAndDraft();

    expect(store().skillImportMode).toBe("review");
    expect(store().skillDraftedBy).toBe("scaffold");
  });

  it("서버에 닿지 못하면 적은 이름과 설명을 잃지 않는다", async () => {
    useEditor.setState({
      draftSkillOnServer: async () => ({ failure: { key: "skillMake.error.offline" } }),
    });

    await makeAndDraft();

    expect(store().skillImportMode).toBe("input");
    expect(store().skillMakeName).toBe("plain-answer");
    expect(store().skillMakeDescription).toBe("Use when you answer a person");
    expect(store().skillImportError?.key).toBe("skillMake.error.offline");
  });

  it("이름 규칙을 어긴 채로는 아무에게도 묻지 않는다 — 그릴 때 막은 것은 여기서도 막힌다", async () => {
    let asked = 0;
    useEditor.setState({
      draftSkillOnServer: async () => {
        asked += 1;
        return { text: DRAFT, draftedBy: "model" as const };
      },
    });

    await makeAndDraft("Plain Answer");

    expect(asked).toBe(0);
    expect(store().skillImportMode).toBe("input");
  });
});

describe("승인 — 문서에 넣고 그 단계가 따르게 한다", () => {
  it("skills +1과 그 단계의 skill_refs +1이 되돌리기 한 걸음에 함께 오간다", async () => {
    await makeAndDraft();
    const steps = store().undoStack.length;

    store().applySkillImport();

    expect(skillsOf().map((one) => one.name)).toEqual(["plain-answer"]);
    expect(wornBy()).toEqual(["skill://plain-answer@1"]);
    expect(store().undoStack.length).toBe(steps + 1);

    store().undo();
    expect(skillsOf()).toEqual([]);
    expect(wornBy()).toEqual([]);
  });

  it("승인하면 카드가 닫히고, 그 단계에 무엇을 만들었는지 남는다", async () => {
    await makeAndDraft();

    store().applySkillImport();

    expect(store().skillImportMode).toBe("closed");
    expect(store().skillMake).toBeNull();
    expect(store().skillMadeFor).toEqual({
      nodeId: NODE,
      ref: "skill://plain-answer@1",
    });
  });

  it("같은 이름이 이미 있으면 갈아 끼운다 — 입는 목록에 같은 이름표가 두 번 서지 않는다", async () => {
    const older = aSkill("plain-answer", "old\n");
    store().loadSpec({
      ...example,
      skills: [older],
      nodes: example.nodes.map((node) =>
        node.id === NODE
          ? { ...node, config: { ...node.config, skill_refs: [older.ref] } }
          : node,
      ),
    });
    await makeAndDraft();

    store().applySkillImport();

    expect(skillsOf()).toHaveLength(1);
    expect(skillsOf()[0].body).toContain("Answer in short sentences.");
    expect(wornBy()).toEqual([older.ref]);

    store().undo();
    expect(skillsOf()[0].body).toBe("old\n");
  });

  it("실행을 보는 동안에는 승인이 문서에 닿지 않고 까닭을 말한 채 기다린다", async () => {
    await makeAndDraft();
    useEditor.setState({ activeRunId: "run_1", runEvents: [{ seq: 1 } as never] });

    store().applySkillImport();

    expect(skillsOf()).toEqual([]);
    expect(wornBy()).toEqual([]);
    expect(store().skillImportMode).toBe("review");
    expect(store().skillImportError?.key).toBe("run.locked");
  });

  it("만든 자리는 닫으면 사라진다 — 다음에 열 때 지난 말이 남지 않는다", async () => {
    await makeAndDraft();
    store().applySkillImport();

    store().forgetSkillMade();

    expect(store().skillMadeFor).toBeNull();
  });
});
