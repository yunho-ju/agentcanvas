// 이 문서가 가진 연결과 그 도구를 읽는 자리 (DESIGN §7 resources-panel).
// 목록은 읽기 전용이다 — 고치기·지우기는 아직 없고, 없는 기능을 있는 것처럼 말하지 않는다.
import type { ResourceBinding } from "../generated/agent_spec";
import { useT } from "../i18n/useT";
import { useDocResources } from "../inspector/useDocResources";
import { LOCKED_HINT } from "../run/lockWords";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";
import { ToolLines } from "./ToolList";
import { kindWord } from "./resourceWords";

function Connection({ binding }: { binding: ResourceBinding }) {
  const t = useT();
  const word = kindWord(binding.kind);
  const tools = binding.tools ?? [];

  return (
    <li className="resources-panel__connection">
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
