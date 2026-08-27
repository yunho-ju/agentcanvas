// 지금 잡고 있는 포트를 받아 줄 자리가 캔버스에 있는가 (C5).
// 이을 수 있는지는 계약이 정한다 — 여기에는 새 판정 규칙이 없고, checkConnection에게 물을 뿐이다.
import type { AgentSpec } from "../generated/agent_spec";
import type { NodeType } from "../generated/node_type";
import { checkConnection } from "../graph/connection";
import { nodeTypes, resolvePorts } from "../registry/registry";
import type { PortAddress } from "./portLink";

/** 끌고 있는 포트가 지금 이 그래프에서 이을 수 있는 자리들. 없으면 빈 목록. */
export function landingPorts(
  spec: AgentSpec,
  from: PortAddress,
  registry: Record<string, NodeType> = nodeTypes,
): PortAddress[] {
  const side = from.side === "source" ? "inputs" : "outputs";
  const held = { node: from.nodeId, port: from.portId };

  return spec.nodes.flatMap((node) => {
    // 제 노드의 다른 포트로는 잇지 않는다 (portLink와 같은 규칙).
    if (node.id === from.nodeId) return [];
    const nodeType = registry[node.type];
    if (!nodeType) return [];

    return Object.keys(resolvePorts(node, nodeType, spec.input_schema)[side]).flatMap(
      (portId) => {
        const theirs = { node: node.id, port: portId };
        const [source, target] = from.side === "source" ? [held, theirs] : [theirs, held];
        if (!checkConnection(spec, source, target, registry).ok) return [];
        return [
          {
            nodeId: node.id,
            portId,
            side: from.side === "source" ? ("target" as const) : ("source" as const),
          },
        ];
      },
    );
  });
}
