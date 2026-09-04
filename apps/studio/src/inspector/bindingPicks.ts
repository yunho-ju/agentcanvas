// '쓸 도구' 칸이 내놓을 줄과, 그중 문서가 지킬 수 있는 것 — 순수 규칙 (DESIGN §7 agent-turns).
// 어떤 연결을 내놓을지는 계약의 표식(x-binding-filter)이 정한다: 노드 타입을 보지 않는다.
import type { ResourceBinding } from "../generated/agent_spec";
import {
  BINDING_FILTER_MARKER,
  BINDING_REF_MARKER,
  type JsonSchema,
} from "../registry/registry";

/**
 * 고를 수 있는 연결을 거르는 규칙들.
 * 새 규칙을 지원할 때 여기 한 줄을 더한다 — 읽는 쪽 코드는 그대로다.
 */
const BINDING_FILTERS: Record<string, (binding: ResourceBinding) => boolean> = {
  with_tools: (binding) => (binding.tools ?? []).length > 0,
};

/** 이 칸이 고를 것을 거르는 규칙의 이름 — 계약이 말하지 않았으면 없다(전부 내놓는다). */
export function bindingFilterName(schema: JsonSchema): string | undefined {
  const items = schema.items;
  if (typeof items !== "object" || items === null) return undefined;
  const marked = items as Record<string, unknown>;
  const name = marked[BINDING_FILTER_MARKER];
  return typeof name === "string" ? name : undefined;
}

/** 이 칸에 적혀 있는 이름들 — 글자가 아닌 것은 이 칸의 값이 아니다. */
export function pickedRefs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((one): one is string => typeof one === "string")
    : [];
}

function offered(bindings: ResourceBinding[], filter: string | undefined) {
  const asks = filter === undefined ? undefined : BINDING_FILTERS[filter];
  // 모르는 규칙으로 고를 것을 없애지 않는다 — 읽을 수 없는 표식은 없는 것과 같다.
  return asks ? bindings.filter(asks) : bindings;
}

/** 체크 목록의 한 줄 — 문서가 내놓은 연결이거나, 고른 채 남은 모르는 이름이다. */
export interface PickRow {
  id: string;
  toolCount: number;
  /** 이 문서가 지금 지킬 수 있는 이름인가 */
  known: boolean;
}

/** 내놓을 연결들 + 골랐지만 내놓을 수 없는 이름들 — 모르는 이름도 줄로 남는다. */
export function bindingPickRows(
  bindings: ResourceBinding[],
  filter: string | undefined,
  picked: string[],
): PickRow[] {
  const rows = offered(bindings, filter);
  const known = new Set(rows.map((binding) => binding.id));
  return [
    ...rows.map((binding) => ({
      id: binding.id,
      toolCount: (binding.tools ?? []).length,
      known: true,
    })),
    ...picked
      .filter((ref) => !known.has(ref))
      .map((ref) => ({ id: ref, toolCount: 0, known: false })),
  ];
}

/** 골랐지만 이 문서가 지킬 수 없는 이름들 — 서버 `node.unknown_binding`과 같은 판정이다. */
export function unresolvedPicks(
  picked: string[],
  bindings: ResourceBinding[],
  filter: string | undefined,
): string[] {
  const known = new Set(offered(bindings, filter).map((binding) => binding.id));
  return picked.filter((ref) => !known.has(ref));
}

/** 연결을 목록으로 고르는 칸 하나 — 이름과, 고를 것을 거르는 규칙. */
export interface BindingPickField {
  name: string;
  filter?: string;
}

/** 이 노드 타입에서 연결을 목록으로 고르는 칸들 — 표식이 붙은 자리를 registry에게 묻는다. */
export function bindingPickFields(configSchema: unknown): BindingPickField[] {
  const schema = configSchema as { properties?: unknown } | null | undefined;
  const properties = schema?.properties;
  if (typeof properties !== "object" || properties === null) return [];
  return Object.entries(properties as Record<string, unknown>).flatMap(([name, one]) => {
    const field = one as JsonSchema | null;
    const items = field?.items;
    const marked =
      typeof items === "object" &&
      items !== null &&
      (items as Record<string, unknown>)[BINDING_REF_MARKER] === true;
    if (!marked || !field) return [];
    const filter = bindingFilterName(field);
    return [{ name, ...(filter === undefined ? {} : { filter }) }];
  });
}

/**
 * 다른 칸의 잠금을 푸는 데 쓸 값 — 지킬 수 없는 이름은 고른 것으로 세지 않는다.
 * (오타 이름 하나로 '최대 몇 턴'이 열리면 화면이 거짓을 말한다.)
 */
export function resolvedPicks(
  configSchema: unknown,
  values: Record<string, unknown>,
  bindings: ResourceBinding[],
): Record<string, unknown> {
  const resolved = { ...values };
  for (const field of bindingPickFields(configSchema)) {
    const picked = pickedRefs(values[field.name]);
    const unresolved = new Set(unresolvedPicks(picked, bindings, field.filter));
    resolved[field.name] = picked.filter((ref) => !unresolved.has(ref));
  }
  return resolved;
}
