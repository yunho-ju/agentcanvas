import { beforeEach, describe, expect, it } from "vitest";
import { validateSpec } from "../src/graph/validateSpec";
import { useEditor } from "../src/store/editor";
import { translate } from "../src/i18n/messages";
import { WANTS_BUNDLE, example, exampleWithTool } from "./exampleWithTool";

function store() {
  return useEditor.getState();
}

beforeEach(() => {
  useEditor.getState().loadSpec(example);
});

/** store가 들고 있는 메시지를 화면이 읽을 한국어 한 줄로. */
function said(message: { key: string } | null): string {
  return message ? translate("ko", message as Parameters<typeof translate>[1]) : "";
}

describe("loadSpec", () => {
  it("puts every node and edge of the file on the canvas", () => {
    expect(store().nodes.map((node) => node.id)).toEqual(
      example.nodes.map((node) => node.id),
    );
    expect(store().edges.map((edge) => edge.id)).toEqual(
      example.edges.map((edge) => edge.id),
    );
  });

  it("starts with no connection error", () => {
    expect(store().connectionHint).toBeNull();
  });
});

describe("exportSpec", () => {
  it("gives back the loaded spec unchanged when nothing was edited", () => {
    expect(store().exportSpec()).toEqual(example);
  });
});

describe("addNode", () => {
  it("adds a node of the requested type at the requested position", () => {
    store().addNode("llm.agent", { x: 5, y: 6 });
    const added = store().nodes.at(-1);
    expect(added?.data.spec.type).toBe("llm.agent");
    expect(added?.position).toEqual({ x: 5, y: 6 });
  });

  it("gives the new node an id no other node uses", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    store().addNode("llm.agent", { x: 0, y: 0 });
    const ids = store().nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows the ports of the node type right away", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    expect(Object.keys(store().nodes.at(-1)?.data.ports.inputs ?? {})).toEqual([
      "messages",
    ]);
  });
});

/** 손을 놓은 자리 — 안내는 이 자리 곁에 선다. */
const DROPPED_AT = { x: 120, y: 240 };

describe("connect", () => {
  it("adds an edge between compatible ports", () => {
    store().connect(
      {
        source: "input",
        sourceHandle: "patient_context",
        target: "triage",
        targetHandle: "input",
      },
      DROPPED_AT,
    );
    expect(store().edges).toHaveLength(example.edges.length + 1);
    expect(store().connectionHint).toBeNull();
  });

  // 무엇이든 받는 자리에는 글자도 이어진다 (DESIGN §7 port-schema).
  it("adds an edge from a port that sends text into the agent's conversation", () => {
    store().connect(
      {
        source: "triage",
        sourceHandle: "route",
        target: "clinical-agent",
        targetHandle: "messages",
      },
      DROPPED_AT,
    );

    expect(store().edges).toHaveLength(example.edges.length + 1);
    expect(store().connectionHint).toBeNull();
  });

  it("refuses incompatible ports and explains why instead of adding an edge", () => {
    store().loadSpec(exampleWithTool());
    store().connect(
      {
        source: "triage",
        sourceHandle: "route",
        target: WANTS_BUNDLE,
        targetHandle: "input",
      },
      DROPPED_AT,
    );
    expect(store().edges).toHaveLength(example.edges.length);
    // 포트는 캔버스에서 읽는 그 라벨로 가리킨다 — 내부 이름표는 쓰지 않는다.
    expect(said(store().connectionHint?.message ?? null)).toContain("route");
    expect(said(store().connectionHint?.message ?? null)).not.toContain("triage");
  });

  it("says it where the hand let go, in the tone of a refusal", () => {
    store().loadSpec(exampleWithTool());
    store().connect(
      {
        source: "triage",
        sourceHandle: "route",
        target: WANTS_BUNDLE,
        targetHandle: "input",
      },
      DROPPED_AT,
    );
    expect(store().connectionHint?.at).toEqual(DROPPED_AT);
    expect(store().connectionHint?.tone).toBe("danger");
  });

  it("refuses a connection that would send the flow back where it came from", () => {
    // human-gate는 triage에서 흘러온 뒤라, 거기서 triage로 되돌리면 제자리를 돈다.
    store().connect(
      {
        source: "human-gate",
        sourceHandle: "rejected",
        target: "triage",
        targetHandle: "input",
      },
      DROPPED_AT,
    );

    expect(store().edges).toHaveLength(example.edges.length);
    expect(said(store().connectionHint?.message ?? null)).toContain("되돌아가");
  });

  it("keeps only the newest refusal on screen", () => {
    store().loadSpec(exampleWithTool());
    store().connect(
      {
        source: "triage",
        sourceHandle: "route",
        target: WANTS_BUNDLE,
        targetHandle: "input",
      },
      DROPPED_AT,
    );
    store().connect(
      {
        source: "input",
        sourceHandle: "question",
        target: "triage",
        targetHandle: "input",
      },
      { x: 10, y: 20 },
    );

    expect(said(store().connectionHint?.message ?? null)).toContain("이미");
    expect(store().connectionHint?.at).toEqual({ x: 10, y: 20 });
  });

  // C8 — 이어졌다는 사실이 이미 답이다: 떠 있던 거절 안내는 그 자리에서 물러난다.
  it("takes the refusal off the screen as soon as a connection succeeds", () => {
    store().loadSpec(exampleWithTool());
    store().connect(
      {
        source: "triage",
        sourceHandle: "route",
        target: WANTS_BUNDLE,
        targetHandle: "input",
      },
      DROPPED_AT,
    );
    expect(store().connectionHint).not.toBeNull();

    store().connect(
      {
        source: "input",
        sourceHandle: "patient_context",
        target: "triage",
        targetHandle: "input",
      },
      DROPPED_AT,
    );

    expect(store().connectionHint).toBeNull();
  });

  it("ignores a connection dragged without a port handle", () => {
    store().connect(
      {
        source: "input",
        sourceHandle: null,
        target: "triage",
        targetHandle: "input",
      },
      DROPPED_AT,
    );
    expect(store().edges).toHaveLength(example.edges.length);
  });

  it("exports the added edge as a spec edge", () => {
    store().connect(
      {
        source: "input",
        sourceHandle: "patient_context",
        target: "triage",
        targetHandle: "input",
      },
      DROPPED_AT,
    );
    expect(store().exportSpec().edges.at(-1)).toMatchObject({
      kind: "data",
      source: { node: "input", port: "patient_context" },
      target: { node: "triage", port: "input" },
    });
  });
});

describe("with nothing open yet", () => {
  beforeEach(() => {
    useEditor.setState({ spec: null, nodes: [], edges: [], connectionHint: null });
  });

  it("starts a draft spec as soon as the first node is dropped", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    expect(store().spec).toMatchObject({
      schema_version: "agent.spec/v1",
      version: 1,
      status: "draft",
    });
    // 초안마다 제 이름이 있다 — 이름이 같으면 나중 초안이 앞의 것을 덮는다.
    expect(store().spec?.id).toMatch(/^draft-/);
    expect(store().nodes).toHaveLength(1);
  });

  it("marks that draft as new so the user knows nothing was loaded", () => {
    expect(store().isDraft).toBe(false);
    store().addNode("llm.agent", { x: 0, y: 0 });
    expect(store().isDraft).toBe(true);
  });

  it("stops marking a draft once a file is loaded", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    store().loadSpec(example);
    expect(store().isDraft).toBe(false);
  });

  it("exports the started draft as a spec the contract accepts", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    expect(validateSpec(store().exportSpec())).toEqual([]);
  });

  it("never lets a store action throw, whatever the user does first", () => {
    expect(() => store().exportSpec()).not.toThrow();
    expect(() =>
      store().connect(
        {
          source: "ghost",
          sourceHandle: "a",
          target: "phantom",
          targetHandle: "b",
        },
        { x: 0, y: 0 },
      ),
    ).not.toThrow();
    expect(() => store().addNode("no.such.type", { x: 0, y: 0 })).not.toThrow();
    expect(() => store().onNodesChange([{ id: "ghost", type: "remove" }])).not.toThrow();
    expect(() => store().onEdgesChange([{ id: "ghost", type: "remove" }])).not.toThrow();
  });
});

describe("edge bookkeeping", () => {
  it("refuses a second edge between the very same pair of ports", () => {
    const twice = {
      source: "input",
      sourceHandle: "question",
      target: "triage",
      targetHandle: "input",
    };
    store().connect(twice, DROPPED_AT);
    const afterFirst = store().edges.length;

    store().connect(twice, DROPPED_AT);

    expect(store().edges).toHaveLength(afterFirst);
    expect(said(store().connectionHint?.message ?? null)).toContain("이미");
  });

  it("removes the edges hanging off a node that was deleted", () => {
    store().onNodesChange([{ id: "triage", type: "remove" }]);

    const exported = store().exportSpec();
    const nodeIds = exported.nodes.map((node) => node.id);
    for (const edge of exported.edges) {
      expect(nodeIds).toContain(edge.source.node);
      expect(nodeIds).toContain(edge.target.node);
    }
    expect(exported.edges.map((edge) => edge.id)).not.toContain("input-triage");
  });
});

describe("canvas changes", () => {
  it("keeps a node move in the exported spec", () => {
    store().onNodesChange([
      { id: "triage", type: "position", position: { x: 1, y: 2 } },
    ]);
    expect(
      store()
        .exportSpec()
        .nodes.find((node) => node.id === "triage")?.position,
    ).toEqual({ x: 1, y: 2 });
  });

  it("drops a removed edge from the exported spec", () => {
    store().onEdgesChange([{ id: "agent-human", type: "remove" }]);
    expect(store().exportSpec().edges.map((edge) => edge.id)).not.toContain(
      "agent-human",
    );
  });
});
