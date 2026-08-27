import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;
const trial = { runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") };

function store() {
  return useEditor.getState();
}

function configOf(nodeId: string): Record<string, unknown> {
  return (
    store().nodes.find((node) => node.id === nodeId)?.data.spec.config ?? {}
  );
}

async function watchAgent() {
  render(<App />);
  await act(async () => {
    store().select("node", "clinical-agent");
    await runOnServer(trial);
  });
}

beforeEach(() => {
  store().loadSpec(example);
});

describe("the settings panel while a run is on screen", () => {
  it("tells the user the settings can only be read right now", async () => {
    await watchAgent();

    expect(screen.getByText(/실행 중에는 고칠 수 없다/)).toBeInTheDocument();
  });

  it("puts every setting out of reach", async () => {
    await watchAgent();

    expect(screen.getByLabelText(/사용할 모델/)).toBeDisabled();
    expect(screen.getByLabelText(/최대 주고받기 횟수/)).toBeDisabled();
    expect(screen.getByLabelText(/쓸 수 있는 도구 묶음/)).toBeDisabled();
  });

  it("hands the settings back when the run is closed", async () => {
    await watchAgent();

    act(() => store().stopRun());

    expect(screen.getByLabelText(/사용할 모델/)).toBeEnabled();
  });

  it("keeps what the user typed during the run out of the graph", async () => {
    await watchAgent();
    const before = configOf("clinical-agent");

    await userEvent.type(screen.getByLabelText(/사용할 모델/), "-changed");

    expect(configOf("clinical-agent")).toEqual(before);
  });

  it("shows the stored value again once editing is possible", async () => {
    await watchAgent();
    const tools = screen.getByLabelText(/쓸 수 있는 도구 묶음/);

    await userEvent.type(tools, "sneaked-in");
    act(() => store().stopRun());

    expect(tools).toHaveValue("clinical-reference");
    expect(configOf("clinical-agent")).toEqual(example.nodes[2].config);
  });
});

describe("the way to delete a node while a run is on screen", () => {
  it("is out of reach, and says why", async () => {
    await watchAgent();

    const remove = screen.getByRole("button", { name: "이 노드 지우기" });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute("title", "실행 중에는 고칠 수 없다");
  });
});

describe("the dock panels while a run is on screen", () => {
  /** 독의 도구는 실행 중에도 열리지만, 그래프를 고치는 일만 잠긴다. */
  async function openDock(name: string) {
    await userEvent.click(screen.getByRole("button", { name }));
  }

  it("does not let the user drop a new node on the canvas", async () => {
    await watchAgent();
    await openDock("노드 추가");

    const item = screen.getByRole("button", { name: /AI 에이전트/ });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute("title", "실행 중에는 고칠 수 없다");
  });

  it("does not let the user plug a stored node back in", async () => {
    act(() => {
      store().requestDetach("output");
      store().confirmDetach();
    });
    await watchAgent();
    await openDock("보관함");

    const item = screen.getByRole("button", { name: /output/ });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute("title", "실행 중에는 고칠 수 없다");
  });
});

describe("starting a run while a question is still open", () => {
  it("drops the question about taking a node out", async () => {
    render(<App />);
    act(() => store().requestDetach("triage"));

    await act(async () => {
      await runOnServer(trial);
    });

    expect(store().pendingDetach).toBeNull();
  });

  it("leaves no half-asked question behind on the screen", async () => {
    render(<App />);
    act(() => store().requestDetach("triage"));

    await act(async () => {
      await runOnServer(trial);
    });

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
