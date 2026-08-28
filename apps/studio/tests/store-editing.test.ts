import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { validateSpec } from "../src/graph/validateSpec";
import { selectedEdge, selectedNode, useEditor } from "../src/store/editor";
import { translate } from "../src/i18n/messages";
import { TOOL_BINDING_ID, withToolBinding } from "./toolSpec";

const example = exampleSpec as unknown as AgentSpec;

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

describe("selection", () => {
  it("has nothing selected right after a file is loaded", () => {
    expect(selectedNode(store())).toBeUndefined();
    expect(selectedEdge(store())).toBeUndefined();
  });

  it("selects the node the user picked", () => {
    store().select("node", "triage");
    expect(selectedNode(store())?.id).toBe("triage");
  });

  it("drops the previous selection when another node is picked", () => {
    store().select("node", "triage");
    store().select("node", "output");
    expect(store().nodes.filter((node) => node.selected)).toHaveLength(1);
  });

  it("selects an edge and forgets the selected node", () => {
    store().select("node", "triage");
    store().select("edge", "input-triage");
    expect(selectedEdge(store())?.id).toBe("input-triage");
    expect(selectedNode(store())).toBeUndefined();
  });

  it("follows a selection made on the canvas itself", () => {
    store().onNodesChange([{ id: "triage", type: "select", selected: true }]);
    expect(selectedNode(store())?.id).toBe("triage");
  });

  it("clears the selection", () => {
    store().select("node", "triage");
    store().clearSelection();
    expect(selectedNode(store())).toBeUndefined();
  });
});

describe("updateNodeConfig", () => {
  it("keeps the new config in the exported spec", () => {
    store().updateNodeConfig("clinical-agent", {
      model_ref: "model://fast",
      prompt_ref: "prompt://clinical@7",
    });
    expect(
      store()
        .exportSpec()
        .nodes.find((node) => node.id === "clinical-agent")?.config,
    ).toEqual({ model_ref: "model://fast", prompt_ref: "prompt://clinical@7" });
  });

  it("still exports a spec the contract accepts", () => {
    store().updateNodeConfig("clinical-agent", { model_ref: "model://fast" });
    expect(validateSpec(store().exportSpec())).toEqual([]);
  });

  it("shows a new output port as soon as a binding is added", () => {
    store().updateNodeConfig("input", {
      bindings: { question: "input.question", vitals: "input.vitals" },
    });
    expect(
      Object.keys(store().nodes.find((node) => node.id === "input")?.data.ports.outputs ?? {}),
    ).toContain("vitals");
  });

  it("removes the edges that hung off a binding the user deleted", () => {
    store().updateNodeConfig("input", { bindings: { patient_context: "input.pc" } });
    expect(store().edges.map((edge) => edge.id)).not.toContain("input-triage");
  });

  it("tells the user which connections it had to remove", () => {
    store().updateNodeConfig("input", { bindings: {} });
    expect(said(store().notice)).toContain("input");
    expect(said(store().notice)).toContain("1");
  });

  it("also tells the user which nodes are left without data", () => {
    store().updateNodeConfig("input", { bindings: {} });
    expect(said(store().notice)).toContain("노드 4개에 데이터가 닿지 않게 됐다");
  });

  it("says nothing when no connection was harmed", () => {
    store().updateNodeConfig("clinical-agent", { model_ref: "model://fast" });
    expect(store().notice).toBeNull();
  });

  it("dresses a tool node's ports in the tool it was just pointed at", () => {
    store().loadSpec(withToolBinding(example, "other"));
    store().updateNodeConfig("tool", {
      resource_ref: TOOL_BINDING_ID,
      tool_name: "lookup",
    });
    expect(
      store().nodes.find((node) => node.id === "tool")?.data.ports.outputs.result.schema,
    ).toEqual({ type: "string" });
  });

  it("ignores a node that is not on the canvas", () => {
    expect(() => store().updateNodeConfig("ghost", { a: 1 })).not.toThrow();
  });
});

describe("edge editing", () => {
  it("changes the kind of the selected edge", () => {
    store().updateEdgeKind("input-triage", "control");
    expect(
      store()
        .exportSpec()
        .edges.find((edge) => edge.id === "input-triage")?.kind,
    ).toBe("control");
  });

  it("keeps a condition the user typed as a CEL expression", () => {
    store().updateEdgeCondition("input-triage", "route == 'urgent'");
    expect(
      store()
        .exportSpec()
        .edges.find((edge) => edge.id === "input-triage")?.condition,
    ).toEqual({ language: "cel", expression: "route == 'urgent'" });
  });

  it("drops the condition when the user empties it", () => {
    store().updateEdgeCondition("triage-agent", "   ");
    expect(
      store()
        .exportSpec()
        .edges.find((edge) => edge.id === "triage-agent"),
    ).not.toHaveProperty("condition");
  });

  it("exports an edited edge the contract still accepts", () => {
    store().updateEdgeKind("input-triage", "approval");
    store().updateEdgeCondition("input-triage", "size(x) > 0");
    expect(validateSpec(store().exportSpec())).toEqual([]);
  });
});

describe("deleteSelection", () => {
  it("removes the selected node and the edges hanging off it once the user confirms", () => {
    store().select("node", "triage");
    store().deleteSelection();
    store().confirmDetach();
    expect(store().nodes.map((node) => node.id)).not.toContain("triage");
    expect(store().edges.map((edge) => edge.id)).not.toContain("input-triage");
  });

  it("removes the selected edge only", () => {
    store().select("edge", "input-triage");
    store().deleteSelection();
    expect(store().edges.map((edge) => edge.id)).not.toContain("input-triage");
    expect(store().nodes).toHaveLength(example.nodes.length);
  });

  it("does nothing when nothing is selected", () => {
    store().deleteSelection();
    expect(store().nodes).toHaveLength(example.nodes.length);
    expect(store().edges).toHaveLength(example.edges.length);
  });
});

describe("selectAdjacentNode", () => {
  it("selects the first node when nothing is selected yet", () => {
    store().selectAdjacentNode(1);
    expect(selectedNode(store())?.id).toBe(example.nodes[0].id);
  });

  it("walks to the next node", () => {
    store().select("node", example.nodes[0].id);
    store().selectAdjacentNode(1);
    expect(selectedNode(store())?.id).toBe(example.nodes[1].id);
  });

  it("wraps around at the end", () => {
    store().select("node", example.nodes.at(-1)?.id ?? "");
    store().selectAdjacentNode(1);
    expect(selectedNode(store())?.id).toBe(example.nodes[0].id);
  });

  it("walks backwards too", () => {
    store().select("node", example.nodes[0].id);
    store().selectAdjacentNode(-1);
    expect(selectedNode(store())?.id).toBe(example.nodes.at(-1)?.id);
  });

  it("does nothing on an empty canvas", () => {
    useEditor.setState({ nodes: [], edges: [] });
    expect(() => store().selectAdjacentNode(1)).not.toThrow();
    expect(selectedNode(store())).toBeUndefined();
  });
});

describe("아직 아무 그래프도 없을 때의 이름 바꾸기", () => {
  it("되돌릴 것을 만들지 않는다", () => {
    useEditor.setState({ spec: null, nodes: [], edges: [], undoStack: [], redoStack: [] });

    useEditor.getState().renameSpec("이름만 먼저");

    expect(useEditor.getState().undoStack).toEqual([]);
    expect(useEditor.getState().spec).toBeNull();
  });
});
