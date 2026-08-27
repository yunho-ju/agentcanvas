// 시험받는 지시문과 '빠진 말'의 순수 규칙 (DESIGN §7 eval-prompt-card, EVAL-1).
// 지시문을 가진 노드를 고르는 일과, 답에서 무엇이 빠졌는지 세는 일은 화면 없이도 성립한다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { promptsUnderTest } from "../src/eval/promptsUnderTest";
import { attemptInQuestion } from "../src/eval/caseState";
import { answerSpread } from "../src/eval/answerSpread";
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

/** 서버가 돌려준 배치 한 벌 — 회차의 판정도 근거도 서버가 적어 온 그대로다. */
function batchWith(
  attempts: { passed: boolean; output_text: string; missing_phrases?: string[] }[],
): EvalBatch {
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

describe("attemptInQuestion — 화면이 말하는 그 회차", () => {
  it("돌린 적이 없으면 말할 회차도 없다", () => {
    expect(attemptInQuestion("case-1", null)).toBeUndefined();
  });

  it("실패한 회차가 있으면 가장 최근에 실패한 회차를 말한다", () => {
    const batch = batchWith([
      { passed: false, output_text: "첫 번째 답" },
      { passed: true, output_text: "두 번째 답" },
    ]);

    expect(attemptInQuestion("case-1", batch)).toEqual({
      round: 1,
      rounds: 2,
      output: "첫 번째 답",
      missing: [],
    });
  });

  it("실패한 회차가 없으면 마지막 회차를 말한다", () => {
    const batch = batchWith([
      { passed: true, output_text: "첫 번째 답" },
      { passed: true, output_text: "두 번째 답" },
    ]);

    expect(attemptInQuestion("case-1", batch)).toEqual({
      round: 2,
      rounds: 2,
      output: "두 번째 답",
      missing: [],
    });
  });

  it("그 회차의 빠진 말은 서버가 실어 준 근거 그대로다 — 화면이 다시 세지 않는다", () => {
    // 서버(casefold)와 화면(toLowerCase)이 갈리는 독일어 ß도, 화면은 서버가 적은 것만 그린다.
    const batch = batchWith([
      { passed: false, output_text: "STRASSE", missing_phrases: ["straße"] },
    ]);

    expect(attemptInQuestion("case-1", batch)?.missing).toEqual(["straße"]);
  });

  it("근거를 싣지 않은 옛 배치의 회차는 근거가 빈 목록이다", () => {
    const batch = batchWith([{ passed: false, output_text: "옛 답" }]);

    expect(attemptInQuestion("case-1", batch)?.missing).toEqual([]);
  });
});

// 안정성 신호 — 판정이 아니라 관찰이다 (DESIGN §7 eval-case-card 주의 신호 한 줄).
describe("answerSpread — 회차마다 답이 갈렸는가", () => {
  it("회차 답이 갈리면 몇 번 중 몇 가지였는지 센다", () => {
    const batch = batchWith([
      { passed: true, output_text: "반갑습니다" },
      { passed: true, output_text: "안녕하세요" },
      { passed: true, output_text: "반갑습니다" },
    ]);

    expect(answerSpread("case-1", batch)).toEqual({ rounds: 3, answers: 2 });
  });

  it("회차 답이 모두 같으면 할 말이 없다", () => {
    const batch = batchWith([
      { passed: true, output_text: "반갑습니다" },
      { passed: true, output_text: "반갑습니다" },
    ]);

    expect(answerSpread("case-1", batch)).toBeUndefined();
  });

  it("한 번만 돌린 케이스는 갈릴 자리가 없다", () => {
    expect(answerSpread("case-1", batchWith([{ passed: true, output_text: "반갑습니다" }]))).toBeUndefined();
  });

  it("돌린 적이 없으면 할 말이 없다", () => {
    expect(answerSpread("case-1", null)).toBeUndefined();
  });

  it("답 글자 그대로 견준다 — 공백 한 칸이 다르면 다른 답이다", () => {
    const batch = batchWith([
      { passed: true, output_text: "반갑 습니다" },
      { passed: true, output_text: "반갑습니다" },
    ]);

    expect(answerSpread("case-1", batch)).toEqual({ rounds: 2, answers: 2 });
  });
});
