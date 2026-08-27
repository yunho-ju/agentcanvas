import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { EVENT_STEP_MS } from "../src/run/fakeRun";
import { EventList } from "../src/run/EventList";
import { useEditor } from "../src/store/editor";
import { currentSeq } from "../src/store/runSlice";
import { runOnServer, settle } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;
const trial = { runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") };

function store() {
  return useEditor.getState();
}

async function startRun() {
  await act(async () => {
    await runOnServer(trial);
  });
}

function itemFor(text: string | RegExp) {
  const item = screen.getByText(text).closest("li");
  if (!item) throw new Error("the event is not on the list");
  return item;
}

beforeEach(() => {
  store().loadSpec(example);
});

describe("the list of what happened during the run", () => {
  it("stays out of the way while the user is editing", () => {
    render(<EventList />);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("tells the story in the order it happened, in plain words", async () => {
    await startRun();
    // 예시 그래프는 사람 확인 밸브에서 한 번 멈춘다 — 승인해야 끝까지의 이야기가 남는다.
    await act(async () => {
      store().tickRun(EVENT_STEP_MS * 1000);
      await store().approveGate();
      await settle();
    });
    render(<EventList />);

    const said = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(said[0]).toContain("실행을 시작했다");
    expect(said.at(-1)).toContain("실행을 모두 마쳤다");
    expect(said.some((line) => line.includes("'triage' 노드가 일을 시작했다"))).toBe(true);
  });

  it("keeps the original event name as a note beside the plain words", async () => {
    await startRun();
    render(<EventList />);

    expect(within(itemFor("'triage' 노드가 일을 시작했다")).getByText("node.started"))
      .toBeInTheDocument();
  });

  it("marks the moment the canvas is showing right now", async () => {
    await startRun();
    render(<EventList />);

    expect(
      within(itemFor("실행을 시작했다")).getByRole("button"),
    ).toHaveAttribute("aria-current", "true");
  });

  it("winds the run to the event the user picks", async () => {
    await startRun();
    render(<EventList />);

    await userEvent.click(
      within(itemFor("'triage' 노드가 일을 시작했다")).getByRole("button"),
    );

    expect(
      store().runEvents.find((event) => event.seq === currentSeq(store()))?.node_id,
    ).toBe("triage");
  });

  it("selects the node the picked event belongs to", async () => {
    await startRun();
    render(<EventList />);

    await userEvent.click(
      within(itemFor("'triage' 노드가 일을 시작했다")).getByRole("button"),
    );

    expect(store().nodes.filter((node) => node.selected).map((node) => node.id)).toEqual([
      "triage",
    ]);
  });

  it("opens up what the picked event carried", async () => {
    await startRun();
    render(<EventList />);

    await userEvent.click(
      within(itemFor("'triage' 노드가 인공지능에게 물어봤다")).getByRole("button"),
    );

    expect(
      within(itemFor("'triage' 노드가 인공지능에게 물어봤다")).getByText(
        /model_ref: "model:\/\/default"/,
      ),
    ).toBeInTheDocument();
  });

  it("shows what an event carried only for the event on screen", async () => {
    await startRun();
    render(<EventList />);

    expect(screen.getAllByRole("definition")).toHaveLength(1);
  });
});
