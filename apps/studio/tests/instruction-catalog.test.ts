// Python `agentcanvas_contracts.instruction_catalog` 테스트의 미러 — 두 쪽이 같은 글을 들고 있다.
// 프리셋 본문은 손으로 옮겨 적지 않는다: 계약이 내보낸 instruction_catalog.json 하나가 원본이다.
import { describe, expect, it } from "vitest";
import catalogData from "../../../packages/contracts/json_schema/instruction_catalog.json";
import { LOCALES } from "../src/i18n/locale";
import {
  INSTRUCTION_CATALOG,
  resolveInstructionPreset,
} from "../src/registry/instructionCatalog";

const SUMMARIZE = "summarize";

describe("instruction preset catalog data", () => {
  it("comes from the committed instruction_catalog.json, keyed by id", () => {
    expect(Object.keys(INSTRUCTION_CATALOG)).toEqual(Object.keys(catalogData));
    for (const [id, preset] of Object.entries(INSTRUCTION_CATALOG)) {
      expect(preset.id).toBe(id);
    }
  });

  it("gives every preset a title and a text in both languages", () => {
    for (const preset of Object.values(INSTRUCTION_CATALOG)) {
      for (const locale of LOCALES) {
        expect(preset.title[locale].trim()).not.toBe("");
        expect(preset.text[locale].trim()).not.toBe("");
      }
    }
  });

  it("offers the same seed the python catalog holds", () => {
    expect(Object.keys(INSTRUCTION_CATALOG).sort()).toEqual([
      "classify",
      "simplify",
      "summarize",
      "translate",
    ]);
  });

  it("holds the same words the python catalog holds", () => {
    expect(INSTRUCTION_CATALOG[SUMMARIZE].title.en).toBe("Summarize");
    expect(INSTRUCTION_CATALOG[SUMMARIZE].text.ko).toBe(
      "다음 글을 읽고 중요한 내용만 세 문장 이내로 요약해요. 쉬운 말로 써요.",
    );
    expect(INSTRUCTION_CATALOG[SUMMARIZE].text.en).toBe(
      "Read the input and summarize only the important points in three sentences or fewer. Use plain language.",
    );
  });
});

describe("resolveInstructionPreset mirrors the Python contract", () => {
  it("finds an id the catalog holds", () => {
    expect(resolveInstructionPreset(SUMMARIZE)).toBe(INSTRUCTION_CATALOG[SUMMARIZE]);
  });

  it.each([
    "",
    "nothing-here",
    "SUMMARIZE",
    "summarize ",
    "instruction://summarize",
    "not an id at all",
  ])("says nothing rather than throwing for %j", (id) => {
    expect(resolveInstructionPreset(id)).toBeUndefined();
  });
});
