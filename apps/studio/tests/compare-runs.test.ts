// 두 실행을 나란히 놓고 어디서부터 달라지는지 찾는 일 — 순수 함수 하나로 끝난다.
// 실행 이름과 시각은 실행마다 다르지만 그것 때문에 달라졌다고 말하지 않는다.
import { describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { endedEarly, firstDivergence, runSteps } from "../src/run/compareRuns";
import { fakeRun, resumeFakeRun } from "../src/run/fakeRun";

const example = exampleSpec as unknown as AgentSpec;
const GATE = "human-gate";

/** 같은 그래프라도 실행할 때마다 이름과 시각은 다르다. */
function runOnce(spec: AgentSpec, number: number) {
  return fakeRun(spec, {
    runId: `run_${number}`,
    startedAt: new Date(`2026-08-01T12:3${number}:00.000Z`),
  });
}

/** 사람 확인 노드가 없는 그래프 — 실행이 끝까지 흐른다. */
function withoutTheGate(): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.filter((node) => node.id !== GATE),
    edges: [
      ...example.edges.filter(
        (edge) => edge.source.node !== GATE && edge.target.node !== GATE,
      ),
      {
        id: "agent-output",
        kind: "data",
        source: { node: "clinical-agent", port: "response" },
        target: { node: "output", port: "input" },
      },
    ],
  };
}

/** 사람 확인 노드가 마지막인 그래프 — 승인하지 않으면 거기가 실행의 끝이다. */
function endingAtTheGate(): AgentSpec {
  return {
    ...example,
    nodes: example.nodes.filter((node) => node.id !== "output"),
    edges: example.edges.filter(
      (edge) => edge.source.node !== "output" && edge.target.node !== "output",
    ),
  };
}

/** 노드 하나를 빼고 그 앞뒤를 곧바로 잇는다 — 노드 목록이 달라진 그래프. */
function withoutTheAgent(spec: AgentSpec): AgentSpec {
  return {
    ...spec,
    nodes: spec.nodes.filter((node) => node.id !== "clinical-agent"),
    edges: [
      ...spec.edges.filter(
        (edge) =>
          edge.source.node !== "clinical-agent" && edge.target.node !== "clinical-agent",
      ),
      {
        id: "triage-output",
        kind: "data",
        source: { node: "triage", port: "passthrough" },
        target: { node: "output", port: "input" },
      },
    ],
  };
}

/** 노드 하나의 설정만 손본 그래프 — 노드 목록은 그대로다. */
function withAnotherPrompt(spec: AgentSpec): AgentSpec {
  return {
    ...spec,
    nodes: spec.nodes.map((node) =>
      node.id === "triage"
        ? { ...node, config: { ...node.config, prompt_ref: "prompt://triage@9" } }
        : node,
    ),
  };
}

describe("실행 하나를 노드 단계로 읽는다", () => {
  it("데이터가 흐른 순서대로 노드 하나에 한 단계씩", () => {
    const steps = runSteps(runOnce(withoutTheGate(), 1));

    expect(steps.map((step) => step.nodeId)).toEqual([
      "input",
      "triage",
      "clinical-agent",
      "output",
    ]);
  });

  it("각 단계가 어떻게 끝났는지 함께 말한다", () => {
    const steps = runSteps(runOnce(withoutTheGate(), 1));

    expect(steps.at(-1)?.status).toBe("completed");
  });

  it("멈춰 선 실행의 마지막 단계는 아직 끝나지 않았다", () => {
    const steps = runSteps(runOnce(example, 1));

    expect(steps.map((step) => step.nodeId)).toEqual([
      "input",
      "triage",
      "clinical-agent",
      GATE,
    ]);
    expect(steps.at(-1)?.status).toBe("waiting");
  });

  it("아무 일도 없던 실행에는 단계도 없다", () => {
    expect(runSteps([])).toEqual([]);
  });
});

describe("두 실행이 갈라지는 첫 자리", () => {
  it("같은 그래프를 다시 실행하면 갈라지지 않는다 — 이름도 시각도 다르지만", () => {
    const spec = withoutTheGate();

    const diverged = firstDivergence(runSteps(runOnce(spec, 1)), runSteps(runOnce(spec, 2)));

    expect(diverged).toBeNull();
  });

  it("설정을 바꾼 노드의 단계에서 갈라진다", () => {
    const spec = withoutTheGate();

    const diverged = firstDivergence(
      runSteps(runOnce(spec, 1)),
      runSteps(runOnce(withAnotherPrompt(spec), 2)),
    );

    expect(diverged).toBe(1);
  });

  it("노드를 빼면 그 앞 노드가 결과를 넘기는 자리부터 달라진다", () => {
    const spec = withoutTheGate();

    const diverged = firstDivergence(
      runSteps(runOnce(spec, 1)),
      runSteps(runOnce(withoutTheAgent(spec), 2)),
    );

    expect(diverged).toBe(1);
  });

  it("한쪽이 멈춰 선 단계에서 갈라진다 — 한쪽은 기다리고 한쪽은 지나갔다", () => {
    const held = runOnce(example, 1);
    const wentOn = resumeFakeRun(example, runOnce(example, 2), { approved: true });
    const shorter = runSteps(held);

    const diverged = firstDivergence(shorter, runSteps(wentOn));

    expect(shorter).toHaveLength(4);
    expect(diverged).toBe(3);
  });

  it("멈춘 자리가 마지막 노드여도 똑같다고 말하지 않는다", () => {
    const spec = endingAtTheGate();
    const held = runSteps(runOnce(spec, 1));
    const wentOn = runSteps(resumeFakeRun(spec, runOnce(spec, 2), { approved: true }));

    expect(held).toHaveLength(wentOn.length);
    expect(held.at(-1)?.status).toBe("waiting");
    expect(wentOn.at(-1)?.status).toBe("completed");
    expect(firstDivergence(held, wentOn)).toBe(held.length - 1);
  });

  it("먼저 끝난 쪽만 먼저 끝났다고 말한다", () => {
    const spec = endingAtTheGate();
    const held = runSteps(runOnce(spec, 1));
    const wentOn = runSteps(resumeFakeRun(spec, runOnce(spec, 2), { approved: true }));

    expect(endedEarly(held, wentOn)).toBe(true);
    expect(endedEarly(wentOn, held)).toBe(false);
  });

  it("둘 다 같은 자리에 멈춰 섰으면 먼저 끝난 쪽은 없다", () => {
    const held = runSteps(runOnce(example, 1));
    const alsoHeld = runSteps(runOnce(example, 2));

    expect(endedEarly(held, alsoHeld)).toBe(false);
  });

  it("이름표만 다른 그래프는 같은 실행이다 — revision은 견주는 자리에 없다", () => {
    const spec = withoutTheGate();
    const restamped = { ...spec, revision: `${spec.revision}-2` };

    const diverged = firstDivergence(
      runSteps(runOnce(spec, 1)),
      runSteps(runOnce(restamped, 2)),
    );

    expect(diverged).toBeNull();
  });

  it("어느 쪽을 먼저 놓아도 같은 자리를 가리킨다", () => {
    const held = runSteps(runOnce(example, 1));
    const wentOn = runSteps(resumeFakeRun(example, runOnce(example, 2), { approved: true }));

    expect(firstDivergence(wentOn, held)).toBe(firstDivergence(held, wentOn));
  });

  it("한쪽에 아무 단계도 없으면 첫 자리에서 갈라진다 — 던지지 않는다", () => {
    expect(firstDivergence([], runSteps(runOnce(example, 1)))).toBe(0);
    expect(firstDivergence([], [])).toBeNull();
  });
});
