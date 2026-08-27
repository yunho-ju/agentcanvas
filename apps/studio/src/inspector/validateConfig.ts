// 노드 config를 registry의 config_schema로 즉시 검증한다 — 오류는 필드 옆에 붙일 수 있게 돌려준다.
// 오류 문장은 사람이 읽을 쉬운 말로 옮긴다 (용어 원칙).
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import { type Message, type MessageKey, msg } from "../i18n/messages";

export interface ConfigError {
  /** 오류가 붙을 필드 이름. 폼 전체의 문제면 null */
  field: string | null;
  message: Message;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = new WeakMap<object, ValidateFunction | null>();

/** schema가 요구하는 형식의 쉬운 이름 — 언어마다 다르므로 이름도 메시지다. */
const TYPE_NAMES: Record<string, MessageKey> = {
  string: "validate.type.string",
  number: "validate.type.number",
  integer: "validate.type.integer",
  boolean: "validate.type.boolean",
  array: "validate.type.array",
  object: "validate.type.object",
};

/** ajv가 어긴 규칙 이름 -> 사람이 읽을 문장. 새 규칙은 여기 한 줄을 더한다. */
const MESSAGE_BY_KEYWORD: Record<string, (error: ErrorObject) => Message> = {
  required: () => msg("validate.required"),
  type: (error) => {
    const wanted = String((error.params as { type?: string }).type ?? "");
    const name = TYPE_NAMES[wanted];
    return name
      ? msg("validate.type", { name: msg(name) })
      : msg("validate.type.raw", { type: wanted });
  },
  minimum: (error) =>
    msg("validate.minimum", { limit: String((error.params as { limit?: number }).limit) }),
  maximum: (error) =>
    msg("validate.maximum", { limit: String((error.params as { limit?: number }).limit) }),
  pattern: (error) =>
    msg("validate.pattern", {
      pattern: String((error.params as { pattern?: string }).pattern),
    }),
  enum: (error) =>
    msg("validate.enum", {
      values: ((error.params as { allowedValues?: unknown[] }).allowedValues ?? []).join(
        ", ",
      ),
    }),
};

function plainMessage(error: ErrorObject): Message {
  const known = MESSAGE_BY_KEYWORD[error.keyword];
  if (known) return known(error);
  // 우리가 아직 말로 옮기지 못한 규칙은 원문이라도 보여 준다 — 침묵하지 않는다.
  return msg("validate.other", {
    rule: error.message ?? msg("validate.other.unknown"),
  });
}

function validatorFor(schema: unknown): ValidateFunction | null {
  if (typeof schema !== "object" || schema === null) return null;
  const cached = compiled.get(schema);
  if (cached !== undefined) return cached;
  let validate: ValidateFunction | null = null;
  try {
    validate = ajv.compile(schema);
  } catch {
    // 우리가 읽을 수 없는 schema로 사용자의 편집을 막지는 않는다.
    validate = null;
  }
  compiled.set(schema, validate);
  return validate;
}

export function validateConfig(schema: unknown, config: unknown): ConfigError[] {
  const validate = validatorFor(schema);
  if (!validate || validate(config)) return [];
  return (validate.errors ?? []).map((error) => {
    const missing = (error.params as { missingProperty?: string }).missingProperty;
    if (missing) return { field: missing, message: plainMessage(error) };
    const [, field] = error.instancePath.split("/");
    return {
      field: field ? decodeURIComponent(field) : null,
      message: plainMessage(error),
    };
  });
}
