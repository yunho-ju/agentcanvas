// 해 본 실행이 쌓이는 띠 — 실험은 지나가는 것이 아니라 되짚을 수 있는 것이 된다.
// 카드 하나를 고르면 그때의 실행이 처음부터 다시 흐르고, 옆의 '비교'는 두 실행을 나란히 놓는다.
import { useLocale, useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { COMPARE_SEATS } from "../store/runSlice";
import { runSummary } from "./historyWords";
import { endedInFailure } from "./player";

export function RunHistoryStrip() {
  const history = useEditor((state) => state.runHistory);
  const activeRunId = useEditor((state) => state.activeRunId);
  const chosen = useEditor((state) => state.compareSelection);
  const adoptedRunId = useEditor((state) => state.adoptedRunId);
  const replayRun = useEditor((state) => state.replayRun);
  const toggleCompare = useEditor((state) => state.toggleCompare);
  const promoteFailedRun = useEditor((state) => state.promoteFailedRun);
  const hasCaseDraft = useEditor((state) => state.caseDraft !== null);
  const locale = useLocale();
  const t = useT();

  // 해 본 적이 없으면 자리도 만들지 않는다 — 빈 띠는 캔버스를 가릴 뿐이다.
  if (history.length === 0) return null;

  // 견줄 상대가 없으면 고를 수 없다 — 그 까닭을 컨트롤이 스스로 말한다.
  const alone = history.length < COMPARE_SEATS;

  return (
    <section className="run-history layer" aria-label={t("runHistory.label")}>
      <ul className="run-history__list">
        {history.map((record) => {
          const seat = chosen.indexOf(record.id);
          return (
            <li
              key={record.id}
              className="run-history__item"
              data-compare={seat === -1 ? "free" : "picked"}
            >
              <button
                type="button"
                className="run-history__card"
                aria-current={record.id === activeRunId}
                title={t("runHistory.replay")}
                onClick={() => replayRun(record.id)}
              >
                {runSummary(record, locale)}
                {/* 끝까지 가지 못한 실행은 늘 그렇게 말한다 — 문제는 감추지 않는다. */}
                {endedInFailure(record.events) && (
                  <span className="run-history__failed">
                    <span className="run-history__failed-mark" aria-hidden="true">
                      ✕
                    </span>
                    {t("runHistory.failed")}
                  </span>
                )}
                {record.id === adoptedRunId && (
                  <span className="run-history__adopted">
                    <span className="run-history__adopted-mark" aria-hidden="true">
                      ✓
                    </span>
                    {t("compare.adopted")}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="run-history__compare"
                aria-pressed={seat !== -1}
                disabled={alone}
                title={alone ? t("compare.pick.none") : t("compare.pick.hint")}
                onClick={() => toggleCompare(record.id)}
              >
                {seat === -1
                  ? t("compare.pick")
                  : t("compare.picked", { at: seat + 1, of: COMPARE_SEATS })}
              </button>
              {endedInFailure(record.events) ? (
                <button
                  type="button"
                  className="run-history__promote"
                  disabled={hasCaseDraft}
                  title={hasCaseDraft ? t("runHistory.promote.disabled") : t("runHistory.promote")}
                  onClick={() => promoteFailedRun(record.id)}
                >
                  {t("runHistory.promote")}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
