// 입은 skill이 문서와 맞는가 — Python `agentcanvas_engine.validator`의 skill 세 판정 미러.
// 같은 코드·같은 심각도를 낸다 (examples/skill-wearing/cases.json이 두 언어를 맞춰 본다).
// 순수 함수다: 던지지 않고 할 말을 목록으로 돌려준다.
import type { AgentSpec } from "../generated/agent_spec";
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

function duplicates(refs: string[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const ref of refs) {
    if (seen.has(ref) && !repeated.includes(ref)) repeated.push(ref);
    seen.add(ref);
  }
  return repeated;
}

/** 문서가 가진 skill과 노드가 입은 skill이 서로 맞는가. */
export function skillIssues(spec: AgentSpec): SkillWearingIssue[] {
  const held = (spec.skills ?? []).map((skill) => skill.ref);
  const worn = wornSkillRefs(spec);

  const issues: SkillWearingIssue[] = duplicates(held).map((ref) => ({
    severity: "error",
    code: "skill.duplicate",
    message: `this agent holds the skill "${ref}" more than once`,
  }));

  for (const [ref, nodeId] of worn) {
    if (!held.includes(ref)) {
      issues.push({
        severity: "error",
        code: "skill.missing",
        message: `node "${nodeId}" wears the skill "${ref}", which this agent does not have`,
        nodeId,
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
