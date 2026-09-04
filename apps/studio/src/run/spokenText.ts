// 실행이 낸 말 — engine `routed_runtime.spoken_llm_texts`의 거울 (순수 함수).
// 두 쪽이 같은 케이스 파일로 맞춰진다 (examples/spoken-answers/README.md).
import type { AgentSpec, Node1 as SpecNode } from "../generated/agent_spec";
import type { RunEvent } from "../generated/run_event";
import { picksAWay } from "./nodeKinds";

/** 갈림길이 고른 길이 실리는 이름 (engine `run_log.ROUTE`). */
const ROUTE = "route";

/**
 * 이 조건이 그 이름에게 바라는 값 — `이름 == '값'`일 때의 `값`
 * (engine `edge_condition.named_value`의 거울: 같지 않음(!=)이나 다른 모양은 없음이다).
 */
const COMPARISON = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(==|!=)\s*(?:'([^']*)'|"([^"]*)")\s*$/;

function namedValue(expression: string, name: string): string | null {
  const read = COMPARISON.exec(expression);
  if (read === null || read[1] !== name || read[2] !== "==") return null;
  return read[3] ?? read[4] ?? null;
}

/** 이 노드에서 갈라지는 길 이름들 — 나가는 조건들이 바라는 값에서 읽는다. */
function waysFrom(spec: AgentSpec, nodeId: string): string[] {
  const ways: string[] = [];
  for (const edge of spec.edges) {
    if (edge.source.node !== nodeId || !edge.condition) continue;
    const way = namedValue(edge.condition.expression, ROUTE);
    if (way !== null && !ways.includes(way)) ways.push(way);
  }
  return ways;
}

/**
 * 이 노드가 고를 수 있는 길들이 실제로 있는가 — 길을 고르는 성격의 노드만 길을 받는다.
 * 말하는 노드는 뒤에 길 이름을 보는 조건이 달려 있어도 길을 고르지 않는다 (engine P3-1).
 */
function offeredWays(spec: AgentSpec, node: SpecNode): boolean {
  return picksAWay(node) && waysFrom(spec, node.id).length > 0;
}

/** 이 턴이 도구를 시켰는가 — 시킨 것이 하나라도 있으면 그 말은 답이 아니다 (engine D5). */
function askedForATool(event: RunEvent): boolean {
  const calls = event.payload.tool_calls;
  return Array.isArray(calls) && calls.length > 0;
}

/**
 * 말하는 노드들이 낸 말 — 갈림길 봉투와 도구를 시킨 턴의 생각은 빼고, 일어난 순서 그대로.
 * 노드가 적히지 않았거나 그래프에 없는 노드의 말은 세지 않는다 (engine과 같은 규칙).
 */
export function spokenTexts(spec: AgentSpec, events: RunEvent[]): string[] {
  const byId = new Map(spec.nodes.map((node) => [node.id, node]));
  const said: string[] = [];
  for (const event of events) {
    if (event.event_type !== "llm.completed" || !event.node_id) continue;
    const node = byId.get(event.node_id);
    const text = event.payload.text;
    if (node === undefined || typeof text !== "string") continue;
    if (askedForATool(event)) continue;
    if (!offeredWays(spec, node)) said.push(text);
  }
  return said;
}
