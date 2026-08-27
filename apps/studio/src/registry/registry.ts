// Python `agentcanvas_contracts.node_registry`의 TS 미러.
// 노드 타입·포트는 여기서만 나온다 — 프론트에 하드코딩하지 않는다 (설계 원칙 §4.2).
import registryData from "../../../../packages/contracts/json_schema/node_registry.json";
import type { Node1 as SpecNode } from "../generated/agent_spec";
import type { NodeType, PortSpec } from "../generated/node_type";

export type JsonSchema = Record<string, unknown>;

export interface ResolvedPorts {
  inputs: Record<string, PortSpec>;
  outputs: Record<string, PortSpec>;
}

export const INPUT_NODE_TYPE = "core.input";

export const nodeTypes: Record<string, NodeType> = registryData as unknown as Record<
  string,
  NodeType
>;

function inputBindings(node: SpecNode): string[] {
  const bindings = node.config?.bindings;
  if (typeof bindings !== "object" || bindings === null || Array.isArray(bindings)) {
    return [];
  }
  return Object.entries(bindings as Record<string, unknown>)
    .filter(([key, value]) => key.trim() !== "" && typeof value === "string")
    .map(([key]) => key);
}

function byId(ports: PortSpec[] | undefined): Record<string, PortSpec> {
  return Object.fromEntries((ports ?? []).map((port) => [port.id, port]));
}

/** 노드의 실제 포트 = registry static ports ∪ config에서 파생되는 dynamic ports. */
export function resolvePorts(
  node: SpecNode,
  nodeType: NodeType,
  inputSchema?: JsonSchema,
): ResolvedPorts {
  const resolved: ResolvedPorts = {
    inputs: byId(nodeType.ports.inputs),
    outputs: byId(nodeType.ports.outputs),
  };
  if (nodeType.type !== INPUT_NODE_TYPE) return resolved;

  const properties = inputSchema?.properties;
  const known =
    typeof properties === "object" && properties !== null && !Array.isArray(properties)
      ? (properties as Record<string, unknown>)
      : {};
  for (const name of inputBindings(node)) {
    const portSchema = known[name];
    resolved.outputs[name] = {
      id: name,
      schema:
        typeof portSchema === "object" && portSchema !== null && !Array.isArray(portSchema)
          ? (portSchema as PortSpec["schema"])
          : {},
    };
  }
  return resolved;
}
