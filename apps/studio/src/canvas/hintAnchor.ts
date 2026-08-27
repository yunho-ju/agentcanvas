// 스스로 사라지는 안내가 설 자리 (DESIGN §7 connection-hint).
// 손이 있던 자리 아래에 서되, 화면 밖으로 나갈 자리라면 안쪽으로 물러선다.
import type { Position } from "../history/graphCommands";

export interface HintBox {
  width: number;
  height: number;
}

/** 화면에서 잰 네모 하나 — 어디에 얼마만 한 크기로 있는가. */
export interface HintRect extends HintBox {
  left: number;
  top: number;
}

/**
 * 포트 하나가 서 있는 자리 — 표면 안의 좌표로 옮긴 그 점의 한가운데.
 * 재는 일은 화면이 하고(브라우저만이 실제 자리를 안다), 옮기는 산수는 여기서 한다.
 */
export function portPoint(port: HintRect, surface: HintRect): Position {
  return {
    x: port.left - surface.left + port.width / 2,
    y: port.top - surface.top + port.height / 2,
  };
}

/** 아직 크기를 재지 못한 화면에서는 자리를 지어내지 않는다 — 손이 있던 자리 그대로 둔다. */
function within(at: number, size: number, reach: number, gap: number): number {
  if (reach === 0) return at;
  return Math.min(Math.max(at, gap), Math.max(reach - size - gap, gap));
}

export function hintAnchor(
  at: Position,
  surface: HintBox,
  hint: HintBox,
  gap: number,
): { left: number; top: number } {
  const below = at.y + gap;
  const fallsOff = surface.height > 0 && below + hint.height > surface.height;
  return {
    left: within(at.x - hint.width / 2, hint.width, surface.width, gap),
    top: fallsOff ? at.y - gap - hint.height : below,
  };
}
