// 입은 skill이 문서와 맞는가 — Python `agentcanvas_engine.validator`의 skill 세 판정 미러.
// 같은 코드·같은 심각도를 낸다 (examples/skill-wearing/cases.json이 두 언어를 맞춰 본다).
// 순수 함수다: 던지지 않고 할 말을 목록으로 돌려준다.
import type { AgentSpec, Node1 as SpecNode } from "../generated/agent_spec";
import type { NodeType } from "../generated/node_type";
import type { SkillDef } from "../generated/skill_def";
import { nodeTypes, skillRefs } from "../registry/registry";

export interface SkillWearingIssue {
  severity: "error" | "info";
  code: "skill.missing" | "skill.duplicate" | "skill.unused";
  message: string;
  /** 어느 단계의 이야기인가 — 문서 전체의 이야기면 없다 */
  nodeId?: string;
}

/** 어느 노드가 어떤 skill을 입었는가 — ref 하나당 처음 입은 노드 하나를 기억한다. */
function wornSkillRefs(spec: AgentSpec): Map<string, string> {
  const worn = new Map<string, string>();
  for (const node of spec.nodes) {
    const nodeType = nodeTypes[node.type];
    if (!nodeType) continue;
    for (const ref of skillRefs(node, nodeType)) {
      if (!worn.has(ref)) worn.set(ref, node.id);
    }
  }
  return worn;
}

/**
 * 이 노드가 입었지만 문서가 갖고 있지 않은 이름표들 — `skill.missing`이 말하는 그 사실이다.
 * 판정은 여기 한 번만 적는다: 문서 전체의 판정도, 그 칸의 손볼 곳(nodeSetupIssues)도 이것을 읽는다.
 */
export function missingWornRefs(
  node: SpecNode,
  nodeType: NodeType | undefined,
  held: string[],
): string[] {
  if (!nodeType) return [];
  const has = new Set(held);
  return skillRefs(node, nodeType).filter((ref) => !has.has(ref));
}

/**
 * 문서가 두 번 이상 든 이름표들 — `skill.duplicate`가 말하는 그 사실이다.
 * skill 패널의 그 줄도 이것을 읽는다 (같은 판정을 두 벌로 두지 않는다).
 */
export function duplicateSkillRefs(skills: SkillDef[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const skill of skills) {
    if (seen.has(skill.ref) && !repeated.includes(skill.ref)) repeated.push(skill.ref);
    seen.add(skill.ref);
  }
  return repeated;
}

/** 문서가 가진 skill과 노드가 입은 skill이 서로 맞는가. */
export function skillIssues(spec: AgentSpec): SkillWearingIssue[] {
  const held = (spec.skills ?? []).map((skill) => skill.ref);
  const worn = wornSkillRefs(spec);

  const issues: SkillWearingIssue[] = duplicateSkillRefs(spec.skills ?? []).map((ref) => ({
    severity: "error",
    code: "skill.duplicate",
    message: `this agent holds the skill "${ref}" more than once`,
  }));

  // 없는 이름표는 노드마다 같은 규칙으로 보고, 이름표 하나당 처음 입은 노드가 말한다.
  const said = new Set<string>();
  for (const node of spec.nodes) {
    for (const ref of missingWornRefs(node, nodeTypes[node.type], held)) {
      if (said.has(ref)) continue;
      said.add(ref);
      issues.push({
        severity: "error",
        code: "skill.missing",
        message: `node "${node.id}" wears the skill "${ref}", which this agent does not have`,
        nodeId: node.id,
      });
    }
  }

  for (const ref of new Set(held)) {
    if (!worn.has(ref)) {
      issues.push({
        severity: "info",
        code: "skill.unused",
        message: `the skill "${ref}" is here, but no step wears it`,
      });
    }
  }

  return issues;
}
