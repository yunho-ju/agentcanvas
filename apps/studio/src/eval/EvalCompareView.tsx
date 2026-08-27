import { useLocale, useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { compareEvalBatches } from "./compareEvalBatches";
import { savedWhen } from "../shell/docWords";

const EMPTY_CASES: never[] = [];
type ComparePart = "before" | "diverged" | "after";

function partOf(index: number, firstDivergence: number | null): ComparePart {
  if (firstDivergence === null || index < firstDivergence) return "before";
  return index === firstDivergence ? "diverged" : "after";
}

export function EvalCompareView() {
  const selection = useEditor((state) => state.evalCompareSelection);
  const batches = useEditor((state) => state.evalCompareBatches);
  const status = useEditor((state) => state.evalCompareStatus);
  const failure = useEditor((state) => state.evalCompareFailure);
  const cases = useEditor((state) => state.dataset?.cases ?? EMPTY_CASES);
  const close = useEditor((state) => state.clearEvalBatchCompare);
  const t = useT();
  const locale = useLocale();
  if (selection.length !== 2) return null;

  if (status === "loading") return <section className="eval-compare-view compare-view layer"><header className="compare-view__header"><h2 className="compare-view__title">{t("eval.compare.title")}</h2><button type="button" className="icon-button compare-view__close" onClick={close} aria-label={t("eval.compare.close")}>×</button></header><p>{t("eval.compare.loading")}</p></section>;
  if (status === "failed") return <section className="eval-compare-view compare-view layer"><header className="compare-view__header"><h2 className="compare-view__title">{t("eval.compare.title")}</h2><button type="button" className="icon-button compare-view__close" onClick={close} aria-label={t("eval.compare.close")}>×</button></header><p>{failure ? t(failure) : t("eval.compare.failed")}</p></section>;
  if (batches[0] === null || batches[1] === null) return <section className="eval-compare-view compare-view layer"><header className="compare-view__header"><h2 className="compare-view__title">{t("eval.compare.title")}</h2><button type="button" className="icon-button compare-view__close" onClick={close} aria-label={t("eval.compare.close")}>×</button></header><p>{t("eval.compare.missing")}</p></section>;
  const leftBatch = batches[0];
  const rightBatch = batches[1];
  const comparison = compareEvalBatches(cases, leftBatch, rightBatch);
  return <section className="eval-compare-view compare-view layer" aria-label={t("eval.compare.title")}>
    <header className="compare-view__header"><h2 className="compare-view__title">{t("eval.compare.title")}</h2><button type="button" className="icon-button compare-view__close" onClick={close} aria-label={t("eval.compare.close")}><span aria-hidden="true">×</span></button></header>
    {comparison.firstDivergence === null ? <p className="compare-view__same">{t("eval.compare.same")}</p> : <p className="eval-compare-view__divergence">{t("eval.compare.divergence", { at: comparison.firstDivergence + 1 })}</p>}
    <div className="compare-view__columns">{[leftBatch, rightBatch].map((batch, side) => <section className="compare-column" key={batch.id} aria-label={t("eval.compare.column", { at: side + 1 })}>
      <p className="compare-column__summary">{savedWhen(batch.started_at, locale)} · {t("eval.history.count", { passed: batch.results.filter((result) => result.passed).length, total: cases.length })}</p>
      <ol className="compare-column__steps">{comparison.cases.map((item, index) => {
        const result = side === 0 ? item.left : item.right;
        const output = result?.attempts.at(-1)?.output_text;
        const missing = (side === 0 && (item.missing === "left" || item.missing === "both")) || (side === 1 && (item.missing === "right" || item.missing === "both"));
        const part = partOf(index, comparison.firstDivergence);
        const status = missing ? t("eval.compare.missing") : result?.passed ? t("eval.compare.result.passed") : t("eval.compare.result.failed");
        return <li className="compare-column__step" data-part={part} key={item.caseId}>
          <span className="compare-column__line"><span className="compare-column__mark" aria-hidden="true">{part === "diverged" ? "⑂" : result?.passed ? "✓" : "✕"}</span>{cases[index]?.title ?? t("eval.compare.missing")}<span className="eval-compare-view__status">{status}</span></span>
          {missing ? <span className="eval-compare-view__output">{t("eval.compare.missing")}</span> : output ? <span className="eval-compare-view__output">{output}</span> : <span className="eval-compare-view__output">{t("eval.case.result.empty")}</span>}
        </li>;
      })}</ol>
    </section>)}</div>
  </section>;
}
