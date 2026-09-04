import type { AgentSpec } from "../generated/agent_spec";
import { skillRefs } from "../registry/registry";
import { fakeRun } from "../run/fakeRun";
import { nodeSetupIssues } from "../graph/nodeSetupIssues";
import { validateSpec } from "../graph/validateSpec";
import { nodeTypes } from "../registry/registry";

/** 이 초안에서 skill을 따르는 단계 하나 — 이름표가 아니라 사람이 읽을 이름으로 말한다. */
export interface StepWearingSkills {
  /** 그 단계를 이 문서에서 부르는 이름(노드 id) — 같은 종류의 두 단계를 가르는 유일한 이름 */
  node: string;
  skills: string[];
}

/**
 * 초안의 어느 단계가 무엇을 따르는가 (DESIGN §7 guided-architect-card 보강).
 * 문서에 없는 이름표는 여기 오지 않는다 — 서버가 이미 빼냈고, 남은 것은 검증이 말한다.
 */
export function stepsWearingSkills(spec: AgentSpec): StepWearingSkills[] {
  const names = new Map((spec.skills ?? []).map((skill) => [skill.ref, skill.name]));
  return spec.nodes.flatMap((node) => {
    const nodeType = nodeTypes[node.type];
    if (nodeType === undefined) return [];
    const worn = skillRefs(node, nodeType)
      .map((ref) => names.get(ref))
      .filter((name): name is string => name !== undefined);
    return worn.length === 0 ? [] : [{ node: node.id, skills: worn }];
  });
}

export const ARCHITECT_REVIEW_TIME = new Date("2026-01-01T00:00:00.000Z");

export interface ArchitectReviewCheck {
  passed: boolean;
  count: number;
}

export interface ArchitectReview {
  passed: boolean;
  schema: ArchitectReviewCheck;
  graph: ArchitectReviewCheck;
  dryRun: ArchitectReviewCheck;
  /** 초안이 적용된 뒤에도 사람이 채워야 하는 설정 칸 수 — 적용을 막지는 않는다. */
  toFill: number;
}

/** 초안의 노드들이 아직 기다리는 설정 칸 수 — 캔버스의 "설정 필요" 판정과 같은 규칙.
 *
 * 한 칸이 여러 이유로 어긋나도 채울 자리는 하나다 — 노드+필드 짝으로 센다. */
function fieldsToFill(spec: AgentSpec): number {
  const fields = spec.nodes.flatMap((node) =>
    nodeSetupIssues(node, nodeTypes[node.type], spec.skills ?? [], spec.resources ?? []).map(
      (issue) => `${node.id}/${issue.field}`,
    ),
  );
  return new Set(fields).size;
}

function graphProblems(spec: AgentSpec): number {
  const ids = new Set(spec.nodes.map((node) => node.id));
  const orphanEdges = spec.edges.filter(
    (edge) => !ids.has(edge.source.node) || !ids.has(edge.target.node),
  ).length;
  const reachable = new Set<string>();
  const queue = spec.nodes.filter((node) => node.type === "core.input").map((node) => node.id);
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of spec.edges) {
      if (edge.source.node === id && ids.has(edge.target.node)) queue.push(edge.target.node);
    }
  }
  const unreachableNodes = spec.nodes.filter((node) => !reachable.has(node.id)).length;
  const indegree = new Map(spec.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of spec.edges) {
    if (!ids.has(edge.source.node) || !ids.has(edge.target.node)) continue;
    indegree.set(edge.target.node, (indegree.get(edge.target.node) ?? 0) + 1);
    outgoing.set(edge.source.node, [...(outgoing.get(edge.source.node) ?? []), edge.target.node]);
  }
  const ready = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift() as string;
    visited += 1;
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) ready.push(target);
    }
  }
  const cycles = visited === ids.size ? 0 : 1;
  return orphanEdges + unreachableNodes + cycles;
}

export function reviewArchitectSpec(spec: AgentSpec): ArchitectReview {
  const schemaErrors = validateSpec(spec);
  const graphErrorCount = graphProblems(spec);
  const events = fakeRun(spec, { runId: `dry-run:${spec.id}`, startedAt: ARCHITECT_REVIEW_TIME });
  const dryRunPassed = events.some((event) => event.event_type === "run.completed");
  const result = {
    schema: { passed: schemaErrors.length === 0, count: schemaErrors.length },
    graph: { passed: graphErrorCount === 0, count: graphErrorCount },
    dryRun: { passed: dryRunPassed, count: dryRunPassed ? 1 : 0 },
    toFill: fieldsToFill(spec),
  } satisfies Omit<ArchitectReview, "passed">;
  return { ...result, passed: result.schema.passed && result.graph.passed && result.dryRun.passed };
}
