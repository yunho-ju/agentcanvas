// 이 문서가 가진 연결과 그 도구를 보고, 고치고, 지우는 자리 (DESIGN §7 resources-panel).
// 고치기는 다시 가져오기(tool-wrap-card 재-import 모드), 지우기는 되돌릴 수 있는 로컬 편집이다.
import type { ApprovalPolicy, ResourceBinding } from "../generated/agent_spec";
import type { MessageKey } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { useDocResources } from "../inspector/useDocResources";
import { LOCKED_HINT } from "../run/lockWords";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";
import { ToolLines } from "./ToolList";
import { kindWord } from "./resourceWords";

/** 도구를 부를 때 사람 확인을 할지 — 값 둘을 쉬운 말로 고른다 (DESIGN §7 resources-panel). */
const POLICY_WORDS: { value: ApprovalPolicy; label: MessageKey }[] = [
  { value: "read_only_auto", label: "resources.policy.readOnlyAuto" },
  { value: "ask_first", label: "resources.policy.askFirst" },
];

function Connection({ binding }: { binding: ResourceBinding }) {
  const running = useEditor(isRunning);
  const reimport = useEditor((state) => state.reimportConnection);
  const drop = useEditor((state) => state.dropConnection);
  const setPolicy = useEditor((state) => state.setApprovalPolicy);
  const t = useT();
  const word = kindWord(binding.kind);
  const tools = binding.tools ?? [];
  // 정책을 적지 않은 연결은 기본값 — 바로 부른다.
  const policy = binding.approval_policy ?? "read_only_auto";

  return (
    <li className="resources-panel__connection" aria-label={binding.id}>
      <span className="resources-panel__name">{binding.id}</span>
      {/* 종류는 쉬운 말로 보여 주고, 계약의 원문은 title로만 남긴다. */}
      <span className="resources-panel__kind" title={binding.kind}>
        {word ? t(word) : binding.kind}
      </span>
      {tools.length === 0 ? (
        <span className="resources-panel__no-tools">{t("control.toolSelect.empty")}</span>
      ) : (
        <ul className="resources-panel__tools">
          {tools.map((tool) => (
            <li className="resources-panel__tool" key={tool.name}>
              <ToolLines tool={tool} />
            </li>
          ))}
        </ul>
      )}
      <label className="resources-panel__policy">
        <span className="resources-panel__policy-label">
          {t("resources.policy.label")}
        </span>
        <select
          className="control resources-panel__policy-select"
          value={policy}
          disabled={running}
          title={running ? t(LOCKED_HINT) : undefined}
          onChange={(event) =>
            setPolicy(binding.id, event.target.value as ApprovalPolicy)
          }
        >
          {POLICY_WORDS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
      </label>
      <div className="resources-panel__actions">
        <button
          type="button"
          className="button-ghost resources-panel__reimport"
          disabled={running}
          title={running ? t(LOCKED_HINT) : t("resources.reimport.hint")}
          onClick={() => reimport(binding.id)}
        >
          {t("resources.reimport")}
        </button>
        {/* 지우기는 inspector 카드의 지우기 문법 그대로 — 되묻지 않고, 되돌리기가 지킨다. */}
        <button
          type="button"
          className="button-ghost resources-panel__delete"
          disabled={running}
          title={running ? t(LOCKED_HINT) : t("resources.delete.hint")}
          onClick={() => drop(binding.id)}
        >
          {t("resources.delete")}
        </button>
      </div>
      {/* 되묻지 않는 대신 무섭지 않다고 말하는 한 줄 — inspector의 그 문장 그대로. */}
      <span className="resources-panel__undo">{t("inspector.delete.undo")}</span>
    </li>
  );
}

export function ResourcesPanel() {
  const { bindings } = useDocResources();
  const running = useEditor(isRunning);
  const openToolWrap = useEditor((state) => state.openToolWrap);
  const t = useT();

  return (
    <section className="resources-panel" aria-label={t("resources.title")}>
      <h2 className="resources-panel__title">{t("resources.title")}</h2>
      {bindings.length === 0 ? (
        <p className="resources-panel__empty">{t("resources.empty")}</p>
      ) : (
        <ul className="resources-panel__list">
          {bindings.map((binding) => (
            <Connection binding={binding} key={binding.id} />
          ))}
        </ul>
      )}
      <button
        type="button"
        className="button-primary resources-panel__new"
        disabled={running}
        title={running ? t(LOCKED_HINT) : t("resources.new.hint")}
        onClick={openToolWrap}
      >
        {t("resources.new")}
      </button>
    </section>
  );
}
