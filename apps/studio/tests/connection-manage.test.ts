// 만든 연결을 고치고 지우는 길 (API_TOOLS P2c) — 지우기는 서버 없이 되돌릴 수 있는 편집 하나다.
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;
const CLINICAL = "clinical-reference";

/** 그 연결을 쓰는 도구 노드 하나를 얹은 문서. */
function withToolNode(): AgentSpec {
  return {
    ...example,
    nodes: [
      ...example.nodes,
      {
        id: "lookup",
        type: "tool.mcp",
        position: { x: 0, y: 0 },
        config: { resource_ref: CLINICAL, tool_name: "search_article" },
      },
    ],
  } as AgentSpec;
}

function store() {
  return useEditor.getState();
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("연결 지우기", () => {
  it("연결이 문서에서 빠지고, 되돌리기 한 걸음으로 살아난다", () => {
    store().dropConnection(CLINICAL);

    expect(store().spec?.resources).toEqual([]);
    store().undo();
    expect(store().spec?.resources?.map((one) => one.id)).toEqual([CLINICAL]);
  });

  it("그 연결을 쓰던 노드가 있으면 어느 노드가 잃었는지 말한다", () => {
    store().loadSpec(withToolNode());

    store().dropConnection(CLINICAL);

    // 예제의 에이전트 노드도 같은 연결을 쓴다(toolset_refs) — 둘 다 이름을 밝힌다.
    expect(store().notice).toEqual({
      key: "edit.dropConnection.notice",
      params: { id: CLINICAL, nodes: "clinical-agent, lookup" },
    });
    // 구조는 아무것도 빠지지 않는다 — 노드도 연결선도 그대로다.
    expect(store().nodes.some((node) => node.id === "lookup")).toBe(true);
  });

  it("쓰던 노드가 없으면 잃은 것도 없다 — 괜한 말을 만들지 않는다", () => {
    // 아무도 가리키지 않는 연결 하나만 든 문서.
    store().loadSpec({
      ...example,
      nodes: example.nodes.filter((node) => node.type !== "llm.agent"),
      edges: [],
    } as AgentSpec);

    store().dropConnection(CLINICAL);

    expect(store().notice).toBeNull();
  });

  it("없는 연결을 지우라고 하면 되돌리기 목록에 걸음을 쌓지 않는다", () => {
    const steps = store().undoStack.length;

    store().dropConnection("ghost");

    expect(store().undoStack.length).toBe(steps);
  });

  it("실행을 보는 동안에는 문서가 잠겨 있다", () => {
    useEditor.setState({ activeRunId: "run_1", runEvents: [{ seq: 1 } as never] });

    store().dropConnection(CLINICAL);

    expect(store().spec?.resources?.map((one) => one.id)).toEqual([CLINICAL]);
  });
});

describe("연결 다시 가져오기", () => {
  const REIMPORTED = {
    id: CLINICAL,
    kind: "mcp.toolset",
    server_ref: "mcp://clinical-reference",
    allowed_tools: [],
    approval_policy: "read_only_auto",
    tools: [
      {
        name: "search_article",
        plain_description: { ko: "찾는다.", en: "Finds." },
        input_schema: { type: "object" },
        output_schema: { type: "object" },
        timeout_ms: 9000,
        call: { transport: "mcp", remote_name: "search_article" },
        result_handling: { mode: "full" },
      },
    ],
  };

  function serverSwaps() {
    useEditor.setState({
      wrapToolsOnServer: async (ask: { replacing?: string }) => {
        expect(ask.replacing).toBe(CLINICAL);
        const spec = store().exportSpec();
        return {
          candidate: {
            ...spec,
            resources: (spec.resources ?? []).map((one) =>
              one.id === CLINICAL ? REIMPORTED : one,
            ),
          },
          issues: [],
        };
      },
    } as never);
  }

  async function reimport() {
    serverSwaps();
    store().reimportConnection(CLINICAL);
    store().setToolWrapSource("openapi: 3.1.0");
    await store().buildToolWrap();
  }

  it("대상 연결을 들고 열린다 — 새 연결을 만드는 것과 다른 일이다", () => {
    store().reimportConnection(CLINICAL);

    expect(store().toolWrapMode).toBe("input");
    expect(store().toolWrapReplacing).toBe(CLINICAL);
  });

  it("승인하면 그 연결 하나만 갈아 끼우고 되돌리기 한 걸음이다", async () => {
    await reimport();

    store().applyToolWrap();

    const swapped = store().spec?.resources?.find((one) => one.id === CLINICAL);
    expect(swapped?.tools?.map((tool) => tool.name)).toEqual(["search_article"]);
    expect(store().spec?.resources).toHaveLength(1);
    store().undo();
    expect(
      store().spec?.resources?.[0].tools?.map((tool) => tool.name),
    ).toEqual(["search_article", "get_article"]);
  });

  it("승인이 끝나면 대상도 함께 놓는다 — 다음 만들기는 새 연결이다", async () => {
    await reimport();

    store().applyToolWrap();

    expect(store().toolWrapReplacing).toBeNull();
    expect(store().toolWrapMode).toBe("closed");
  });

  it("도구가 그대로면 그 도구를 쓰던 노드의 포트도 그대로다", async () => {
    store().loadSpec(withToolNode());
    await reimport();

    store().applyToolWrap();

    const node = store().nodes.find((one) => one.id === "lookup");
    expect(Object.keys(node?.data.ports.outputs ?? {})).toContain("result");
    expect(store().notice).toBeNull();
  });

  it("모양이 어긋나 끊어지는 연결선은 조용히 사라지지 않고 그 사실을 말한다", async () => {
    // 다시 가져온 도구가 다른 모양의 값을 돌려주면, 그 값을 받던 연결선은 더 이상 설 수 없다.
    const narrowed = {
      ...REIMPORTED,
      tools: [
        {
          ...REIMPORTED.tools[0],
          output_schema: { type: "string" },
        },
      ],
    };
    useEditor.setState({
      wrapToolsOnServer: async () => {
        const spec = store().exportSpec();
        return {
          candidate: {
            ...spec,
            resources: (spec.resources ?? []).map((one) =>
              one.id === CLINICAL ? narrowed : one,
            ),
          },
          issues: [],
        };
      },
    } as never);
    store().loadSpec({
      ...withToolNode(),
      nodes: [
        ...withToolNode().nodes,
        {
          id: "sink",
          type: "tool.mcp",
          position: { x: 200, y: 0 },
          config: { resource_ref: CLINICAL, tool_name: "get_article" },
        },
      ],
      edges: [
        ...example.edges,
        {
          id: "lookup-sink",
          kind: "data",
          source: { node: "lookup", port: "result" },
          target: { node: "sink", port: "input" },
        },
      ],
    } as AgentSpec);
    store().reimportConnection(CLINICAL);
    store().setToolWrapSource("openapi: 3.1.0");
    await store().buildToolWrap();

    store().applyToolWrap();

    expect(store().notice?.key).toBe("edit.reimportConnection.notice");
    expect(store().edges.some((edge) => edge.id === "lookup-sink")).toBe(false);
    // 되돌리면 끊어진 연결선도 함께 살아난다.
    store().undo();
    expect(store().edges.some((edge) => edge.id === "lookup-sink")).toBe(true);
  });

  it("연결선이 끊겨 데이터가 닿지 않게 된 노드도 함께 말한다", async () => {
    // input -> lookup -> sink. lookup의 결과 모양이 달라지면 그 뒤의 sink에는 값이 닿지 않는다.
    const narrowed = {
      ...REIMPORTED,
      tools: [{ ...REIMPORTED.tools[0], output_schema: { type: "string" } }],
    };
    useEditor.setState({
      wrapToolsOnServer: async () => {
        const spec = store().exportSpec();
        return {
          candidate: {
            ...spec,
            resources: (spec.resources ?? []).map((one) =>
              one.id === CLINICAL ? narrowed : one,
            ),
          },
          issues: [],
        };
      },
    } as never);
    store().loadSpec({
      ...withToolNode(),
      nodes: [
        ...withToolNode().nodes,
        {
          id: "sink",
          type: "tool.mcp",
          position: { x: 200, y: 0 },
          config: { resource_ref: CLINICAL, tool_name: "get_article" },
        },
      ],
      edges: [
        {
          id: "input-lookup",
          kind: "data",
          source: { node: "input", port: "question" },
          target: { node: "lookup", port: "input" },
        },
        {
          id: "lookup-sink",
          kind: "data",
          source: { node: "lookup", port: "result" },
          target: { node: "sink", port: "input" },
        },
      ],
    } as AgentSpec);
    store().reimportConnection(CLINICAL);
    store().setToolWrapSource("openapi: 3.1.0");
    await store().buildToolWrap();

    store().applyToolWrap();

    // 끊어진 연결선 한 줄과, 그 때문에 값이 닿지 않게 된 노드 한 줄을 함께 말한다.
    const impact = store().notice?.params?.impact as { key: string }[];
    expect(impact.map((line) => line.key)).toEqual([
      "impact.edges.did",
      "impact.nodes.did",
    ]);
  });

  it("실행을 보는 동안에는 다시 가져오기가 열리지 않는다", () => {
    useEditor.setState({ activeRunId: "run_1", runEvents: [{ seq: 1 } as never] });

    store().reimportConnection(CLINICAL);

    expect(store().toolWrapMode).toBe("closed");
  });
});
