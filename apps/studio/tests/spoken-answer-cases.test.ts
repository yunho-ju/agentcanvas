// 실행이 낸 말 — engine(Python)의 `spoken_llm_texts`와 같은 말을 골라내야 한다.
// 같은 케이스 파일을 packages/engine/tests/test_spoken_answer_cases.py도 읽는다
// (examples/spoken-answers/README.md). 대화 화면은 이 목록의 마지막 말을 답으로 삼으므로
// 두 쪽이 갈라지면 화면이 답이 아닌 것(갈림길 봉투)을 답이라고 말하게 된다.
import { describe, expect, it } from "vitest";
import cases from "../../../examples/spoken-answers/cases.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import { spokenTexts } from "../src/run/spokenText";

interface SpokenCase {
  name: string;
  spec: AgentSpec;
  events: RunEvent[];
  expected_spoken: string[];
}

const CASES = cases as unknown as SpokenCase[];

describe("두 언어가 같은 말을 고른다", () => {
  it.each(CASES.map((one) => [one.name, one] as const))("%s", (_name, one) => {
    expect(spokenTexts(one.spec, one.events)).toEqual(one.expected_spoken);
  });
});
