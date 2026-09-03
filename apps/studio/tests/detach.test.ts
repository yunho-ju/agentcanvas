import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { toFlow } from "../src/graph/serialize";
import { validateSpec } from "../src/graph/validateSpec";
import { changesNothing } from "../src/history/command";
import { detachToTray, restoreFromTray } from "../src/history/trayCommands";
import { useEditor } from "../src/store/editor";
import { translate } from "../src/i18n/messages";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

function nodeIds() {
  return store().nodes.map((node) => node.id);
}

function trayIds() {
  return store().tray.map((node) => node.id);
}

beforeEach(() => {
  store().loadSpec(example);
});

/** store가 들고 있는 메시지를 화면이 읽을 한국어 한 줄로. */
function said(message: { key: string } | null): string {
  return message ? translate("ko", message as Parameters<typeof translate>[1]) : "";
}

/**
 * 화면이 재 둔 치수는 그 화면의 사정이다 — 편집이 기억하는 노드가 그것을 들고 오면,
 * 캔버스는 다시 돌아온 카드를 이미 다 잰 것으로 여기고 포트 자리를 다시 재지 않는다
 * (그러면 그 노드에 걸린 연결선이 끝점을 찾지 못한다).
 */
describe("the node an edit remembers", () => {
  /** 화면이 노드를 재고 나면 붙는 것들 — 캔버스 라이브러리가 우리 노드 객체에 적어 둔다. */
  function asMeasured(nodeId: string) {
    useEditor.setState({
      nodes: store().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, measured: { width: 208, height: 64 }, selected: true }
          : node,
      ),
    });
  }

  it("carries no screen measurements back when an edit is undone", () => {
    asMeasured("triage");

    store().requestDetach("triage");
    store().confirmDetach();
    store().undo();

    const back = store().nodes.find((node) => node.id === "triage");
    expect(back).toBeDefined();
    expect(back).not.toHaveProperty("measured");
    expect(back).not.toHaveProperty("selected");
  });

  it("carries none into the shelf either — what waits there is the node, not its picture", () => {
    asMeasured("triage");

    store().requestDetach("triage");
    store().confirmDetach();

    expect(store().tray[0]).not.toHaveProperty("measured");
  });

  it("carries none back out of the shelf", () => {
    asMeasured("triage");
    store().requestDetach("triage");
    store().confirmDetach();

    store().restoreFromTray("triage");

    expect(store().nodes.find((node) => node.id === "triage")).not.toHaveProperty(
      "measured",
    );
  });
});

describe("asking to take a node out", () => {
  it("shows what would break instead of taking it out right away", () => {
    store().requestDetach("triage");

    expect(store().pendingDetach).toBe("triage");
    expect(nodeIds()).toContain("triage");
    expect(store().edges).toHaveLength(example.edges.length);
  });

  it("takes a node that breaks nothing straight to the tray", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    const added = nodeIds().at(-1) ?? "";

    store().requestDetach(added);

    expect(store().pendingDetach).toBeNull();
    expect(nodeIds()).not.toContain(added);
    expect(trayIds()).toEqual([added]);
  });

  it("changes nothing when the user backs out", () => {
    store().requestDetach("triage");
    store().cancelDetach();

    expect(store().pendingDetach).toBeNull();
    expect(nodeIds()).toEqual(example.nodes.map((node) => node.id));
    expect(store().edges).toHaveLength(example.edges.length);
    expect(store().undoStack).toEqual([]);
  });

  it("ignores a node that is not on the canvas", () => {
    store().requestDetach("ghost");

    expect(store().pendingDetach).toBeNull();
    expect(nodeIds()).toEqual(example.nodes.map((node) => node.id));
  });

  it("knows there is nothing to take back about a node that is not there", () => {
    const scene = { ...toFlow(example), tray: [], name: null, resources: [], input_schema: {}, skills: [] };
    expect(changesNothing(detachToTray(scene, "ghost"))).toBe(true);
  });
});

describe("going ahead with taking the node out", () => {
  it("moves the node into the tray with its settings", () => {
    store().requestDetach("triage");
    store().confirmDetach();

    expect(nodeIds()).not.toContain("triage");
    expect(store().tray[0]?.data.spec.config).toEqual(example.nodes[1].config);
  });

  it("takes the connections that hung off it away too", () => {
    store().requestDetach("triage");
    store().confirmDetach();

    expect(store().edges.map((edge) => edge.id)).not.toContain("input-triage");
  });

  it("tells the user where the node went", () => {
    store().requestDetach("triage");
    store().confirmDetach();

    expect(said(store().notice)).toContain("보관함");
  });

  it("puts the node and its connections back when the user takes it back", () => {
    store().requestDetach("triage");
    store().confirmDetach();
    store().undo();

    expect(nodeIds()).toContain("triage");
    expect(store().edges.map((edge) => edge.id)).toContain("input-triage");
    expect(trayIds()).toEqual([]);
  });

  it("moves it out again on redo", () => {
    store().requestDetach("triage");
    store().confirmDetach();
    store().undo();
    store().redo();

    expect(nodeIds()).not.toContain("triage");
    expect(trayIds()).toEqual(["triage"]);
  });

  it("gives up quietly when the node is gone before the user says yes", () => {
    store().requestDetach("triage");
    useEditor.setState({
      nodes: store().nodes.filter((node) => node.id !== "triage"),
    });

    store().confirmDetach();

    expect(store().pendingDetach).toBeNull();
    expect(store().undoStack).toEqual([]);
    expect(said(store().notice)).toContain("이미");
  });

  it("does nothing when no node is waiting to be taken out", () => {
    store().confirmDetach();

    expect(nodeIds()).toEqual(example.nodes.map((node) => node.id));
    expect(store().undoStack).toEqual([]);
  });
});

describe("plugging a stored node back in", () => {
  function detach(nodeId: string) {
    store().requestDetach(nodeId);
    store().confirmDetach();
  }

  it("brings it back to the canvas with its settings", () => {
    detach("triage");
    store().restoreFromTray("triage");

    expect(nodeIds()).toContain("triage");
    expect(
      store().nodes.find((node) => node.id === "triage")?.data.spec.config,
    ).toEqual(example.nodes[1].config);
    expect(trayIds()).toEqual([]);
  });

  it("gives it another name when that name is taken again", () => {
    detach("triage");
    // 보관해 둔 사이에 같은 이름의 노드가 캔버스에 다시 생겼다
    useEditor.setState({ nodes: [...store().nodes, { ...store().tray[0] }] });

    store().restoreFromTray("triage");

    expect(nodeIds().filter((id) => id.startsWith("triage"))).toEqual(["triage", "triage-2"]);
    expect(store().nodes.find((node) => node.id === "triage-2")?.data.spec.id).toBe(
      "triage-2",
    );
  });

  it("still exports a spec the contract accepts", () => {
    detach("triage");
    store().restoreFromTray("triage");

    expect(validateSpec(store().exportSpec())).toEqual([]);
  });

  it("sends it back to the tray when the user takes the move back", () => {
    detach("triage");
    store().restoreFromTray("triage");
    store().undo();

    expect(nodeIds()).not.toContain("triage");
    expect(trayIds()).toEqual(["triage"]);
  });

  it("leaves the scene exactly as it was when the move is taken back", () => {
    detach("triage");
    detach("clinical-agent");
    const before = JSON.stringify({
      nodes: store().nodes,
      edges: store().edges,
      tray: store().tray,
    });

    store().restoreFromTray("triage");
    store().undo();

    expect(
      JSON.stringify({
        nodes: store().nodes,
        edges: store().edges,
        tray: store().tray,
      }),
    ).toBe(before);
  });

  it("ignores a node that is not in the tray", () => {
    store().restoreFromTray("ghost");

    expect(nodeIds()).toEqual(example.nodes.map((node) => node.id));
    expect(store().undoStack).toEqual([]);
  });

  it("leaves the scene as it is when asked for a node nobody stored", () => {
    const scene = { ...toFlow(example), tray: [], name: null, resources: [], input_schema: {}, skills: [] };

    expect(restoreFromTray(scene, "ghost").apply(scene)).toEqual(scene);
    expect(restoreFromTray(scene, "ghost").revert(scene)).toEqual(scene);
  });

  it("knows there is nothing to take back about a node nobody stored", () => {
    const scene = { ...toFlow(example), tray: [], name: null, resources: [], input_schema: {}, skills: [] };
    expect(changesNothing(restoreFromTray(scene, "ghost"))).toBe(true);
  });
});

describe("the tray belongs to this session only", () => {
  it("stays out of the exported spec", () => {
    store().requestDetach("triage");
    store().confirmDetach();

    expect(store().exportSpec().nodes.map((node) => node.id)).not.toContain("triage");
  });

  it("is emptied when another file is opened", () => {
    store().requestDetach("triage");
    store().confirmDetach();
    store().loadSpec(example);

    expect(trayIds()).toEqual([]);
    expect(store().pendingDetach).toBeNull();
  });
});

describe("an edit with nothing to do", () => {
  it("does not become a step the user has to take back", () => {
    store().requestDetach("ghost");
    store().restoreFromTray("ghost");

    expect(store().undoStack).toEqual([]);
  });

  it("does not throw away what the user could still put back", () => {
    store().addNode("llm.agent", { x: 0, y: 0 });
    store().undo();

    store().restoreFromTray("ghost");

    expect(store().redoStack).toHaveLength(1);
  });
});
