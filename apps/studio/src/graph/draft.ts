// 아직 없던 것을 계약에 맞게 지어 내는 자리 — 빈 초안과 갓 놓인 노드.
// 팔레트에서 놓든 피커에서 고르든 새 노드의 모습은 하나다.
import type { AgentSpec } from "../generated/agent_spec";
import type { NodeType } from "../generated/node_type";
import { resolvePorts } from "../registry/registry";
import { uniqueId } from "./ids";
import type { FlowNode } from "./serialize";

/** 새 초안이 받을 이름을 짓는다 — 무작위는 순수한 자리 밖, 여기에만 있다. */
export function randomDraftId(): string {
  return `draft-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
}

/**
 * 아직 아무 파일도 열지 않았을 때 쓰는 빈 초안.
 * 이름은 밖에서 지어 받는다 — 초안마다 이름이 달라야 나중에 만든 것이 앞의 것을 덮지 않는다.
 * revision은 프론트가 계산하지 않으므로 placeholder다 (판을 매기는 권위는 서버에 있다).
 */
export function newDraftSpec(makeId: () => string): AgentSpec {
  return {
    schema_version: "agent.spec/v1",
    id: makeId(),
    version: 1,
    revision: `sha256:${"0".repeat(64)}`,
    status: "draft",
    input_schema: { type: "object", properties: {} },
    state_schema: { type: "object", properties: {} },
    nodes: [],
    edges: [],
  };
}

/** 갓 놓인 노드. config는 비어 있다 — 값 입력은 inspector 몫이다. */
export function newNode(
  nodeType: NodeType,
  position: { x: number; y: number },
  taken: string[],
): FlowNode {
  const id = uniqueId(nodeType.type.split(".").pop() ?? nodeType.type, taken);
  const spec = { id, type: nodeType.type, position, config: {} };
  return {
    id,
    type: "agentNode" as const,
    position,
    data: { spec, nodeType, ports: resolvePorts(spec, nodeType) },
  };
}
