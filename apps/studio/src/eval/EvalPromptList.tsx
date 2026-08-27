// 지금 시험받는 지시문 — 읽기 전용 투영 (DESIGN §7 eval-prompt-card).
// 고치는 곳은 인스펙터 하나뿐이라, 카드는 그 노드를 고르는 일까지만 한다.
import { useMemo } from "react";
import { promptsUnderTest } from "./promptsUnderTest";
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { nodeTypes } from "../registry/registry";
import { useEditor } from "../store/editor";

export function EvalPromptList() {
  // exportSpec 자체는 늘 같은 함수라 의존성이 되지 못한다 — 그래프가 실제로 바뀌는 nodes·edges를 봐야
  // 패널이 열려 있는 동안 지시문을 고쳐도 카드가 따라온다(EvalCaseForm과 같은 문법).
  const exportSpec = useEditor((state) => state.exportSpec);
  const nodes = useEditor((state) => state.nodes);
  const edges = useEditor((state) => state.edges);
  const select = useEditor((state) => state.select);
  const locale = useLocale();
  const t = useT();

  const prompts = useMemo(
    () => promptsUnderTest(exportSpec(), nodeTypes),
    [exportSpec, nodes, edges],
  );

  // 지시문을 가질 수 있는 노드가 하나도 없으면 구역 자체가 없다 — 빈 상자를 세우지 않는다.
  if (prompts.length === 0) return null;

  return (
    <section className="eval-prompts" aria-label={t("eval.prompt.label")}>
      <p className="eval-prompts__label">{t("eval.prompt.label")}</p>
      {prompts.map((prompt) => {
        const name = localized(prompt.displayName, locale);
        return (
          <button
            key={prompt.nodeId}
            type="button"
            className="eval-prompt-card"
            aria-label={t("eval.prompt.card.label", { name })}
            title={t("eval.prompt.hint")}
            onClick={() => select("node", prompt.nodeId)}
          >
            <span className="eval-prompt-card__name">{name}</span>
            <span className="eval-prompt-card__node">{prompt.nodeId}</span>
            <span className="eval-prompt-card__instruction" data-empty={prompt.instruction === ""}>
              {prompt.instruction === "" ? t("eval.prompt.empty") : prompt.instruction}
            </span>
          </button>
        );
      })}
    </section>
  );
}
