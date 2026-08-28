// 이 편집이 무엇을 망가뜨리는가 — 편집을 실제로 하기 전에 답한다 (순수 함수).
// 도달성 규칙은 engine validator의 graph.unreachable_node와 같다:
// core.input 노드에서 연결을 따라 갈 수 있는 노드만 데이터가 닿는 노드다.
import type { Resources } from "../generated/agent_spec";
import { INPUT_NODE_TYPE, type JsonSchema } from "../registry/registry";
import { withNodeConfig } from "./config";
import type { FlowEdge, FlowGraph, FlowNode } from "./serialize";

export interface Impact {
  /** 이 편집으로 사라질 연결 */
  brokenEdges: FlowEdge[];
  /** 남아 있지만 더는 데이터가 닿지 않게 될 노드 */
  unreachableNodes: FlowNode[];
}

const NOTHING: Impact = { brokenEdges: [], unreachableNodes: [] };

export function breaksNothing(impact: Impact): boolean {
  return impact.brokenEdges.length === 0 && impact.unreachableNodes.length === 0;
}

function reachedIds(graph: FlowGraph): Set<string> {
  const present = new Set(graph.nodes.map((node) => node.id));
  const reached = new Set<string>();
  const stack = graph.nodes
    .filter((node) => node.data.spec.type === INPUT_NODE_TYPE)
    .map((node) => node.id);

  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (reached.has(current)) continue;
    reached.add(current);
    for (const edge of graph.edges) {
      if (edge.source === current && present.has(edge.target)) stack.push(edge.target);
    }
  }
  return reached;
}

/** 지금 그래프에서 바뀐 그래프로 갈 때 잃는 것. 이미 잃은 것은 이 편집의 탓이 아니다. */
export function impactBetween(before: FlowGraph, after: FlowGraph): Impact {
  const keptEdges = new Set(after.edges.map((edge) => edge.id));
  const reachedBefore = reachedIds(before);
  const reachedAfter = reachedIds(after);
  return {
    brokenEdges: before.edges.filter((edge) => !keptEdges.has(edge.id)),
    unreachableNodes: after.nodes.filter(
      (node) => reachedBefore.has(node.id) && !reachedAfter.has(node.id),
    ),
  };
}

/** 노드 하나를 빼면 무엇이 망가지는가. */
export function analyzeDetach(graph: FlowGraph, nodeId: string): Impact {
  if (!graph.nodes.some((node) => node.id === nodeId)) return NOTHING;
  return impactBetween(graph, {
    nodes: graph.nodes.filter((node) => node.id !== nodeId),
    edges: graph.edges.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    ),
  });
}

/** 노드의 설정을 바꾸면 무엇이 망가지는가 — 사라지는 포트에 걸린 연결까지 센다. */
export function analyzeConfigChange(
  graph: FlowGraph,
  nodeId: string,
  config: Record<string, unknown>,
  inputSchema?: JsonSchema,
  resources?: Resources,
): Impact {
  return impactBetween(
    graph,
    withNodeConfig(graph, nodeId, config, inputSchema, resources).graph,
  );
}
