// 도구를 든 연결과 그 도구를 실행하는 노드를 얹은 그래프 — 도구 포트를 보는 테스트가 함께 쓴다.
import type { AgentSpec } from "../src/generated/agent_spec";

export const TOOL_BINDING_ID = "clinical-reference";

export function withToolBinding(spec: AgentSpec, toolName = "lookup"): AgentSpec {
  return {
    ...spec,
    resources: [
      {
        id: TOOL_BINDING_ID,
        kind: "mcp.toolset",
        server_ref: "mcp://clinical-reference",
        approval_policy: "read_only_auto",
        tools: [
          {
            name: "lookup",
            plain_description: { ko: "찾아본다.", en: "Looks it up." },
            input_schema: { type: "object" },
            output_schema: { type: "string" },
            timeout_ms: 5000,
            call: { transport: "mcp", remote_name: "lookup" },
          },
        ],
      },
    ],
    nodes: [
      ...spec.nodes,
      {
        id: "tool",
        type: "tool.mcp",
        position: { x: 0, y: 0 },
        config: { resource_ref: TOOL_BINDING_ID, tool_name: toolName },
      },
    ],
  };
}
