// config가 바뀌면 포트가 바뀐다 — 그 여파(사라진 포트, 모양이 어긋난 포트에 걸린 연결)를
// 결과로 돌려주는 순수 함수.
import type { Resources } from "../generated/agent_spec";
import type { JsonSchema } from "../registry/registry";
import { nodeTypes, resolvePorts } from "../registry/registry";
import { type ConnectableSpec, checkConnection } from "./connection";
import type { FlowEdge, FlowGraph, FlowNode } from "./serialize";

export interface ConfigChange {
  graph: FlowGraph;
  /** 포트가 사라져 더는 존재할 수 없는 연결 */
  removedEdges: FlowEdge[];
}

function reconfigured(
  node: FlowNode,
  config: Record<string, unknown>,
  inputSchema?: JsonSchema,
  resources?: Resources,
): FlowNode {
  const spec = { ...node.data.spec, config };
  const nodeType = node.data.nodeType ?? nodeTypes[spec.type];
  return {
    ...node,
    data: {
      ...node.data,
      spec,
      // 모르는 노드 타입의 포트는 우리가 다시 계산할 수 없다 — 있던 포트를 그대로 둔다.
      ports: nodeType
        ? resolvePorts(spec, nodeType, inputSchema, resources)
        : node.data.ports,
    },
  };
}

/**
 * 연결 규칙을 물어볼 수 있을 만큼의 문서 — 노드와 값의 모양만 있으면 된다.
 * edges를 비워 둔다: 이미 그어진 연결에게 "돌아오는 길이냐"고 다시 묻지 않는다.
 */
function asSpec(
  nodes: FlowNode[],
  inputSchema?: JsonSchema,
  resources?: Resources,
): ConnectableSpec {
  return {
    nodes: nodes.map((node) => node.data.spec),
    edges: [],
    input_schema: inputSchema ?? {},
    ...(resources ? { resources } : {}),
  };
}

function endpoints(edge: FlowEdge) {
  return [
    { node: edge.source, port: edge.sourceHandle },
    { node: edge.target, port: edge.targetHandle },
  ] as const;
}

/**
 * 이 편집을 하고도 이 연결이 남아 있을 수 있는가.
 * 포트가 사라졌으면 남을 수 없고, 남았어도 값의 모양이 어긋나면 그을 수 없는 연결이다.
 * 판정은 새로 쓰지 않는다 — 그을 때 쓰는 `checkConnection`에게 그대로 묻는다.
 * 바뀐 노드가 여럿일 수 있다(연결을 다시 가져오면 그 연결을 쓰던 노드가 모두 바뀐다).
 */
function stillConnected(
  edge: FlowEdge,
  changed: FlowNode[],
  before: ConnectableSpec,
  after: ConnectableSpec,
): boolean {
  const touched = changed.filter(
    (node) => edge.source === node.id || edge.target === node.id,
  );
  if (touched.length === 0) return true;
  for (const node of touched) {
    const { inputs, outputs } = node.data.ports;
    if (edge.source === node.id && !(edge.sourceHandle in outputs)) return false;
    if (edge.target === node.id && !(edge.targetHandle in inputs)) return false;
  }

  const [source, target] = endpoints(edge);
  if (checkConnection(after, source, target).ok) return true;
  // 이미 어긋나 있던 연결은 이 편집의 탓이 아니다 — 남의 잘못으로 지우지 않는다.
  return !checkConnection(before, source, target).ok;
}

/** 노드 하나의 config를 바꾸고, 그 때문에 끊어지는 연결을 함께 알려준다. */
export function withNodeConfig(
  graph: FlowGraph,
  id: string,
  config: Record<string, unknown>,
  inputSchema?: JsonSchema,
  resources?: Resources,
): ConfigChange {
  const target = graph.nodes.find((node) => node.id === id);
  if (!target) return { graph, removedEdges: [] };

  const next = reconfigured(target, config, inputSchema, resources);
  const nodes = graph.nodes.map((node) => (node.id === id ? next : node));
  const before = asSpec(graph.nodes, inputSchema, resources);
  const after = asSpec(nodes, inputSchema, resources);
  const kept = (edge: FlowEdge) => stillConnected(edge, [next], before, after);
  return {
    graph: { nodes, edges: graph.edges.filter(kept) },
    removedEdges: graph.edges.filter((edge) => !kept(edge)),
  };
}

/**
 * 연결(spec.resources) 하나를 갈아 끼우고, 그 때문에 끊어지는 연결선을 함께 알려준다.
 * 그 연결을 쓰던 노드의 포트는 새 도구의 모양으로 다시 그려진다. 판정은 설정을 바꿀 때와
 * 같은 자리(`stillConnected` → `checkConnection`)의 답이다 — 새 규칙을 만들지 않는다.
 */
export function withSwappedConnection(
  graph: FlowGraph,
  usedBy: string[],
  before: Resources,
  after: Resources,
  inputSchema?: JsonSchema,
): ConfigChange {
  const changed = graph.nodes
    .filter((node) => usedBy.includes(node.id))
    .map((node) => reconfigured(node, node.data.spec.config ?? {}, inputSchema, after));
  if (changed.length === 0) return { graph, removedEdges: [] };

  const fresh = new Map(changed.map((node) => [node.id, node]));
  const nodes = graph.nodes.map((node) => fresh.get(node.id) ?? node);
  const kept = (edge: FlowEdge) =>
    stillConnected(
      edge,
      changed,
      asSpec(graph.nodes, inputSchema, before),
      asSpec(nodes, inputSchema, after),
    );
  return {
    graph: { nodes, edges: graph.edges.filter(kept) },
    removedEdges: graph.edges.filter((edge) => !kept(edge)),
  };
}
