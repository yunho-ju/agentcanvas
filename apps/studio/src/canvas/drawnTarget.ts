// 메뉴가 말하는 대상이 화면에 그려진 그 요소 (DESIGN §7 context-menu).
// 초점을 돌려보낼 자리와, 포인터 없이 연 메뉴가 설 자리가 함께 쓴다.
import type { ContextTarget } from "../store/contextMenuSlice";

/** 이름은 계약이 정한 id라 선택자에 그대로 끼운다. */
const SELECTOR: Record<"node" | "edge", (id: string) => string> = {
  node: (id) => `.react-flow__node[data-id="${id}"] .node-card`,
  edge: (id) => `.react-flow__edge[data-id="${id}"]`,
};

export function drawnTarget(target: ContextTarget): HTMLElement | SVGElement | null {
  if (target.kind === "pane") return null;
  return document.querySelector<HTMLElement | SVGElement>(SELECTOR[target.kind](target.id));
}

/** 캔버스 자신 — 대상이 없거나 초점을 받을 수 없을 때 손이 돌아갈 자리다. */
export function drawnCanvas(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="application"]');
}
