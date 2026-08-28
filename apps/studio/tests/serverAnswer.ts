// 시험이 쓰는 가짜 서버의 말투 — 진짜 서버(pydantic)는 빠진 값을 null·빈 값으로 채워서 돌려준다.
// 가짜가 이 모양을 흉내 내지 않으면, 모양 차이 때문에 생기는 버그를 시험이 영영 못 본다.
// 이 모양은 examples/basic-agent/saved_spec.json에 못 박혀 있고 pytest가 같은 파일을 지킨다.
import type { AgentSpec } from "../src/generated/agent_spec";

/** 서버가 그래프 하나를 돌려줄 때의 모양 — 없던 자리도 빠짐없이 채워져 있다. */
export function asServerAnswer(spec: AgentSpec): AgentSpec {
  return {
    schema_version: spec.schema_version,
    id: spec.id,
    name: spec.name ?? null,
    version: spec.version,
    revision: spec.revision,
    status: spec.status,
    input_schema: spec.input_schema,
    state_schema: spec.state_schema,
    nodes: spec.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      config: node.config ?? {},
    })),
    edges: spec.edges.map((edge) => ({
      id: edge.id,
      kind: edge.kind,
      source: { node: edge.source.node, port: edge.source.port },
      target: { node: edge.target.node, port: edge.target.port },
      condition: edge.condition ?? null,
    })),
    resources: (spec.resources ?? []).map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      server_ref: resource.server_ref,
      allowed_tools: resource.allowed_tools ?? [],
      approval_policy: resource.approval_policy,
      // 도구의 처리 방법은 아무 말이 없으면 계약이 "통째로"라고 대신 적어 준다.
      tools: (resource.tools ?? []).map((tool) => ({
        ...tool,
        result_handling: tool.result_handling ?? { mode: "full" },
      })),
    })),
    execution: spec.execution ?? null,
  };
}
