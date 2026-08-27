import type { AgentSpec } from "../generated/agent_spec";
import { fakeRun } from "../run/fakeRun";
import { validateSpec } from "../graph/validateSpec";

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

export function makeArchitectSpec(request: string, draftId: string): AgentSpec {
  return {
    schema_version: "agent.spec/v1",
    id: draftId,
    version: 1,
    revision: `sha256:${"0".repeat(64)}`,
    status: "draft",
    input_schema: {
      type: "object",
      required: ["request"],
      properties: { request: { type: "string" } },
    },
    state_schema: { type: "object", properties: { answer: { type: "string" } } },
    nodes: [
      { id: "core-input", type: "core.input", position: { x: 0, y: 0 }, config: { bindings: { request: "input.request" } } },
      { id: "llm-router", type: "llm.router", position: { x: 280, y: 0 }, config: { instruction: request, model_ref: "model://default" } },
      { id: "llm-agent", type: "llm.agent", position: { x: 560, y: 0 }, config: { instruction: request, model_ref: "model://default" } },
      { id: "core-output", type: "core.output", position: { x: 840, y: 0 }, config: { binding: "state.answer" } },
    ],
    edges: [
      { id: "edge-input-router", kind: "data", source: { node: "core-input", port: "request" }, target: { node: "llm-router", port: "input" } },
      { id: "edge-router-agent", kind: "control", source: { node: "llm-router", port: "passthrough" }, target: { node: "llm-agent", port: "messages" } },
      { id: "edge-agent-output", kind: "data", source: { node: "llm-agent", port: "response" }, target: { node: "core-output", port: "input" } },
    ],
  };
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
  } satisfies Omit<ArchitectReview, "passed">;
  return { ...result, passed: result.schema.passed && result.graph.passed && result.dryRun.passed };
}
