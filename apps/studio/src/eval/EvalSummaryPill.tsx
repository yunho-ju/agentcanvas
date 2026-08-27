// 결론이 숫자보다 먼저 오는 pill (DESIGN §7 eval-summary-pill).
import { useShallow } from "zustand/react/shallow";
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { evalSummary } from "../store/evalSlice";

const MARK: Record<string, string> = {
  allPassed: "✓",
  someFailed: "✕",
  running: "…",
  none: "",
};

export function EvalSummaryPill() {
  const summary = useEditor(useShallow(evalSummary));
  const t = useT();
  const text =
    summary.verdict === "allPassed"
      ? t("eval.summary.allPassed", { total: summary.total })
      : summary.verdict === "someFailed"
        ? t("eval.summary.someFailed", { failed: summary.failed })
        : summary.verdict === "running"
          ? t("eval.summary.running")
          : t("eval.summary.none");

  return (
    <p
      className="eval-summary-pill"
      data-verdict={summary.verdict}
      role="status"
    >
      <span className="eval-summary-pill__mark" aria-hidden="true">
        {MARK[summary.verdict]}
      </span>
      {text}
    </p>
  );
}
