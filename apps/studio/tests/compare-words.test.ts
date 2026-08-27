// 견주는 화면의 단계 한 줄 — 색을 보지 못해도 기호와 쉬운 말로 무슨 일이 있었는지 읽힌다.
import { describe, expect, it } from "vitest";
import type { RunStep } from "../src/run/compareRuns";
import { stepWords } from "../src/run/compareWords";
import type { NodeRunStatus } from "../src/run/player";

function step(nodeId: string, status: NodeRunStatus): RunStep {
  return { nodeId, status, marks: [] };
}

describe("단계 하나를 읽는 한 줄", () => {
  it("어느 노드가 무엇을 했는지 함께 말한다", () => {
    expect(stepWords(step("triage", "completed"), "ko").line).toBe("'triage' 노드가 마쳤다");
  });

  it("색을 보지 못해도 구분되도록 기호가 함께 간다", () => {
    expect(stepWords(step("triage", "completed"), "ko").mark).toBe("✓");
    expect(stepWords(step("human-gate", "waiting"), "ko").mark).toBe("✋");
  });

  it("사람을 기다리다 멈춘 단계는 기다린다고 말한다", () => {
    expect(stepWords(step("human-gate", "waiting"), "ko").line).toContain(
      "확인을 기다려요",
    );
  });

  it("끝내지 못한 단계도 감추지 않고 말한다", () => {
    expect(stepWords(step("triage", "failed"), "ko").line).toContain("끝내지 못했다");
  });

  it("영어로 읽는 사람에게는 같은 내용을 영어 한 줄로 말한다", () => {
    expect(stepWords(step("triage", "completed"), "en").line).toBe(
      "The 'triage' node — All done",
    );
  });
});
