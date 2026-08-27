// 그래프를 그림이 아니라 목록으로 읽는 길 (설계 §13 접근성).
// 캔버스를 보지 않고도 무엇이 있는지 알고, 고르고, 뺄 수 있다.
// 여는 자리는 독의 아이콘이다 — 이 파일은 목록만 그린다.
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { useEditor } from "../store/editor";

export function NodeList() {
  const nodes = useEditor((state) => state.nodes);
  const select = useEditor((state) => state.select);
  const requestDetach = useEditor((state) => state.requestDetach);
  const fitNodes = useEditor((state) => state.fitNodes);
  const locale = useLocale();
  const t = useT();

  return (
    <section className="node-list" aria-label={t("nodeList.title")}>
      <h2 className="node-list__title">{t("nodeList.title")}</h2>
      <ul className="node-list__items">
        {nodes.map((node) => (
          <li key={node.id} className="node-list__row">
            <button
              type="button"
              className="node-list__name"
              aria-current={node.selected === true}
              title={t("nodeList.focus.hint")}
              onClick={() => select("node", node.id)}
              // 두 번 누르면 캔버스가 그 노드로 데려간다 — 목록에서 찾은 것을 그림에서도 찾는다.
              onDoubleClick={() => fitNodes([node.id])}
            >
              <span>
                {localized(node.data.nodeType?.display_name, locale) ||
                  node.data.spec.type}
              </span>
              <span className="node-list__id">{node.id}</span>
            </button>
            <button
              type="button"
              className="node-list__detach"
              onClick={() => requestDetach(node.id)}
            >
              {t("nodeList.detach", { id: node.id })}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
