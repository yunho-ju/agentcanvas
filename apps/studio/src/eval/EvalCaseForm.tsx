// 펼친 케이스의 편집 필드 — 전부 기존 .control 재사용, 새 시각 발명 금지 (DESIGN §7 eval-case-form).
import { useMemo } from "react";
import {
  countsAreAtLeastOne,
  draftIsSavable,
  draftMatchesCase,
  passesExceedRuns,
  withPhrase,
} from "./caseForm";
import { EXPECTED_PHRASES_EVALUATOR, evaluatorCatalog } from "./evaluatorCatalog";
import { localized } from "../i18n/locale";
import type { MessageKey } from "../i18n/messages";
import { useLocale, useT } from "../i18n/useT";
import { SchemaFields } from "../inspector/SchemaFields";
import { asText, toNumber } from "../inspector/values";
import { runInputFields } from "../run/runInput";
import { useEditor } from "../store/editor";

/** 저장 캡션 3상태 — doc-card와 같은 문구를 그대로 쓴다 (DESIGN §7 eval-case-form). */
function saveCaptionKey(saving: boolean, synced: boolean): MessageKey {
  if (saving) return "save.caption.saving";
  return synced ? "save.ok" : "save.caption.changed";
}

export function EvalCaseForm() {
  const draft = useEditor((state) => state.caseDraft);
  const phraseHint = useEditor((state) => state.casePhraseHint);
  const saving = useEditor((state) => state.caseSaving);
  const datasetSynced = useEditor((state) => state.datasetSynced);
  const setCaseDraft = useEditor((state) => state.setCaseDraft);
  const saveCaseDraft = useEditor((state) => state.saveCaseDraft);
  const deleteCase = useEditor((state) => state.deleteCase);
  // exportSpec 자체는 늘 같은 함수라 의존성이 되지 못한다 — 그래프가 실제로 바뀌는 nodes·edges를 봐야
  // 폼이 열려 있는 동안 그래프를 고쳐도 '넣을 값'이 따라온다.
  const exportSpec = useEditor((state) => state.exportSpec);
  const nodes = useEditor((state) => state.nodes);
  const edges = useEditor((state) => state.edges);
  const t = useT();
  const locale = useLocale();
  // '들어있어야 하는 말'의 설명은 카탈로그의 plain_description이 원천이다 — messages.ts에 손으로
  // 다시 적지 않는다(독립 리뷰 M4, 설계 원칙 §4.2).
  const evaluatorDescription = localized(
    evaluatorCatalog[EXPECTED_PHRASES_EVALUATOR]?.plain_description,
    locale,
  );

  const fields = useMemo(() => runInputFields(exportSpec()), [exportSpec, nodes, edges]);

  if (!draft) return null;

  const exceeds = passesExceedRuns(draft.passesNeeded, draft.runsPerCase);
  // 판정은 draftIsSavable 한 곳뿐이다 — 여기서 반쪽을 다시 재지 않는다(계약의 ge=1과 같은 판정).
  const savable = draftIsSavable(draft);
  // 빈 칸(undefined)도, 0·음수도 같은 이유다 — draftIsSavable과 같은 판정 한 곳(countsAreAtLeastOne)을 쓴다.
  const countTooLow = !countsAreAtLeastOne(draft);
  // 저장했다고 말할 수 있는 것은 이 초안이 "지금 서버가 들고 있는 그 케이스"와 내용까지 같을 때뿐이다
  // — 저장한 뒤 계속 고치는 중이면 dataset은 그대로라도 초안은 이미 다르다(독립 리뷰 M1).
  const savedMatch = draft.id ? (datasetSynced?.cases?.find((c) => c.id === draft.id) ?? null) : null;
  const synced = savedMatch !== null && draftMatchesCase(draft, savedMatch);

  return (
    <div className="eval-case-form">
      <div className="eval-case-form__field">
        <label className="eval-case-form__label" htmlFor="eval-case-title">
          {t("form.required", { label: t("eval.case.form.title.label") })}
        </label>
        <input
          id="eval-case-title"
          className="control"
          type="text"
          value={draft.title}
          onChange={(event) => setCaseDraft({ title: event.target.value })}
        />
      </div>

      {fields.length > 0 ? (
        <SchemaFields
          fields={fields}
          values={draft.input}
          onChange={(name, value) => setCaseDraft({ input: { ...draft.input, [name]: value } })}
          block="eval-case-form"
          idPrefix="eval-case-input"
        />
      ) : null}

      <div className="eval-case-form__field">
        <label className="eval-case-form__label" htmlFor="eval-case-expected">
          {t("form.required", { label: t("eval.case.form.expected.label") })}
        </label>
        {evaluatorDescription ? (
          <p className="eval-case-form__hint">{evaluatorDescription}</p>
        ) : null}
        {/* 대화에서 가져온 초안에만 — 실제로 나왔던 답을 보여만 준다(넣는 것은 사람이 누를 때다). */}
        {phraseHint !== null && draft.id === null ? (
          <div className="eval-case-form__candidate">
            <p className="eval-case-form__hint">{t("eval.case.form.expected.candidate")}</p>
            <p className="eval-case-form__candidate-said">{phraseHint}</p>
            <button
              type="button"
              className="button-ghost eval-case-form__candidate-take"
              onClick={() => setCaseDraft({ expectedText: withPhrase(draft.expectedText, phraseHint) })}
            >
              {t("eval.case.form.expected.candidate.take")}
            </button>
          </div>
        ) : null}
        <textarea
          id="eval-case-expected"
          className="control"
          placeholder={t("eval.case.form.expected.hint")}
          value={draft.expectedText}
          onChange={(event) => setCaseDraft({ expectedText: event.target.value })}
        />
      </div>

      <div className="eval-case-form__field">
        <label className="eval-case-form__label" htmlFor="eval-case-runs">
          {t("eval.case.form.runs.label")}
        </label>
        <input
          id="eval-case-runs"
          className="control"
          type="number"
          min={1}
          value={asText(draft.runsPerCase)}
          onChange={(event) => setCaseDraft({ runsPerCase: toNumber(event.target.value) })}
        />
      </div>

      <div className="eval-case-form__field">
        <label className="eval-case-form__label" htmlFor="eval-case-passes">
          {t("eval.case.form.passes.label")}
        </label>
        <input
          id="eval-case-passes"
          className="control"
          type="number"
          min={1}
          value={asText(draft.passesNeeded)}
          onChange={(event) => setCaseDraft({ passesNeeded: toNumber(event.target.value) })}
        />
        {exceeds ? (
          <p className="eval-case-form__error">{t("eval.case.form.passes.exceeds")}</p>
        ) : countTooLow ? (
          <p className="eval-case-form__error">{t("eval.case.form.count.tooLow")}</p>
        ) : null}
      </div>

      <div className="eval-case-form__actions">
        <button
          type="button"
          className="eval-case-form__save"
          disabled={!savable || saving}
          title={
            exceeds
              ? t("eval.case.form.passes.exceeds")
              : countTooLow
                ? t("eval.case.form.count.tooLow")
                : undefined
          }
          onClick={() => void saveCaseDraft()}
        >
          {t("eval.case.form.save")}
        </button>
        {draft.id ? (
          <button
            type="button"
            className="eval-case-form__delete"
            title={t("eval.case.delete.hint")}
            onClick={() => draft.id && void deleteCase(draft.id)}
          >
            {t("eval.case.delete")}
          </button>
        ) : null}
      </div>
      <p className="eval-case-form__save-caption">{t(saveCaptionKey(saving, synced))}</p>
    </div>
  );
}
