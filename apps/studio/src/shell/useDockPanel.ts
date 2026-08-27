// 독에서 지금 어느 도구가 펼쳐져 있는가 — 한 번에 하나다.
// 캔버스 위에 뜨는 것들의 상태는 그래프의 상태가 아니므로 store에 두지 않는다.
import { useState } from "react";
import type { DockPanelId } from "./dockTools";

export interface DockPanel {
  openPanel: DockPanelId | null;
  /** 같은 도구를 다시 부르면 닫힌다 */
  toggle: (id: DockPanelId) => void;
  close: () => void;
}

export function useDockPanel(): DockPanel {
  const [openPanel, setOpenPanel] = useState<DockPanelId | null>(null);
  return {
    openPanel,
    toggle: (id) => setOpenPanel((current) => (current === id ? null : id)),
    close: () => setOpenPanel(null),
  };
}
