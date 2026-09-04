// json_schema/*.json -> src/generated/*.ts. 손으로 고치지 말고 `pnpm gen:types`로 다시 만든다.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

export const SCHEMA_DIR = fileURLToPath(
  new URL("../../../packages/contracts/json_schema", import.meta.url),
);
export const GENERATED_DIR = fileURLToPath(
  new URL("../src/generated", import.meta.url),
);
export const GENERATED_SCHEMAS = [
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
  "pattern_def",
  "run",
  "run_event",
  "schema_def",
  "skill_def",
  "spec_publication",
];

export async function renderTypes(name) {
  return compileFromFile(`${SCHEMA_DIR}/${name}.json`, {
    bannerComment:
      "/* eslint-disable */\n/**\n * packages/contracts/json_schema/" +
      `${name}.json 에서 생성된 파일입니다. 직접 수정하지 마세요.\n` +
      " * 다시 만들기: pnpm gen:types\n */",
    additionalProperties: false,
    style: { singleQuote: false },
  });
}

export async function writeTypes() {
  await mkdir(GENERATED_DIR, { recursive: true });
  const written = [];
  for (const name of GENERATED_SCHEMAS) {
    const path = `${GENERATED_DIR}/${name}.ts`;
    await writeFile(path, await renderTypes(name), "utf-8");
    written.push(path);
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const path of await writeTypes()) console.log(path);
}
