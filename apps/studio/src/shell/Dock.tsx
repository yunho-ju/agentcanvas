// 좌측 아이콘 독 — 캔버스를 나눠 갖지 않고, 부를 때만 옆으로 패널이 펼쳐진다.
import { useT } from "../i18n/useT";
import { DOCK_TOOLS, type DockPanelId } from "./dockTools";

export function Dock({
  openPanel,
  onToggle,
}: {
  openPanel: DockPanelId | null;
  onToggle: (id: DockPanelId) => void;
}) {
  const t = useT();
  const open = DOCK_TOOLS.find((tool) => tool.id === openPanel);
  const Panel = open?.panel;

  return (
    <div className="dock">
      <nav className="dock__rail layer" aria-label={t("dock.label")}>
        {DOCK_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="icon-button dock__button"
            aria-label={t(tool.name)}
            aria-expanded={tool.id === openPanel}
            title={`${t(tool.name)} — ${t(tool.hint)}`}
            onClick={() => onToggle(tool.id)}
          >
            <span className="dock__mark" aria-hidden="true">
              {tool.mark}
            </span>
          </button>
        ))}
      </nav>
      {Panel ? (
        <div className="dock__panel layer">
          <Panel />
        </div>
      ) : null}
    </div>
  );
}
