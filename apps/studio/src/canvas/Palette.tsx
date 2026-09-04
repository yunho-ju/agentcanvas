// 팔레트 — 노드 목록은 registry에서만 온다. 모든 항목은 이름과 함께 쉬운 설명을 보여준다.
import { placeNewNode } from "../graph/placement";
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { LOCKED_HINT } from "../run/lockWords";
import { nodeTypes } from "../registry/registry";
import { selectedNode, useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";
import { DocTools } from "./DocTools";
import { NodeTypeChip } from "./NodeTypeChip";
import { PatternShapes } from "./PatternShapes";

export function Palette() {
  const addNode = useEditor((state) => state.addNode);
  const running = useEditor(isRunning);
  const locale = useLocale();
  const t = useT();
  // 자리를 정하는 규칙은 순수 함수의 것이다 — 고른 카드 옆, 없으면 보고 있는 화면 안.
  // 그 재료는 누르는 순간의 캔버스에서 읽는다: 화면을 끌 때마다 팔레트를 다시 그리지 않는다.
  const placedAt = () => {
    const canvas = useEditor.getState();
    return placeNewNode({
      nodes: canvas.nodes,
      selectedId: selectedNode(canvas)?.id ?? null,
      viewport: canvas.viewportBox,
    });
  };

  return (
    <section className="palette" aria-label={t("palette.title")}>
      <h2 className="palette__title">{t("palette.title")}</h2>
      <ul className="palette__list">
        {Object.values(nodeTypes).map((nodeType) => (
          <li key={nodeType.type}>
            <button
              type="button"
              className="palette__item"
              disabled={running}
              title={
                running ? t(LOCKED_HINT) : localized(nodeType.plain_description, locale)
              }
              onClick={() => addNode(nodeType.type, placedAt())}
            >
              {/* 캔버스의 카드와 같은 칩 — 놓기 전에 무엇인지 알아본다. */}
              <NodeTypeChip type={nodeType.type} />
              <span className="palette__name">{localized(nodeType.display_name, locale)}</span>
              <span className="palette__hint">
                {localized(nodeType.plain_description, locale)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <DocTools at={placedAt} />
      <PatternShapes />
    </section>
  );
}
