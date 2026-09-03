// 예시 문서에 도구 노드 하나를 더한 것.
// 예시 문서 안에서 종류를 정말로 가리는 받는 자리는 도구의 `input`(묶음)뿐이다 —
// AI 에이전트의 `messages`는 엔진이 state 전체를 넘기므로 무엇이든 받는다 (DESIGN §7 port-schema).
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";

export const example = exampleSpec as unknown as AgentSpec;

/** 이 문서에서 묶음만 받는 자리 — `${WANTS_BUNDLE}.input`. */
export const WANTS_BUNDLE = "reference-lookup";

/** 예시 문서 + 묶음만 받는 도구 노드 하나. */
export function exampleWithTool(): AgentSpec {
  return {
    ...example,
    nodes: [
      ...example.nodes,
      {
        id: WANTS_BUNDLE,
        type: "tool.mcp",
        position: { x: 900, y: 200 },
        config: { resource_ref: "clinical-reference", tool_name: "search_article" },
      },
    ],
  };
}
