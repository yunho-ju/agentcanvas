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

/** 정리한 뒤 각 노드가 있어야 할 자리. */
export function arrangedPositions(graph: FlowGraph): PlacedNode[] {
  const step = stepOf(graph);
  const rows = new Map<number, number>();
  return graph.nodes.map((node) => {
    const column = step.get(node.id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return {
      id: node.id,
      position: { x: FIRST.x + column * STEP.x, y: FIRST.y + row * STEP.y },
    };
  });
}
