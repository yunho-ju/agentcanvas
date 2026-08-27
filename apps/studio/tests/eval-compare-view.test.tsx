import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvalCompareView } from "../src/eval/EvalCompareView";
import type { EvalBatch } from "../src/generated/eval_batch";
import { setLocale } from "../src/i18n/localeStore";
import { useEditor } from "../src/store/editor";

const cases = [
  { id: "a", title: "첫째", input: {}, expected_phrases: ["x"] as [string] },
  { id: "b", title: "둘째", input: {}, expected_phrases: ["y"] as [string] },
];

function batch(id: string, passed: boolean, output = "답"): EvalBatch {
  return { id, dataset_id: "d", spec_id: "s", spec_revision: "r", started_at: id, results: [{ case_id: "a", evaluator: "e", evaluator_version: "v", passed, attempts: [{ run_id: id, passed, output_text: output }] }] };
}

beforeEach(() => {
  setLocale("ko");
  useEditor.setState({ dataset: { id: "d", name: "시험", cases }, evalCompareSelection: ["left", "right"], evalCompareBatches: [null, null], evalCompareStatus: "idle", evalCompareFailure: null, clearEvalBatchCompare: vi.fn() });
});
afterEach(cleanup);

describe("EvalCompareView states", () => {
  it.each([
    ["loading", "시험 결과를 불러오는 중이에요"],
    ["failed", "시험 결과를 읽지 못했어요 — 잠시 뒤 다시 해보세요"],
  ] as const)("renders %s state", (status, text) => {
    act(() => useEditor.setState({ evalCompareStatus: status }));
    render(<EvalCompareView />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("renders missing and same results", () => {
    act(() => useEditor.setState({ evalCompareStatus: "ready", evalCompareBatches: [batch("left", true), null] }));
    render(<EvalCompareView />);
    expect(screen.getByText("이 시험의 결과가 없어요")).toBeInTheDocument();
    cleanup();
    act(() => useEditor.setState({ evalCompareBatches: [batch("left", true), batch("right", true)] }));
    render(<EvalCompareView />);
    expect(screen.getByText("두 시험 결과가 똑같아요")).toBeInTheDocument();
  });

  it("marks only the first divergence and explains empty output", () => {
    const left = batch("left", true, "");
    const right = batch("right", false, "다름");
    left.results.push({ case_id: "b", evaluator: "e", evaluator_version: "v", passed: true, attempts: [{ run_id: "b", passed: true, output_text: "뒤" }] });
    right.results.push({ case_id: "b", evaluator: "e", evaluator_version: "v", passed: true, attempts: [{ run_id: "b", passed: true, output_text: "뒤" }] });
    act(() => useEditor.setState({ evalCompareStatus: "ready", evalCompareBatches: [left, right] }));
    render(<EvalCompareView />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveAttribute("data-part", "diverged");
    expect(rows[1]).toHaveAttribute("data-part", "after");
    expect(screen.getAllByText("답이 없었어요")).toHaveLength(1);
    expect(screen.getAllByText("통과")).toHaveLength(3);
    expect(screen.getByText("실패")).toBeInTheDocument();
  });

  it("closes through the close action", () => {
    const close = vi.fn();
    act(() => useEditor.setState({ evalCompareStatus: "ready", evalCompareBatches: [batch("left", true), batch("right", true)], clearEvalBatchCompare: close }));
    render(<EvalCompareView />);
    fireEvent.click(screen.getByRole("button", { name: "시험 결과 견주기 닫기" }));
    expect(close).toHaveBeenCalledOnce();
  });
});
