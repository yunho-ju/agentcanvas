import { describe, expect, it } from "vitest";
import { validateConfig, type ConfigError } from "../src/inspector/validateConfig";
import type { Locale } from "../src/i18n/locale";
import { translate } from "../src/i18n/messages";
import { nodeTypes } from "../src/registry/registry";

const agentSchema = nodeTypes["llm.agent"].config_schema;

function said(error: ConfigError, locale: Locale = "ko"): string {
  return translate(locale, error.message);
}

describe("validateConfig", () => {
  it("says nothing about a config the schema accepts", () => {
    expect(
      validateConfig(agentSchema, {
        model_ref: "model://default",
        prompt_ref: "prompt://a@1",
      }),
    ).toEqual([]);
  });

  it("points at the field the user left empty and not the one filled in", () => {
    const errors = validateConfig(nodeTypes["tool.mcp"].config_schema, {
      resource_ref: "mcp://files@1",
    });
    expect(errors.map((error) => error.field)).toEqual(["tool_name"]);
    expect(said(errors[0])).toContain("채워야");
  });

  it("says in plain words that the number is too small", () => {
    const errors = validateConfig(agentSchema, {
      model_ref: "model://default",
      prompt_ref: "prompt://a@1",
      max_turns: 0,
    });
    expect(errors.map((error) => error.field)).toEqual(["max_turns"]);
    expect(said(errors[0])).toBe("1 이상이어야 한다");
  });

  it("says in plain words what kind of value is expected", () => {
    const errors = validateConfig(agentSchema, {
      model_ref: "model://default",
      prompt_ref: "prompt://a@1",
      max_turns: "네 번",
    });
    expect(said(errors[0])).toBe("정수를 넣어야 한다");
  });

  it("says which values the user may choose from", () => {
    const errors = validateConfig(
      { type: "object", properties: { mode: { type: "string", enum: ["빠름", "정확"] } } },
      { mode: "보통" },
    );
    expect(said(errors[0])).toBe("정해진 값 중에서 골라야 한다 (고를 수 있는 값: 빠름, 정확)");
  });

  it("says the value is too large", () => {
    const errors = validateConfig(
      { type: "object", properties: { ratio: { type: "number", maximum: 10 } } },
      { ratio: 11 },
    );
    expect(said(errors[0])).toBe("10 이하여야 한다");
  });

  it("says the shape does not match", () => {
    const errors = validateConfig(
      { type: "object", properties: { ref: { type: "string", pattern: "^model://" } } },
      { ref: "openai" },
    );
    expect(said(errors[0])).toBe("정해진 형태와 다르다 (형태: ^model://)");
  });

  it("falls back to the rule itself for a condition it has no words for", () => {
    const errors = validateConfig(
      { type: "object", properties: { tags: { type: "array", minItems: 2 } } },
      { tags: ["one"] },
    );
    expect(said(errors[0])).toBe(
      "입력값이 조건에 맞지 않는다 (조건: must NOT have fewer than 2 items)",
    );
  });

  it("says the very same things to a reader of english", () => {
    const errors = validateConfig(agentSchema, {
      model_ref: "model://default",
      prompt_ref: "prompt://a@1",
      max_turns: 0,
    });
    expect(said(errors[0], "en")).toBe("This has to be 1 or more");
  });

  it("names the kind of value it wants in english too", () => {
    const errors = validateConfig(agentSchema, {
      model_ref: "model://default",
      prompt_ref: "prompt://a@1",
      max_turns: "네 번",
    });
    expect(said(errors[0], "en")).toBe("This needs a whole number");
  });

  it("reports a problem that belongs to no single field without a field", () => {
    const errors = validateConfig(agentSchema, "not an object");
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBeNull();
  });

  it("accepts anything when the schema cannot be compiled", () => {
    expect(validateConfig({ type: "not-a-type" }, { anything: 1 })).toEqual([]);
    expect(validateConfig(undefined, { anything: 1 })).toEqual([]);
  });
});
