// 데이터가 흐르는 순서 — 누가 누구를 먹여 주는지로 노드를 줄 세운다 (순수 함수).
// 서로를 되먹이는 무리도 반드시 끝난다: 줄 세울 수 없는 노드는 맨 뒤 칸에 선다.

/** 줄을 세우는 데 필요한 것은 이름과 이어짐뿐이다 — 캔버스 그래프든 spec이든 같다. */
export interface OrderedGraph {
  nodes: { id: string }[];
  edges: { source: string; target: string }[];
}

/** 자기를 먹여 주는 노드가 몇 개인가 — 자기 자신과 없는 노드는 세지 않는다. */
function feederCounts(graph: OrderedGraph): Map<string, number> {
  const counts = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    if (edge.source === edge.target) continue;
    if (!counts.has(edge.source) || !counts.has(edge.target)) continue;
    counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
  }
  return counts;
}

/** 각 노드가 몇 번째 칸에 서는가. 줄 세울 수 없는 노드(서로 되먹이는 무리)는 맨 뒤 칸이다. */
export function stepOf(graph: OrderedGraph): Map<string, number> {
  const waiting = feederCounts(graph);
  const step = new Map<string, number>();
  let queue = graph.nodes.filter((node) => waiting.get(node.id) === 0).map((n) => n.id);
  for (const id of queue) step.set(id, 0);

  while (queue.length > 0) {
    const next: string[] = [];
    for (const id of queue) {
      for (const edge of graph.edges.filter((candidate) => candidate.source === id)) {
        const target = edge.target;
        if (target === id || !waiting.has(target)) continue;
        step.set(target, Math.max(step.get(target) ?? 0, (step.get(id) ?? 0) + 1));
        waiting.set(target, (waiting.get(target) ?? 0) - 1);
        if (waiting.get(target) === 0) next.push(target);
      }
    }
    queue = next;
  }

  const last = Math.max(-1, ...step.values()) + 1;
  for (const node of graph.nodes) {
    if (!step.has(node.id)) step.set(node.id, last);
  }
  return step;
}

/** 데이터가 닿는 순서대로 늘어놓은 노드 이름. 같은 칸에 선 노드는 적힌 순서를 지킨다. */
export function flowOrder(graph: OrderedGraph): string[] {
  const step = stepOf(graph);
  return graph.nodes
    .map((node, index) => ({ id: node.id, step: step.get(node.id) ?? 0, index }))
    .sort((a, b) => a.step - b.step || a.index - b.index)
    .map((placed) => placed.id);
}
