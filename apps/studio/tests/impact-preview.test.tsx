import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import { markedForPreview } from "../src/canvas/previewMarks";
import type { AgentSpec } from "../src/generated/agent_spec";
import { toFlow } from "../src/graph/serialize";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

beforeEach(() => {
  store().loadSpec(example);
});

describe("the warning shown before a node is taken out", () => {
  function askToDetach(nodeId: string) {
    render(<App />);
    act(() => store().requestDetach(nodeId));
  }

  it("says in plain words what will break", () => {
    askToDetach("triage");

    const warning = screen.getByRole("alertdialog");
    expect(warning).toHaveTextContent("연결 2개가 끊어진다");
    expect(warning).toHaveTextContent("노드 3개에 데이터가 닿지 않게 된다");
  });

  it("names the nodes that would be left without data, not only colours them", () => {
    askToDetach("triage");

    const warning = screen.getByRole("alertdialog");
    expect(warning).toHaveTextContent("clinical-agent");
    expect(warning).toHaveTextContent("output");
  });

  it("takes the node out when the user goes ahead anyway", async () => {
    askToDetach("triage");

    await userEvent.click(screen.getByRole("button", { name: "그래도 빼기" }));

    expect(store().nodes.map((node) => node.id)).not.toContain("triage");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("leaves the graph alone when the user backs out", async () => {
    askToDetach("triage");

    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(store().nodes.map((node) => node.id)).toContain("triage");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps up with the graph while the warning is on screen", () => {
    askToDetach("triage");
    // 사용자가 경고를 읽는 동안 우회 연결을 그렸다 — 이제 끊기는 노드는 하나뿐이다.
    act(() =>
      useEditor.setState({
        edges: [
          ...store().edges,
          {
            id: "input-gate",
            source: "input",
            sourceHandle: "question",
            target: "human-gate",
            targetHandle: "review",
            data: { kind: "data" as const },
          },
        ],
      }),
    );

    const warning = screen.getByRole("alertdialog");
    expect(warning).toHaveTextContent("노드 1개에 데이터가 닿지 않게 된다");
    expect(warning).not.toHaveTextContent("노드 3개에 데이터가 닿지 않게 된다");
  });

  it("colours the affected part of the canvas too", () => {
    askToDetach("triage");

    const main = screen.getByRole("main");
    expect(main.querySelector(".impact--going")).not.toBeNull();
    expect(main.querySelector(".impact--stranded")).not.toBeNull();
  });

  it("is not in the way while the user is just editing", () => {
    render(<App />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("colouring the canvas while the warning is up", () => {
  const graph = toFlow(example);

  function classOf(id: string): string {
    const marked = markedForPreview(graph, "triage");
    return (
      [...marked.nodes, ...marked.edges].find((item) => item.id === id)?.className ?? ""
    );
  }

  it("marks the node that is on its way out", () => {
    expect(classOf("triage")).toContain("impact--going");
  });

  it("marks the nodes that would lose their data", () => {
    expect(classOf("clinical-agent")).toContain("impact--stranded");
    expect(classOf("output")).toContain("impact--stranded");
  });

  it("marks the connections that would be cut", () => {
    expect(classOf("input-triage")).toContain("impact--breaking");
  });

  it("leaves untouched parts unmarked", () => {
    expect(classOf("input")).toBe("");
  });

  it("marks nothing when no warning is up", () => {
    const marked = markedForPreview(graph, null);
    expect(marked.nodes.every((node) => node.className === undefined)).toBe(true);
    expect(marked.edges).toEqual(graph.edges);
  });
});
