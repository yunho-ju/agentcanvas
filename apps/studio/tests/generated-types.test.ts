// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  GENERATED_DIR,
  GENERATED_SCHEMAS,
  renderTypes,
} from "../scripts/generate-types.mjs";

describe("generated contract types", () => {
  it("covers the schemas the studio reads", () => {
    expect([...GENERATED_SCHEMAS].sort()).toEqual([
      "agent_spec",
      "agent_spec_patch",
      "approval_answer",
      "eval_batch",
      "eval_case",
      "eval_dataset",
      "evaluator_def",
      "instruction_preset_def",
      "model_def",
      "node_type",
      "optimization_proposal",
      "run",
      "run_event",
      "schema_def",
    ]);
  });

  it.each([...GENERATED_SCHEMAS])(
    "%s.ts on disk matches what json-schema-to-typescript produces now",
    async (name) => {
      const committed = await readFile(`${GENERATED_DIR}/${name}.ts`, "utf-8");
      expect(committed).toBe(await renderTypes(name));
    },
  );
});
