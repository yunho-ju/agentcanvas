// 팔레트 — 노드 목록은 registry에서만 온다. 모든 항목은 이름과 함께 쉬운 설명을 보여준다.
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { LOCKED_HINT } from "../run/lockWords";
import { nodeTypes } from "../registry/registry";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";
import { DocTools } from "./DocTools";
import { NodeTypeChip } from "./NodeTypeChip";

export function Palette() {
  const addNode = useEditor((state) => state.addNode);
  const count = useEditor((state) => state.nodes.length);
  const running = useEditor(isRunning);
  const locale = useLocale();
  const t = useT();
  // 놓이는 자리는 이미 놓인 노드 수를 따라 조금씩 어긋난다 — 카드가 서로를 가리지 않는다.
  const placedAt = (offset: number) => ({
    x: 120 + (count + offset) * 24,
    y: 120 + (count + offset) * 24,
  });

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
              onClick={() => addNode(nodeType.type, placedAt(0))}
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
      <DocTools at={(index) => placedAt(index)} />
    </section>
  );
}
