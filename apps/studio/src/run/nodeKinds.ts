// 노드의 성격 — 길을 고르는가, 사람을 기다리는가.
// engine `node_work.KIND_BY_NODE_TYPE`의 거울이다: 새 타입은 양쪽 표에 한 줄씩 더한다
// (실행기도 화면도 타입 이름으로 분기하지 않고 이 표만 읽는다).
import type { Node1 as SpecNode } from "../generated/agent_spec";

/** 길을 고르는 성격의 타입들 (engine `_NodeKind.picks_a_way`). */
const PICKS_A_WAY: readonly string[] = ["llm.router"];

/** 사람의 확인을 기다리는 성격의 타입들 (engine `_NodeKind.waits_for_person`). */
const WAITS_FOR_PERSON: readonly string[] = ["control.human_gate"];

export function picksAWay(node: SpecNode): boolean {
  return PICKS_A_WAY.includes(node.type);
}

export function waitsForPerson(node: SpecNode): boolean {
  return WAITS_FOR_PERSON.includes(node.type);
}
