import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";
import { translate } from "../src/i18n/messages";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function nodeIds() {
  return store().nodes.map((node) => node.id);
}

function edgeIds() {
  return store().edges.map((edge) => edge.id);
}

function configOf(id: string) {
  return store().nodes.find((node) => node.id === id)?.data.spec.config;
}

function dragNode(id: string, to: { x: number; y: number }) {
  store().onNodesChange([
    { id, type: "position", position: { x: to.x - 5, y: to.y }, dragging: true },
  ]);
  store().onNodesChange([{ id, type: "position", position: to, dragging: true }]);
  store().onNodesChange([{ id, type: "position", position: to, dragging: false }]);
}

beforeEach(() => {
  useEditor.getState().loadSpec(example);
});

/** store가 들고 있는 메시지를 화면이 읽을 한국어 한 줄로. */
function said(message: { key: string } | null): string {
  return message ? translate("ko", message as Parameters<typeof translate>[1]) : "";
}

describe("undo and redo, one edit at a time", () => {
  it("takes back a node the user added, and puts it back", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    const added = nodeIds().at(-1) ?? "";

    store().undo();
    expect(nodeIds()).not.toContain(added);

    store().redo();
    expect(nodeIds()).toContain(added);
  });

  it("takes back a deleted node together with its edges", () => {
    store().select("node", "triage");
    store().deleteSelection();
    store().confirmDetach();

    store().undo();
    expect(nodeIds()).toContain("triage");
    expect(edgeIds()).toContain("input-triage");
  });

  it("takes back a connection the user drew", () => {
    store().connect(
      {
        source: "input",
        sourceHandle: "patient_context",
        target: "triage",
        targetHandle: "input",
      },
      { x: 0, y: 0 },
    );
    store().undo();
    expect(store().edges).toHaveLength(example.edges.length);
  });

  it("takes back a deleted edge", () => {
    store().onEdgesChange([{ id: "agent-human", type: "remove" }]);
    store().undo();
    expect(edgeIds()).toContain("agent-human");
  });

  it("takes back a whole drag as one step", () => {
    const before = store().nodes.find((node) => node.id === "triage")?.position;
    dragNode("triage", { x: 900, y: 900 });

    store().undo();

    expect(store().nodes.find((node) => node.id === "triage")?.position).toEqual(before);
    expect(store().undoStack).toHaveLength(0);
  });

  it("takes back a config change, ports and all", () => {
    store().updateNodeConfig("input", { bindings: {} });
    store().undo();

    expect(configOf("input")).toEqual(example.nodes[0].config);
    expect(
      Object.keys(store().nodes.find((node) => node.id === "input")?.data.ports.outputs ?? {}),
    ).toContain("question");
    expect(edgeIds()).toContain("input-triage");
  });

  it("takes back an edge kind and condition change", () => {
    store().updateEdgeKind("input-triage", "control");
    store().updateEdgeCondition("input-triage", "route == 'urgent'");

    store().undo();
    store().undo();

    expect(store().exportSpec().edges[0]).toEqual(example.edges[0]);
  });
});

describe("undo leaves the selection alone", () => {
  it("does not bring back the node that was selected when the edit happened", () => {
    store().select("node", "input");
    store().updateNodeConfig("input", { bindings: { question: "input.question" } });
    store().select("node", "triage");

    store().undo();

    expect(store().nodes.filter((node) => node.selected).map((node) => node.id)).toEqual([
      "triage",
    ]);
  });

  it("brings a deleted node back unselected", () => {
    store().select("node", "triage");
    store().deleteSelection();
    store().confirmDetach();
    store().select("node", "output");

    store().undo();

    expect(store().nodes.filter((node) => node.selected).map((node) => node.id)).toEqual([
      "output",
    ]);
  });

  it("does not carry a half-finished drag back into the graph", () => {
    store().onNodesChange([
      { id: "triage", type: "position", position: { x: 10, y: 10 }, dragging: true },
    ]);
    store().select("node", "triage");
    store().deleteSelection();
    store().confirmDetach();

    store().undo();

    const restored = store().nodes.find((node) => node.id === "triage") as unknown as
      | Record<string, unknown>
      | undefined;
    expect(restored?.dragging).toBeUndefined();
  });
});

describe("a message about what an edit did", () => {
  it("keeps the message on screen when the next edit has nothing to say", () => {
    store().updateNodeConfig("input", { bindings: {} });
    store().updateNodeConfig("clinical-agent", { model_ref: "model://fast" });

    expect(said(store().notice)).toContain("연결");
  });

  it("keeps the message while the user takes the edit back", () => {
    store().updateNodeConfig("input", { bindings: {} });
    store().undo();

    expect(said(store().notice)).toContain("연결");
  });

  it("replaces it as soon as another edit has something to say", () => {
    store().updateNodeConfig("input", { bindings: {} });
    store().undo();
    store().connect(
      {
        source: "input",
        sourceHandle: "patient_context",
        target: "triage",
        targetHandle: "input",
      },
      { x: 0, y: 0 },
    );

    store().updateNodeConfig("input", { bindings: {} });

    expect(said(store().notice)).toContain("2개");
  });
});

describe("an edit that changes nothing", () => {
  it("is not worth taking back", () => {
    const same = store().nodes.find((node) => node.id === "input")?.data.spec.config ?? {};
    store().updateNodeConfig("input", { ...same });

    expect(store().undoStack).toEqual([]);
  });

  it("does not throw away what the user could still redo", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    store().undo();

    const same = store().nodes.find((node) => node.id === "input")?.data.spec.config ?? {};
    store().updateNodeConfig("input", { ...same });

    expect(store().redoStack).toHaveLength(1);
  });

  it("ignores an edge kind that is already set", () => {
    store().updateEdgeKind("input-triage", "data");
    expect(store().undoStack).toEqual([]);
  });
});

describe("typing counts as one edit", () => {
  function type(nodeId: string, field: string, text: string) {
    const config = store().nodes.find((node) => node.id === nodeId)?.data.spec.config ?? {};
    store().updateNodeConfig(nodeId, { ...config, [field]: text });
  }

  it("folds letters typed into one field into a single step", () => {
    type("clinical-agent", "model_ref", "m");
    type("clinical-agent", "model_ref", "mo");
    type("clinical-agent", "model_ref", "mod");

    expect(store().undoStack).toHaveLength(1);
    store().undo();
    expect(configOf("clinical-agent")).toEqual(example.nodes[2].config);
  });

  it("starts a new step for another field", () => {
    type("clinical-agent", "model_ref", "m");
    type("clinical-agent", "prompt_ref", "p");
    expect(store().undoStack).toHaveLength(2);
  });

  it("starts a new step for another node", () => {
    type("clinical-agent", "model_ref", "m");
    type("triage", "model_ref", "m");
    expect(store().undoStack).toHaveLength(2);
  });

  it("starts a new step after the user took something back", () => {
    type("clinical-agent", "model_ref", "m");
    store().undo();
    type("clinical-agent", "model_ref", "x");

    expect(store().undoStack).toHaveLength(1);
    store().undo();
    expect(configOf("clinical-agent")).toEqual(example.nodes[2].config);
  });

  it("starts a new step after the user did something else in between", () => {
    type("clinical-agent", "model_ref", "m");
    dragNode("triage", { x: 700, y: 700 });
    type("clinical-agent", "model_ref", "mo");

    expect(store().undoStack).toHaveLength(3);
  });

  // 고르는 일은 글자를 이어 적는 일과 다르다 — 한 번 고른 것은 한 걸음으로 되돌아온다.
  it("keeps each pick its own step when the edit says not to fold it", () => {
    const config = store().nodes.find((node) => node.id === "clinical-agent")
      ?.data.spec.config ?? {};
    store().updateNodeConfig(
      "clinical-agent",
      { ...config, model_ref: "model://claude-sonnet" },
      { merge: false },
    );
    store().updateNodeConfig(
      "clinical-agent",
      { ...config, model_ref: "model://claude-opus" },
      { merge: false },
    );

    expect(store().undoStack).toHaveLength(2);
    store().undo();
    expect(configOf("clinical-agent")).toMatchObject({
      model_ref: "model://claude-sonnet",
    });
  });

  it("folds a condition typed letter by letter into a single step", () => {
    store().updateEdgeCondition("input-triage", "r");
    store().updateEdgeCondition("input-triage", "ro");
    store().updateEdgeCondition("input-triage", "rou");

    expect(store().undoStack).toHaveLength(1);
    store().undo();
    expect(store().exportSpec().edges[0]).toEqual(example.edges[0]);
  });
});

describe("the undo stack itself", () => {
  it("does nothing when there is nothing to take back", () => {
    expect(() => store().undo()).not.toThrow();
    expect(nodeIds()).toEqual(example.nodes.map((node) => node.id));
  });

  it("walks back through several edits and forward again", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    store().addNode("tool.mcp", { x: 0, y: 0 });
    const afterBoth = nodeIds();

    store().undo();
    store().undo();
    expect(nodeIds()).toEqual(example.nodes.map((node) => node.id));

    store().redo();
    store().redo();
    expect(nodeIds()).toEqual(afterBoth);
  });

  it("forgets the redo trail once the user edits again", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    store().undo();
    store().addNode("tool.mcp", { x: 0, y: 0 });

    expect(store().redoStack).toHaveLength(0);
    store().redo();
    expect(nodeIds().filter((id) => id.startsWith("agent"))).toHaveLength(0);
  });

  it("names every edit in plain words so the user knows what will be taken back", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    expect(said(store().undoStack.at(-1)?.label ?? null)).toContain("노드");
  });

  it("starts empty for a freshly loaded file", () => {
    expect(store().undoStack).toEqual([]);
    expect(store().redoStack).toEqual([]);
  });

  it("forgets the history of the file that was open before", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    store().loadSpec(example);
    expect(store().undoStack).toEqual([]);
  });

  it("ignores a drag that ended where it started", () => {
    const at = store().nodes.find((node) => node.id === "triage")?.position;
    store().onNodesChange([
      { id: "triage", type: "position", position: at, dragging: true },
      { id: "triage", type: "position", position: at, dragging: false },
    ]);
    expect(store().undoStack).toEqual([]);
  });

  it("ignores selection and sizing changes from the canvas", () => {
    store().onNodesChange([{ id: "triage", type: "select", selected: true }]);
    store().onEdgesChange([{ id: "input-triage", type: "select", selected: true }]);
    expect(store().undoStack).toEqual([]);
  });
});

describe("an edit that cut a connection stands on its own", () => {
  function connectPatientContext() {
    store().connect(
      {
        source: "input",
        sourceHandle: "patient_context",
        target: "triage",
        targetHandle: "input",
      },
      { x: 0, y: 0 },
    );
  }

  it("is not folded into the edit before it", () => {
    connectPatientContext();
    store().updateNodeConfig("input", { bindings: { question: "input.question" } });
    store().updateNodeConfig("input", { bindings: {} });

    expect(store().undoStack).toHaveLength(3);
  });

  it("gives every cut connection its own step back", () => {
    connectPatientContext();
    const withBoth = edgeIds();
    store().updateNodeConfig("input", { bindings: { question: "input.question" } });
    store().updateNodeConfig("input", { bindings: {} });

    store().undo();
    expect(edgeIds()).toContain("input-triage");

    store().undo();
    expect(edgeIds().sort()).toEqual(withBoth.sort());
  });

  it("still folds letters typed into a field that cut nothing", () => {
    const config = store().nodes.find((node) => node.id === "clinical-agent")?.data.spec
      .config;
    store().updateNodeConfig("clinical-agent", { ...config, model_ref: "m" });
    store().updateNodeConfig("clinical-agent", { ...config, model_ref: "mo" });

    expect(store().undoStack).toHaveLength(1);
  });
});
