// 선택된 노드의 설정. 폼은 registry의 config_schema가 그린다.
import { cardTitle } from "../graph/cardName";
import type { FlowNode } from "../graph/serialize";
import { skillWearIssues } from "../graph/nodeSetupIssues";
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { LOCKED_HINT } from "../run/lockWords";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";
import { docSkills } from "../store/skillSlice";
import { ConfigForm } from "./ConfigForm";
import { turnsCaptions } from "./turnsCaption";

export function NodeInspector({ node }: { node: FlowNode }) {
  const updateNodeConfig = useEditor((state) => state.updateNodeConfig);
  const toggleBreakpoint = useEditor((state) => state.toggleBreakpoint);
  const deleteSelection = useEditor((state) => state.deleteSelection);
  const running = useEditor(isRunning);
  const halting = useEditor((state) => state.breakpoints.includes(node.id));
  // 문서 전체를 봐야 아는 손볼 곳 — 입은 skill이 이 문서에 있는가 (validator skill.missing).
  const skills = useEditor(docSkills);
  const { nodeType, spec } = node.data;
  const locale = useLocale();
  const t = useT();
  const description = localized(nodeType?.plain_description, locale);

  return (
    <>
      <h2 className="inspector__title" title={description}>
        {cardTitle(node.data, locale)}
      </h2>
      <p className="inspector__id">{node.id}</p>
      {description ? <p className="inspector__hint">{description}</p> : null}
      {/* 손 밸브 — 재생을 이 노드 앞에서 세운다. 그래프에는 남지 않는다. */}
      <button
        type="button"
        className="inspector__breakpoint"
        aria-pressed={halting}
        title={t("breakpoint.hint")}
        onClick={() => toggleBreakpoint(node.id)}
      >
        <span className="inspector__breakpoint-mark" aria-hidden="true">
          ❚❚
        </span>
        {t("breakpoint.toggle")}
      </button>
      {/* 폼은 노드마다 제 것이다 — 고름/적음 같은 화면의 자세가 옆 노드로 새 나가지 않는다. */}
      <ConfigForm
        key={node.id}
        schema={nodeType?.config_schema}
        config={spec.config ?? {}}
        onChange={(config, options) => updateNodeConfig(node.id, config, options)}
        extraErrors={skillWearIssues(spec, nodeType, skills)}
        extraCaptions={turnsCaptions()}
      />
      {/* 지우는 길은 폼 맨 아래에 있다 — Delete 키가 가던 그 길로 간다 (DESIGN §7).
          잠그는 일은 이 폼을 감싼 fieldset이 이미 한다 — 이유만 여기서 말한다. */}
      <button
        type="button"
        className="inspector__delete"
        title={running ? t(LOCKED_HINT) : t("inspector.delete.hint")}
        onClick={deleteSelection}
      >
        {t("inspector.delete")}
      </button>
      {/* 되묻지 않는 대신, 무섭지 않다고 말한다. */}
      <p className="inspector__delete-undo">{t("inspector.delete.undo")}</p>
    </>
  );
}
