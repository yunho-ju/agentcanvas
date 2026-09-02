// 되돌리기·다시하기 두 명령의 사실 — 무엇을 되돌리는지, 지금 되돌릴 수 있는지.
// 상단의 버튼과 좁은 화면의 문서 메뉴가 같은 이 표를 그린다 (DESIGN §1 상단 레이어 900↓).
import { type Message, msg } from "../i18n/messages";
import type { MessageKey } from "../i18n/messages";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";

export interface HistoryCommand {
  id: "undo" | "redo";
  /** 명령의 이름 — 어느 자리에서 그리든 같은 말로 부른다 */
  name: MessageKey;
  /** 글이 아니라 그림으로 알아보게 하는 기호 */
  mark: string;
  /** 무엇이 되돌아가는지, 되돌릴 것이 없으면 그 까닭 */
  hint: Message;
  disabled: boolean;
  run: () => void;
}

export function useHistoryCommands(): HistoryCommand[] {
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  // 실행을 보는 동안 그래프는 잠긴다 — 보기만 하고 고치지 않는다.
  const running = useEditor(isRunning);
  const lastEdit = useEditor((state) => state.undoStack.at(-1));
  const nextEdit = useEditor((state) => state.redoStack.at(-1));

  return [
    {
      id: "undo",
      name: "history.undo",
      mark: "↺",
      hint: lastEdit
        ? msg("history.undo.of", { edit: lastEdit.label })
        : msg("history.undo.none"),
      disabled: lastEdit === undefined || running,
      run: undo,
    },
    {
      id: "redo",
      name: "history.redo",
      mark: "↻",
      hint: nextEdit
        ? msg("history.redo.of", { edit: nextEdit.label })
        : msg("history.redo.none"),
      disabled: nextEdit === undefined || running,
      run: redo,
    },
  ];
}
