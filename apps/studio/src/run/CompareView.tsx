// 두 실행을 나란히 놓고 보는 자리 — 어디서부터 달라지는지 보이고, 한쪽을 골라 이어 갈 수 있다.
// 어디서 갈라지는지는 화면이 정하지 않는다: compareRuns의 순수 함수가 이벤트에서 찾아낸다.
import { useLocale, useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import type { RunRecord } from "../store/runSlice";
import { type RunStep, endedEarly, firstDivergence, runSteps } from "./compareRuns";
import { stepWords } from "./compareWords";
import { runSummary } from "./historyWords";

/** 갈라지는 자리를 기준으로 단계가 놓인 세 구간 — 색과 굵기는 CSS가 이 이름으로 정한다. */
type StepPart = "before" | "diverged" | "after";

function partOf(at: number, diverged: number | null): StepPart {
  if (diverged === null || at < diverged) return "before";
  return at === diverged ? "diverged" : "after";
}

function CompareColumn({
  record,
  steps,
  facing,
  diverged,
}: {
  record: RunRecord;
  steps: RunStep[];
  /** 맞은편 실행의 단계들 — 이 실행이 먼저 끝났는지는 상대를 봐야 알 수 있다 */
  facing: RunStep[];
  diverged: number | null;
}) {
  const adoptRun = useEditor((state) => state.adoptRun);
  const locale = useLocale();
  const t = useT();
  const endedFirst = endedEarly(steps, facing);

  return (
    <section className="compare-column" aria-label={runSummary(record, locale)}>
      <p className="compare-column__summary">{runSummary(record, locale)}</p>
      <ol className="compare-column__steps">
        {steps.map((step, at) => {
          const words = stepWords(step, locale);
          const part = partOf(at, diverged);
          return (
            <li key={step.nodeId} className="compare-column__step" data-part={part}>
              <span className="compare-column__line">
                <span className="compare-column__mark" aria-hidden="true">
                  {part === "diverged" ? "⑂" : words.mark}
                </span>
                {words.line}
              </span>
              {part === "diverged" && (
                <span className="compare-column__note">{t("compare.diverged")}</span>
              )}
            </li>
          );
        })}
      </ol>
      {endedFirst && <p className="compare-column__ended">{t("compare.ended")}</p>}
      <button
        type="button"
        className="compare-column__adopt"
        title={t("compare.adopt.hint")}
        onClick={() => adoptRun(record.id)}
      >
        {t("compare.adopt")}
      </button>
    </section>
  );
}

export function CompareView() {
  const chosen = useEditor((state) => state.compareSelection);
  const history = useEditor((state) => state.runHistory);
  const clearCompare = useEditor((state) => state.clearCompare);
  const t = useT();

  // 둘을 다 골랐을 때만 견주는 자리가 생긴다 — 하나로는 견줄 것이 없다.
  const records = chosen.flatMap((id) => {
    const found = history.find((record) => record.id === id);
    return found ? [found] : [];
  });
  if (records.length !== 2) return null;

  const columns = records.map((record) => runSteps(record.events));
  const diverged = firstDivergence(columns[0], columns[1]);

  return (
    <section className="compare-view layer" aria-label={t("compare.title")}>
      <header className="compare-view__header">
        <h2 className="compare-view__title">{t("compare.title")}</h2>
        <button
          type="button"
          className="icon-button compare-view__close"
          title={t("compare.close")}
          aria-label={t("compare.close")}
          onClick={clearCompare}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      {diverged === null && <p className="compare-view__same">{t("compare.same")}</p>}
      <div className="compare-view__columns">
        {records.map((record, side) => (
          <CompareColumn
            key={record.id}
            record={record}
            steps={columns[side]}
            facing={columns[side === 0 ? 1 : 0]}
            diverged={diverged}
          />
        ))}
      </div>
    </section>
  );
}
