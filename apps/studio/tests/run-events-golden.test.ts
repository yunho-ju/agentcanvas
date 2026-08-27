// 예시 실행의 이벤트를 파일 하나에 못 박는다 — 같은 파일을 Python 계약 테스트도 읽는다
// (packages/contracts/tests/test_example_run_events.py, detach_reachability.json과 같은 방식).
// 이벤트가 달라져야 하는 변경이라면: pnpm vitest run tests/run-events-golden.test.ts -u
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { fakeRun, resumeFakeRun } from "../src/run/fakeRun";

const example = exampleSpec as unknown as AgentSpec;

/** 골든 파일이 흔들리지 않도록 실행 이름과 시작 시각을 고정한다. */
const EXAMPLE_RUN = {
  runId: "run_example",
  startedAt: new Date("2026-08-01T12:30:00.000Z"),
};

describe("the recorded example run", () => {
  // 예시 그래프에는 사람 확인 밸브가 있다 — 기록해 두는 것은 사람이 승인해 끝까지 흐른 실행이다.
  it("is what the fake runtime produces for the example spec today", async () => {
    const events = resumeFakeRun(example, fakeRun(example, EXAMPLE_RUN), {
      approved: true,
    });

    await expect(`${JSON.stringify(events, null, 2)}\n`).toMatchFileSnapshot(
      "../../../examples/basic-agent/run_events.json",
    );
  });
});
