// 캔버스에서 오른쪽 클릭한 자리에 뜨는 메뉴 (DESIGN §7 context-menu).
// 있는 조작에 입구를 하나 더 다는 자리다 — 무엇을 할 수 있는지는 항목 표(contextMenuItems)가 안다.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useT } from "../i18n/useT";
import { useFocusInspector } from "../inspector/inspectorFocus";
import { DocMenuItem } from "../shell/DocMenuItem";
import { focusMenuItem, rovedByKey } from "../shell/docMenuFocus";
import type { ContextMenuRequest, ContextTarget } from "../store/contextMenuSlice";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";
import { contextMenuItems } from "./contextMenuItems";
import { contextMenuAnchor } from "./contextMenuAnchor";
import { drawnCanvas, drawnTarget } from "./drawnTarget";
import type { HintBox } from "./hintAnchor";
import { tokenLengthPx } from "./motion";
import { useOutsidePress } from "../hooks/useOutsidePress";

const NOT_MEASURED: HintBox = { width: 0, height: 0 };

/** 초점이 돌아갈 자리 — 그 대상이 초점을 받을 수 없으면 캔버스가 받는다(허공에 두지 않는다). */
function backFrom(target: ContextTarget): HTMLElement | SVGElement | null {
  const drawn = drawnTarget(target);
  return drawn?.hasAttribute("tabindex") ? drawn : drawnCanvas();
}

export function ContextMenu() {
  const request = useEditor((state) => state.contextMenu);
  const closeContextMenu = useEditor((state) => state.closeContextMenu);
  // 항목의 말과 잠금이 보는 것만 구독한다 — 표가 보는 것과 화면이 듣는 것이 같은 목록이다.
  const running = useEditor(isRunning);
  const breakpoints = useEditor((state) => state.breakpoints);
  const focusInspector = useFocusInspector();
  const menu = useRef<HTMLDivElement>(null);
  const wasOpen = useRef<ContextMenuRequest | null>(null);
  const [box, setBox] = useState<HintBox>(NOT_MEASURED);
  const [surface, setSurface] = useState<HintBox>(NOT_MEASURED);
  const t = useT();

  // 어디에 설지는 제 크기와 캔버스의 크기를 재 봐야 안다 (가장자리에서는 안쪽으로 뒤집는다).
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    setBox({ width: element.offsetWidth, height: element.offsetHeight });
    const parent = element.parentElement;
    setSurface({ width: parent?.clientWidth ?? 0, height: parent?.clientHeight ?? 0 });
  }, [request]);

  useEffect(() => {
    const container = menu.current;
    if (request && container) focusMenuItem(container, 0);
  }, [request]);

  // 닫히면 손은 메뉴를 연 대상으로 돌아온다. 다른 팝오버가 자리를 이어받아 손을 가져갔으면
  // 그대로 둔다 — 허공(body)에 떨어졌을 때만 데려온다 (DESIGN §7 doc-card와 같은 규칙).
  useEffect(() => {
    const opened = wasOpen.current;
    wasOpen.current = request;
    if (!opened || request) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    backFrom(opened.target)?.focus();
  }, [request]);

  useOutsidePress(request !== null, [menu], closeContextMenu);

  const items = request ? contextMenuItems(request, { running, breakpoints }) : [];
  if (!request || items.length === 0) return null;

  // Esc는 여기서 받지 않는다 — 무엇을 먼저 무를지는 화면 전체의 순서(canvas/shortcuts)가 정한다.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (rovedByKey(menu.current, event.key)) event.preventDefault();
  }

  const at = contextMenuAnchor(request.screen, surface, box, tokenLengthPx("--space-1"));
  return (
    <div
      ref={menu}
      className="context-menu layer"
      role="menu"
      aria-label={t("context.label")}
      style={{ left: at.left, top: at.top }}
      onKeyDown={onKeyDown}
    >
      {items.map((entry) => (
        <DocMenuItem
          key={entry.key}
          className="context-menu__item"
          disabled={entry.disabled !== null}
          title={entry.disabled ? t(entry.disabled) : undefined}
          onClick={() => {
            entry.run({ editor: useEditor.getState(), focusInspector });
            closeContextMenu();
          }}
        >
          {t(entry.key)}
        </DocMenuItem>
      ))}
    </div>
  );
}
