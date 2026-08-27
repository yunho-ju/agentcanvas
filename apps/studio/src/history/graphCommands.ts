// 캔버스 위의 노드·연결을 바꾸는 편집들. 모두 순수하다 — 예외를 던지지 않는다.
import type { AgentSpec } from "../generated/agent_spec";
import { withNodeConfig } from "../graph/config";
import { analyzeConfigChange, breaksNothing } from "../graph/impact";
import { impactLines } from "../graph/impactWords";
import type { Scene } from "../graph/scene";
import { msg } from "../i18n/messages";
import { type FlowEdge, type FlowEdgeData, type FlowNode, toFlow } from "../graph/serialize";
import type { JsonSchema } from "../registry/registry";
import { type Command, doNothing } from "./command";
import { placed, restored, withoutNode } from "./sceneParts";

export interface Position {
  x: number;
  y: number;
}

export interface NodeMove {
  id: string;
  from: Position;
  to: Position;
}

function withPositions(graph: Scene, moves: NodeMove[], side: "from" | "to"): Scene {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const move = moves.find((candidate) => candidate.id === node.id);
      return move ? { ...node, position: { ...move[side] } } : node;
    }),
  };
}

function withEdgeData(graph: Scene, id: string, data: FlowEdgeData): Scene {
  return {
    ...graph,
    edges: graph.edges.map((edge) => (edge.id === id ? { ...edge, data } : edge)),
  };
}

export function addNode(node: FlowNode): Command {
  return {
    label: msg("edit.addNode"),
    apply: (scene) => ({ ...scene, nodes: [...scene.nodes, node] }),
    revert: (scene) => withoutNode(scene, node.id),
  };
}

export function addEdge(edge: FlowEdge): Command {
  return {
    label: msg("edit.addEdge"),
    apply: (graph) => ({ ...graph, edges: [...graph.edges, edge] }),
    revert: (graph) => ({
      ...graph,
      edges: graph.edges.filter((candidate) => candidate.id !== edge.id),
    }),
  };
}

/**
 * 노드를 놓으면서 곧바로 이어 붙인다 (피커에서 고른 노드).
 * 놓기와 잇기는 사용자에게 한 번의 행동이었으므로 되돌리기도 한 걸음이다.
 */
export function addNodeWithEdge(node: FlowNode, edge: FlowEdge): Command {
  return {
    label: msg("edit.addLinkedNode"),
    apply: (scene) => ({
      ...scene,
      nodes: [...scene.nodes, node],
      edges: [...scene.edges, edge],
    }),
    revert: (scene) => withoutNode(scene, node.id),
  };
}

/** 노드와 연결을 지운다. 노드에 걸려 있던 연결은 함께 지워지고 함께 돌아온다. */
export function removeParts(
  graph: Scene,
  ids: { nodes?: string[]; edges?: string[] },
): Command {
  const nodeIds = ids.nodes ?? [];
  const edgeIds = [
    ...(ids.edges ?? []),
    ...graph.edges
      .filter((edge) => nodeIds.includes(edge.source) || nodeIds.includes(edge.target))
      .map((edge) => edge.id),
  ];
  const removedNodes = placed(graph.nodes, nodeIds);
  const removedEdges = placed(graph.edges, edgeIds);

  return {
    label: nodeIds.length > 0 ? msg("edit.removeNode") : msg("edit.removeEdge"),
    apply: (current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !nodeIds.includes(node.id)),
      edges: current.edges.filter((edge) => !edgeIds.includes(edge.id)),
    }),
    revert: (current) => ({
      ...current,
      nodes: restored(current.nodes, removedNodes),
      edges: restored(current.edges, removedEdges),
    }),
  };
}

/** 두 그래프가 같은 그래프인가 — 놓인 자리와 설정까지 같아야 같다. */
function sameGraph(one: AgentSpec, other: AgentSpec): boolean {
  return (
    JSON.stringify([one.nodes, one.edges]) === JSON.stringify([other.nodes, other.edges])
  );
}

/**
 * 지난 실행이 돌던 그래프를 지금 캔버스에 그대로 앉힌다 ("이쪽으로 계속").
 * 이미 그 그래프라면 채택은 편집이 아니다 — 되돌릴 걸음을 만들지 않는다.
 */
export function adoptSpec(scene: Scene, now: AgentSpec, adopted: AgentSpec): Command {
  if (sameGraph(now, adopted)) return doNothing;
  const next = toFlow(adopted);
  return {
    label: msg("edit.adoptRun"),
    apply: (current) => ({ ...current, nodes: next.nodes, edges: next.edges }),
    // 되돌리면 채택하기 직전의 캔버스가 그대로 돌아온다.
    revert: (current) => ({ ...current, nodes: scene.nodes, edges: scene.edges }),
  };
}

export function moveNodes(moves: NodeMove[]): Command {
  return {
    label: msg("edit.moveNodes"),
    apply: (graph) => withPositions(graph, moves, "to"),
    revert: (graph) => withPositions(graph, moves, "from"),
  };
}

/** 두 설정 사이에서 실제로 달라진 필드 이름들. */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

/**
 * 이어지는 편집을 한 걸음으로 합쳐도 되는가.
 * 글자는 이어 적히므로 합치고(기본), 목록에서 고르는 일은 고를 때마다 제 걸음이다.
 */
export interface EditOptions {
  merge?: boolean;
}

export function changeNodeConfig(
  graph: Scene,
  id: string,
  config: Record<string, unknown>,
  inputSchema?: JsonSchema,
  options: EditOptions = {},
): Command {
  const previous = graph.nodes.find((node) => node.id === id);
  // 설정을 바꾸는 것도 무언가를 빼는 일이다 — 노드를 뺄 때와 같은 잣대로 영향을 잰다.
  const impact = analyzeConfigChange(graph, id, config, inputSchema);
  const removedEdges = placed(
    graph.edges,
    impact.brokenEdges.map((edge) => edge.id),
  );

  const changed = changedFields(previous?.data.spec.config ?? {}, config);
  const previousData = previous?.data;

  return {
    label: msg("edit.changeConfig"),
    ...(breaksNothing(impact)
      ? {}
      : {
          notice: msg("edit.config.notice", {
            id,
            impact: impactLines(impact, "did"),
          }),
        }),
    // 한 필드만 고친 편집끼리만 합친다 — 여러 필드가 한꺼번에 바뀌면 별개의 걸음이다.
    // 연결을 끊은 편집은 합치지 않는다: 합친 걸음은 앞 편집만 되돌리므로 뒤에서 끊긴 연결이 영영 사라진다.
    ...(options.merge !== false && changed.length === 1 && breaksNothing(impact)
      ? { mergeKey: `config:${id}:${changed[0]}` }
      : {}),
    apply: (current) => ({
      ...current,
      ...withNodeConfig(current, id, config, inputSchema).graph,
    }),
    revert: (current) => ({
      ...current,
      // 노드는 그대로 두고 설정과 포트만 되돌린다 — 지금의 선택과 위치는 화면의 것이다.
      nodes: previousData
        ? current.nodes.map((node) =>
            node.id === id ? { ...node, data: previousData } : node,
          )
        : current.nodes,
      edges: restored(current.edges, removedEdges),
    }),
  };
}

export function changeEdgeData(
  graph: Scene,
  id: string,
  data: FlowEdgeData,
): Command {
  const previous = graph.edges.find((edge) => edge.id === id)?.data;
  // 조건식은 한 글자씩 쳐서 만들어진다 — 종류 바꾸기와 달리 한 걸음으로 합친다.
  const onlyCondition = previous !== undefined && previous.kind === data.kind;
  return {
    label: msg("edit.changeEdge"),
    ...(onlyCondition ? { mergeKey: `edge:${id}:condition` } : {}),
    apply: (current) => withEdgeData(current, id, data),
    revert: (current) => (previous ? withEdgeData(current, id, previous) : current),
  };
}
