import { describe, expect, it } from "vitest";
import { describeForm, missingRequired } from "../src/inspector/schemaForm";
import { nodeTypes } from "../src/registry/registry";

function controlsOf(schema: unknown): Record<string, string> {
  return Object.fromEntries(
    describeForm(schema).fields.map((field) => [field.name, field.control]),
  );
}

describe("describeForm on the six base node types", () => {
  // 입력 노드가 받는 줄은 이름·값 표가 아니라 제 편집기를 쓴다 (DESIGN §7 input-rows).
  it("reads core.input bindings as the rows the run will ask for", () => {
    expect(controlsOf(nodeTypes["core.input"].config_schema)).toEqual({
      bindings: "inputRows",
    });
  });

  it("reads core.output binding as a single line of text", () => {
    expect(controlsOf(nodeTypes["core.output"].config_schema)).toEqual({
      binding: "text",
    });
  });

  it("reads llm.router refs as picks from their catalogs, prompt still by hand", () => {
    expect(controlsOf(nodeTypes["llm.router"].config_schema)).toEqual({
      model_ref: "modelRef",
      instruction: "instructionText",
      prompt_ref: "text",
      output_schema_ref: "schemaRef",
    });
  });

  it("reads llm.agent string list and integer with their own controls", () => {
    expect(controlsOf(nodeTypes["llm.agent"].config_schema)).toEqual({
      model_ref: "modelRef",
      instruction: "instructionText",
      prompt_ref: "text",
      toolset_refs: "array",
      skill_refs: "skillWear",
      max_turns: "number",
    });
  });

  // 두 자리 모두 문서가 가진 것 중에서 고른다 — 마커가 그렇게 표시했다 (DESIGN §7).
  it("reads tool.mcp refs as picks from what the document holds", () => {
    expect(controlsOf(nodeTypes["tool.mcp"].config_schema)).toEqual({
      resource_ref: "bindingSelect",
      tool_name: "toolSelect",
    });
  });

  it("reads control.human_gate ref as a pick from the schema catalog", () => {
    expect(controlsOf(nodeTypes["control.human_gate"].config_schema)).toEqual({
      approval_schema_ref: "schemaRef",
    });
  });
});

describe("describeForm control choice", () => {
  it("offers a choice when the schema lists an enum", () => {
    const [field] = describeForm({
      type: "object",
      properties: { mode: { type: "string", enum: ["fast", "careful"] } },
    }).fields;
    expect(field.control).toBe("select");
    expect(field.options).toEqual(["fast", "careful"]);
  });

  it("lets a model be picked from the catalog instead of typed from memory", () => {
    expect(
      controlsOf({
        type: "object",
        properties: { model_ref: { type: "string", format: "model-ref" } },
      }),
    ).toEqual({ model_ref: "modelRef" });
  });

  it("hides a secret behind its own control instead of plain text", () => {
    expect(
      controlsOf({
        type: "object",
        properties: { api_key: { type: "string", format: "secret-ref" } },
      }),
    ).toEqual({ api_key: "secretRef" });
  });

  it("lets an instruction start from a preset instead of an empty box", () => {
    expect(
      controlsOf({
        type: "object",
        properties: { instruction: { type: "string", format: "instruction" } },
      }),
    ).toEqual({ instruction: "instructionText" });
  });

  it("gives long text its own box", () => {
    expect(
      controlsOf({
        type: "object",
        properties: { note: { type: "string", format: "textarea" } },
      }),
    ).toEqual({ note: "textarea" });
  });

  // format이 없는 이름->글자 표는 그대로 일반 표 편집기다 — 다른 노드의 표는 바뀌지 않는다.
  it("still reads a plain name -> text map as a name -> text map", () => {
    expect(
      controlsOf({
        type: "object",
        properties: {
          headers: { type: "object", additionalProperties: { type: "string" } },
        },
      }),
    ).toEqual({ headers: "stringMap" });
  });

  it("gives the input rows their own editor when the contract asks for it", () => {
    expect(
      controlsOf({
        type: "object",
        properties: {
          bindings: {
            type: "object",
            format: "input-rows",
            additionalProperties: { type: "string" },
          },
        },
      }),
    ).toEqual({ bindings: "inputRows" });
  });

  it("treats a checkbox schema as a checkbox", () => {
    expect(
      controlsOf({ type: "object", properties: { strict: { type: "boolean" } } }),
    ).toEqual({ strict: "boolean" });
  });

  it("treats a plain number the same as an integer", () => {
    expect(
      controlsOf({ type: "object", properties: { ratio: { type: "number" } } }),
    ).toEqual({ ratio: "number" });
  });
});

describe("describeForm fallback", () => {
  it("falls back to raw JSON for a field shape it cannot read", () => {
    expect(
      controlsOf({
        type: "object",
        properties: {
          weird: { oneOf: [{ type: "string" }, { type: "number" }] },
          nested: { type: "object", properties: { a: { type: "string" } } },
          matrix: { type: "array", items: { type: "array" } },
        },
      }),
    ).toEqual({ weird: "json", nested: "json", matrix: "json" });
  });

  it("edits the whole config as raw JSON when the schema itself is unreadable", () => {
    expect(describeForm({ type: "array" })).toEqual({ fields: [], raw: true });
    expect(describeForm("not a schema at all")).toEqual({ fields: [], raw: true });
    expect(describeForm(undefined)).toEqual({ fields: [], raw: true });
  });

  it("shows no fields and no raw editor for a schema with no config at all", () => {
    expect(describeForm({ type: "object", properties: {} })).toEqual({
      fields: [],
      raw: false,
    });
  });
});

describe("describeForm labels", () => {
  it("labels a field with the plain title from the schema", () => {
    const field = describeForm(nodeTypes["llm.agent"].config_schema).fields.find(
      (candidate) => candidate.name === "model_ref",
    );
    expect(field?.label.ko).toBe("사용할 모델");
    expect(field?.description?.ko).toContain("모델");
  });

  it("labels the same field in english from the schema's own words", () => {
    const field = describeForm(nodeTypes["llm.agent"].config_schema).fields.find(
      (candidate) => candidate.name === "model_ref",
    );
    expect(field?.label.en).toBe("Model to use");
    expect(field?.description?.en).toContain("model");
  });

  it("falls back to the field name in both languages when the schema has no title", () => {
    const [field] = describeForm({
      type: "object",
      properties: { raw_name: { type: "string" } },
    }).fields;
    expect(field.label).toEqual({ ko: "raw_name", en: "raw_name" });
    expect(field.description).toBeUndefined();
  });

  it("falls back to the standard title when a schema carries no korean of its own", () => {
    const [field] = describeForm({
      type: "object",
      properties: { ratio: { type: "number", title: "Ratio", description: "How much" } },
    }).fields;
    expect(field.label).toEqual({ ko: "Ratio", en: "Ratio" });
    expect(field.description).toEqual({ ko: "How much", en: "How much" });
  });

  it("marks the fields the schema requires", () => {
    const required = describeForm(nodeTypes["llm.agent"].config_schema)
      .fields.filter((field) => field.required)
      .map((field) => field.name);
    expect(required).toEqual(["model_ref"]);
  });
});

// 그리는 차례는 우연이 아니라 계약이다 — 순서를 아는 곳은 registry 선언뿐이다.
describe("describeForm field order", () => {
  function namesOf(schema: unknown): string[] {
    return describeForm(schema).fields.map((field) => field.name);
  }

  it.each(["llm.agent", "llm.router"])(
    "draws %s fields in the order its schema declares",
    (type) => {
      const schema = nodeTypes[type].config_schema as Record<string, unknown>;
      expect(namesOf(schema)).toEqual(schema["x-field-order"]);
    },
  );

  it("keeps the schema's own key order when it declares none", () => {
    expect(
      namesOf({
        type: "object",
        properties: { zeta: { type: "string" }, alpha: { type: "string" } },
      }),
    ).toEqual(["zeta", "alpha"]);
  });

  // 조용히 잃지 않는다 — 순서에 못 적힌 필드도 화면에는 선다.
  it("puts a field the order forgot at the end instead of dropping it", () => {
    expect(
      namesOf({
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        "x-field-order": ["b"],
      }),
    ).toEqual(["b", "a"]);
  });

  it("skips a name in the order that the schema has no field for", () => {
    expect(
      namesOf({
        type: "object",
        properties: { a: { type: "string" } },
        "x-field-order": ["gone", "a"],
      }),
    ).toEqual(["a"]);
  });
});

// 무엇을 아직 채우지 않았는가 — 버튼을 잠글지 정하는 판정은 화면 밖 순수 함수의 일이다.
describe("missingRequired", () => {
  const form = describeForm({
    type: "object",
    properties: {
      reason: { type: "string" },
      note: { type: "string" },
      count: { type: "number" },
    },
    required: ["reason", "count"],
  });

  it("names every required field nobody filled in", () => {
    expect(missingRequired(form.fields, {})).toEqual(["reason", "count"]);
  });

  it("counts an empty line of text as not filled in", () => {
    expect(missingRequired(form.fields, { reason: "", count: 1 })).toEqual(["reason"]);
  });

  // 공백 한 칸은 적은 것이 아니다 — 보내는 쪽(실행 입력)도 같은 규칙으로 버린다.
  it("counts a line of nothing but spaces as not filled in", () => {
    expect(missingRequired(form.fields, { reason: "   ", count: 1 })).toEqual(["reason"]);
  });

  it("is happy once every required field carries a value", () => {
    expect(missingRequired(form.fields, { reason: "looks right", count: 0 })).toEqual([]);
  });

  it("asks nothing of the fields the schema left optional", () => {
    expect(missingRequired(form.fields, { reason: "ok", count: 2, note: "" })).toEqual([]);
  });

  it("says nothing is missing when the form asks for nothing", () => {
    expect(missingRequired([], {})).toEqual([]);
  });
});
