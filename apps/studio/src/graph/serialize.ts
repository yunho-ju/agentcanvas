// 캔버스 상태 <-> AgentSpec. 계약에 없는 필드는 만들지 않는다.
import type {
  AgentSpec,
  Edge as SpecEdge,
  EdgeCondition,
  EdgeKind,
  Node1 as SpecNode,
} from "../generated/agent_spec";
import type { NodeType } from "../generated/node_type";
import { type ResolvedPorts, nodeTypes, resolvePorts } from "../registry/registry";
import type { EdgeFlowState, NodeRunStatus } from "../run/player";

export interface AgentNodeData extends Record<string, unknown> {
  spec: SpecNode;
  nodeType?: NodeType;
  ports: ResolvedPorts;
  /** 실행을 보는 동안 이 노드가 무엇을 하고 있는가 — 화면의 것이고 계약에는 없다 */
  runStatus?: NodeRunStatus;
  /** 마친 노드가 일하는 데 걸린 시간(ms) — 카드가 덧붙이는 하나뿐인 숫자 */
  runElapsedMs?: number;
  /** 끝내지 못한 이유 한 줄 */
  runError?: string;
}

export interface FlowNode {
  id: string;
  type: "agentNode";
  position: { x: number; y: number };
  data: AgentNodeData;
  selected?: boolean;
  /** 화면이 재어 준 카드의 크기 — 계약에는 없고, 줄을 맞출 때만 쓴다 */
  measured?: { width?: number; height?: number };
  /** 지금 화면에서만 입히는 표시 (예: 빼기 미리보기) — 계약에는 없다 */
  className?: string;
}

export interface FlowEdgeData extends Record<string, unknown> {
  kind: EdgeKind;
  condition?: EdgeCondition | null;
  /** 실행을 보는 동안 이 연결이 데이터를 나르고 있는가 — 화면의 것이고 계약에는 없다 */
  flowState?: EdgeFlowState;
  /** 나르던 값이 잠긴 밸브 앞에 고여 있는가 — 사람의 확인을 기다리는 동안이다 */
  held?: boolean;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  data: FlowEdgeData;
  selected?: boolean;
  /** 관을 그릴 줄 아는 연결 — 실행을 보는 동안에만 입힌다 */
  type?: "flow";
  /** 지금 화면에서만 입히는 표시 (예: 빼기 미리보기) — 계약에는 없다 */
  className?: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export function toFlow(spec: AgentSpec): FlowGraph {
  return {
    nodes: spec.nodes.map((node) => {
      const nodeType = nodeTypes[node.type];
      return {
        id: node.id,
        type: "agentNode" as const,
        position: { ...node.position },
        data: {
          spec: node,
          nodeType,
          ports: nodeType
            ? resolvePorts(node, nodeType, spec.input_schema, spec.resources)
            : { inputs: {}, outputs: {} },
        },
      };
    }),
    edges: spec.edges.map((edge) => ({
      id: edge.id,
      source: edge.source.node,
      sourceHandle: edge.source.port,
      target: edge.target.node,
      targetHandle: edge.target.port,
      data: edge.condition
        ? { kind: edge.kind, condition: edge.condition }
        : { kind: edge.kind },
    })),
  };
}

/**
 * 캔버스에서 돌아온 그래프를 원본 spec 위에 얹는다.
 * revision은 프론트에서 계산하지 않는다 — TODO: 저장 API가 계산해 돌려준다.
 */
export function toSpec(base: AgentSpec, flow: FlowGraph): AgentSpec {
  return {
    ...base,
    nodes: flow.nodes.map((node) => ({
      ...node.data.spec,
      position: { ...node.position },
    })),
    edges: flow.edges.map(toSpecEdge),
  };
}

/**
 * 서버가 돌려준 그래프를 화면이 쓰는 표현으로 옮긴다.
 * 서버(pydantic)는 비어 있는 자리도 null로 채워 보내고 화면은 그런 자리를 아예 만들지 않는다 —
 * 같은 말로 옮겨 두지 않으면 방금 받은 그래프를 두고 "달라졌다"고 잘못 말하게 된다.
 * 서버가 매긴 판·revision·이름은 그대로 남는다 (그것이 서버의 권위다).
 */
export function asCanvasWouldWriteIt(saved: AgentSpec): AgentSpec {
  return toSpec(saved, toFlow(saved));
}

function toSpecEdge(edge: FlowEdge): SpecEdge {
  const specEdge: SpecEdge = {
    id: edge.id,
    kind: edge.data.kind,
    source: { node: edge.source, port: edge.sourceHandle },
    target: { node: edge.target, port: edge.targetHandle },
  };
  return edge.data.condition
    ? { ...specEdge, condition: edge.data.condition }
    : specEdge;
}
