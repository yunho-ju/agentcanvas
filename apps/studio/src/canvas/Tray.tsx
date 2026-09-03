// 보관함 — 캔버스에서 뺀 노드가 설정을 그대로 지닌 채 기다리는 곳. 클릭하면 다시 꽂힌다.
import { cardTitle } from "../graph/cardName";
import { useLocale, useT } from "../i18n/useT";
import { LOCKED_HINT } from "../run/lockWords";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";

export function Tray() {
  const tray = useEditor((state) => state.tray);
  const restoreFromTray = useEditor((state) => state.restoreFromTray);
  const running = useEditor(isRunning);
  const locale = useLocale();
  const t = useT();

  return (
    <section className="tray" aria-label={t("tray.title")}>
      <h2 className="tray__title">{t("tray.title")}</h2>
      {tray.length === 0 ? (
        <p className="tray__empty">{t("tray.empty")}</p>
      ) : (
        <ul className="tray__list">
          {tray.map((node) => (
            <li key={node.id}>
              <button
                type="button"
                className="tray__item"
                disabled={running}
                title={running ? t(LOCKED_HINT) : t("tray.restore")}
                onClick={() => restoreFromTray(node.id)}
              >
                <span className="tray__name">
                  {cardTitle(node.data, locale)}
                </span>
                <span className="tray__id">{node.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
