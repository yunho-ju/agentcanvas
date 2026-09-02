// 캔버스 정리 — 데이터가 흐르는 방향대로 왼쪽에서 오른쪽으로 줄을 세운다 (순수 함수).
// 같은 그래프는 언제나 같은 자리에 놓인다. 줄 세우는 규칙 자체는 graph/order에 있다.
import { stepOf } from "./order";
import type { FlowGraph, FlowNode } from "./serialize";

export interface PlacedNode {
  id: string;
  position: FlowNode["position"];
}

const FIRST = { x: 80, y: 80 };
const STEP = { x: 320, y: 180 };

function cell(column: number, row: number): FlowNode["position"] {
  return { x: FIRST.x + column * STEP.x, y: FIRST.y + row * STEP.y };
}

/** 정리한 뒤 각 노드가 있어야 할 자리. 아무와도 이어지지 않은 노드는 마지막 열 뒤에 한 줄로 선다. */
export function arrangedPositions(graph: FlowGraph): PlacedNode[] {
  const step = stepOf(graph);
  const linked = new Set(graph.edges.flatMap((edge) => [edge.source, edge.target]));
  const afterLast =
    Math.max(
      -1,
      ...graph.nodes.filter((node) => linked.has(node.id)).map((node) => step.get(node.id) ?? 0),
    ) + 1;
  const rows = new Map<number, number>();
  let loose = 0;
  return graph.nodes.map((node) => {
    // 흐름의 단계가 없는 노드는 세로로 쌓지 않는다 — 첫 줄에서 오른쪽으로 이어 세운다.
    if (!linked.has(node.id)) {
      return { id: node.id, position: cell(afterLast + loose++, 0) };
    }
    const column = step.get(node.id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { id: node.id, position: cell(column, row) };
  });
}
