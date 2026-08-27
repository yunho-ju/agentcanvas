// 지금 시험받는 지시문 — spec의 노드 config를 읽어 화면에 투영한다 (DESIGN §7 eval-prompt-card).
// 순수 함수다: 원본은 노드 config의 instruction 하나뿐이고, 여기서 사본을 만들지 않는다.
import type { AgentSpec, Node1 as SpecNode } from "../generated/agent_spec";
import type { LocalizedText, NodeType } from "../generated/node_type";

/** 지시문을 가진 노드 하나의 투영 — 이름은 node-list와 같은 원천(registry display_name)이다. */
export interface PromptUnderTest {
  nodeId: string;
  displayName: LocalizedText;
  instruction: string;
}

/** 이 노드 타입이 지시문을 가질 수 있는가 — registry의 config_schema가 답한다(타입 이름이 아니라). */
function schemaHasInstruction(nodeType: NodeType): boolean {
  const properties = nodeType.config_schema.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return false;
  }
  return "instruction" in (properties as Record<string, unknown>);
}

/** 아직 아무 말도 적지 않은 지시문은 빈 글이다 — 없는 것과 같은 자리에서 같은 말을 한다. */
function instructionOf(node: SpecNode): string {
  const instruction = node.config?.instruction;
  return typeof instruction === "string" ? instruction : "";
}

/** 이 문서가 지금 시험받는 지시문들 — 지시문을 가질 수 있는 노드가 없으면 빈 목록이다. */
export function promptsUnderTest(
  spec: AgentSpec,
  registry: Record<string, NodeType>,
): PromptUnderTest[] {
  return spec.nodes.flatMap((node) => {
    const nodeType = registry[node.type];
    if (!nodeType || !schemaHasInstruction(nodeType)) return [];
    return [
      {
        nodeId: node.id,
        displayName: nodeType.display_name,
        instruction: instructionOf(node),
      },
    ];
  });
}
