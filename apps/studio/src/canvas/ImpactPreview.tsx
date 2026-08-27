// 노드를 빼기 전에 무엇이 망가지는지 보여주고 답을 받는다. 문장은 모두 쉬운 말이다.
import { useEffect, useRef } from "react";
import { analyzeDetach } from "../graph/impact";
import { impactLines } from "../graph/impactWords";
import type { FlowNode } from "../graph/serialize";
import type { Locale } from "../i18n/locale";
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { useEditor } from "../store/editor";

function nodeLabel(node: FlowNode, locale: Locale): string {
  const name = localized(node.data.nodeType?.display_name, locale);
  return name ? `${name} (${node.id})` : node.id;
}

export function ImpactPreview({ nodeId }: { nodeId: string }) {
  const confirmDetach = useEditor((state) => state.confirmDetach);
  const cancelDetach = useEditor((state) => state.cancelDetach);
  const nodes = useEditor((state) => state.nodes);
  const edges = useEditor((state) => state.edges);
  // 지금 이 순간의 그래프에서 다시 잰다 — 읽는 동안 그래프가 바뀌면 이 글도 바뀐다.
  const impact = analyzeDetach({ nodes, edges }, nodeId);
  const { unreachableNodes } = impact;
  const panel = useRef<HTMLElement>(null);
  const locale = useLocale();
  const t = useT();

  // 물음이 뜨면 초점이 물음으로 온다 — 답하는 키가 물음에 닿아야 한다.
  // 물음이 닫히면 초점은 원래 있던 캔버스로 돌아간다.
  useEffect(() => {
    panel.current?.focus();
    return () => {
      document.querySelector<HTMLElement>('[role="application"]')?.focus();
    };
  }, []);

  return (
    <section
      className="impact-preview"
      role="alertdialog"
      aria-label={t("impact.label")}
      ref={panel}
      tabIndex={-1}
    >
      <h2 className="impact-preview__title">{t("impact.title", { id: nodeId })}</h2>
      <ul className="impact-preview__lines">
        {impactLines(impact, "will").map((line) => (
          <li key={line.key}>{t(line)}</li>
        ))}
      </ul>
      {unreachableNodes.length > 0 ? (
        <>
          <p className="impact-preview__subtitle">{t("impact.subtitle")}</p>
          <ul className="impact-preview__nodes">
            {unreachableNodes.map((node) => (
              <li key={node.id}>{nodeLabel(node, locale)}</li>
            ))}
          </ul>
        </>
      ) : null}
      <div className="impact-preview__actions">
        <button
          type="button"
          className="impact-preview__confirm"
          onClick={confirmDetach}
        >
          {t("impact.confirm")}
        </button>
        <button type="button" className="impact-preview__cancel" onClick={cancelDetach}>
          {t("impact.cancel")}
        </button>
      </div>
    </section>
  );
}
