// config가 바뀌면 포트가 바뀐다 — 그 여파(사라진 포트에 걸린 연결)를 결과로 돌려주는 순수 함수.
import type { JsonSchema } from "../registry/registry";
import { nodeTypes, resolvePorts } from "../registry/registry";
import type { FlowEdge, FlowGraph, FlowNode } from "./serialize";

export interface ConfigChange {
  graph: FlowGraph;
  /** 포트가 사라져 더는 존재할 수 없는 연결 */
  removedEdges: FlowEdge[];
}

function reconfigured(node: FlowNode, config: Record<string, unknown>, inputSchema?: JsonSchema): FlowNode {
  const spec = { ...node.data.spec, config };
  const nodeType = node.data.nodeType ?? nodeTypes[spec.type];
  return {
    ...node,
    data: {
      ...node.data,
      spec,
      // 모르는 노드 타입의 포트는 우리가 다시 계산할 수 없다 — 있던 포트를 그대로 둔다.
      ports: nodeType ? resolvePorts(spec, nodeType, inputSchema) : node.data.ports,
    },
  };
}

function stillConnected(edge: FlowEdge, node: FlowNode): boolean {
  const { inputs, outputs } = node.data.ports;
  if (edge.source === node.id && !(edge.sourceHandle in outputs)) return false;
  if (edge.target === node.id && !(edge.targetHandle in inputs)) return false;
  return true;
}

/** 노드 하나의 config를 바꾸고, 그 때문에 끊어지는 연결을 함께 알려준다. */
export function withNodeConfig(
  graph: FlowGraph,
  id: string,
  config: Record<string, unknown>,
  inputSchema?: JsonSchema,
): ConfigChange {
  const target = graph.nodes.find((node) => node.id === id);
  if (!target) return { graph, removedEdges: [] };

  const next = reconfigured(target, config, inputSchema);
  const removedEdges = graph.edges.filter((edge) => !stillConnected(edge, next));
  return {
    graph: {
      nodes: graph.nodes.map((node) => (node.id === id ? next : node)),
      edges: graph.edges.filter((edge) => stillConnected(edge, next)),
    },
    removedEdges,
  };
}
