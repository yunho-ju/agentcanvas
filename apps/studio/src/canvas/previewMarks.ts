// 영향을 캔버스 위에 입힐 표시로 바꾼다 — 무엇이 나가고, 무엇이 데이터를 잃고, 무엇이 끊어지는가.
// 영향은 지금 이 그래프에서 다시 잰다: 그리는 사이에 그래프가 바뀌면 표시도 따라 바뀐다.
// 색은 거들 뿐이다: 같은 내용을 옆 패널이 글로도 말한다.
import { analyzeDetach } from "../graph/impact";
import type { FlowEdge, FlowGraph, FlowNode } from "../graph/serialize";

const GOING = "impact--going";
const STRANDED = "impact--stranded";
const BREAKING = "impact--breaking";

function withClass<T extends { id: string }>(item: T, className: string): T {
  return { ...item, className };
}

export function markedForPreview(
  graph: FlowGraph,
  pendingNodeId: string | null,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  if (pendingNodeId === null) return graph;

  const impact = analyzeDetach(graph, pendingNodeId);
  const stranded = new Set(impact.unreachableNodes.map((node) => node.id));
  const breaking = new Set(impact.brokenEdges.map((edge) => edge.id));
  return {
    nodes: graph.nodes.map((node) => {
      if (node.id === pendingNodeId) return withClass(node, GOING);
      return stranded.has(node.id) ? withClass(node, STRANDED) : node;
    }),
    edges: graph.edges.map((edge) =>
      breaking.has(edge.id) ? withClass(edge, BREAKING) : edge,
    ),
  };
}
