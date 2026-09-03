// 입력 노드가 받는 줄 ↔ 문서 (DESIGN §7 input-rows).
// 원본은 문서다: 받는 자리는 노드의 `bindings`, 종류·필수는 문서의 `input_schema`가 말한다.
// 화면은 이 두 곳을 함께 읽고 함께 적는다 — 여기 있는 것은 전부 입력→출력 순수 함수다.
import type { Node1 as SpecNode } from "../generated/agent_spec";
import { type Message, msg } from "../i18n/messages";
import type { JsonSchema } from "../registry/registry";
import { TYPE_KINDS, type TypeKind, typeKind, typeOfKind } from "./typeWords";

/** 문서에 직접 적혀 있어 화면이 부를 이름이 없는 모양 (여러 종류를 겹친 것 등). */
export const CUSTOM_KIND = "custom";
/** 항목이 없는 줄 — 포트가 무엇이든 받고, 실행은 글 한 줄로 묻는다. */
export const ANY_KIND = "any";

/** 화면이 고를 수 있는 종류 — 쉬운 말 표의 종류에 '아무 값이나'를 더한 것. */
export type RowKind = Exclude<TypeKind, "nothing"> | typeof ANY_KIND;

/**
 * 고를 수 있는 종류들. 표에서 그대로 나온다 — 여기 손으로 적는 목록은 없다.
 * '빈 값'(null)은 사람에게 물어 받을 값이 아니므로 고르는 자리에 두지 않는다
 * (문서에 그렇게 적혀 있으면 잠긴 줄이 된다).
 */
export const ROW_KINDS: RowKind[] = [
  ...TYPE_KINDS.filter((kind): kind is Exclude<TypeKind, "nothing"> => kind !== "nothing"),
  ANY_KIND,
];

export interface InputRow {
  /** 받는 값의 이름. 값이 오는 자리는 언제나 `input.<이름>`이라 화면에 없다 */
  name: string;
  /** 이 줄이 받는 값의 종류. `custom`이면 문서에 직접 적힌 모양이라 화면이 바꾸지 않는다 */
  kind: RowKind | typeof CUSTOM_KIND;
  /** 이 값 없이는 실행할 수 없는가 (`input_schema.required`) */
  required: boolean;
  /**
   * 이 줄이 문서에서 들고 온 제 이름표 — 아직 문서에 없는 새 줄은 없다(null).
   * 짝은 차례가 아니라 이 이름표로 찾는다: 옆줄을 지우거나 이름을 바꿔도
   * 내 줄의 모양은 글자 하나 바뀌지 않는다 (DESIGN §7 input-rows).
   */
  was: string | null;
}

/** 이 줄의 모양은 문서에 직접 적힌 것이라 화면이 고쳐 쓸 수 없다. */
export function isLocked(row: InputRow): boolean {
  return row.kind === CUSTOM_KIND;
}

/** 모양이 없는 값은 필수로 물을 수 없다 — 무엇을 채우라고 할지 말할 수 없기 때문이다. */
export function canBeRequired(row: InputRow): boolean {
  return row.kind !== ANY_KIND;
}

/** 종류를 바꾼 줄. 아무 값이나 받게 되면 꼭 받아요도 함께 풀린다 (DESIGN §7 input-rows). */
export function withKind(row: InputRow, kind: InputRow["kind"]): InputRow {
  const next = { ...row, kind };
  return canBeRequired(next) ? next : { ...next, required: false };
}

/** 이 종류를 화면에 적을 쉬운 말 — 자료형 원문은 어디에도 쓰지 않는다 (DESIGN §7). */
export function rowKindWord(kind: InputRow["kind"]): Message {
  return msg(`type.${kind}`);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 이 노드가 받기로 한 이름들 — 이름이 없는 자리는 받는 값이 아니다. */
function boundNames(node: SpecNode): string[] {
  return Object.keys(asObject(node.config?.bindings) ?? {}).filter(
    (name) => name.trim() !== "",
  );
}

function propertiesOf(inputSchema: JsonSchema | undefined): Record<string, unknown> {
  return asObject(inputSchema?.properties) ?? {};
}

function requiredOf(inputSchema: JsonSchema | undefined): string[] {
  const required = inputSchema?.required;
  return Array.isArray(required)
    ? required.filter((name): name is string => typeof name === "string")
    : [];
}

/** 문서가 이 이름에 대해 적어 둔 모양이 화면이 부를 수 있는 종류인가. */
function kindOfShape(shape: unknown): InputRow["kind"] {
  const property = asObject(shape);
  if (!property) return ANY_KIND;
  const kind = typeKind(property.type);
  return kind !== undefined && kind !== "nothing" ? kind : CUSTOM_KIND;
}

/** 이 노드가 받는 값들을 화면이 그릴 줄로 읽는다. */
export function rowsOf(node: SpecNode, inputSchema?: JsonSchema): InputRow[] {
  const properties = propertiesOf(inputSchema);
  const required = requiredOf(inputSchema);
  return boundNames(node).map((name) => ({
    name,
    kind: kindOfShape(properties[name]),
    required: required.includes(name),
    was: name,
  }));
}

/** 이 줄이 문서에 적힐 모양 — 고쳐 쓰지 않은 줄은 적혀 있던 그대로다. */
function shapeOf(row: InputRow, previous: unknown): unknown {
  if (row.kind === ANY_KIND) return undefined;
  // 잠긴 줄도, 종류를 그대로 둔 줄도 문서의 원문(`integer` 등)을 건드릴 이유가 없다.
  if (row.kind === CUSTOM_KIND || row.kind === kindOfShape(previous)) return previous;
  // 종류만 갈아 끼운다 — 줄에 붙어 있던 제목 같은 것은 그 줄의 것이다.
  return { ...asObject(previous), type: typeOfKind(row.kind) };
}

/**
 * 줄들을 문서에 옮겨 적는다 — 노드의 `bindings`와 문서의 `input_schema`를 함께 돌려준다.
 * 줄은 제 이름표(`was`)로 문서의 항목과 짝을 짓는다: 이름표가 가리키는 항목이 그 줄의 것이고,
 * 이름을 바꾸면 그 항목과 필수가 새 이름을 따라간다. 이름표가 없는 줄은 새 줄이다.
 * 이 노드가 받지 않는 항목은 남의 것이라 그대로 둔다.
 */
export function applyRows(
  node: SpecNode,
  inputSchema: JsonSchema | undefined,
  rows: InputRow[],
): { config: Record<string, unknown>; input_schema: JsonSchema } {
  const was = rowsOf(node, inputSchema);
  const properties = { ...propertiesOf(inputSchema) };
  const required = requiredOf(inputSchema).filter(
    (name) => !was.some((row) => row.name === name),
  );

  const shapes = new Map(was.map((row) => [row.name, properties[row.name]]));
  for (const row of was) delete properties[row.name];

  for (const row of rows) {
    // 이름표가 가리키는 항목만 이 줄의 것이다 — 옆줄이 지워져도 자리를 물려받지 않는다.
    const shape = shapeOf(row, row.was === null ? undefined : shapes.get(row.was));
    if (shape !== undefined) properties[row.name] = shape;
    if (row.required && shape !== undefined) required.push(row.name);
  }

  // 문서가 이 두 자리에 대해 적어 두었던 것은 이제 줄들이 말한다 — 나머지는 그대로 둔다.
  const rest = { ...inputSchema };
  delete rest.properties;
  delete rest.required;

  return {
    config: {
      ...node.config,
      bindings: Object.fromEntries(rows.map((row) => [row.name, `input.${row.name}`])),
    },
    input_schema: {
      type: "object",
      ...rest,
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  };
}

/** 이 줄들을 문서에 옮겨 적을 수 있는가 — 이름이 없거나 겹치면 적지 않는다. */
export function rowsProblem(rows: InputRow[]): "empty" | "duplicate" | undefined {
  const names = rows.map((row) => row.name.trim());
  if (names.some((name) => name === "")) return "empty";
  if (new Set(names).size !== names.length) return "duplicate";
  return undefined;
}
