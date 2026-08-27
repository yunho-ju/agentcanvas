import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { Timeline } from "../src/run/Timeline";
import { useEditor } from "../src/store/editor";
import { currentSeq } from "../src/store/runSlice";
import { runOnServer } from "./fakeRunServer";

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

beforeEach(() => {
  store().loadSpec(example);
});

describe("the timeline under the canvas", () => {
  it("stays out of the way while the user is editing", () => {
    render(<Timeline />);

    expect(screen.queryByLabelText("재생 위치")).not.toBeInTheDocument();
  });

  it("tells the user the graph is locked while the run is on screen", async () => {
    await startRun();
    render(<Timeline />);

    expect(screen.getByText(/그래프는 잠겨 있다/)).toBeInTheDocument();
  });

  it("says how far into the run the user is", async () => {
    await startRun();
    render(<Timeline />);

    expect(
      screen.getByText(`${store().runEvents.length}개 중 1번째`),
    ).toBeInTheDocument();
  });

  it("winds the run to the moment the user drags to", async () => {
    await startRun();
    render(<Timeline />);

    fireEvent.change(screen.getByLabelText("재생 위치"), { target: { value: "6" } });

    expect(currentSeq(store())).toBe(store().runEvents[6].seq);
  });

  it("winds backwards just as well", async () => {
    await startRun();
    render(<Timeline />);
    const scrubber = screen.getByLabelText("재생 위치");

    fireEvent.change(scrubber, { target: { value: "6" } });
    fireEvent.change(scrubber, { target: { value: "2" } });

    expect(currentSeq(store())).toBe(store().runEvents[2].seq);
  });

  it("lets the user stop the run where it is", async () => {
    await startRun();
    render(<Timeline />);

    await userEvent.click(screen.getByRole("button", { name: "잠시 멈추기" }));

    expect(store().isPlaying).toBe(false);
  });

  it("lets the user start it moving again", async () => {
    await startRun();
    render(<Timeline />);

    await userEvent.click(screen.getByRole("button", { name: "잠시 멈추기" }));
    await userEvent.click(screen.getByRole("button", { name: "이어서 보기" }));

    expect(store().isPlaying).toBe(true);
  });

  it("takes the run back to the beginning", async () => {
    await startRun();
    render(<Timeline />);
    fireEvent.change(screen.getByLabelText("재생 위치"), { target: { value: "6" } });

    await userEvent.click(screen.getByRole("button", { name: "처음부터" }));

    expect(currentSeq(store())).toBe(0);
  });

  it("plays faster when the user asks for it", async () => {
    await startRun();
    render(<Timeline />);

    await userEvent.selectOptions(screen.getByLabelText("재생 속도"), "4");

    expect(store().runSpeed).toBe(4);
  });

  it("offers speeds from half to eight times", async () => {
    await startRun();
    render(<Timeline />);

    expect(
      [...screen.getByLabelText("재생 속도").querySelectorAll("option")].map(
        (option) => option.value,
      ),
    ).toEqual(["0.5", "1", "2", "4", "8"]);
  });

  // 편집으로 돌아가는 길은 상단 모드 세그먼트가 맡는다 (tests/mode-segment.test.tsx).
});
