// config_schema(JSON Schema) -> inspector 폼. 노드 타입은 여기서 쳐다보지 않는다 (설계 §4.2).
// 읽을 수 없는 조각은 버리지 않고 raw JSON 편집으로 넘긴다 — 어떤 schema가 와도 UI는 살아 있다.
import type { Locale } from "../i18n/locale";
import {
  BINDING_REF_MARKER,
  TOOL_NAME_FIELD,
  TOOL_PORTS_MARKER,
  type JsonSchema,
} from "../registry/registry";

/** 계약이 두 언어로 들고 온 글과 같은 모양 — 폼의 라벨도 언어를 고를 수 있어야 한다. */
export type FieldText = Record<Locale, string>;

export type ControlKind =
  | "text"
  | "textarea"
  | "instructionText"
  | "number"
  | "boolean"
  | "select"
  | "array"
  | "stringMap"
  | "inputRows"
  | "secretRef"
  | "schemaRef"
  | "modelRef"
  | "bindingSelect"
  | "toolSelect"
  | "json";

export interface FormField {
  name: string;
  label: FieldText;
  description?: FieldText;
  required: boolean;
  control: ControlKind;
  /** select에서 고를 수 있는 값 */
  options?: string[];
  schema: JsonSchema;
}

export interface ConfigForm {
  fields: FormField[];
  /** 폼으로 읽을 수 없는 schema — config 전체를 raw JSON으로 편집한다 */
  raw: boolean;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

function itemsType(schema: Record<string, unknown>): unknown {
  return asObject(schema.items)?.type;
}

function additionalType(schema: Record<string, unknown>): unknown {
  return asObject(schema.additionalProperties)?.type;
}

/** format이 골라 주는 특수 편집기. 없으면 type이 고른다. */
const CONTROL_BY_FORMAT: Record<string, ControlKind> = {
  "secret-ref": "secretRef",
  "schema-ref": "schemaRef",
  "model-ref": "modelRef",
  instruction: "instructionText",
  textarea: "textarea",
  "input-rows": "inputRows",
};

/**
 * 필드 자신에 붙은 마커가 골라 주는 편집기 — format 표와 같은 문법이다.
 * 노드 타입 이름은 여기서도 쳐다보지 않는다: 마커를 붙인 필드면 무엇이든 대상이다.
 */
// 마커 이름은 계약이 정한다 — registry가 읽는 그 이름을 그대로 쓴다 (두 벌로 두지 않는다).
const CONTROL_BY_MARKER: Record<string, ControlKind> = {
  [BINDING_REF_MARKER]: "bindingSelect",
};

/**
 * schema type -> 편집기 매핑 테이블.
 * 새 type을 지원할 때 여기 한 줄을 더한다 — 읽는 쪽 코드는 그대로다.
 */
const CONTROL_BY_TYPE: Record<string, (schema: Record<string, unknown>) => ControlKind> = {
  string: () => "text",
  number: () => "number",
  integer: () => "number",
  boolean: () => "boolean",
  array: (schema) => (itemsType(schema) === "string" ? "array" : "json"),
  object: (schema) => (additionalType(schema) === "string" ? "stringMap" : "json"),
};

function markedControl(schema: Record<string, unknown>): ControlKind | undefined {
  const marker = Object.keys(CONTROL_BY_MARKER).find((key) => schema[key] === true);
  return marker ? CONTROL_BY_MARKER[marker] : undefined;
}

/** 뿌리가 "이 필드가 도구 이름"이라고 가리킨 이름 — 가리키지 않았으면 없다. */
function toolNameField(root: Record<string, unknown> | null): string | undefined {
  const plan = asObject(root?.[TOOL_PORTS_MARKER])?.[TOOL_NAME_FIELD];
  return typeof plan === "string" ? plan : undefined;
}

function controlOf(schema: Record<string, unknown>, marked?: ControlKind): ControlKind {
  // 마커는 계약이 이 자리에 대해 아는 가장 구체적인 말이다 — enum·type보다 먼저다.
  const byMarker = marked ?? markedControl(schema);
  if (byMarker) return byMarker;
  if (stringList(schema.enum)) return "select";
  // format은 계약이 이 자리의 모양에 대해 아는 말이다 — type이 고르기 전에 묻는다.
  const byFormat =
    typeof schema.format === "string" ? CONTROL_BY_FORMAT[schema.format] : undefined;
  if (byFormat) return byFormat;
  const byType =
    typeof schema.type === "string" ? CONTROL_BY_TYPE[schema.type] : undefined;
  // 표에 없는 조각은 버리지 않고 raw JSON으로 넘긴다.
  return byType ? byType(schema) : "json";
}

/**
 * JSON Schema의 title/description은 표준 소비자를 위해 영어로 두고, 한국어는 `x-i18n`에 싣는다.
 * 한국어가 없는 schema(사용자가 직접 쓴 것)는 표준 자리의 글을 두 언어가 함께 쓴다.
 */
function schemaText(
  schema: Record<string, unknown>,
  field: "title" | "description",
): FieldText | undefined {
  const standard = typeof schema[field] === "string" ? (schema[field] as string) : "";
  const korean = asObject(asObject(schema["x-i18n"])?.ko)?.[field];
  const ko = typeof korean === "string" && korean.trim() !== "" ? korean : standard;
  return standard.trim() === "" ? undefined : { ko, en: standard };
}

/** 설정 항목의 사람 이름 — schema가 제목을 주면 그것을, 없으면 필드 이름을 쓴다. */
export function fieldTitle(
  schema: Record<string, unknown>,
  name: string,
): FieldText {
  return schemaText(schema, "title") ?? { ko: name, en: name };
}

function describeField(
  name: string,
  schema: Record<string, unknown>,
  required: string[],
  marked?: ControlKind,
): FormField {
  const description = schemaText(schema, "description");
  const control = controlOf(schema, marked);
  return {
    name,
    label: fieldTitle(schema, name),
    ...(description ? { description } : {}),
    required: required.includes(name),
    control,
    ...(control === "select" ? { options: stringList(schema.enum) ?? [] } : {}),
    schema,
  };
}

/**
 * 아직 채우지 않은 필수 항목들의 이름 — 값이 없거나, 글자라면 공백뿐인 경우다.
 * 공백 한 칸은 적은 것이 아니다: 값을 보내는 쪽도 같은 규칙으로 버린다 (run/runInput).
 * 판정만 하고 아무것도 막지 않는다: 무엇을 잠글지는 화면이 정한다.
 */
export function missingRequired(
  fields: FormField[],
  values: Record<string, unknown>,
): string[] {
  return fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = values[field.name];
      if (value === undefined || value === null) return true;
      return typeof value === "string" && value.trim() === "";
    })
    .map((field) => field.name);
}

/**
 * 필드를 그리는 차례 — 계약이 `x-field-order`로 말한 순서다.
 * 차례에 이름이 없는 필드는 뒤에 붙이고(잃지 않는다), 필드가 없는 이름은 건너뛴다.
 */
function orderedNames(properties: Record<string, unknown>, declared: unknown): string[] {
  const order = stringList(declared);
  if (!order) return Object.keys(properties);
  const known = order.filter((name) => name in properties);
  const rest = Object.keys(properties).filter((name) => !known.includes(name));
  return [...known, ...rest];
}

/** config_schema를 inspector가 그릴 수 있는 필드 목록으로 옮긴다. */
export function describeForm(configSchema: unknown): ConfigForm {
  const schema = asObject(configSchema);
  const properties = schema && schema.type === "object" ? asObject(schema.properties) : null;
  if (!properties) return { fields: [], raw: true };

  const required = stringList(schema?.required) ?? [];
  const toolName = toolNameField(schema);
  const fields = orderedNames(properties, schema?.["x-field-order"]).flatMap((name) => {
    const property = asObject(properties[name]);
    if (!property) return [];
    return [
      describeField(
        name,
        property,
        required,
        name === toolName ? "toolSelect" : undefined,
      ),
    ];
  });
  return { fields, raw: false };
}
