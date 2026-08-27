// 처음 온 사람의 네 걸음 (DESIGN §7 first-steps-card).
// 걸음의 완료는 그래프의 실제 상태에서 파생된다 — 켜고 끄는 튜토리얼 상태 머신이 아니다.
import { describe, expect, it } from "vitest";
import { type FirstStepsInput, currentStep, firstSteps } from "../src/guide/firstSteps";

const NOTHING_YET: FirstStepsInput = {
  nodeCount: 0,
  edgeCount: 0,
  needsSetupCount: 0,
  runFinished: false,
};

function doneKeys(input: FirstStepsInput): string[] {
  return firstSteps(input)
    .filter((step) => step.done)
    .map((step) => step.key);
}

describe("네 걸음의 완료는 그래프에서 파생된다", () => {
  it("빈 캔버스에서는 한 걸음도 걷지 않았다", () => {
    expect(firstSteps(NOTHING_YET)).toEqual([
      { key: "place", done: false },
      { key: "link", done: false },
      { key: "fill", done: false },
      { key: "run", done: false },
    ]);
  });

  it("노드를 하나 놓으면 첫 걸음이 끝난다", () => {
    expect(doneKeys({ ...NOTHING_YET, nodeCount: 1 })).toContain("place");
  });

  it("연결이 하나라도 있으면 잇는 걸음이 끝난다", () => {
    expect(doneKeys({ ...NOTHING_YET, edgeCount: 1 })).toContain("link");
  });

  it("채울 것이 남은 노드가 없어야 채우는 걸음이 끝난다", () => {
    expect(doneKeys({ ...NOTHING_YET, nodeCount: 2, needsSetupCount: 1 })).not.toContain(
      "fill",
    );
    expect(doneKeys({ ...NOTHING_YET, nodeCount: 2, needsSetupCount: 0 })).toContain("fill");
  });

  it("아직 아무것도 놓지 않았다면 채운 것도 아니다", () => {
    expect(doneKeys(NOTHING_YET)).not.toContain("fill");
  });

  it("이번 실행이 끝까지 가야 마지막 걸음이 끝난다", () => {
    expect(doneKeys({ ...NOTHING_YET, runFinished: true })).toContain("run");
  });
});

describe("지금 걸음은 첫 미완료 걸음이다", () => {
  it("빈 캔버스에서는 노드를 놓는 걸음이다", () => {
    expect(currentStep(firstSteps(NOTHING_YET))).toBe("place");
  });

  // 뒤 걸음이 앞 걸음보다 먼저 끝날 수 있다 — done은 걸음마다 제 것이고, 지금 걸음만 순서를 본다.
  it("뒤 걸음을 먼저 끝내도 지금 걸음은 앞의 미완료 걸음이다", () => {
    const steps = firstSteps({
      nodeCount: 2,
      edgeCount: 0,
      needsSetupCount: 0,
      runFinished: false,
    });

    expect(doneKeys({ nodeCount: 2, edgeCount: 0, needsSetupCount: 0, runFinished: false }))
      .toEqual(["place", "fill"]);
    expect(currentStep(steps)).toBe("link");
  });

  it("네 걸음을 모두 걸었으면 지금 걸음이 없다", () => {
    const steps = firstSteps({
      nodeCount: 2,
      edgeCount: 1,
      needsSetupCount: 0,
      runFinished: true,
    });

    expect(steps.every((step) => step.done)).toBe(true);
    expect(currentStep(steps)).toBeNull();
  });
});
