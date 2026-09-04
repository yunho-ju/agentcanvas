// 캔버스 위의 노드·연결을 바꾸는 편집들. 모두 순수하다 — 예외를 던지지 않는다.
import type { AgentSpec, Resources } from "../generated/agent_spec";
import { withNodeConfig } from "../graph/config";
import { analyzeConfigChange, breaksNothing } from "../graph/impact";
import { impactLines } from "../graph/impactWords";
import type { Scene } from "../graph/scene";
import { settingsChanged } from "../graph/patternWords";
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

/**
 * 카탈로그의 모양 하나를 문서에 놓는다 (설계 문서 D12).
 * 카드도 선도 설정도 사용자에게는 한 번의 행동이었으므로 되돌리기도 한 걸음이다 —
 * 무엇을 놓을지는 이미 정해져 온다(graph/patternPut.ts).
 */
export function putPattern(before: Scene, put: Scene): Command {
  // 카드도 선도 늘지 않는 모양은 바뀐 칸을 말해 주지 않으면 아무 일도 없던 것처럼 보인다.
  const changed = settingsChanged(before, put);
  return {
    label: msg("edit.putPattern"),
    ...(changed
      ? { notice: msg("edit.pattern.notice", { id: changed.id, fields: changed.fields }) }
      : {}),
    apply: (current) => ({ ...current, nodes: put.nodes, edges: put.edges }),
    revert: (current) => ({ ...current, nodes: before.nodes, edges: before.edges }),
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

/** 이 편집 앞뒤로 문서가 받기로 한 값의 모양 — 모양이 바뀌지 않는 편집이면 둘이 같다. */
interface InputShapes {
  was?: JsonSchema;
  now?: JsonSchema;
}

/** 설정을 바꾸는 편집 하나 — 문서의 모양이 함께 바뀌든 아니든 판정과 되돌림은 이 자리다. */
function configEdit(
  graph: Scene,
  id: string,
  config: Record<string, unknown>,
  shapes: InputShapes,
  resources?: Resources,
  options: EditOptions = {},
): Command {
  const inputSchema = shapes.now;
  const previous = graph.nodes.find((node) => node.id === id);
  // 설정을 바꾸는 것도 무언가를 빼는 일이다 — 노드를 뺄 때와 같은 잣대로 영향을 잰다.
  const impact = analyzeConfigChange(graph, id, config, inputSchema, resources, shapes.was);
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
      ...withNodeConfig(current, id, config, inputSchema, resources, shapes.was).graph,
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

export function changeNodeConfig(
  graph: Scene,
  id: string,
  config: Record<string, unknown>,
  inputSchema?: JsonSchema,
  resources?: Resources,
  options: EditOptions = {},
): Command {
  // 문서가 받기로 한 값의 모양은 이 편집이 건드리지 않는다 — 앞뒤가 같다.
  return configEdit(graph, id, config, { was: inputSchema, now: inputSchema }, resources, options);
}

/**
 * 입력 노드가 받는 줄을 고친다 — 받는 자리(config)와 문서가 적어 둔 모양(input_schema)이
 * 한 걸음에 함께 바뀌고 함께 돌아온다 (DESIGN §7 input-rows).
 * 무엇이 끊어지는지 재고 말하는 일은 설정을 바꿀 때 쓰던 그 자리의 답이다 — 새 판정을 만들지 않는다.
 */
export function changeInputRows(
  graph: Scene,
  id: string,
  config: Record<string, unknown>,
  inputSchema: JsonSchema,
  resources?: Resources,
): Command {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (!node) return doNothing;
  const wasSchema = graph.input_schema;
  const same =
    changedFields(node.data.spec.config ?? {}, config).length === 0 &&
    JSON.stringify(wasSchema) === JSON.stringify(inputSchema);
  if (same) return doNothing;

  const change = configEdit(
    graph,
    id,
    config,
    { was: wasSchema, now: inputSchema },
    resources,
  );
  return {
    ...change,
    apply: (current) => ({ ...change.apply(current), input_schema: inputSchema }),
    revert: (current) => ({ ...change.revert(current), input_schema: wasSchema }),
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
