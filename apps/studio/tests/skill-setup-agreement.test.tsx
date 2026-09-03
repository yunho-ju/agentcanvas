// 문서에 없는 skill을 입은 단계는 화면 어디서나 같은 수로 말한다 (SK-3 리뷰 지적 2).
// 뱃지·실행 옆 pill·실행 게이트·첫 걸음이 한 판정(graph/nodeSetupIssues)을 함께 읽는다.
import { ReactFlowProvider } from "@xyflow/react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import { NodeCard } from "../src/canvas/NodeCard";
import type { AgentSpec } from "../src/generated/agent_spec";
import { firstSteps } from "../src/guide/firstSteps";
import { nodesNeedingSetup } from "../src/graph/nodeSetupIssues";
import { selectedNode, useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;
const AGENT = "clinical-agent";

function store() {
  return useEditor.getState();
}

/** 그 단계가 문서에 없는 skill 하나를 입은 문서 — 다른 칸은 모두 채워져 있다. */
function withStaleSkill(): AgentSpec {
  return {
    ...example,
    skills: [],
    nodes: example.nodes.map((node) =>
      node.id === AGENT
        ? { ...node, config: { ...node.config, skill_refs: ["skill://plain-answer@1"] } }
        : node,
    ),
  };
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("문서에 없는 skill을 입은 단계", () => {
  it("실행 옆 pill이 그 한 곳을 센다 — 뱃지만 알고 pill은 모르는 일이 없다", async () => {
    act(() => store().loadSpec(withStaleSkill()));
    render(<App />);

    const pill = await screen.findByRole("button", { name: /확인이 필요해요/ });

    expect(pill).toHaveTextContent("노드 1개에 확인이 필요해요");
  });

  it("pill을 누르면 그 단계로 데려간다", async () => {
    act(() => store().loadSpec(withStaleSkill()));
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /확인이 필요해요/ }));

    expect(selectedNode(store())?.id).toBe(AGENT);
  });

  it("실행 게이트가 그 자리로 데려가고 실행을 시작하지 않는다", async () => {
    act(() => store().loadSpec(withStaleSkill()));
    const asked: unknown[] = [];
    useEditor.setState({
      sendRunStart: async (...args: unknown[]) => {
        asked.push(args);
        return { failure: { key: "run.locked" } } as never;
      },
    } as never);

    await act(async () => {
      await store().startRun(store().spec?.revision ?? "");
    });

    expect(asked).toEqual([]);
    expect(store().notice?.key).toBe("run.waiting.notice");
    expect(selectedNode(store())?.id).toBe(AGENT);
  });

  it("첫 걸음의 '설정 채우기'도 아직 걷지 않은 것으로 본다", () => {
    const spec = withStaleSkill();
    act(() => store().loadSpec(spec));

    const waiting = nodesNeedingSetup(store().nodes, spec.skills ?? []);
    const steps = firstSteps({
      nodeCount: store().nodes.length,
      edgeCount: store().edges.length,
      needsSetupCount: waiting.length,
      runFinished: false,
    });

    expect(waiting.map((node) => node.id)).toEqual([AGENT]);
    expect(steps.find((step) => step.key === "fill")?.done).toBe(false);
  });

  it("문서가 그 skill을 들이면 네 자리 모두 조용해진다", () => {
    const spec = withStaleSkill();
    act(() =>
      store().loadSpec({
        ...spec,
        skills: [
          {
            ref: "skill://plain-answer@1",
            name: "plain-answer",
            description: "use it when you answer",
            body: "Answer plainly.\n",
            license: null,
            compatibility: null,
            metadata: {},
            references: [],
            source: null,
          },
        ],
      }),
    );
    render(<App />);

    expect(nodesNeedingSetup(store().nodes, store().spec?.skills ?? [])).toEqual([]);
    expect(screen.queryByRole("button", { name: /확인이 필요해요/ })).not.toBeInTheDocument();

    const node = store().nodes.find((one) => one.id === AGENT);
    render(
      <ReactFlowProvider>
        <NodeCard id={AGENT} data={node!.data} />
      </ReactFlowProvider>,
    );
    expect(screen.queryByRole("button", { name: /설정 필요/ })).not.toBeInTheDocument();
  });
});
