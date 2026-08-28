// Python `agentcanvas_contracts.node_registry`의 TS 미러.
// 노드 타입·포트는 여기서만 나온다 — 프론트에 하드코딩하지 않는다 (설계 원칙 §4.2).
import registryData from "../../../../packages/contracts/json_schema/node_registry.json";
import type {
  Resources,
  Node1 as SpecNode,
  ToolDef,
} from "../generated/agent_spec";
import type { NodeType, PortSpec } from "../generated/node_type";

export type JsonSchema = Record<string, unknown>;

export interface ResolvedPorts {
  inputs: Record<string, PortSpec>;
  outputs: Record<string, PortSpec>;
}

export const INPUT_NODE_TYPE = "core.input";

// config_schema 확장 키워드 — Python `node_registry`와 같은 이름을 읽는다.
export const BINDING_REF_MARKER = "x-binding-ref";
export const TOOL_PORTS_MARKER = "x-tool-ports";
export const TOOL_NAME_FIELD = "tool_name_field";
const TOOL_INPUT_PORT = "input_port";
const TOOL_OUTPUT_PORT = "output_port";

export const nodeTypes: Record<string, NodeType> = registryData as unknown as Record<
  string,
  NodeType
>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function inputBindings(node: SpecNode): string[] {
  const bindings = asRecord(node.config?.bindings);
  if (!bindings) return [];
  return Object.entries(bindings)
    .filter(([key, value]) => key.trim() !== "" && typeof value === "string")
    .map(([key]) => key);
}

function byId(ports: PortSpec[] | undefined): Record<string, PortSpec> {
  return Object.fromEntries((ports ?? []).map((port) => [port.id, port]));
}

/**
 * config_schema가 바인딩 id라고 표시한(x-binding-ref) 자리에 실제로 적힌 이름들.
 * 타입 이름으로 분기하지 않는다 — 마커를 붙인 노드 타입이면 무엇이든 대상이다.
 */
export function bindingRefs(node: SpecNode, nodeType: NodeType): string[] {
  const properties = asRecord(nodeType.config_schema.properties);
  if (!properties) return [];

  const refs: string[] = [];
  for (const [name, fieldSchema] of Object.entries(properties)) {
    const field = asRecord(fieldSchema);
    if (!field) continue;
    const value = node.config?.[name];
    if (field[BINDING_REF_MARKER] === true && typeof value === "string") {
      refs.push(value);
    }
    const items = asRecord(field.items);
    if (items?.[BINDING_REF_MARKER] === true && Array.isArray(value)) {
      refs.push(...value.filter((item): item is string => typeof item === "string"));
    }
  }
  return refs;
}

/** 이 노드가 고른 도구 — 가리킨 바인딩이 그 이름의 도구를 들고 있을 때만 있다. */
function chosenTool(
  node: SpecNode,
  nodeType: NodeType,
  plan: Record<string, unknown>,
  resources: Resources,
): ToolDef | undefined {
  const field = plan[TOOL_NAME_FIELD];
  const wanted = typeof field === "string" ? node.config?.[field] : undefined;
  if (typeof wanted !== "string") return undefined;
  const bound = bindingRefs(node, nodeType);
  return resources
    .filter((resource) => bound.includes(resource.id))
    .flatMap((resource) => resource.tools ?? [])
    .find((tool) => tool.name === wanted);
}

/** registry에 있는 포트에만 schema를 입힌다 — 없는 자리를 새로 만들지 않는다. */
function wearing(
  ports: Record<string, PortSpec>,
  portId: unknown,
  schema: PortSpec["schema"],
): void {
  const port = typeof portId === "string" ? ports[portId] : undefined;
  if (port) ports[port.id] = { ...port, schema };
}

/** 도구를 입는 포트를 가진 노드라면, 고른 도구의 schema를 그 포트에 입힌다. */
function wearTool(
  node: SpecNode,
  nodeType: NodeType,
  resources: Resources,
  resolved: ResolvedPorts,
): void {
  const plan = asRecord(nodeType.config_schema[TOOL_PORTS_MARKER]);
  if (!plan) return;
  const tool = chosenTool(node, nodeType, plan, resources);
  if (!tool) return;
  wearing(resolved.inputs, plan[TOOL_INPUT_PORT], tool.input_schema);
  wearing(resolved.outputs, plan[TOOL_OUTPUT_PORT], tool.output_schema);
}

/** 노드의 실제 포트 = registry static ports ∪ config에서 파생되는 dynamic ports. */
export function resolvePorts(
  node: SpecNode,
  nodeType: NodeType,
  inputSchema?: JsonSchema,
  resources: Resources = [],
): ResolvedPorts {
  const resolved: ResolvedPorts = {
    inputs: byId(nodeType.ports.inputs),
    outputs: byId(nodeType.ports.outputs),
  };
  // Python `resolve_ports`와 같은 차례다 — bindings가 먼저 포트를 만들고, 도구가 나중에 입힌다.
  if (nodeType.type === INPUT_NODE_TYPE) {
    const known = asRecord(inputSchema?.properties) ?? {};
    for (const name of inputBindings(node)) {
      const portSchema = asRecord(known[name]);
      resolved.outputs[name] = { id: name, schema: portSchema ?? {} };
    }
  }
  wearTool(node, nodeType, resources, resolved);
  return resolved;
}
