// 문서가 가진 skill(spec.skills)에 대한 순수한 셈 — 무엇이 들어오고, 무엇이 빠지고,
// 누가 입었고, 입은 것 중 문서에 없는 것은 무엇인가. 화면과 store가 같은 답을 함께 쓴다
// (연결에 대한 같은 자리: graph/connections).
import type { SkillDef } from "../generated/skill_def";
import { skillRefs } from "../registry/registry";
import type { FlowNode } from "./serialize";

/** 같은 이름표가 이미 있으면 그 자리에서 갈아 끼우고, 없으면 뒤에 붙인 목록. */
export function withSkill(current: SkillDef[], skill: SkillDef): SkillDef[] {
  return current.some((one) => one.ref === skill.ref)
    ? current.map((one) => (one.ref === skill.ref ? skill : one))
    : [...current, skill];
}

/** skill 하나를 뺀 목록 — 나머지의 차례는 그대로다. */
export function withoutSkill(current: SkillDef[], ref: string): SkillDef[] {
  return current.filter((one) => one.ref !== ref);
}

/** 본문의 줄 수 — 이전 판과 새 판이 얼마나 다른지 사람에게 말하는 단위다. */
export function countedLines(body: string): number {
  const written = body.replace(/\n+$/, "");
  return written === "" ? 0 : written.split("\n").length;
}

/**
 * 이 skill을 입은 노드들의 이름 — 무엇이 틀렸는지는 여기서 판정하지 않는다.
 * 읽는 자리는 registry의 마커 하나(skillRefs)로, inspector가 쓰는 그 리더다.
 */
export function nodesWearing(nodes: FlowNode[], ref: string): string[] {
  return nodes
    .filter((node) => {
      const nodeType = node.data.nodeType;
      return nodeType !== undefined && skillRefs(node.data.spec, nodeType).includes(ref);
    })
    .map((node) => node.id);
}
