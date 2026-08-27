// 시험받는 지시문과 '빠진 말'의 순수 규칙 (DESIGN §7 eval-prompt-card, EVAL-1).
// 지시문을 가진 노드를 고르는 일과, 답에서 무엇이 빠졌는지 세는 일은 화면 없이도 성립한다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { promptsUnderTest } from "../src/eval/promptsUnderTest";
import { attemptInQuestion } from "../src/eval/caseState";
import { missingPhrases } from "../src/eval/missingPhrases";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { EvalBatch } from "../src/generated/eval_batch";
import type { NodeType } from "../src/generated/node_type";
import { nodeTypes } from "../src/registry/registry";

const example = exampleSpec as unknown as AgentSpec;

/** 지시문을 이 노드에 적어 둔 문서 — 원본은 노드 config 하나뿐이다. */
function specWith(instructions: Record<string, string>): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.map((node) =>
      instructions[node.id] === undefined
        ? node
        : { ...node, config: { ...node.config, instruction: instructions[node.id] } },
    ),
  } as AgentSpec;
}

describe("promptsUnderTest — 무엇을 시험하고 있는가", () => {
  it("지시문을 적어 둔 노드 하나면 그 노드의 지시문 하나를 낸다", () => {
    const prompts = promptsUnderTest(specWith({ "clinical-agent": "환자에게 친절하게 답해요" }), nodeTypes);

    expect(prompts.map((prompt) => [prompt.nodeId, prompt.instruction])).toEqual([
      ["triage", ""],
      ["clinical-agent", "환자에게 친절하게 답해요"],
    ]);
  });

  it("지시문 노드가 여럿이면 노드마다 하나씩, 노드 이름으로 갈라 낸다", () => {
    const prompts = promptsUnderTest(
      specWith({ triage: "먼저 급한지 가려요", "clinical-agent": "친절하게 답해요" }),
      nodeTypes,
    );

    expect(prompts).toHaveLength(2);
    expect(prompts.map((prompt) => prompt.displayName.ko)).toEqual([
      nodeTypes["llm.router"].display_name.ko,
      nodeTypes["llm.agent"].display_name.ko,
    ]);
  });

  it("지시문이 아직 없는 노드도 빠뜨리지 않는다 — 빈 글로 낸다", () => {
    const prompts = promptsUnderTest(example, nodeTypes);

    expect(prompts.map((prompt) => prompt.instruction)).toEqual(["", ""]);
  });

  it("지시문을 가질 수 있는 노드가 하나도 없으면 아무것도 내지 않는다", () => {
    const noPrompts = { ...example, nodes: example.nodes.filter((node) => !node.type.startsWith("llm.")) } as AgentSpec;

    expect(promptsUnderTest(noPrompts, nodeTypes)).toEqual([]);
  });

  it("고르는 기준은 registry의 config_schema다 — 노드 타입 이름이 아니다", () => {
    // 이름이 llm과 아무 상관 없는 새 타입이라도 config_schema에 instruction이 있으면 시험 대상이다.
    const registry: Record<string, NodeType> = {
      "some.newcomer": {
        ...nodeTypes["llm.agent"],
        type: "some.newcomer",
        display_name: { ko: "새로 온 단계", en: "A new step" },
      },
    };
    const spec = {
      ...example,
      nodes: [{ id: "newcomer", type: "some.newcomer", position: { x: 0, y: 0 }, config: { instruction: "새 말" } }],
    } as unknown as AgentSpec;

    expect(promptsUnderTest(spec, registry)).toEqual([
      { nodeId: "newcomer", displayName: { ko: "새로 온 단계", en: "A new step" }, instruction: "새 말" },
    ]);
  });
});

// 서버 판정(packages/engine/agentcanvas_engine/evaluation/expected_phrases.py)의 미러다.
// 아래 케이스는 packages/engine/tests/test_evaluation_expected_phrases.py와 같은 케이스다 —
// 규칙이 갈라지면 "실패인데 빠진 말이 없다"는 모순 화면이 나온다.
describe("missingPhrases — 서버 판정과 같은 규칙으로 빠진 말을 고른다", () => {
  it("대소문자 차이는 빠진 것이 아니다", () => {
    expect(missingPhrases("Nice to meet YOU", ["nice to meet you"])).toEqual([]);
  });

  it("연속 공백·개행은 1칸으로 좁혀 견준다", () => {
    expect(missingPhrases("hello,\n\n  nice   to\nmeet   you  world", ["nice to meet you"])).toEqual([]);
  });

  it("같은 글자의 결합형·분해형은 같은 것으로 본다", () => {
    const composed = "café".normalize("NFC");
    const decomposed = "café".normalize("NFD");
    expect(composed).not.toBe(decomposed);

    expect(missingPhrases(`welcome to the ${decomposed}`, [composed])).toEqual([]);
  });

  it("둘 중 하나만 들어 있으면 없던 그 말만 골라 낸다 — 적은 그대로 돌려준다", () => {
    expect(missingPhrases("반갑습니다, 오늘도 좋은 하루예요", ["반갑습니다", "감사합니다"])).toEqual([
      "감사합니다",
    ]);
  });

  it("답이 비어 있으면 기대한 말은 모두 빠진 말이다", () => {
    expect(missingPhrases("", ["아무 말이나"])).toEqual(["아무 말이나"]);
  });

  it("서버가 공백으로 보지 않는 글자(U+FEFF)는 우리도 공백으로 보지 않는다", () => {
    // 파이썬 re의 \s에는 U+FEFF가 없다 — JS의 \s를 그대로 쓰면 서버는 실패인데 화면은 빠진 말 0이 된다.
    expect(missingPhrases("hello﻿world", ["hello world"])).toEqual(["hello world"]);
  });

  it("서버가 공백으로 보는 글자(U+00A0·U+3000·U+001C)는 우리도 1칸으로 좁힌다", () => {
    expect(missingPhrases("hello 　world", ["hello world"])).toEqual([]);
  });
});

describe("attemptInQuestion — 화면이 말하는 그 회차", () => {
  function batchWith(attempts: { passed: boolean; output_text: string }[]): EvalBatch {
    return {
      id: "batch",
      dataset_id: "ds",
      spec_id: "spec",
      spec_revision: "rev",
      started_at: "2026-08-20T00:00:00.000Z",
      results: [
        {
          case_id: "case-1",
          evaluator: "expected_phrases",
          evaluator_version: "v1",
          passed: false,
          attempts: attempts.map((attempt, index) => ({ run_id: `r${index}`, ...attempt })),
        },
      ],
    };
  }

  it("돌린 적이 없으면 말할 회차도 없다", () => {
    expect(attemptInQuestion("case-1", null)).toBeUndefined();
  });

  it("실패한 회차가 있으면 가장 최근에 실패한 회차를 말한다", () => {
    const batch = batchWith([
      { passed: false, output_text: "첫 번째 답" },
      { passed: true, output_text: "두 번째 답" },
    ]);

    expect(attemptInQuestion("case-1", batch)).toEqual({ round: 1, rounds: 2, output: "첫 번째 답" });
  });

  it("실패한 회차가 없으면 마지막 회차를 말한다", () => {
    const batch = batchWith([
      { passed: true, output_text: "첫 번째 답" },
      { passed: true, output_text: "두 번째 답" },
    ]);

    expect(attemptInQuestion("case-1", batch)).toEqual({ round: 2, rounds: 2, output: "두 번째 답" });
  });
});
