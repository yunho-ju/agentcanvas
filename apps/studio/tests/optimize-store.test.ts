// 지금 그래프를 objective로 고치는 흐름 — 승인 전에는 그래프가 그대로다 (OPT-1).
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { OptimizeOutcome } from "../src/api/optimize";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

/** 후보는 예제 그래프에서 한 노드의 설정만 바꾼 것 — 그래프는 여전히 유효하다. */
function candidateOutcome(): OptimizeOutcome {
  const candidate: AgentSpec = {
    ...example,
    nodes: example.nodes.map((node) =>
      node.id === "triage"
        ? { ...node, config: { ...node.config, model_ref: "model://small" } }
        : node,
    ),
  };
  return {
    candidate,
    issues: [],
    proposal: {
      objective: { ko: "비용을 줄인다", en: "cut the cost" },
      hypothesis: { ko: "큰 모델을 쓴다", en: "it uses too large a model" },
      target_nodes: ["triage"],
      expected_effect: { ko: "비용이 준다", en: "cost goes down" },
      evidence: { batch_id: "batch_7", cases: 12, cases_with_gaps: 3 },
    },
  };
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
  useEditor.setState({
    optimizeOnServer: async () => candidateOutcome(),
  });
  store().leaveOptimizeMode();
});

describe("OptimizeSlice", () => {
  it("enters on an existing graph and asks for an objective", () => {
    store().enterOptimizeMode();

    expect(store().optimizeMode).toBe("input");
  });

  it("does not enter on an empty canvas — there is nothing to optimize", () => {
    useEditor.setState({ spec: null, nodes: [], edges: [] });

    store().enterOptimizeMode();

    expect(store().optimizeMode).toBe("closed");
  });

  it("keeps the graph unchanged while a candidate is under review", async () => {
    store().enterOptimizeMode();
    store().setOptimizeObjective("cut the cost");

    await store().buildOptimizeCandidate();

    expect(store().optimizeMode).toBe("review");
    expect(store().optimizeProposal?.objective.en).toBe("cut the cost");
    expect(store().nodes).toHaveLength(example.nodes.length); // 승인 전 그래프 불변
  });

  it("applies the candidate as one undo step on approval", async () => {
    store().enterOptimizeMode();
    store().setOptimizeObjective("cut the cost");
    await store().buildOptimizeCandidate();
    const steps = store().undoStack.length;

    expect(store().applyOptimizeCandidate()).toBe(true);

    const triage = () =>
      store().nodes.find((node) => node.id === "triage")?.data.spec.config?.model_ref;
    expect(triage()).toBe("model://small");
    expect(store().undoStack.length).toBe(steps + 1);
    store().undo();
    expect(triage()).not.toBe("model://small");
  });

  it("a blank objective does not ask the server", async () => {
    store().enterOptimizeMode();

    await store().buildOptimizeCandidate();

    expect(store().optimizeMode).toBe("input");
    expect(store().optimizeError).toEqual({ key: "optimize.error.empty" });
  });

  it("leaving optimize mode drops the candidate and closes", async () => {
    store().enterOptimizeMode();
    store().setOptimizeObjective("cut the cost");
    await store().buildOptimizeCandidate();

    store().leaveOptimizeMode();

    expect(store().optimizeMode).toBe("closed");
    expect(store().optimizeCandidate).toBeNull();
    expect(store().nodes).toHaveLength(example.nodes.length);
  });

  it("a server failure keeps the objective and says why", async () => {
    useEditor.setState({
      optimizeOnServer: async () => ({ failure: { key: "optimize.error.offline" } }),
    });
    store().enterOptimizeMode();
    store().setOptimizeObjective("cut the cost");

    await store().buildOptimizeCandidate();

    expect(store().optimizeMode).toBe("input");
    expect(store().optimizeObjective).toBe("cut the cost");
    expect(store().optimizeError).toEqual({ key: "optimize.error.offline" });
  });
});
