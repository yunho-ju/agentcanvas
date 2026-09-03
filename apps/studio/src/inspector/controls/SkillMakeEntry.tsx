// 지시문 칸에서 skill을 만드는 길 (DESIGN §7 skill-make-card) — 그리기만 한다.
// 두 조각이 한 흐름이다: 만들러 가는 손잡이와, 만들고 난 자리에 남는 말.
// 만들 수 있는 단계인지는 registry가 답한다 — 화면은 노드 타입 이름으로 분기하지 않는다.
import { useT } from "../../i18n/useT";
import { skillRefField } from "../../registry/registry";
import { LOCKED_HINT } from "../../run/lockWords";
import { selectedNode, useEditor } from "../../store/editor";
import { isRunning } from "../../store/runSlice";
import { skillMadeStillTrue } from "../../store/skillMakeSlice";

/** 이 단계가 skill을 입을 수 있는가 — 입을 칸이 없으면 만들어 줄 자리도 없다. */
function useWearingNode() {
  const node = useEditor(selectedNode);
  const nodeType = node?.data.nodeType;
  const field = nodeType ? skillRefField(nodeType) : undefined;
  return field ? node : undefined;
}

/** 적어 둔 지시문을 skill로 만들러 가는 손잡이 — 적힌 것이 없으면 잠그고 까닭을 말한다. */
export function SkillMakeEntry({ instruction }: { instruction: string }) {
  const node = useWearingNode();
  const running = useEditor(isRunning);
  const openSkillMake = useEditor((state) => state.openSkillMake);
  const t = useT();
  if (!node) return null;

  // 공백 한 칸은 적은 것이 아니다 — 실행기·케이스 제안과 같은 판정이다.
  const written = instruction.trim() !== "";
  const blocked = running
    ? LOCKED_HINT
    : written
      ? undefined
      : { key: "skillMake.entry.disabled" as const };

  return (
    <button
      type="button"
      className="button-ghost control__make-skill"
      disabled={blocked !== undefined}
      title={t(blocked ?? { key: "skillMake.entry.hint" })}
      onClick={() => openSkillMake(node.id, instruction)}
    >
      {t("skillMake.entry")}
    </button>
  );
}

/**
 * 만들고 난 자리에 남는 말 — 지시문은 그대로 두었고, 이 skill을 시험해 볼 수 있다.
 * 다른 단계를 고르면 이 말은 그 자리에 서지 않는다(그 단계의 일이 아니다).
 */
export function SkillMadeNote() {
  const node = useEditor(selectedNode);
  // 되돌리기로 그 걸음이 물러났으면 이 말도 참말이 아니다 — 문서에게 물어 그린다.
  const made = useEditor(skillMadeStillTrue);
  const forget = useEditor((state) => state.forgetSkillMade);
  const enterEvalMode = useEditor((state) => state.enterEvalMode);
  const focusSuggestAsk = useEditor((state) => state.focusSuggestAsk);
  const t = useT();
  if (!made || made.nodeId !== node?.id) return null;

  return (
    <div className="control__made-skill" role="status">
      <span className="control__made-line">{t("skillMake.made.kept")}</span>
      <span className="control__made-line">{t("skillMake.made.test")}</span>
      <div className="control__made-actions">
        <button
          type="button"
          className="button-ghost"
          title={t("skillMake.made.testAction.hint")}
          onClick={() => {
            // 새 표면을 만들지 않는다 — 있던 자리로 데려가 청하는 줄에 손을 놓는다.
            enterEvalMode();
            focusSuggestAsk();
          }}
        >
          {t("skillMake.made.testAction")}
        </button>
        <button type="button" className="button-ghost" onClick={forget}>
          {t("skillMake.made.dismiss")}
        </button>
      </div>
    </div>
  );
}
