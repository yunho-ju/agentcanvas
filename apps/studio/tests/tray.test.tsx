import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

/** 보관함은 독에서 부를 때 펼쳐진다. */
async function openTray() {
  render(<App />);
  await userEvent.click(screen.getByRole("button", { name: "보관함" }));
}

function tray() {
  return within(screen.getByRole("region", { name: "보관함" }));
}

beforeEach(() => {
  store().loadSpec(example);
});

describe("the tray of nodes taken out of the canvas", () => {
  function detach(nodeId: string) {
    act(() => {
      store().requestDetach(nodeId);
      store().confirmDetach();
    });
  }

  it("tells the user what it is for while it is empty", async () => {
    await openTray();
    expect(tray().getByText(/뺀 노드/)).toBeInTheDocument();
  });

  it("shows a node that was taken out, by the name the user reads", async () => {
    await openTray();
    detach("triage");

    expect(tray().getByRole("button", { name: /갈림길 판단/ })).toBeInTheDocument();
  });

  it("plugs the node back into the canvas when its item is clicked", async () => {
    await openTray();
    detach("triage");

    await userEvent.click(tray().getByRole("button", { name: /갈림길 판단/ }));

    expect(store().nodes.map((node) => node.id)).toContain("triage");
    expect(tray().queryByRole("button", { name: /갈림길 판단/ })).not.toBeInTheDocument();
  });
});
