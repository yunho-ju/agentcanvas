import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { selectedNode, useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

async function openList() {
  render(<App />);
  await userEvent.click(screen.getByRole("button", { name: "노드 목록" }));
  return within(screen.getByRole("region", { name: "노드 목록" }));
}

beforeEach(() => {
  store().loadSpec(example);
});

describe("reading the graph as a list instead of a picture", () => {
  it("stays out of the way until the user asks for it", () => {
    render(<App />);
    expect(screen.queryByRole("region", { name: "노드 목록" })).not.toBeInTheDocument();
  });

  it("names every node on the canvas", async () => {
    const list = await openList();

    for (const node of example.nodes) {
      expect(
        list.getByRole("button", { name: new RegExp(`${node.id}$`) }),
      ).toBeInTheDocument();
    }
  });

  it("says what each node is for, in plain words", async () => {
    const list = await openList();
    expect(list.getByRole("button", { name: /갈림길 판단/ })).toBeInTheDocument();
  });

  it("selects the node on the canvas when its row is chosen", async () => {
    const list = await openList();

    await userEvent.click(list.getByRole("button", { name: /triage$/ }));

    expect(selectedNode(store())?.id).toBe("triage");
  });

  it("marks the row of the node that is selected on the canvas", async () => {
    const list = await openList();
    act(() => store().select("node", "output"));

    expect(list.getByRole("button", { name: /output$/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  // 목록에서 찾은 노드를 캔버스에서도 찾게 해 준다 (브리프 B7).
  it("takes the canvas to the node when its row is double-clicked", async () => {
    const list = await openList();

    await userEvent.dblClick(list.getByRole("button", { name: /triage$/ }));

    expect(store().viewRequest?.nodes).toEqual(["triage"]);
  });

  it("lets the user take a node out from the list", async () => {
    const list = await openList();

    await userEvent.click(list.getByRole("button", { name: "triage 빼기" }));

    expect(store().pendingDetach).toBe("triage");
  });
});
