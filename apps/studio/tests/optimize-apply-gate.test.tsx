import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { makeArchitectSpec, withAHumanGate } from "./architect-fixtures";
import { reviewArchitectSpec } from "../src/architect/architect";
import { useEditor } from "../src/store/editor";

const CANDIDATE = withAHumanGate(makeArchitectSpec("answer questions", "opt-gated"));

function showTheCandidate(review = reviewArchitectSpec(CANDIDATE)) {
  useEditor.setState({
    optimizeMode: "review",
    optimizeObjective: "answer more plainly",
    optimizeCandidate: CANDIDATE,
    optimizeReview: review,
    optimizeProposal: null,
    optimizeError: null,
    optimizeLoading: false,
  });
}

beforeEach(() => {
  useEditor.setState({ architectMode: "closed" });
  useEditor.getState().loadSpec(makeArchitectSpec("answer questions", "opt-base"));
});

describe("the optimize card sits on the same gate as the architect card", () => {
  it("lets a candidate that stops for a person be applied", () => {
    showTheCandidate();
    render(<App />);

    expect(screen.getByRole("button", { name: "이대로 고치기" })).toBeEnabled();
  });

  it("refuses a candidate whose checks did not pass and says why", () => {
    showTheCandidate({
      passed: false,
      schema: { passed: true, count: 0 },
      graph: { passed: false, count: 1 },
      dryRun: { passed: true, count: 1 },
      toFill: 0,
    });
    render(<App />);
    const apply = screen.getByRole("button", { name: "이대로 고치기" });

    expect(apply).toBeDisabled();
    expect(apply).toHaveAttribute("title", "모든 확인을 통과해야 적용할 수 있어요");
  });
});
