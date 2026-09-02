// 시험해 보기 — Evaluate 모드의 화면 (DESIGN §7 eval-panel). 자리는 .layer-right 세로 스택.
import { useShallow } from "zustand/react/shallow";
import { EvalCaseCard } from "./EvalCaseCard";
import { EvalCaseForm } from "./EvalCaseForm";
import { EvalPromptList } from "./EvalPromptList";
import { EvalSuggestCards } from "./EvalSuggestCards";
import { EvalSummaryPill } from "./EvalSummaryPill";
import { useT } from "../i18n/useT";
import { evalCases, evalJudgeBlocked, evalJudgeInEffect, evalRunBlocked } from "../store/evalSlice";
import { NLI_ENTAILMENT_EVALUATOR } from "./evaluatorCatalog";
import { layerIsMissing } from "./evaluatorStanding";
import { useEditor } from "../store/editor";
import { getLocale } from "../i18n/localeStore";
import { savedWhen } from "../shell/docWords";
import { EvalDatasetPicker } from "./EvalDatasetPicker";

/**
 * 지운 케이스가 있던 그 자리에 서는 한 줄 — '지웠어요 — 되돌리기'(DESIGN §7 eval-case-card 갱신본).
 * 되돌리기는 ghost 액션이고, 새 지우기가 오면 이 줄 자체가 갈아탄다(store가 슬롯을 하나만 쥔다).
 */
function RestoreRow({ onRestore }: { onRestore: () => void }) {
  const t = useT();
  return (
    <p className="eval-case-card eval-case-card--restore">
      {t("eval.case.delete.restore")}{" "}
      <button type="button" className="eval-panel__restore-action" onClick={onRestore}>
        {t("eval.case.delete.restore.action")}
      </button>
    </p>
  );
}

export function EvalPanel() {
  const open = useEditor((state) => state.evalPanelOpen);
  // 계산해서 돌려주는 값(새 배열/객체)은 얕은 비교로 감싼다 — 안 그러면 매번 다른 참조가
  // useSyncExternalStore의 스냅숏 안정성을 깨고 렌더 루프를 만든다.
  const cases = useEditor(useShallow(evalCases));
  const draft = useEditor((state) => state.caseDraft);
  const blocked = useEditor(useShallow(evalRunBlocked));
  const caseSaveNotice = useEditor((state) => state.caseSaveNotice);
  const lastDeletedCase = useEditor((state) => state.lastDeletedCase);
  const startNewCase = useEditor((state) => state.startNewCase);
  const restoreDeletedCase = useEditor((state) => state.restoreDeletedCase);
  const runAllCases = useEditor((state) => state.runAllCases);
  // 켠 표시도 판정을 거친다 — 설 수 없는 심판은 켜진 것으로 보이지 않는다.
  const useJudge = useEditor(evalJudgeInEffect);
  const setUseJudge = useEditor((state) => state.setEvalUseJudge);
  const judgeBlocked = useEditor(useShallow(evalJudgeBlocked));
  const standing = useEditor((state) => state.evaluatorStanding);
  const t = useT();
  const advanced = useEditor((state) => state.evalAdvanced);
  const setAdvanced = useEditor((state) => state.setEvalAdvanced);
  const history = useEditor((state) => state.evalBatchHistory);
  const historyLoading = useEditor((state) => state.evalBatchHistoryLoading);
  const historyFailure = useEditor((state) => state.evalBatchHistoryFailure);
  const selectedHistoryId = useEditor((state) => state.evalSelectedHistoryId);
  const selectBatch = useEditor((state) => state.selectEvalBatch);
  const compareSelection = useEditor((state) => state.evalCompareSelection);
  const toggleCompare = useEditor((state) => state.toggleEvalBatchCompare);

  if (!open) return null;

  const newCaseOpen = draft !== null && draft.id === null;

  return (
    // 우측 기둥의 자리 규칙은 data-mode-panel 표식 하나로 받는다 (DESIGN §1 우측 레이어의 자리 나눔).
    <section
      className="eval-panel layer"
      data-mode-panel="eval"
      aria-label={t("eval.panel.label")}
    >
      <div className="eval-panel__heading">
        <p className="eval-panel__title">{t("eval.panel.title")}</p>
        <button type="button" className="eval-panel__advanced" aria-pressed={advanced} onClick={() => {
          setAdvanced(!advanced);
        }} aria-label={t("eval.advanced.label")}>
          {t(advanced ? "eval.advanced.hide" : "eval.advanced.show")}
        </button>
      </div>
      <EvalDatasetPicker />
      {/* 시험받는 지시문이 결과보다 먼저 — 무엇을 고칠지가 같은 화면에서 읽힌다 (DESIGN §7 eval-prompt-card). */}
      <EvalPromptList />
      <EvalSummaryPill />
      <button
        type="button"
        className="eval-panel__run"
        disabled={blocked !== null}
        title={blocked ? t(blocked) : t("eval.run.all.hint")}
        onClick={() => void runAllCases()}
      >
        {t("eval.run.all")}
      </button>
      {/* 값이 드는 층은 사람이 켤 때만 선다 — 비용은 누르기 전에 체크 옆에서 읽힌다 (DESIGN §7 eval-panel). */}
      <label
        className="eval-panel__judge"
        title={judgeBlocked ? t(judgeBlocked) : undefined}
      >
        <input
          type="checkbox"
          checked={useJudge}
          disabled={judgeBlocked !== null}
          onChange={(event) => setUseJudge(event.target.checked)}
        />
        <span className="eval-panel__judge-label">{t("eval.run.judge")}</span>
        <span className="eval-panel__judge-cost">{t("eval.run.judge.cost")}</span>
      </label>
      {/* 지운 케이스의 되돌리기와는 다른 자리 — 실행 실패 같은 패널 전역 알림만 여기서 말한다. */}
      {caseSaveNotice ? (
        <p className="eval-panel__notice" data-tone={caseSaveNotice.tone}>
          {t(caseSaveNotice.message)}
        </p>
      ) : null}
      {cases.length === 0 && !newCaseOpen && !lastDeletedCase ? (
        <div className="eval-panel__empty">
          <p className="eval-panel__invite">{t("eval.empty.invite")}</p>
          <button type="button" className="eval-panel__add" onClick={() => startNewCase()}>
            {t("eval.empty.cta")}
          </button>
        </div>
      ) : (
        <div className="eval-panel__cases">
          {/* 되돌리기 줄은 지운 케이스가 있던 그 자리에 낀다 — 목록 끝이었다면 맨 뒤에 선다. */}
          {cases.flatMap((evalCase, index) => [
            lastDeletedCase?.index === index ? (
              <RestoreRow key="restore" onRestore={() => void restoreDeletedCase()} />
            ) : null,
            <EvalCaseCard key={evalCase.id} evalCase={evalCase} />,
          ])}
          {lastDeletedCase && lastDeletedCase.index >= cases.length ? (
            <RestoreRow key="restore" onRestore={() => void restoreDeletedCase()} />
          ) : null}
          {newCaseOpen ? (
            <div className="eval-case-card eval-case-card--new">
              <EvalCaseForm />
            </div>
          ) : (
            <button type="button" className="eval-panel__add" onClick={() => startNewCase()}>
              {t("eval.case.add")}
            </button>
          )}
        </div>
      )}
      {/* 손으로 짓는 자리 다음에 AI가 지어 주는 자리 — 담아야 묶음에 들어간다 (DESIGN §7 eval-suggest-card). */}
      <EvalSuggestCards />
      {/* 이 서버에 뜻 검사가 없다는 사실은 고급 보기에서만 말한다 — 기본 화면은 조용하다. */}
      {advanced && layerIsMissing(standing, NLI_ENTAILMENT_EVALUATOR) ? (
        <p className="eval-panel__layer-note">{t("eval.layer.meaning.missing")}</p>
      ) : null}
      {advanced ? (
        <section className="eval-batch-history" aria-label={t("eval.history.label")}>
          <p className="eval-batch-history__title">{t("eval.history.title")}</p>
          {historyLoading ? <p>{t("eval.history.loading")}</p> : null}
          {!historyLoading && historyFailure ? <p>{t(historyFailure)}</p> : null}
          {!historyLoading && !historyFailure && (!history || history.batches.length === 0) ? <p>{t("eval.history.empty")}</p> : null}
          {!historyLoading && !historyFailure ? history?.batches.map((summary) => (
            <div className="eval-batch-history__row" key={summary.id}>
              <button type="button" className="eval-batch-history__detail" aria-pressed={selectedHistoryId === summary.id} onClick={() => void selectBatch(summary)}><span>{savedWhen(summary.started_at, getLocale())}</span><span>{t("eval.history.count", { passed: summary.passed_count, total: summary.case_count })}</span></button>
              <button type="button" className="eval-batch-history__compare" aria-pressed={compareSelection.includes(summary.id)} onClick={() => toggleCompare(summary)}>{compareSelection.includes(summary.id) ? t("eval.compare.picked", { at: compareSelection.indexOf(summary.id) + 1 }) : t("eval.compare.pick")}</button>
            </div>
          )) : null}
          {history?.has_more ? <p className="eval-batch-history__more">{t("eval.history.more")}</p> : null}
        </section>
      ) : null}
    </section>
  );
}
