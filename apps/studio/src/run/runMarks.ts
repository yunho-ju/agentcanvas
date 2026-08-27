// 실행의 한 순간을 캔버스 위의 표시로 바꾼다 — 실행을 보는 동안에만 입힌다.
// 표시는 화면의 것이다: 편집 기록에도, AgentSpec에도 남지 않는다.
import type { FlowGraph } from "../graph/serialize";
import type { EdgeFlowState, NodeRunFact } from "./player";

export function markedForRun(
  graph: FlowGraph,
  facts: Record<string, NodeRunFact>,
  flows: Record<string, EdgeFlowState>,
): FlowGraph {
  return {
    ...graph,
    // 관은 캔버스에만 있다 — 연결이 무엇을 나르는지는 화면의 표시일 뿐 계약에 남지 않는다.
    edges: graph.edges.map((edge) => {
      const flowState = flows[edge.id] ?? "idle";
      // 사람의 확인을 기다리는 노드 앞에서는 값이 고인다 — 관은 나르는 중인 채로 멈춘다.
      const held = facts[edge.target]?.status === "waiting";
      return {
        ...edge,
        type: "flow" as const,
        className: held ? `pipe--${flowState} pipe--held` : `pipe--${flowState}`,
        data: { ...edge.data, flowState, ...(held ? { held } : {}) },
      };
    }),
    nodes: graph.nodes.map((node) => {
      // 실행이 아직 닿지 않은 노드도 "아직 차례가 아니다"라고 말한다.
      const fact = facts[node.id] ?? { status: "idle" as const };
      return {
        ...node,
        className: `run--${fact.status}`,
        data: {
          ...node.data,
          runStatus: fact.status,
          ...(fact.elapsedMs !== undefined ? { runElapsedMs: fact.elapsedMs } : {}),
          ...(fact.error ? { runError: fact.error } : {}),
        },
      };
    }),
  };
}
