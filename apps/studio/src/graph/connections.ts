// 문서가 가진 연결(spec.resources)에 대한 순수한 셈 — 무엇이 새로 오고, 무엇이 빠지고,
// 다시 가져온 연결이 무엇을 바꾸는가. 화면과 store가 같은 답을 함께 쓴다.
import type { ResourceBinding, ToolDef } from "../generated/agent_spec";
import { bindingRefs } from "../registry/registry";
import { A_TOOL, sameContent } from "./canonical";
import type { FlowNode } from "./serialize";

/** 제안된 것 중 이 문서에 아직 없는 연결들 — 승인하면 새로 들어올 것이 이것이다. */
export function newConnections(
  proposed: ResourceBinding[],
  current: ResourceBinding[],
): ResourceBinding[] {
  const known = new Set(current.map((binding) => binding.id));
  return proposed.filter((binding) => !known.has(binding.id));
}

/** 다시 가져온 연결이 도구를 어떻게 바꾸는가 — 빠지는 것을 침묵하지 않기 위한 셈. */
export interface ToolDiff {
  added: ToolDef[];
  changed: ToolDef[];
  removed: ToolDef[];
}

/** 도구는 이름으로 짝을 짓고, 짝이 있는 것끼리는 내용으로 견준다. */
export function toolDiff(before: ToolDef[], after: ToolDef[]): ToolDiff {
  const was = new Map(before.map((tool) => [tool.name, tool]));
  const willBe = new Map(after.map((tool) => [tool.name, tool]));
  return {
    added: after.filter((tool) => !was.has(tool.name)),
    changed: after.filter((tool) => {
      const old = was.get(tool.name);
      return old !== undefined && !sameContent(old, tool, A_TOOL);
    }),
    removed: before.filter((tool) => !willBe.has(tool.name)),
  };
}

/** 연결 하나를 뺀 목록 — 나머지의 차례는 그대로다. */
export function withoutConnection(
  current: ResourceBinding[],
  id: string,
): ResourceBinding[] {
  return current.filter((binding) => binding.id !== id);
}

/** 같은 이름의 연결을 그 자리에서 갈아 끼운 목록 — 없는 이름이면 아무것도 바꾸지 않는다. */
export function withConnection(
  current: ResourceBinding[],
  swapped: ResourceBinding,
): ResourceBinding[] {
  return current.map((binding) => (binding.id === swapped.id ? swapped : binding));
}

/**
 * 그 연결을 적어 둔 노드들의 이름 — 무엇이 틀렸는지는 여기서 판정하지 않는다.
 * 읽는 자리는 registry의 마커 하나(bindingRefs)로, inspector가 쓰는 그 리더다.
 */
export function nodesUsing(nodes: FlowNode[], id: string): string[] {
  return nodes
    .filter((node) => {
      const nodeType = node.data.nodeType;
      return nodeType !== undefined && bindingRefs(node.data.spec, nodeType).includes(id);
    })
    .map((node) => node.id);
}

/** 연결이 도구 말고도 들고 있는 것들 — 다시 가져오기가 이 칸들도 갈아 끼운다. */
export type BindingField = "kind" | "server_ref" | "allowed_tools" | "approval_policy";

/** 화면에 그대로 실을 수 있는 한 줄짜리 값 — 목록은 쉼표로 잇고, 없는 것은 빈 글자다. */
function written(value: unknown): string {
  if (value === undefined || value === null) return "";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

export interface BindingChange {
  field: BindingField;
  before: string;
  after: string;
}

/** 새 종류의 칸이 계약에 생기면 여기 한 줄이다 (분기 대신 표). */
const BINDING_FIELDS: BindingField[] = [
  "kind",
  "server_ref",
  "allowed_tools",
  "approval_policy",
];

/**
 * 다시 가져온 연결이 도구 말고 무엇을 바꾸는가 — **바뀐 칸만** 돌려준다.
 * 적지 않은 칸과 빈 목록은 같은 말이므로 바뀐 것으로 세지 않는다.
 */
export function bindingChanges(
  before: ResourceBinding,
  after: ResourceBinding,
): BindingChange[] {
  return BINDING_FIELDS.flatMap((field) => {
    const was = written(before[field]);
    const willBe = written(after[field]);
    return was === willBe ? [] : [{ field, before: was, after: willBe }];
  });
}
