// 실행이 물을 것이 있을 때 실행 버튼 아래에 서는 카드 (DESIGN §7 run-input-card).
// 무엇을 물을지는 화면이 정하지 않는다: 그래프의 입력 노드가 받는 값에서 나온 사실이다.
import { useMemo } from "react";
import { useT } from "../i18n/useT";
import { SchemaFields } from "../inspector/SchemaFields";
import { missingRequired } from "../inspector/schemaForm";
import { runInputFields } from "./runInput";
import { useEditor } from "../store/editor";

export function RunInputCard() {
  const open = useEditor((state) => state.runInputOpen);
  // 무엇을 물을지는 그래프에서 나온다 — 그래프가 그대로면 물음도 그대로다.
  const spec = useEditor((state) => state.spec);
  const nodes = useEditor((state) => state.nodes);
  const fields = useMemo(
    () => runInputFields(useEditor.getState().exportSpec()),
    [spec, nodes],
  );
  const values = useEditor((state) => state.runInputValues);
  // 저장·시작이 오가는 동안에는 이 버튼도 기다린다 — 조용한 무반응을 두지 않는다 (DESIGN §9).
  const saving = useEditor((state) => state.saving);
  const starting = useEditor((state) => state.startingRun);
  const setRunInputValue = useEditor((state) => state.setRunInputValue);
  const runWithInput = useEditor((state) => state.runWithInput);
  const closeRunInput = useEditor((state) => state.closeRunInput);
  const t = useT();

  // 물을 것이 없으면 카드도 없다 — 빈 카드를 띄우지 않는다.
  if (!open || fields.length === 0) return null;

  const unanswered = missingRequired(fields, values);

  return (
    <div className="run-input-card layer" role="dialog" aria-label={t("runInput.label")}>
      <p className="run-input-card__title">{t("runInput.title")}</p>
      <SchemaFields
        fields={fields}
        values={values}
        onChange={setRunInputValue}
        block="run-input-card"
        idPrefix="run-input"
      />
      <div className="run-input-card__actions">
        <button
          type="button"
          className="run-input-card__run"
          onClick={() => void runWithInput()}
          disabled={saving || starting || unanswered.length > 0}
          title={
            saving
              ? t("save.caption.saving")
              : starting
                ? t("run.starting")
                : unanswered.length > 0
                  ? t("runInput.blocked")
                  : undefined
          }
        >
          {t("runInput.confirm")}
        </button>
        <button
          type="button"
          className="run-input-card__cancel"
          onClick={closeRunInput}
        >
          {t("runInput.cancel")}
        </button>
      </div>
    </div>
  );
}
