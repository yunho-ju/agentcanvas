// 되돌리기·다시하기 — 언제나 보이는 자리에 있다 (디자인 언어 §1.3 안심).
// 무엇이 되돌아가는지 이름으로 알려 준다 — 버튼을 누르기 전에 알 수 있어야 한다.
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";

export function HistoryControls() {
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  const running = useEditor(isRunning);
  const lastEdit = useEditor((state) => state.undoStack.at(-1));
  const nextEdit = useEditor((state) => state.redoStack.at(-1));
  const t = useT();

  return (
    <div className="history-controls layer">
      <button
        type="button"
        className="icon-button history-controls__undo"
        aria-label={t("history.undo")}
        onClick={undo}
        disabled={lastEdit === undefined || running}
        title={
          lastEdit
            ? t("history.undo.of", { edit: lastEdit.label })
            : t("history.undo.none")
        }
      >
        <span aria-hidden="true">↺</span>
      </button>
      <button
        type="button"
        className="icon-button history-controls__redo"
        aria-label={t("history.redo")}
        onClick={redo}
        disabled={nextEdit === undefined || running}
        title={
          nextEdit
            ? t("history.redo.of", { edit: nextEdit.label })
            : t("history.redo.none")
        }
      >
        <span aria-hidden="true">↻</span>
      </button>
    </div>
  );
}
