// 되돌리기·다시하기 — 언제나 보이는 자리에 있다 (디자인 언어 §1.3 안심).
// 무엇이 되돌아가는지 이름으로 알려 준다 — 버튼을 누르기 전에 알 수 있어야 한다.
// 자리가 좁아지면 이 줄은 물러나고 같은 명령이 문서 메뉴에 선다 (DESIGN §1 상단 레이어 900↓).
import { useT } from "../i18n/useT";
import { useHistoryCommands } from "./historyCommands";
import { HISTORY_IN_MENU, useWidthMatch } from "./topLayout";

export function HistoryControls() {
  const commands = useHistoryCommands();
  const inMenu = useWidthMatch(HISTORY_IN_MENU);
  const t = useT();

  // 한 행동을 두 자리에 동시에 두지 않는다 — 좁은 화면에서는 문서 메뉴가 이 명령을 맡는다.
  if (inMenu) return null;

  return (
    <div className="history-controls layer">
      {commands.map((command) => (
        <button
          key={command.id}
          type="button"
          className={`icon-button history-controls__${command.id}`}
          aria-label={t(command.name)}
          onClick={command.run}
          disabled={command.disabled}
          title={t(command.hint)}
        >
          <span aria-hidden="true">{command.mark}</span>
        </button>
      ))}
    </div>
  );
}
