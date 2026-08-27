// 무엇이 선택돼 있는지는 그래프 자체에 적혀 있다 — 별도의 selection 상태를 두지 않는다.
import type { FlowEdge, FlowGraph, FlowNode } from "./serialize";

export type SelectionKind = "node" | "edge";

function marked<T extends { id: string }>(items: T[], selectedId: string | null): T[] {
  return items.map((item) => ({ ...item, selected: item.id === selectedId }));
}

/** 노드 하나 또는 엣지 하나만 선택된 그래프를 돌려준다. */
export function withSelection(
  graph: FlowGraph,
  kind: SelectionKind,
  id: string,
): FlowGraph {
  return {
    nodes: marked(graph.nodes, kind === "node" ? id : null),
    edges: marked(graph.edges, kind === "edge" ? id : null),
  };
}

export function withoutSelection(graph: FlowGraph): FlowGraph {
  return { nodes: marked(graph.nodes, null), edges: marked(graph.edges, null) };
}

export function selectedNodeOf(graph: FlowGraph): FlowNode | undefined {
  return graph.nodes.find((node) => node.selected);
}

export function selectedEdgeOf(graph: FlowGraph): FlowEdge | undefined {
  return graph.edges.find((edge) => edge.selected);
}

/** 지금 선택된 노드에서 offset칸 떨어진 노드. 끝에서는 반대편으로 돌아온다. */
export function adjacentNodeId(graph: FlowGraph, offset: number): string | undefined {
  const { nodes } = graph;
  if (nodes.length === 0) return undefined;
  const current = nodes.findIndex((node) => node.selected);
  if (current === -1) return nodes[offset >= 0 ? 0 : nodes.length - 1].id;
  return nodes[(current + offset + nodes.length) % nodes.length].id;
}
