// 처음 온 사람이 빈 캔버스에서 첫 실행까지 걷는 네 걸음 (DESIGN §7 first-steps-card).
// 걸음의 완료는 그래프의 지금 상태에서 파생한다 — 따로 켜고 끄는 튜토리얼 상태가 없다. 순수 함수다.

/** 걸음 하나의 이름 — 화면의 문구도, 완료 술어도 이 이름을 따라간다. */
export type FirstStepKey = "place" | "link" | "fill" | "run";

/** 걸음을 판정하는 데 필요한 재료 전부 — 판정에 쓰는 것 말고는 받지 않는다. */
export interface FirstStepsInput {
  nodeCount: number;
  edgeCount: number;
  /** 아직 채울 것이 남은 노드의 수 (graph/nodeSetupIssues의 판정을 그대로 받는다) */
  needsSetupCount: number;
  /** 이번 실행이 끝까지 갔는가 */
  runFinished: boolean;
}

export interface FirstStep {
  key: FirstStepKey;
  done: boolean;
}

/**
 * 걸음마다 "끝났다"가 무슨 뜻인가 — 새 걸음은 여기 한 줄을 더한다.
 * 순서는 걷는 순서다: 지금 걸음은 이 순서에서 처음 만나는 미완료 걸음이다.
 */
const DONE_WHEN: Record<FirstStepKey, (input: FirstStepsInput) => boolean> = {
  place: (input) => input.nodeCount >= 1,
  link: (input) => input.edgeCount >= 1,
  // 놓은 것이 없으면 채운 것도 없다 — 빈 캔버스는 "다 채웠다"가 아니다.
  fill: (input) => input.nodeCount >= 1 && input.needsSetupCount === 0,
  run: (input) => input.runFinished,
};

export const FIRST_STEP_KEYS = Object.keys(DONE_WHEN) as FirstStepKey[];

/** 지금 그래프에서 네 걸음이 각각 끝났는가. 걸음마다 제 술어만 본다. */
export function firstSteps(input: FirstStepsInput): FirstStep[] {
  return FIRST_STEP_KEYS.map((key) => ({ key, done: DONE_WHEN[key](input) }));
}

/** 지금 걸을 걸음 — 처음 만나는 미완료 걸음. 다 걸었으면 없다. */
export function currentStep(steps: FirstStep[]): FirstStepKey | null {
  return steps.find((step) => !step.done)?.key ?? null;
}
