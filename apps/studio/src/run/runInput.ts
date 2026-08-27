// 실행에 넣을 값의 규칙 — 무엇을 물을지와, 무엇을 서버로 보낼지 (순수 함수).
// 물을 것은 그래프가 정한다: 입력 노드가 받는 값 이름이 곧 물음이고, 문서의 input_schema가
// 있으면 그 제목·타입이 그대로 살아난다. 화면은 이 결과를 그리기만 한다 (DESIGN §7 run-input-card).
import type { AgentSpec } from "../generated/agent_spec";
import { type FormField, describeForm } from "../inspector/schemaForm";
import { INPUT_NODE_TYPE, type JsonSchema } from "../registry/registry";

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 입력 노드가 받기로 한 값 이름들 — 이름이 곧 사람에게 물을 것이다. */
function boundNames(spec: AgentSpec): string[] {
  const names = spec.nodes
    .filter((node) => node.type === INPUT_NODE_TYPE)
    .flatMap((node) => Object.keys(asObject(node.config?.bindings) ?? {}))
    .filter((name) => name.trim() !== "");
  return [...new Set(names)];
}

/** 문서가 그 이름에 대해 적어 둔 형식 — 적어 둔 것이 없으면 글 한 줄로 묻는다. */
function schemaFor(properties: Record<string, unknown>, name: string): JsonSchema {
  return asObject(properties[name]) ?? { type: "string" };
}

/**
 * 이번 실행에 사람에게 물을 칸들. 물을 것이 없으면 빈 목록이다 —
 * 그때는 카드도 서지 않는다 (빈 카드를 띄우지 않는다).
 */
export function runInputFields(spec: AgentSpec): FormField[] {
  const names = boundNames(spec);
  if (names.length === 0) return [];

  const schema = asObject(spec.input_schema) ?? {};
  const properties = asObject(schema.properties) ?? {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  return describeForm({
    type: "object",
    properties: Object.fromEntries(
      names.map((name) => [name, schemaFor(properties, name)]),
    ),
    required: names.filter((name) => required.includes(name)),
  }).fields;
}

/** 적지 않은 값은 없는 값이다 — 빈 칸을 값인 척 실어 보내지 않는다. */
function wasWritten(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value === "string" ? value.trim() !== "" : true;
}

/** 사람이 실제로 적은 것만 남긴 값 — 아무것도 적지 않았으면 빈 객체다. */
export function filledInput(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => wasWritten(value)),
  );
}
