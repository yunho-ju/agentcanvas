// 11곳에 흩어져 있던 role="menuitem" + tabIndex={-1} 반복을 한 곳에 모은다 (DESIGN §7 doc-card).
import type { ButtonHTMLAttributes } from "react";

export function DocMenuItem(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button" role="menuitem" tabIndex={-1} />;
}
