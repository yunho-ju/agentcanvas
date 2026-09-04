// 문서 메뉴(role=menu) 안 항목(role=menuitem) 사이를 오가는 roving 초점 —
// 순수 계산(다음 자리가 몇 번째인가)과 DOM 반영(그 자리에 tabindex·초점을 준다)을 나눈다.
export type RovingKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/** ↑↓Home/End가 가리키는 다음 항목의 자리 — 끝에서 반대편으로 돈다. */
export function rovedMenuFocus(current: number, key: RovingKey, count: number): number {
  if (count === 0) return current;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "Home") return 0;
  return count - 1; // "End"
}

export function menuItemsIn(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]'));
}

/** 잠긴 항목은 초점을 받을 수 없다(브라우저가 그렇다) — roving은 살아 있는 항목만 오간다. */
export function focusableMenuItemsIn(container: Element): HTMLElement[] {
  return menuItemsIn(container).filter(
    (item) => !item.hasAttribute("disabled") && item.getAttribute("aria-disabled") !== "true",
  );
}

/** 그 자리에만 tabindex 0을 주고(roving) 초점을 옮긴다 — index는 살아 있는 항목 사이의 자리다. */
export function focusMenuItem(container: Element, index: number): void {
  const items = menuItemsIn(container);
  const focusable = focusableMenuItemsIn(container);
  const target = focusable[index];
  items.forEach((item) => item.setAttribute("tabindex", item === target ? "0" : "-1"));
  target?.focus();
}

/** 눌린 키가 오가는 키였으면 초점을 옮기고 그렇다고 답한다 — 아니면 그 키는 메뉴의 것이 아니다. */
export function rovedByKey(container: Element | null, key: string): boolean {
  const roving = (["ArrowDown", "ArrowUp", "Home", "End"] as const).find(
    (candidate) => candidate === key,
  );
  if (!roving || !container) return false;
  const items = focusableMenuItemsIn(container);
  const current = items.indexOf(document.activeElement as HTMLElement);
  focusMenuItem(container, rovedMenuFocus(current, roving, items.length));
  return true;
}
