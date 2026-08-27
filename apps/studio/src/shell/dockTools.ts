// 독에 선 도구들의 표. 도구가 하나 늘면 여기에 한 줄을 더한다 (분기 대신 표).
import type { ComponentType } from "react";
import type { MessageKey } from "../i18n/messages";
import { NodeList } from "../canvas/NodeList";
import { Palette } from "../canvas/Palette";
import { Tray } from "../canvas/Tray";

export type DockPanelId = "palette" | "tray" | "nodes";

export interface DockTool {
  id: DockPanelId;
  /** 아이콘의 이름 — 펼쳐지는 패널의 이름과 같다 */
  name: MessageKey;
  /** 무엇을 하는 자리인지 한 줄 설명 (tooltip) */
  hint: MessageKey;
  /** 글이 아니라 그림으로 알아보게 하는 기호 */
  mark: string;
  panel: ComponentType;
}

export const DOCK_TOOLS: DockTool[] = [
  {
    id: "palette",
    name: "palette.title",
    hint: "palette.hint",
    mark: "+",
    panel: Palette,
  },
  {
    id: "tray",
    name: "tray.title",
    hint: "tray.hint",
    mark: "▤",
    panel: Tray,
  },
  {
    id: "nodes",
    name: "nodeList.title",
    hint: "nodeList.hint",
    mark: "≡",
    panel: NodeList,
  },
];
