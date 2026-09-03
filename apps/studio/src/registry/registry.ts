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
// 입은 skill의 표식은 연결과 갈라져 있다 — skill이 끊긴 연결로 잘못 잡히면 안 된다.
export const SKILL_REF_MARKER = "x-skill-ref";
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
 * config_schema가 이 표식을 붙인 자리에 실제로 적힌 이름들.
 * 타입 이름으로 분기하지 않는다 — 표식을 붙인 노드 타입이면 무엇이든 대상이다.
 */
function markedRefs(node: SpecNode, nodeType: NodeType, marker: string): string[] {
  const properties = asRecord(nodeType.config_schema.properties);
  if (!properties) return [];

  const refs: string[] = [];
  for (const [name, fieldSchema] of Object.entries(properties)) {
    const field = asRecord(fieldSchema);
    if (!field) continue;
    const value = node.config?.[name];
    if (field[marker] === true && typeof value === "string") {
      refs.push(value);
    }
    const items = asRecord(field.items);
    if (items?.[marker] === true && Array.isArray(value)) {
      refs.push(...value.filter((item): item is string => typeof item === "string"));
    }
  }
  return refs;
}

/** 이 노드가 쓰겠다고 적은 연결(spec.resources)의 id들 — x-binding-ref 자리. */
export function bindingRefs(node: SpecNode, nodeType: NodeType): string[] {
  return markedRefs(node, nodeType, BINDING_REF_MARKER);
}

/** 이 노드가 입겠다고 적은 skill(spec.skills)의 ref들 — x-skill-ref 자리. */
export function skillRefs(node: SpecNode, nodeType: NodeType): string[] {
  return markedRefs(node, nodeType, SKILL_REF_MARKER);
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

/** 도구 하나를 그대로 실을 수 있는 자리 — 어느 노드 타입의, 어느 두 칸인가. */
export interface ToolHost {
  type: string;
  /** 연결 이름을 적는 칸 (x-binding-ref) */
  bindingField: string;
  /** 도구 이름을 적는 칸 (x-tool-ports.tool_name_field) */
  toolNameField: string;
}

function bindingField(nodeType: NodeType): string | undefined {
  const properties = asRecord(nodeType.config_schema.properties) ?? {};
  return Object.entries(properties).find(
    ([, field]) => asRecord(field)?.[BINDING_REF_MARKER] === true,
  )?.[0];
}

/**
 * 도구를 실을 자리를 registry에게 묻는다 — 화면은 노드 타입 이름을 외우지 않는다.
 * 두 칸(연결·도구 이름)을 모두 가진 타입이 그 자리다. 없으면 없다고 답한다.
 * 지금 그런 타입은 하나뿐이다(registry 테스트가 그 사실을 지킨다) — 둘이 되는 날
 * "어느 자리에 놓을까"는 사람이 고를 물음이 되므로, 그때 고르는 규칙을 정한다.
 */
export function toolHost(): ToolHost | undefined {
  for (const nodeType of Object.values(nodeTypes)) {
    const plan = asRecord(nodeType.config_schema[TOOL_PORTS_MARKER]);
    const toolNameField = plan?.[TOOL_NAME_FIELD];
    const binding = bindingField(nodeType);
    if (typeof toolNameField === "string" && binding !== undefined) {
      return { type: nodeType.type, bindingField: binding, toolNameField };
    }
  }
  return undefined;
}
