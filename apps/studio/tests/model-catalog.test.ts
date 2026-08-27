// Python `agentcanvas_contracts.model_catalog` 테스트의 미러 — 두 리졸버가 같은 판정을 내린다.
// 목록은 손으로 옮겨 적지 않는다: 계약이 내보낸 model_catalog.json 하나가 원본이다.
import { describe, expect, it } from "vitest";
import catalogData from "../../../packages/contracts/json_schema/model_catalog.json";
import { LOCALES } from "../src/i18n/locale";
import { MODEL_CATALOG, resolveModel } from "../src/registry/modelCatalog";

const DEFAULT_MODEL = "model://default";

describe("model catalog data", () => {
  it("comes from the committed model_catalog.json, keyed by ref", () => {
    expect(Object.keys(MODEL_CATALOG)).toEqual(Object.keys(catalogData));
    for (const [ref, definition] of Object.entries(MODEL_CATALOG)) {
      expect(definition.ref).toBe(ref);
    }
  });

  it("gives every model a title in both languages", () => {
    for (const definition of Object.values(MODEL_CATALOG)) {
      for (const locale of LOCALES) {
        expect(definition.title[locale].trim()).not.toBe("");
      }
    }
  });

  it("offers the same seed the python catalog holds", () => {
    expect(Object.keys(MODEL_CATALOG).sort()).toEqual([
      "model://claude-haiku",
      "model://claude-opus",
      "model://claude-sonnet",
      "model://default",
    ]);
  });
});

describe("resolveModel mirrors the Python contract", () => {
  it("finds a ref the catalog holds", () => {
    expect(resolveModel(DEFAULT_MODEL)).toBe(MODEL_CATALOG[DEFAULT_MODEL]);
  });

  it.each([
    "",
    "model://nothing-here",
    "model://default@2",
    "MODEL://DEFAULT",
    "schema://answer-review@1",
    "not a ref at all",
  ])("says nothing rather than throwing for %j", (ref) => {
    expect(resolveModel(ref)).toBeUndefined();
  });
});
