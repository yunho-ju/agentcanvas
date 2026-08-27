// Python `agentcanvas_contracts.schema_catalog` 테스트의 미러 — 두 리졸버가 같은 판정을 내린다.
// 카탈로그 자체는 손으로 옮겨 적지 않는다: 계약이 내보낸 schema_catalog.json 하나가 원본이다.
import { describe, expect, it } from "vitest";
import catalogData from "../../../packages/contracts/json_schema/schema_catalog.json";
import { LOCALES } from "../src/i18n/locale";
import { SCHEMA_CATALOG, resolveSchema } from "../src/registry/schemaCatalog";

const ANSWER_REVIEW = "schema://answer-review@1";

describe("schema catalog data", () => {
  it("comes from the committed schema_catalog.json, keyed by ref", () => {
    expect(Object.keys(SCHEMA_CATALOG)).toEqual(Object.keys(catalogData));
    for (const [ref, definition] of Object.entries(SCHEMA_CATALOG)) {
      expect(definition.ref).toBe(ref);
    }
  });

  it("gives every definition a title in both languages", () => {
    for (const definition of Object.values(SCHEMA_CATALOG)) {
      for (const locale of LOCALES) {
        expect(definition.title[locale].trim()).not.toBe("");
      }
    }
  });

  it("asks for an optional review note in the form the seed describes", () => {
    const seed = SCHEMA_CATALOG[ANSWER_REVIEW];
    const properties = seed.schema.properties as Record<string, Record<string, unknown>>;

    expect(seed.schema.type).toBe("object");
    expect(seed.schema.required).toEqual([]);
    expect(properties.comment.type).toBe("string");
    expect(properties.comment.format).toBe("textarea");
  });
});

describe("resolveSchema mirrors the Python contract", () => {
  it("finds a ref the catalog holds", () => {
    expect(resolveSchema(ANSWER_REVIEW)).toBe(SCHEMA_CATALOG[ANSWER_REVIEW]);
  });

  it.each([
    "",
    "schema://nothing-here@1",
    "schema://answer-review@2",
    "schema://answer-review",
    "SCHEMA://ANSWER-REVIEW@1",
    "not a ref at all",
  ])("says nothing rather than throwing for %j", (ref) => {
    expect(resolveSchema(ref)).toBeUndefined();
  });
});
