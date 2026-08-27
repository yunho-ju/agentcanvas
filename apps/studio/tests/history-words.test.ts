// 실행 한 번을 한 줄로 요약하는 말. 카드에 적히는 글은 여기서만 만든다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import { runSummary } from "../src/run/historyWords";
import type { RunRecord } from "../src/store/runSlice";

const example = exampleSpec as unknown as AgentSpec;

/** 시작하고 몇 ms 뒤에 일어난 사건들 — 요약이 보는 것은 개수와 마지막 시각뿐이다. */
function record(offsetsMs: number[], order = 1): RunRecord {
  const start = Date.parse("2026-08-01T12:30:00.000Z");
  const events = offsetsMs.map(
    (offset, index) =>
      ({
        seq: index,
        timestamp: new Date(start + offset).toISOString(),
      }) as unknown as RunEvent,
  );
  return {
    id: "run_1",
    at: new Date(start),
    order,
    events,
    specSnapshot: example,
  };
}

describe("실행 카드에 적히는 한 줄", () => {
  it("몇 번째 실행인지·몇 단계였는지·얼마나 걸렸는지를 함께 말한다", () => {
    expect(runSummary(record([0, 1000, 3200]), "ko")).toBe("실행 1 · 3단계 · 3.2초");
  });

  it("초는 소수 한 자리까지만 — 숫자가 길어져 읽기를 방해하지 않는다", () => {
    expect(runSummary(record([0, 3249]), "ko")).toBe("실행 1 · 2단계 · 3.2초");
  });

  it("눈 깜짝할 새 끝난 실행도 시간을 말한다", () => {
    expect(runSummary(record([0]), "ko")).toBe("실행 1 · 1단계 · 0초");
  });

  it("몇 번째 실행인지는 기록이 들고 있는 순번에서 나온다", () => {
    expect(runSummary(record([0, 500], 12), "ko")).toContain("실행 12");
  });

  it("영어로 읽는 사람에게는 같은 내용을 영어 한 줄로 말한다", () => {
    expect(runSummary(record([0, 1000, 3200]), "en")).toBe("Run 1 · 3 steps · 3.2s");
  });

  it("한 단계뿐인 실행도 영어 말끝이 어색하지 않다", () => {
    expect(runSummary(record([0]), "en")).toBe("Run 1 · 1 step · 0s");
  });
});
