// 실행의 한 순간을 캔버스 위의 표시로 바꾼다 — 실행을 보는 동안에만 입힌다.
// 표시는 화면의 것이다: 편집 기록에도, AgentSpec에도 남지 않는다.
import type { NodeType } from "../generated/node_type";
import type { FlowGraph } from "../graph/serialize";
import type { EdgeFlowState, NodeRunFact } from "./player";

/**
 * 이 노드가 몇 번까지 도구를 부르며 시도할 수 있는가 — 문서가 적은 값,
 * 안 적었거나 계약이 막는 값이면 계약의 기본값(registry `max_turns.default`).
 * 화면은 숫자를 따로 적어 두지 않는다: 모르면 없음이다(지어내지 않는다).
 */
function maxTurns(
  config: Record<string, unknown> | undefined,
  nodeType: NodeType | undefined,
): number | undefined {
  const told = config?.max_turns;
  if (typeof told === "number" && Number.isInteger(told) && told >= 1) return told;
  const field = (nodeType?.config_schema.properties as Record<string, unknown> | undefined)
    ?.max_turns;
  const fallback = (field as { default?: unknown } | undefined)?.default;
  return typeof fallback === "number" ? fallback : undefined;
}

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
      const max = maxTurns(node.data.spec.config, node.data.nodeType);
      return {
        ...node,
        className: `run--${fact.status}`,
        data: {
          ...node.data,
          runStatus: fact.status,
          ...(fact.elapsedMs !== undefined ? { runElapsedMs: fact.elapsedMs } : {}),
          ...(fact.error ? { runError: fact.error } : {}),
          ...(fact.turn !== undefined
            ? { runTurn: fact.turn, ...(max !== undefined ? { runMaxTurns: max } : {}) }
            : {}),
          ...(fact.closing ? { runClosing: true } : {}),
          ...(fact.closedEarly ? { runClosedEarly: true } : {}),
        },
      };
    }),
  };
}
