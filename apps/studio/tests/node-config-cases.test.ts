// 노드 설정에 문제가 있는가 — Python `config_issues`와 같은 판정이어야 한다.
// 같은 케이스 파일을 packages/contracts/tests/test_node_config_cases.py도 읽는다:
// 저쪽은 config_issues가 문장을 내놓는지 묻고, 여기서는 validateConfig가 오류를 내놓는지 묻는다.
// 문구는 비교하지 않는다 — 언어가 다르다 (examples/node-configs/README.md).
import { describe, expect, it } from "vitest";
import cases from "../../../examples/node-configs/cases.json";
import { validateConfig } from "../src/inspector/validateConfig";
import { nodeTypes } from "../src/registry/registry";

interface ConfigCase {
  name: string;
  node_type: string;
  config: Record<string, unknown>;
  valid: boolean;
}

const CASES = cases as ConfigCase[];

function looksFine(one: ConfigCase): boolean {
  return validateConfig(nodeTypes[one.node_type].config_schema, one.config).length === 0;
}

describe("노드 설정이 쓸 만한가 — 서버와 같은 판정", () => {
  it.each(CASES)("$name", (one) => {
    expect(looksFine(one)).toBe(one.valid);
  });

  it("케이스는 두 가지 답을 모두 담는다", () => {
    expect(new Set(CASES.map((one) => one.valid))).toEqual(new Set([true, false]));
  });
});
