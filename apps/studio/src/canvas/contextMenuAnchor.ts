// 오른쪽 클릭 메뉴가 설 자리 (DESIGN §7 context-menu).
// 누른 지점의 아래·오른쪽에 서되, 화면 밖으로 나갈 자리라면 안쪽으로 뒤집는다.
import type { Position } from "../history/graphCommands";
import type { HintBox, HintRect } from "./hintAnchor";

/** 그 축에서 메뉴가 시작할 자리 — 다 못 담을 자리면 누른 지점의 반대편으로, 그래도 화면 안쪽으로. */
function beside(at: number, size: number, reach: number, gap: number): number {
  const after = at + gap;
  const fallsOff = reach > 0 && after + size > reach;
  return Math.max(fallsOff ? at - gap - size : after, gap);
}

export function contextMenuAnchor(
  at: Position,
  surface: HintBox,
  menu: HintBox,
  gap: number,
): { left: number; top: number } {
  return {
    left: beside(at.x, menu.width, surface.width, gap),
    top: beside(at.y, menu.height, surface.height, gap),
  };
}

/**
 * 포인터가 없는 손짓(Shift+F10)이 가리키는 화면의 한 점 — 대상이 그려져 있으면 그 사각형의
 * 왼쪽 아래, 빈 곳이면 캔버스 한가운데다. 키보드로 연 메뉴가 화면 구석(0,0)에 서지 않는다.
 */
export function keyboardMenuPoint(target: HintRect | null, surface: HintRect): Position {
  if (target) return { x: target.left, y: target.top + target.height };
  return {
    x: surface.left + surface.width / 2,
    y: surface.top + surface.height / 2,
  };
}
